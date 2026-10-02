import { db } from '../db/models.js';
import '../models/Taxonomy.js';
import '../models/Product.js';
import { HAS_PICTURE } from '../../../shared/partPhotos.js';
import { currentBusinessId } from '../db/context.js';
import { categoryFilter, invalidateCatalog } from './catalogService.js';

/**
 * Normalises the component-type argument, which is multi-select.
 *
 * The wizard and the mega menu both let a buyer tick several component types at
 * once, so this arrives as a comma-joined string or an array. One type and many
 * behave identically everywhere below; the singular case is just a list of one.
 */
function toPartTypes(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(list.map((item) => String(item).trim()).filter(Boolean))].sort();
}

/**
 * Caches, keyed by business and category (2026-10-01).
 *
 * They were module-level single values, so with one process serving every
 * business the first shop to ask filled the cache for all of them. Keyed now,
 * which also gives each part-kind category (Parts, and any a business adds)
 * its own tree.
 */
const TTL_MS = 5 * 60 * 1000;
const treeCache = new Map();

/** Where a product filed at no level is counted: above every root. */
const ROOT = Symbol('root');

/**
 * "Any" (2026-10-03): a product filed no deeper than a node fits every entry
 * under it, and the website's filters show it under each one
 * (`productService.levelClause`). So each node also counts what its ancestors
 * hold themselves, or a filter would read "0" over a grid that is not empty.
 * Runs after the rollup, which counts each node's own and deeper products.
 */
function addFitsAll(nodes, ownCounts, carry = ownCounts.get(ROOT) ?? 0) {
  for (const node of nodes) {
    const own = ownCounts.get(node.slug) ?? 0;
    addFitsAll(node.children, ownCounts, carry + own);
    node.count += carry;
  }
}
const keyOf = (category, extra = '') =>
  [String(currentBusinessId() ?? 'default'), category || 'parts', extra].join('|');

/**
 * Pruned trees, keyed by component type.
 *
 * Small and bounded - one entry per part type, ~25 of them - and each is the
 * same shape as the full tree, so the client cannot tell which it got.
 */
const prunedCache = new Map();

/**
 * Returns the whole category tree in one payload.
 *
 * The sidebar, mega menu and tab wizard all render from this single response
 * three sources would drift. It changes rarely, so it is cached in process.
 */
