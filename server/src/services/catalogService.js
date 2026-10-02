import { db } from '../db/models.js';
import { currentBusinessId } from '../db/context.js';
import '../models/CatalogCategory.js';
import '../models/Taxonomy.js';
import '../models/Product.js';
import '../models/PreownedDevice.js';
import '../models/Service.js';
import '../models/DeviceCatalog.js';
import ApiError from '../utils/ApiError.js';
import {
  ATTRIBUTE_KEY_PATTERN,
  DEFAULT_REPAIR_TYPES,
  GRADE_VALUE_PATTERN,
  SYSTEM_CATEGORIES,
  SYSTEM_SLUGS,
  SYSTEM_MAX_LEVELS,
  TREE_LEVEL_KEYS,
  attributeKeyOf,
  categoryPath,
  gradeValueOf,
  taxonomySlug,
} from '../../../shared/catalog.js';

/**
 * Catalogue categories and the taxonomy trees behind the Phones and Services
 * pages (client ruling, 2026-10-01; the vocabulary is in `shared/catalog.js`).
 *
 * The Parts tree keeps its own builder (`taxonomyService`), which counts
 * products and has been tuned for that for months. This file is the other two:
 * the Phones tree counts listed handsets, and the Services tree counts the
 * services that APPLY to each device, which is a different question from
 * "what is filed under it" (a "Screen replacement" scoped to nothing applies
 * to every phone, so it counts under every phone).
 *
 * ## Where the two new trees come from
 *
 * A business that has never touched them still gets a working finder: the
 * first read copies its own "Devices taken in" list (`DeviceCatalog`) into
 * the category, which is exactly the list of devices it repairs and buys. From
 * then on the tree is the category's own and is edited in Device & Models.
 * Nothing is copied twice: a category with any node is left alone.
 */

const slugify = (value) =>
  String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * The nodes of one category's tree. A node with no `category` is a Parts node:
 * every node written before categories existed, so Parts needed no migration.
 */
export function categoryFilter(slug) {
  return !slug || slug === 'parts' ? { category: { $in: [null, 'parts'] } } : { category: slug };
}

/** The same rule for products: no `category` is Parts. */
export const productCategoryFilter = categoryFilter;

// ---- caches -------------------------------------------------------------------

const TTL_MS = 5 * 60 * 1000;
const cache = new Map();
/** Businesses whose system categories and seeded trees were already checked in this process. */
const ensured = new Set();

/**
 * Keyed by business as well as by question. The process serves every
 * business, and a module-level cache keyed only on the category would hand
 * one shop's tree to the next.
 */
const keyOf = (...parts) => [String(currentBusinessId() ?? 'default'), ...parts].join('|');

async function cached(key, build) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await build();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Call after anything that changes a tree, a phone's listing or the service list. */
export function invalidateCatalog() {
  cache.clear();
}

// ---- categories ---------------------------------------------------------------

/** The level `required` defaults for a system type, by key. */
const systemRequired = (system, key) => system?.levels?.find((level) => level.key === key)?.required !== false;

/**
 * The three system categories, written once per business if missing, and
 * brought up to what the ERP expects of them now (2026-10-02): every level
 * says whether it is required, every product type has its grades, Phones are
 * products with stock (`kind: 'part'`, with Storage and Colour features and
 * phone grades), and a type's first level has its entries in the tree. Each
 * step fills only what is missing, so a business's own names and lists are
 * never overwritten.
 */
async function ensureSystemCategories() {
  const key = keyOf('system');
  if (ensured.has(key)) return;

  for (const system of SYSTEM_CATEGORIES) {
    await db().CatalogCategory.updateOne(
      { slug: system.slug },
      {
        $setOnInsert: {
          slug: system.slug,
          name: system.name,
          kind: system.kind,
          description: system.description,
          facetLabel: system.facetLabel,
          facetRequired: system.facetRequired,
          levels: system.levels,
          grades: system.grades,
          attributes: system.attributes,
          isSystem: true,
          isActive: true,
          order: system.order,
        },
      },
      { upsert: true },
    );

    const raw = await db().CatalogCategory.findOne({ slug: system.slug }).lean();
    const set = {};
    if (system.slug === 'phones' && raw.kind === 'phone') set.kind = 'part';
    if (raw.grades === undefined && system.grades.length) set.grades = system.grades;
    if (system.slug === 'phones' && !raw.attributes?.length) set.attributes = system.attributes;
    if (raw.facetRequired === undefined) set.facetRequired = system.facetRequired;
    if ((raw.levels ?? []).some((level) => level.required === undefined)) {
      set.levels = (raw.levels?.length ? raw.levels : system.levels).map((level) => ({
        key: level.key,
        label: level.label,
        required: level.required ?? systemRequired(system, level.key),
      }));
    }
    if (Object.keys(set).length) await db().CatalogCategory.updateOne({ _id: raw._id }, { $set: set });
  }

  // A type a business added before grades existed keeps the five it was sold under.
  await db().CatalogCategory.updateMany(
    { kind: 'part', grades: { $exists: false } },
    { $set: { grades: SYSTEM_CATEGORIES[0].grades } },
  );

  ensured.add(key);
  for (const row of await db().CatalogCategory.find({ facetLabel: { $nin: [null, ''] } }).lean()) {
    await ensureFirstLevel(row);
  }
}

function shapeAttribute(attribute) {
  return {
    key: attribute.key,
    label: attribute.label,
    type: attribute.type ?? 'select',
    options: attribute.type === 'select' ? (attribute.options ?? []) : [],
    unit: attribute.unit ?? '',
    required: Boolean(attribute.required),
    inventory: attribute.inventory !== false,
    filter: Boolean(attribute.filter),
    product: attribute.product !== false,
  };
}

/**
 * A category's features as saved (2026-10-02).
 *
 * A feature keeps the key it was created with, whatever it is renamed to,
 * because every product's answer is filed under that key. A new one takes
 * its key from its name, made unique within the category. Options only
 * belong to a list feature, and they are de-duplicated as typed.
 */
function normaliseAttributes(input = [], existing = []) {
  const known = new Set(existing.map((attribute) => attribute.key));
  const used = new Set();
  return input.map((attribute) => {
    let key = attribute.key && known.has(attribute.key) ? attribute.key : attributeKeyOf(attribute.label);
    if (!ATTRIBUTE_KEY_PATTERN.test(key)) key = 'feature';
    const base = key;
    for (let n = 2; used.has(key); n += 1) key = `${base}-${n}`.slice(0, 40);
    used.add(key);
    const type = ['select', 'text', 'number', 'boolean'].includes(attribute.type) ? attribute.type : 'select';
    return {
      key,
      label: attribute.label,
      type,
      options: type === 'select' ? [...new Set((attribute.options ?? []).map((option) => option.trim()).filter(Boolean))] : [],
      unit: type === 'number' ? (attribute.unit ?? '') : '',
      required: Boolean(attribute.required),
      inventory: attribute.inventory !== false,
      filter: Boolean(attribute.filter),
      product: attribute.product !== false,
    };
  });
}

/**
 * A type's grades as saved: a grade keeps the value it was created with
 * whatever it is renamed to (every product stores it), a new one takes its
 * value from its name, made unique.
 */
function normaliseGrades(input = [], existing = []) {
  const known = new Set(existing.map((grade) => grade.value));
  const used = new Set();
  return input
    .filter((grade) => String(grade.label ?? '').trim())
    .map((grade) => {
      let value = grade.value && known.has(grade.value) ? grade.value : gradeValueOf(grade.label);
      if (!GRADE_VALUE_PATTERN.test(value)) value = 'GRADE';
      const base = value;
      for (let n = 2; used.has(value); n += 1) value = `${base}-${n}`.slice(0, 24);
      used.add(value);
      return { value, label: String(grade.label).trim() };
    });
}

// ---- the first level's entries -------------------------------------------------

/** The tree slug of a first-level entry, in its category's namespace. */
export const firstLevelSlug = (category, value) => taxonomySlug(category, `type-${value}`);

/**
 * A first level's entries before it had any (2026-10-02), read from what is
 * already filed so nothing moved: Parts takes every `partType` its products
 * carry, named by the label most of them use; Services the repair types its
 * services were filed under. A list kept on the type for a few hours that day
 * (`facetOptions`) wins over both.
 */