async function getTree({ force = false, category = 'parts' } = {}) {
  const key = keyOf(category);
  const hit = treeCache.get(key);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.value;

  // A first level's entries (Component Type) are not part of the device tree.
  const nodes = await db()
    .Taxonomy.find({ ...categoryFilter(category), kind: { $ne: 'partType' } })
    .sort({ order: 1, name: 1 })
    .lean();

  /**
   * Counts come from the PRODUCTS, not from the stored `productCount`.
   *
   * `Taxonomy.productCount` is denormalised and counts every product under a
   * node, including the ones the catalogue refuses to list because it has no
   * picture for them (`HAS_PICTURE` - see productService.buildQuery). So the
   * sidebar offered "Smartphone 212" and the grid behind it answered 116, and
   * "Tablet 54" opened an empty catalogue. A count beside a filter is a promise
   * about what clicking it returns, and these were promising stock that cannot
   * be shown.
   *
   * The pruned tree (getTreeForPartType, below) already counted this way. This
   * is the same aggregate without the component-type match, so the two agree.
   */
  const groups = await db().Product.aggregate([
    { $match: { isActive: true, ...HAS_PICTURE, ...categoryFilter(category) } },
    {
      $group: {
        _id: {
          deviceType: '$deviceTypeSlug',
          brand: '$brandSlug',
          series: '$seriesSlug',
          model: '$modelSlug',
          level5: '$level5Slug',
          level6: '$level6Slug',
        },
        count: { $sum: 1 },
      },
    },
  ]);

  // A product counts at the deepest level it is filed at: the model on a
  // four-level type, the brand on a two-level one (finder depth per type,
  // 2026-10-02). Every level above is the rollup below.
  const modelCounts = new Map();
  const live = new Set();
  for (const group of groups) {
    const { deviceType, brand, series, model, level5, level6 } = group._id;
    for (const slug of [deviceType, brand, series, model, level5, level6]) {
      if (slug) live.add(slug);
    }
    const leaf = level6 || level5 || model || series || brand || deviceType;
    // Filed at no level at all: "Any" from the first, so it fits every entry.
    modelCounts.set(leaf || ROOT, (modelCounts.get(leaf || ROOT) ?? 0) + group.count);
  }

  const byId = new Map();
  for (const node of nodes) {
    byId.set(node._id.toString(), {
      id: node._id.toString(),
      kind: node.kind,
      name: node.name,
      slug: node.slug,
      icon: node.icon ?? null,
      isFeatured: Boolean(node.isFeatured),
      count: modelCounts.get(node.slug) ?? 0,
      path: node.path ?? {},
      children: [],
    });
  }

  const roots = [];
  for (const node of nodes) {
    const shaped = byId.get(node._id.toString());
    if (node.parent) {
      byId.get(node.parent.toString())?.children.push(shaped);
    } else {
      roots.push(shaped);
    }
  }

  // Roll counts up so a device type shows the sum of its models, not zero,
  // plus anything filed at that level itself.
  const rollup = (node) => {
    if (node.children.length === 0) return node.count;
    node.count += node.children.reduce((sum, child) => sum + rollup(child), 0);
    return node.count;
  };
  roots.forEach(rollup);
  addFitsAll(roots, modelCounts);

  // Drop what the catalogue cannot show. A branch counting zero is a filter
  // that opens an empty grid, and offering it is the dead end the pruned tree
  // exists to prevent - the unpruned one should not reintroduce it. Kept if it
  // counts anything itself or still has a child that does.
  const prune = (list) =>
    list
      .map((node) => ({ ...node, children: prune(node.children) }))
      .filter((node) => node.count > 0 || node.children.length > 0);

  const value = { tree: prune(roots) };
  treeCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * The same tree, containing only the branches that actually stock one component
 * type - and counting only that component's products.
 *
 * The wizard asks for a component FIRST (§5.3), so every level below it has to
 * answer "which device types / brands / series / models can I get a battery
 * for". Returning the full tree there walks a buyer into a dead end: they pick
 * Optical Drive, then Smartphone, and land on an empty grid having been offered
 * the combination by us.
 *
 * The counts come from the products themselves rather than from the stored
 * `productCount`, which is a total across every part type and would tell a
 * buyer looking at batteries that Samsung has 97 of them.
 */
async function getTreeForPartType(partType, category = 'parts') {
  const types = toPartTypes(partType);
  if (types.length === 0) return getTree({ category });

  // Sorted and joined, so ticking A then B and ticking B then A are one entry.
  const key = keyOf(category, types.join(','));

  const hit = prunedCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  // One pass over the matching products gives the exact count for every node in
  // the tree at once: a model's count is its own group, and the levels above it
  // are the rollup that getTree() already does.
  //
  // `HAS_PICTURE` because the grid applies it: without it a buyer ticking a
  // component type would be offered brands and models whose products the grid
  // then hides, which is the dead end this pruning exists to prevent.
  const groups = await db().Product.aggregate([
    { $match: { partType: { $in: types }, isActive: true, ...HAS_PICTURE, ...categoryFilter(category) } },
    {
      $group: {
        _id: {
          deviceType: '$deviceTypeSlug',
          brand: '$brandSlug',
          series: '$seriesSlug',
          model: '$modelSlug',
          level5: '$level5Slug',
          level6: '$level6Slug',
        },
        count: { $sum: 1 },
      },
    },
  ]);

  // Every slug that survives, at any level - a node is kept when its own slug
  // appears, which for a leaf means it has stock and for a parent means one of
  // its descendants does.
  const live = new Set();
  const modelCounts = new Map();
  for (const group of groups) {
    const { deviceType, brand, series, model, level5, level6 } = group._id;
    for (const slug of [deviceType, brand, series, model, level5, level6]) {
      if (slug) live.add(slug);
    }
    // At the deepest level filed, as in getTree.
    const leaf = level6 || level5 || model || series || brand || deviceType;
    // Filed at no level at all: "Any" from the first, so it fits every entry.
    modelCounts.set(leaf || ROOT, (modelCounts.get(leaf || ROOT) ?? 0) + group.count);
  }

  const { tree: full } = await getTree({ category });

  // `fits`: a product above this node was set to "Any" below it, so the node
  // opens a grid that shows it even when nothing is filed here.
  const prune = (nodes, fits = (modelCounts.get(ROOT) ?? 0) > 0) =>
    nodes
      .filter((node) => fits || live.has(node.slug))
      .map((node) => {
        const children = prune(node.children ?? [], fits || (modelCounts.get(node.slug) ?? 0) > 0);
        return {
          ...node,
          children,
          count: (modelCounts.get(node.slug) ?? 0) + children.reduce((sum, child) => sum + child.base, 0),
        };
      })
      .map((node) => ({ ...node, base: node.count }))
      // A branch that kept no children and counts nothing is a node whose slug
      // matched but whose products all sit under a level we dropped.
      .filter((node) => node.count > 0 || node.children.length > 0 || fits);

  const pruned = prune(full);
  addFitsAll(pruned, modelCounts);
  const drop = (nodes) => nodes.filter((node) => node.count > 0).map(({ base, ...node }) => ({ ...node, children: drop(node.children) }));
  const result = { tree: drop(pruned) };
  prunedCache.set(key, { at: Date.now(), value: result });
  return result;
}

const componentCache = new Map();

/**
 * Every component type in the catalogue, with its label and how many live
 * products carry it.
 *
 * This is step 1 of the wizard, so it is deliberately NOT derived from the
 * taxonomy tree: a component type cuts across the tree (a battery exists for
 * phones, laptops and watches alike) and has no node of its own.
 */
async function getComponentTypes(category = 'parts') {
  const key = keyOf(category);
  const hit = componentCache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  // `HAS_PICTURE` so this counts what the grid will actually show. Counted
  // without it, a component type whose every product is pictureless would be
  // offered as step 1 of the wizard and lead straight to an empty grid - and
  // the counts beside the live types would overstate by the hidden rows.
  const rows = await db().Product.aggregate([
    { $match: { isActive: true, ...HAS_PICTURE, ...categoryFilter(category) } },
    {
      $group: {
        _id: '$partType',
        label: { $first: '$partTypeLabel' },
        count: { $sum: 1 },
      },
    },
    { $sort: { label: 1 } },
  ]);

  const value = {
    componentTypes: rows
      .filter((row) => row._id)
      .map((row) => ({ slug: row._id, name: row.label || row._id, count: row.count })),
  };
  componentCache.set(key, { at: Date.now(), value });
  return value;
}

/** Call after any catalogue mutation so the next request rebuilds the tree. */
function invalidateTree() {
  treeCache.clear();
  prunedCache.clear();
  componentCache.clear();
  // The Phones and Services trees are built from the same collection.
  invalidateCatalog();
}

export { getTree, getTreeForPartType, getComponentTypes, invalidateTree };