async function startingEntries(doc) {
  if (doc.facetOptions?.length) return doc.facetOptions;
  if (doc.kind === 'service') {
    const used = await db().Service.distinct('category');
    const known = new Set(DEFAULT_REPAIR_TYPES.map((option) => option.value));
    return [
      ...DEFAULT_REPAIR_TYPES,
      ...used.filter((value) => value && !known.has(value)).map((value) => ({ value, label: value })),
    ];
  }
  const rows = await db().Product.aggregate([
    { $match: { ...categoryFilter(doc.slug), partType: { $nin: [null, ''] } } },
    { $group: { _id: { value: '$partType', label: '$partTypeLabel' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  const options = new Map();
  for (const row of rows) {
    if (!options.has(row._id.value)) options.set(row._id.value, row._id.label || row._id.value);
  }
  return [...options].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Give a type's first level its tree entries, and its rows, once.
 *
 * Every entry is a root of kind `partType`. Rows: each product (or service)
 * marks the deepest entry it is filed under with its first-level value
 * (`Taxonomy.lines`), so the category tree shows Screen › … › iPhone 15 Pro
 * and Battery › … › iPhone 15 Pro as two rows from day one.
 */
async function ensureFirstLevel(doc) {
  const key = keyOf('first-level', doc.slug);
  if (ensured.has(key)) return;
  const filter = { ...categoryFilter(doc.slug), kind: 'partType' };
  if (!(await db().Taxonomy.exists(filter))) {
    const entries = await startingEntries(doc);
    for (const [index, entry] of entries.entries()) {
      await db().Taxonomy.updateOne(
        { slug: firstLevelSlug(doc.slug, entry.value) },
        {
          $setOnInsert: {
            category: doc.slug,
            kind: 'partType',
            name: entry.label,
            slug: firstLevelSlug(doc.slug, entry.value),
            parent: null,
            path: { partType: entry.value },
            order: index,
            isActive: true,
          },
        },
        { upsert: true },
      );
    }

    const deepest = TREE_LEVEL_KEYS.slice().reverse().map((level) => `$${level}Slug`);
    const rows =
      doc.kind === 'service'
        ? await db().Service.aggregate([
            { $project: { value: '$category', at: { $ifNull: [{ $first: { $filter: { input: deepest, cond: { $gt: ['$$this', ''] } } } }, null] } } },
            { $match: { value: { $nin: [null, ''] }, at: { $ne: null } } },
            { $group: { _id: { value: '$value', at: '$at' } } },
          ])
        : await db().Product.aggregate([
            { $match: { ...categoryFilter(doc.slug), partType: { $nin: [null, ''] } } },
            { $project: { value: '$partType', at: { $ifNull: [{ $first: { $filter: { input: deepest, cond: { $gt: ['$$this', ''] } } } }, null] } } },
            { $match: { at: { $ne: null } } },
            { $group: { _id: { value: '$value', at: '$at' } } },
          ]);
    const byNode = new Map();
    for (const row of rows) byNode.set(row._id.at, [...(byNode.get(row._id.at) ?? []), row._id.value]);
    for (const [slug, values] of byNode) {
      await db().Taxonomy.updateOne({ slug, ...categoryFilter(doc.slug) }, { $addToSet: { lines: { $each: values } } });
    }
    invalidateCatalog();
  }
  ensured.add(key);
}

/** Mark an entry as a row for a first-level value (an item was filed there). */
export async function addLine(category, slug, value) {
  if (!slug || !value) return;
  await db().Taxonomy.updateOne({ slug, ...categoryFilter(category) }, { $addToSet: { lines: value } });
}

/** Every category's first-level entries, as `{ value, label }`, active ones in order. */
async function firstLevelEntries(slugs) {
  const nodes = await db()
    .Taxonomy.find({ kind: 'partType', isActive: { $ne: false } })
    .sort({ order: 1, name: 1 })
    .select('category name path')
    .lean();
  const by = new Map(slugs.map((slug) => [slug, []]));
  for (const node of nodes) {
    const slug = node.category || 'parts';
    if (by.has(slug)) by.get(slug).push({ value: node.path?.partType, label: node.name });
  }
  return by;
}

/** One category's first level: its name and its entries (empty name: no first level). */
export async function categoryFacet(slug) {
  await ensureSystemCategories();
  const doc = await db().CatalogCategory.findOne({ slug: String(slug || 'parts') }).lean();
  if (!doc?.facetLabel) return { label: '', options: [] };
  await ensureFirstLevel(doc);
  return { label: doc.facetLabel, options: (await firstLevelEntries([doc.slug])).get(doc.slug) ?? [] };
}

/** One category's features, for the product form, the inventory and the website. */
export async function categoryAttributes(slug) {
  await ensureSystemCategories();
  const doc = await db()
    .CatalogCategory.findOne({ slug: String(slug || 'parts') })
    .select('attributes')
    .lean();
  return (doc?.attributes ?? []).map(shapeAttribute);
}

function shapeCategory(doc, extra = {}) {
  const system = SYSTEM_CATEGORIES.find((entry) => entry.slug === doc.slug);
  const levels = (doc.levels?.length ? doc.levels : (system?.levels ?? SYSTEM_CATEGORIES[0].levels)).map((level) => ({
    key: level.key,
    label: level.label,
    required: level.required ?? systemRequired(system, level.key),
  }));
  return {
    id: String(doc._id),
    slug: doc.slug,
    name: doc.name,
    kind: doc.kind === 'phone' ? 'part' : doc.kind,
    description: doc.description ?? '',
    facetLabel: doc.facetLabel ?? '',
    facetRequired: doc.facetLabel ? doc.facetRequired !== false : false,
    facetOptions: [],
    levels,
    grades: (doc.grades ?? []).map(({ value, label }) => ({ value, label })),
    isSystem: Boolean(doc.isSystem),
    isActive: doc.isActive !== false,
    order: doc.order ?? 10,
    attributes: (doc.attributes ?? []).map(shapeAttribute),
    address: doc.address || doc.slug,
    path: categoryPath(doc),
    ...extra,
  };
}

/** Every category, with how many items and taxonomy nodes each holds (ERP list). */
export async function listCategories({ includeInactive = true, withCounts = false } = {}) {
  await ensureSystemCategories();
  const rows = await db()
    .CatalogCategory.find(includeInactive ? {} : { isActive: { $ne: false } })
    .sort({ order: 1, name: 1 })
    .lean();
  const entries = await firstLevelEntries(rows.map((row) => row.slug));
  const withEntries = (row) => ({ facetOptions: row.facetLabel ? (entries.get(row.slug) ?? []) : [] });

  if (!withCounts) return rows.map((row) => shapeCategory(row, withEntries(row)));

  const [nodeGroups, productGroups, services] = await Promise.all([
    db().Taxonomy.aggregate([{ $group: { _id: { $ifNull: ['$category', 'parts'] }, count: { $sum: 1 } } }]),
    db().Product.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: { $ifNull: ['$category', 'parts'] }, count: { $sum: 1 } } },
    ]),
    db().Service.countDocuments({ isActive: true }),
  ]);
  const nodes = new Map(nodeGroups.map((row) => [row._id, row.count]));
  const products = new Map(productGroups.map((row) => [row._id, row.count]));

  return rows.map((row) =>
    shapeCategory(row, {
      ...withEntries(row),
      nodeCount: nodes.get(row.slug) ?? 0,
      itemCount: row.kind === 'service' ? services : (products.get(row.slug) ?? 0),
    }),
  );
}

/** One category by slug, or a 404 that names it. */
export async function getCategory(slug, { activeOnly = false } = {}) {
  await ensureSystemCategories();
  const doc = await db().CatalogCategory.findOne({ slug: String(slug ?? '') }).lean();
  if (!doc || (activeOnly && doc.isActive === false)) {
    throw ApiError.notFound('That category does not exist.', 'CATEGORY_NOT_FOUND');
  }
  const entries = doc.facetLabel ? ((await firstLevelEntries([doc.slug])).get(doc.slug) ?? []) : [];
  return shapeCategory(doc, { facetOptions: entries });
}

/**
 * Add a category. Always `part` kind: a new section of the website is more
 * products filed under a tree of their own. The slug is derived from the name
 * once and never changes, because it is in the website address and in every
 * product filed under it. Its first level, if any, is named here; its entries
 * go in from the category tree.
 */
/**
 * Whether a web address is free for a type (client: "we need a field for the
 * url as well and it should check if its available before confirming"). The
 * page is `/catalogue/<address>` for every type (2026-10-03); `except` is the
 * slug of the type asking, whose own address is not a clash.
 */
export async function slugAvailability(input, except = null) {
  await ensureSystemCategories();
  const slug = slugify(input);
  if (!slug) return { slug, available: false, reason: 'Use letters or numbers.' };
  if (slug.length > 40) return { slug, available: false, reason: 'Keep it to 40 characters.' };
  const others = await db()
    .CatalogCategory.find({ slug: { $ne: except ?? '' } })
    .select('slug address')
    .lean();
  const taken = others.some((row) => (row.address || row.slug) === slug);
  return taken
    ? { slug, available: false, reason: `${categoryPath({ slug })} is already another type's address.` }
    : { slug, available: true, path: categoryPath({ slug }) };
}

/** The type at a web address, for `/catalogue/<address>`. */
export async function categoryAtAddress(address) {
  await ensureSystemCategories();
  const rows = await db().CatalogCategory.find({}).select('slug address formerAddresses').lean();
  const wanted = String(address ?? '');
  // A current address wins over one a type used to have; the caller forwards
  // a former one to the type's live address.
  const match =
    rows.find((row) => (row.address || row.slug) === wanted) ?? rows.find((row) => (row.formerAddresses ?? []).includes(wanted));
  return match ? getCategory(match.slug, { activeOnly: true }) : null;
}

export async function createCategory(input) {
  await ensureSystemCategories();
  // The identifier comes from the name once; the address is the type's to choose.
  let base = slugify(input.name);
  if (!base) throw ApiError.badRequest('Give the category a name with letters in it.', 'CATEGORY_NAME');
  for (let n = 2; SYSTEM_SLUGS.includes(base) || (await db().CatalogCategory.exists({ slug: base })); n += 1) {
    base = `${slugify(input.name)}-${n}`;
  }
  const check = await slugAvailability(input.address || input.name);
  if (!check.available) throw ApiError.conflict(check.reason, 'CATEGORY_ADDRESS_TAKEN');

  const doc = await db().CatalogCategory.create({
    name: input.name,
    slug: base,
    address: check.slug,
    kind: 'part',
    description: input.description ?? '',
    facetLabel: input.facetLabel ?? '',
    facetRequired: input.facetRequired !== false,
    levels: input.levels,
    // No grades is allowed: its products then carry no grade and no badge.
    grades: normaliseGrades(input.grades ?? []),
    isActive: input.isActive !== false,
    order: input.order ?? 10,
    attributes: normaliseAttributes(input.attributes ?? []),
  });
  invalidateCatalog();
  return shapeCategory(doc.toObject());
}

/** Rename, relabel, reorder or switch off. Kind and slug never change. */
export async function updateCategory(slug, input) {
  const doc = await db().CatalogCategory.findOne({ slug });
  if (!doc) throw ApiError.notFound('That category does not exist.', 'CATEGORY_NOT_FOUND');
  // Every type is treated alike (client ruling 2026-10-02: "current 3 types
  // shouldn't be built in"): Parts, Phones and Services can be switched off
  // like any other. Only their web addresses stay, being pages of their own.

  // Services file from the four-level serviced-items list.
  if (doc.kind === 'service' && (input.levels?.length ?? 0) > SYSTEM_MAX_LEVELS) {
    throw ApiError.badRequest(`${doc.name} has at most ${SYSTEM_MAX_LEVELS} tree levels.`, 'CATEGORY_DEPTH');
  }

  /**
   * A type can lose levels only while nothing is filed under them
   * (2026-10-02). Shrinking Parts from four levels to two would leave 178
   * models and every product's model in the database with no step that
   * reaches them, so it is refused with the count instead.
   */
  const oldDepth = doc.levels?.length || 4;
  const newDepth = input.levels?.length || 4;
  if (newDepth < oldDepth) {
    const dropped = TREE_LEVEL_KEYS.slice(newDepth, oldDepth);
    const [nodes, products] = await Promise.all([
      db().Taxonomy.countDocuments({ ...categoryFilter(slug), kind: { $in: dropped } }),
      db().Product.countDocuments({
        ...categoryFilter(slug),
        $or: dropped.map((key) => ({ [`${key}Slug`]: { $nin: [null, ''] } })),
      }),
    ]);
    if (nodes > 0 || products > 0) {
      throw ApiError.badRequest(
        `${doc.name} has ${nodes} tree entr${nodes === 1 ? 'y' : 'ies'} and ${products} product${products === 1 ? '' : 's'} filed below level ${newDepth}. Move or remove them before taking the levels away.`,
        'CATEGORY_DEPTH_IN_USE',
      );
    }
  }

  /** A grade still on a product cannot be taken away; a renamed one keeps its value. */
  if (input.grades !== undefined && doc.kind !== 'service') {
    const existing = (doc.grades ?? []).map(({ value, label }) => ({ value, label }));
    const next = normaliseGrades(input.grades, existing);
    const kept = new Set(next.map((grade) => grade.value));
    const dropped = existing.filter((grade) => !kept.has(grade.value)).map((grade) => grade.value);
    if (dropped.length) {
      const inUse = await db().Product.distinct('grade', { ...categoryFilter(slug), grade: { $in: dropped } });
      if (inUse.length) {
        const names = existing.filter((grade) => inUse.includes(grade.value)).map((grade) => grade.label);
        throw ApiError.badRequest(
          `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} still on products. Change those products first.`,
          'GRADE_IN_USE',
        );
      }
    }
    doc.grades = next;
  }

  doc.name = input.name;
  doc.description = input.description ?? '';
  // The first level is renamed here, never removed: its entries hold items.
  if (doc.facetLabel && input.facetLabel) doc.facetLabel = input.facetLabel;
  if (!doc.facetLabel && input.facetLabel) doc.facetLabel = input.facetLabel;
  if (input.facetRequired !== undefined) doc.facetRequired = input.facetRequired;
  doc.levels = input.levels;
  doc.isActive = input.isActive !== false;
  doc.order = input.order ?? doc.order;
  if (input.attributes !== undefined) {
    doc.attributes = normaliseAttributes(input.attributes, doc.attributes ?? []);
  }

  /**
   * A new web address, for any type (2026-10-03). Only the page moves: items
   * and the tree are filed under the slug, which does not change. The old
   * address is kept and forwards here, so a shared link still lands.
   */
  if (input.address) {
    const next = slugify(input.address);
    const current = doc.address || doc.slug;
    if (next !== current) {
      const check = await slugAvailability(next, doc.slug);
      if (!check.available) throw ApiError.conflict(check.reason, 'CATEGORY_ADDRESS_TAKEN');
      doc.formerAddresses = [...new Set([...(doc.formerAddresses ?? []), current])].filter((entry) => entry !== next);
      doc.address = next;
    }
  }

  await doc.save();
  invalidateCatalog();
  return getCategory(doc.slug);
}

/** A type's grades, for checking a product's. */
export async function categoryGrades(slug) {
  await ensureSystemCategories();
  const doc = await db().CatalogCategory.findOne({ slug: String(slug || 'parts') }).select('grades').lean();
  return (doc?.grades ?? []).map(({ value, label }) => ({ value, label }));
}

// ---- seeding a new tree --------------------------------------------------------

/**
 * Give a Phones or Services tree its first nodes, from "Devices taken in".
 *
 * Idempotent: it runs only for a category with no node at all, and upserts by
 * slug, so two requests racing on a fresh business cannot build it twice.
 * Slugs are the device list's own, prefixed with the category, which keeps
 * them unique beside the Parts tree's bare ones.
 */
export async function ensureTree(category) {
  // Phones and Services only: they file the same devices a repair counter
  // takes in, so the serviced-items list is their natural first tree. A type
  // a business adds (Accessories) starts empty, at its own depth; seeding it
  // with every phone and laptop the counter repairs was wrong (2026-10-02).
  if (!category || !['phones', 'services'].includes(category)) return;
  const key = keyOf('tree', category);
  if (ensured.has(key)) return;

  // A first level's entries alone are not a tree.
  const exists = await db().Taxonomy.exists({ category, kind: { $ne: 'partType' } });
  // Seeded once from the retired Serviced items list (`DeviceCatalog`), then
  // the tree is its own: since 2026-10-03 it IS the device list every picker reads.
  if (!exists) {
    const rows = await db().DeviceCatalog.find({ isActive: { $ne: false } }).sort({ order: 1, name: 1 }).lean();
    const byId = new Map(rows.map((row) => [String(row._id), row]));
    const depth = (row) => TREE_LEVEL_KEYS.indexOf(row.kind);
    const ids = new Map();

    for (const row of [...rows].sort((a, b) => depth(a) - depth(b))) {
      const parentRow = row.parent ? byId.get(String(row.parent)) : null;
      if (row.parent && !parentRow) continue;
      const slug = `${category}-${row.slug}`;
      const path = Object.fromEntries(
        Object.entries(row.path ?? {})
          .filter(([, value]) => value)
          .map(([level, value]) => [level, `${category}-${value}`]),
      );
      path[row.kind] = slug;

      const node = await db().Taxonomy.findOneAndUpdate(
        { slug },
        {
          $setOnInsert: {
            slug,
            category,
            kind: row.kind,
            name: row.name,
            parent: parentRow ? (ids.get(String(parentRow._id)) ?? null) : null,
            path,
            aliases: row.aliases ?? [],
            order: row.order ?? 0,
            isActive: true,
          },
        },
        { upsert: true, new: true },
      );
      ids.set(String(row._id), node._id);
    }
    invalidateCatalog();
  }
  ensured.add(key);
}

// ---- trees -----------------------------------------------------------------------

/** One category's nodes as a forest, uncounted. */
async function forestOf(category) {
  await ensureTree(category);
  const nodes = await db()
    // The first level's entries are roots of their own, not part of the device tree.
    .Taxonomy.find({ ...categoryFilter(category), kind: { $ne: 'partType' }, isActive: { $ne: false } })
    .sort({ order: 1, name: 1 })
    .lean();

  const byId = new Map();
  for (const node of nodes) {
    byId.set(String(node._id), {
      id: String(node._id),
      kind: node.kind,
      name: node.name,
      slug: node.slug,
      icon: node.icon ?? null,
      isFeatured: Boolean(node.isFeatured),
      path: node.path ?? {},
      count: 0,
      children: [],
    });
  }
  const roots = [];
  for (const node of nodes) {
    const shaped = byId.get(String(node._id));
    const parent = node.parent ? byId.get(String(node.parent)) : null;
    if (parent) parent.children.push(shaped);
    else if (!node.parent) roots.push(shaped);
  }
  return roots;
}

/** Drop every branch that counts nothing: a filter that opens an empty grid is a dead end. */
const prune = (list) =>
  list
    .map((node) => ({ ...node, children: prune(node.children) }))
    .filter((node) => node.count > 0 || node.children.length > 0);

/**
 * Whether a service applies to a place in the Services tree.
 *
 * Its scope and the place may not disagree on any level both name: a service
 * scoped to the iPhone 15 applies under Apple and under iPhone 15, not under
 * Samsung. A service scoped to nothing applies everywhere its `deviceTypes`
 * hint allows ("phone", "laptop"), read against the device type's name.
 */
export function serviceApplies(service, path = {}, deviceTypeName = '') {
  for (const level of TREE_LEVEL_KEYS) {
    const mine = service[`${level}Slug`];
    if (mine && path[level] && mine !== path[level]) return false;
  }
  const hints = service.deviceTypes ?? [];
  if (!service.deviceTypeSlug && hints.length && deviceTypeName) {
    return hints.includes(deviceTypeName.trim().toLowerCase());
  }
  return true;
}

/** The device type name a path starts from, for the `deviceTypes` hint. */
async function deviceTypeNameOf(path = {}) {
  if (!path.deviceType) return '';
  const node = await db().Taxonomy.findOne({ slug: path.deviceType }).select('name').lean();
  return node?.name ?? '';
}
export { deviceTypeNameOf };

/**
 * The Services tree: every device, counting the services that apply to it, so
 * the finder never walks a customer to a device nothing is offered for.
 * `types` narrows to repair types (the finder's first step), exactly as the
 * Parts tree narrows to a component type.
 */
export async function serviceTree(types = []) {
  const list = [...new Set(types)].sort();
  return cached(keyOf('services-tree', list.join(',')), async () => {
    const [roots, all] = await Promise.all([
      forestOf('services'),
      db().Service.find({ isActive: true }).select('category deviceTypes deviceTypeSlug brandSlug seriesSlug modelSlug').lean(),
    ]);
    const services = list.length ? all.filter((row) => list.includes(row.category ?? 'other')) : all;

    const walk = (node, deviceTypeName) => {
      const name = node.kind === 'deviceType' ? node.name : deviceTypeName;
      node.count = services.filter((service) => serviceApplies(service, node.path, name)).length;
      node.children.forEach((child) => walk(child, name));
    };
    roots.forEach((root) => walk(root, ''));
    return { tree: prune(roots) };
  });
}

/**
 * The Services finder's first step: the repair types on offer, with how many
 * services each holds. The Parts finder's component types, for labour.
 */
export async function serviceTypes() {
  return cached(keyOf('service-types'), async () => {
    const [rows, facet] = await Promise.all([
      db().Service.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: { $ifNull: ['$category', 'other'] }, count: { $sum: 1 } } },
      ]),
      categoryFacet('services'),
    ]);
    const counts = new Map(rows.map((row) => [row._id, row.count]));
    // The Services type's own first-step list, in its order (2026-10-02).
    return facet.options
      .filter((option) => counts.has(option.value))
      .map((option) => ({ slug: option.value, name: option.label, count: counts.get(option.value) }));
  });
}

// ---- placing a phone in its tree ---------------------------------------------------

async function findOrCreate({ kind, name, parent, category }) {
  const clean = String(name ?? '').trim();
  if (!clean) return parent;
  const exact = new RegExp(`^${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

  const found = await db().Taxonomy.findOne({ category, kind, parent: parent?._id ?? null, name: exact });
  if (found) return found;

  const slug = parent ? `${parent.slug}-${slugify(clean)}` : `${category}-${slugify(clean)}`;
  const parentPath = parent ? ((typeof parent.toObject === 'function' ? parent.toObject() : parent).path ?? {}) : {};
  const path = { ...parentPath, [kind]: slug };
  const last = await db()
    .Taxonomy.findOne({ category, kind, parent: parent?._id ?? null })
    .sort({ order: -1 })
    .select('order')
    .lean();
  try {
    const created = await db().Taxonomy.create({
      category,
      kind,
      name: clean,
      slug,
      parent: parent?._id ?? null,
      path,
      order: (last?.order ?? -1) + 1,
    });
    invalidateCatalog();
    return created;
  } catch (error) {
    // Two requests creating the same node at once: the loser reads the winner's.
    if (error?.code === 11000) return db().Taxonomy.findOne({ slug });
    throw error;
  }
}

/**
 * Where a phone sits in the Phones tree, from the names staff and the kiosk
 * write on it, creating whatever level is missing. Returns the four slugs.
 */
export async function resolvePhone(device) {
  await ensureTree('phones');
  const deviceType = await findOrCreate({ category: 'phones', kind: 'deviceType', name: device.category || 'Phone', parent: null });
  const brand = await findOrCreate({ category: 'phones', kind: 'brand', name: device.brand || 'Other', parent: deviceType });
  const series = device.series
    ? await findOrCreate({ category: 'phones', kind: 'series', name: device.series, parent: brand })
    : null;
  const model = await findOrCreate({ category: 'phones', kind: 'model', name: device.model, parent: series ?? brand });

  return {
    deviceTypeSlug: deviceType?.slug ?? '',
    brandSlug: brand?.slug ?? '',
    seriesSlug: series?.slug ?? '',
    modelSlug: model?.slug ?? '',
  };
}

export default {
  categoryFilter,
  listCategories,
  getCategory,
  categoryFacet,
  createCategory,
  updateCategory,
  ensureTree,
  serviceTree,
  serviceApplies,
  resolvePhone,
  invalidateCatalog,
};
