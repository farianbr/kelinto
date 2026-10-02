import mongoose from 'mongoose';

import { db } from '../db/models.js';
import '../models/Taxonomy.js';
import '../models/Product.js';
import '../models/Service.js';
import ApiError from '../utils/ApiError.js';
import { escapeRegex, likeRegex } from '../utils/regex.js';
import { invalidateTree } from './taxonomyService.js';
import { addLine, categoryFilter, ensureTree, firstLevelSlug, getCategory, invalidateCatalog, serviceApplies } from './catalogService.js';
import { FACET_VALUE_PATTERN, categoryLevels, facetValueOf, taxonomySlug } from '../../../shared/catalog.js';
import { parseCsv, rowsWithoutHeader } from '../utils/csv.js';

/**
 * The category tree editor (ERP › Settings › Taxonomy › a type's tree; was
 * CellShoppe's *Device & Models*, §6.15).
 *
 * The master list behind the pickers on every product and service form and
 * behind the website's three filter UIs. Read-side lives in `taxonomyService`;
 * this is the write side, kept separate so the cached public tree has exactly
 * one owner and this file has to go through `invalidateTree` to affect it.
 *
 * Since 2026-10-02 it works in the type's own levels, every one alike: the
 * first level (Component Type, Repair Type) is an entry like a brand is, the
 * table shows one column per level and one row per product line, and adding
 * walks the levels the type defines, honouring which are required.
 *
 * **Aliases are the point of the edit dialog** (§6.15). They sit on the entry,
 * so one alias on a model covers every SKU that fits that phone.
 *
 * **Nothing here deletes an entry that is in use.** One with items behind it
 * can be deactivated but not removed: deleting it would leave every one of
 * those items pointing at a slug that resolves to nothing.
 */

/**
 * Aliases, cleaned.
 *
 * Lowercased so matching never case-folds at query time, deduplicated, and
 * stripped of anything that would match everything - an empty alias, or one
 * that is just whitespace, silently turns a search box into a firehose.
 */
function normaliseAliases(input) {
  const list = Array.isArray(input)
    ? input
    : String(input ?? '')
        .split(',')
        .map((value) => value.trim());

  const seen = new Set();
  const out = [];

  for (const raw of list) {
    const value = String(raw ?? '').trim().toLowerCase();
    if (!value || value.length > 60) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }

  return out;
}

/** One entry, shaped for the edit dialog. */
function shape(node, counts) {
  return {
    id: node._id.toString(),
    kind: node.kind,
    name: node.name,
    slug: node.slug,
    parent: node.parent ? node.parent.toString() : null,
    path: node.path ?? {},
    aliases: node.aliases ?? [],
    isActive: node.isActive !== false,
    isFeatured: Boolean(node.isFeatured),
    order: node.order ?? 0,
    // The live figure, which is what decides whether an entry may be deleted,
    // so the screen shows the number the rule uses.
    productCount: counts?.get(node.slug) ?? 0,
    category: node.category || 'parts',
  };
}

/** The category a request names, checked, defaulting to Parts. */
async function categoryOf(slug) {
  const value = typeof slug === 'string' && slug.trim() ? slug.trim() : 'parts';
  const category = await getCategory(value);
  await ensureTree(category.slug);
  return category;
}

/**
 * How many live items sit under each taxonomy slug, and under each first-level
 * entry (keyed by that entry's slug).
 *
 * Counted from the items rather than read off `Taxonomy.productCount`, which
 * the seed writes and nothing else maintains. The delete rule depends on this
 * being true right now, not true at the last seed. One item contributes to
 * every ancestor, so a brand's count is everything under every model it makes.
 */
async function liveCounts(category = { slug: 'parts', kind: 'part' }) {
  const isService = category.kind === 'service';
  const model = isService ? db().Service : db().Product;
  const match = isService ? {} : { isActive: true, ...categoryFilter(category.slug) };

  const [slugRows, typeRows] = await Promise.all([
    model.aggregate([
      { $match: match },
      { $project: { slugs: ['$deviceTypeSlug', '$brandSlug', '$seriesSlug', '$modelSlug', '$level5Slug', '$level6Slug'] } },
      { $unwind: '$slugs' },
      { $match: { slugs: { $nin: [null, ''] } } },
      { $group: { _id: '$slugs', count: { $sum: 1 } } },
    ]),
    model.aggregate([{ $match: match }, { $group: { _id: isService ? '$category' : '$partType', count: { $sum: 1 } } }]),
  ]);

  const counts = new Map(slugRows.map((row) => [row._id, row.count]));
  for (const row of typeRows) {
    if (row._id) counts.set(firstLevelSlug(category.slug, row._id), row.count);
  }
  return counts;
}

/**
 * The category tree as a table (2026-10-02, client: "the tree should show all
 * the levels as columns so that each row is one product/service").
 *
 * One column per level of the type, its first level included. A row is a
 * product line: an entry marked with a first-level value (`Taxonomy.lines`)
 * gives one row per value (Screen › Smartphone › Apple › … › iPhone 15 Pro
 * and Battery › … › iPhone 15 Pro), a deepest entry with none gives one row
 * with the first column empty, and a first-level entry with no rows yet gets a
 * row of its own, so nothing added is ever invisible. Each cell is the entry
 * itself, so the screen opens it to rename it or edit its aliases.
 */
async function rows({ category: categorySlug, search, includeInactive } = {}) {
  const category = await categoryOf(categorySlug);
  const levels = categoryLevels(category);
  const treeKeys = levels.map((level) => level.key).filter((key) => key !== 'partType');
  const showInactive = includeInactive === true || includeInactive === 'true';

  const [nodes, counts] = await Promise.all([
    db()
      .Taxonomy.find({ ...categoryFilter(category.slug), ...(showInactive ? {} : { isActive: { $ne: false } }) })
      .sort({ order: 1, name: 1 })
      .lean(),
    liveCounts(category),
  ]);

  const isService = category.kind === 'service';
  const model = isService ? db().Service : db().Product;
  const lineCounts = new Map(
    (
      await model.aggregate([
        { $match: isService ? {} : { isActive: true, ...categoryFilter(category.slug) } },
        {
          $project: {
            value: isService ? '$category' : '$partType',
            slugs: ['$deviceTypeSlug', '$brandSlug', '$seriesSlug', '$modelSlug', '$level5Slug', '$level6Slug'],
          },
        },
        { $unwind: '$slugs' },
        { $match: { slugs: { $nin: [null, ''] } } },
        { $group: { _id: { value: '$value', slug: '$slugs' }, count: { $sum: 1 } } },
      ])
    ).map((row) => [`${row._id.value}|${row._id.slug}`, row.count]),
  );

  const cellOf = (node) => ({
    id: String(node._id),
    kind: node.kind,
    name: node.name,
    slug: node.slug,
    aliases: node.aliases ?? [],
    isActive: node.isActive !== false,
    productCount: counts.get(node.slug) ?? 0,
  });

  const byId = new Map(nodes.map((node) => [String(node._id), node]));
  const hasChildren = new Set(nodes.filter((node) => node.parent).map((node) => String(node.parent)));
  const firstLevel = new Map(nodes.filter((node) => node.kind === 'partType').map((node) => [node.path?.partType, node]));
  const hasFirst = levels[0]?.key === 'partType';

  const chainOf = (node) => {
    const chain = [];
    for (let at = node; at; at = at.parent ? byId.get(String(at.parent)) : null) chain.unshift(at);
    return chain;
  };

  /**
   * Services: a row for every repair type offered on every device (2026-10-02,
   * client: "services tree should be filled every field"). Most services are
   * offered on a whole kind of device ("phone") rather than pinned to one
   * model, so the rows come from what each active service applies to
   * (`serviceApplies`, the rule the website's Services finder uses), at every
   * deepest entry, counted by the services that apply there.
   */
  const derived = new Map();
  if (isService && hasFirst) {
    const services = await db()
      .Service.find({ isActive: true })
      .select('category deviceTypes deviceTypeSlug brandSlug seriesSlug modelSlug')
      .lean();
    for (const node of nodes) {
      if (!treeKeys.includes(node.kind) || hasChildren.has(String(node._id))) continue;
      const rootName = chainOf(node)[0]?.name ?? '';
      const perType = new Map();
      for (const service of services) {
        if (!firstLevel.has(service.category) || !serviceApplies(service, node.path ?? {}, rootName)) continue;
        perType.set(service.category, (perType.get(service.category) ?? 0) + 1);
      }
      for (const [value, count] of perType) lineCounts.set(`${value}|${node.slug}`, count);
      derived.set(String(node._id), [...perType.keys()]);
    }
  }

  const out = [];
  const usedTypes = new Set();
  for (const node of nodes) {
    if (!treeKeys.includes(node.kind)) continue;
    const stored = hasFirst ? (node.lines ?? []).filter((value) => firstLevel.has(value)) : [];
    const lines = [...new Set([...stored, ...(derived.get(String(node._id)) ?? [])])];
    if (!lines.length && hasChildren.has(String(node._id))) continue;

    const cells = Object.fromEntries(chainOf(node).map((entry) => [entry.kind, cellOf(entry)]));
    if (!lines.length) {
      out.push({ id: String(node._id), cells, count: counts.get(node.slug) ?? 0 });
      continue;
    }
    for (const value of lines) {
      usedTypes.add(value);
      out.push({
        id: `${value}|${node._id}`,
        cells: { partType: cellOf(firstLevel.get(value)), ...cells },
        count: lineCounts.get(`${value}|${node.slug}`) ?? 0,
      });
    }
  }
  if (hasFirst) {
    for (const [value, type] of firstLevel) {
      if (!usedTypes.has(value)) out.push({ id: `${value}|`, cells: { partType: cellOf(type) }, count: counts.get(type.slug) ?? 0 });
    }
  }

  // Sorted by the columns left to right, so a brand's rows sit together.
  // A row with no entry at a level (no product line yet) sorts after those with one.
  const sortKey = (row) => levels.map((level) => row.cells[level.key]?.name?.toLowerCase() ?? '\uffff').join('\u0001');
  out.sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));

  const text = String(search ?? '').trim().toLowerCase();
  const matched = text
    ? out.filter((row) =>
        Object.values(row.cells).some(
          (cell) =>
            cell.name.toLowerCase().includes(text) || cell.slug.includes(text) || cell.aliases.some((alias) => alias.includes(text)),
        ),
      )
    : out;

  return {
    levels,
    rows: matched,
    total: matched.length,
    stats: {
      rows: out.length,
      entries: nodes.length,
      withAliases: nodes.filter((node) => node.aliases?.length).length,
      inactive: nodes.filter((node) => node.isActive === false).length,
    },
  };
}

/**
 * The entries of one type's tree as a flat, filterable list. Kept for any
 * caller that wants entries rather than rows; the tree screen reads `rows`.
 */
async function list({ search, kind, parent, includeInactive, category: categorySlug, page = 1, limit = 50 } = {}) {
  const category = await categoryOf(categorySlug);
  const filter = { ...categoryFilter(category.slug) };

  if (kind && kind !== 'all') filter.kind = kind;
  if (parent) filter.parent = parent;
  if (!includeInactive || includeInactive === 'false') filter.isActive = { $ne: false };

  if (search) {
    const rx = likeRegex(search);
    filter.$and = [{ $or: [{ name: rx }, { slug: rx }, { aliases: rx }] }];
  }

  const perPage = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const current = Math.max(Number(page) || 1, 1);

  const [nodes, total, counts] = await Promise.all([
    db().Taxonomy.find(filter).sort({ kind: 1, order: 1, name: 1 }).skip((current - 1) * perPage).limit(perPage).lean(),
    db().Taxonomy.countDocuments(filter),
    liveCounts(category),
  ]);

  return {
    nodes: nodes.map((node) => shape(node, counts)),
    total,
    page: current,
    pages: Math.max(Math.ceil(total / perPage), 1),
  };
}

/**
 * One category's whole tree, unpruned, for the pickers that file things into
 * it (2026-10-01). The website's tree drops every branch with nothing under it,
 * which is right for a buyer and wrong for staff: a model nobody has listed a
 * part for yet is exactly where the first one has to go. The first level's
 * entries are not part of it; the forms read them off the type
 * (`facetOptions`).
 */
async function fullTree(categorySlug) {
  const category = await categoryOf(categorySlug);
  const nodes = await db()
    .Taxonomy.find({ ...categoryFilter(category.slug), kind: { $ne: 'partType' }, isActive: { $ne: false } })
    .sort({ order: 1, name: 1 })
    .select('kind name slug parent path lines')
    .lean();

  const byId = new Map(
    nodes.map((node) => [
      String(node._id),
      {
        id: String(node._id),
        kind: node.kind,
        name: node.name,
        slug: node.slug,
        path: node.path ?? {},
        lines: node.lines ?? [],
        children: [],
      },
    ]),
  );
  const roots = [];
  for (const node of nodes) {
    const shaped = byId.get(String(node._id));
    const parent = node.parent ? byId.get(String(node.parent)) : null;
    if (parent) parent.children.push(shaped);
    else if (!node.parent) roots.push(shaped);
  }
  return { category: category.slug, tree: roots };
}

/** One entry, for the edit form. */
async function get(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Not found.', 'TAXONOMY_NOT_FOUND');

  const node = await db().Taxonomy.findById(id).lean();
  if (!node) throw ApiError.notFound('Not found.', 'TAXONOMY_NOT_FOUND');

  return { node: shape(node, await liveCounts(await categoryOf(node.category))) };
}

/** `iPhone 15 Pro Max` → `iphone-15-pro-max`, the shape every seeded slug has. */
function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Finds an entry by name under its parent, or creates it.
 *
 * Typing "Apple" finds the Apple already there, whatever slug the seed or an
 * earlier import gave it, so adding a second Samsung model does not mint a
 * second Samsung. A new entry takes the slug Parts has always used for its
 * level (a model is prefixed with its brand, as the seed does, because "Pro"
 * is a model several brands have); when that slug is taken elsewhere in the
 * collection it is prefixed with its parent instead.
 *
 * **New entries are ordered last**, not inserted alphabetically. The wizard
 * reads `order`, and renumbering siblings to slot one in would move rows on a
 * website that a staff member is not looking at.
 */
async function ensureNode({ category, kind, name, parent, preferredSlug }) {
  const clean = name.trim();
  const exact = new RegExp(`^${escapeRegex(clean)}$`, 'i');
  const found = await db().Taxonomy.findOne({ ...categoryFilter(category), kind, parent: parent?._id ?? null, name: exact });
  if (found) return { node: found, created: false };

  let slug = preferredSlug;
  if (await db().Taxonomy.exists({ slug })) slug = parent ? slugify(`${parent.slug}-${clean}`) : slug;
  for (let n = 2; await db().Taxonomy.exists({ slug }); n += 1) slug = `${preferredSlug}-${n}`;

  const last = await db()
    .Taxonomy.findOne({ kind, parent: parent?._id ?? null, ...categoryFilter(category) })
    .sort({ order: -1 })
    .select('order')
    .lean();

  const parentPath = parent ? ((typeof parent.toObject === 'function' ? parent.toObject() : parent).path ?? {}) : {};
  const node = await db().Taxonomy.create({
    // Parts entries stay unstamped like every one before categories existed.
    ...(category === 'parts' ? {} : { category }),
    kind,
    name: clean,
    slug,
    parent: parent?._id ?? null,
    path: { ...parentPath, [kind]: slug },
    order: (last?.order ?? -1) + 1,
  });
  return { node, created: true };
}

/** The slug an entry would take at its level, before any clash is resolved. */
function preferredSlug(category, kind, name, chain) {
  const brand = chain.find((entry) => entry.kind === 'brand');
  const parent = chain.at(-1);
  if (kind === 'model' && brand) return slugify(`${brand.slug}-${name}`);
  if ((kind === 'level5' || kind === 'level6') && parent) return slugify(`${parent.slug}-${name}`);
  return taxonomySlug(category, slugify(name));
}

/**
 * Adds one row to the category tree, walking the type's own levels
 * (2026-10-02, client: "adding an entry in the tree doesn't follow finder
 * levels").
 *
 * ## What it takes
 *
 * A name per level (`input[levelKey]`), top to bottom, the first level
 * included, because that is how somebody adding "the new Pixel" thinks: they
 * do not know whether a `Google` entry exists, and making them find out first
 * would mean three screens to add one phone. Each level is found by name under
 * its parent or created. Every level the type marks required must be named;
 * an optional one may be left blank (a model hanging off its brand).
 *
 * ## When it is new
 *
 * A row, not just an entry: adding Battery › … › iPhone 15 Pro when only the
 * Screen row exists adds the Battery row to the existing iPhone 15 Pro. A row
 * that is already there is refused, so a second save of the same form does
 * not look like it worked while editing nothing.
 */
async function create(input) {
  const category = await categoryOf(input.category);
  const cat = category.slug;
  const levels = categoryLevels(category);
  const first = levels[0]?.key === 'partType' ? levels[0] : null;
  const tree = levels.filter((level) => level.key !== 'partType');

  const named = (key) => String(input[key] ?? '').trim();
  // Older callers sent the deepest level as `name`.
  const leafKey = tree[tree.length - 1].key;
  if (!named(leafKey) && named('name')) input = { ...input, [leafKey]: named('name') };

  for (const level of levels) {
    if (level.required !== false && !named(level.key)) {
      throw ApiError.badRequest(`Name the ${level.label.toLowerCase()}.`, `${level.key.toUpperCase()}_REQUIRED`);
    }
  }
  if (!levels.some((level) => named(level.key))) {
    throw ApiError.badRequest(`Name the ${levels[0].label.toLowerCase()}.`, 'ENTRY_REQUIRED');
  }

  const aliases = normaliseAliases(input.aliases);
  if (aliases.length) {
    const aliasClash = await db()
      .Taxonomy.findOne({ aliases: { $in: aliases }, ...categoryFilter(cat) })
      .select('name aliases')
      .lean();
    if (aliasClash) {
      const overlap = aliases.filter((alias) => aliasClash.aliases.includes(alias));
      throw ApiError.badRequest(
        `“${overlap[0]}” is already an alias for ${aliasClash.name}. An alias can only point at one entry.`,
        'ALIAS_IN_USE',
      );
    }
  }

  // The first level: an entry of its own, a root.
  let type = null;
  let created = false;
  if (first && named('partType')) {
    const value = facetValueOf(named('partType'));
    if (!FACET_VALUE_PATTERN.test(value)) {
      throw ApiError.badRequest(`Give the ${first.label.toLowerCase()} a name with letters in it.`, 'ENTRY_NAME');
    }
    const result = await ensureNode({
      category: cat,
      kind: 'partType',
      name: named('partType'),
      parent: null,
      preferredSlug: firstLevelSlug(cat, value),
    });
    type = result.node;
    if (result.created) {
      type.path = { partType: value };
      await type.save();
      created = true;
    }
  }

  // The tree levels, each found by name under the last or created.
  let parent = null;
  const chain = [];
  for (const level of tree) {
    if (!named(level.key)) continue;
    const result = await ensureNode({
      category: cat,
      kind: level.key,
      name: named(level.key),
      parent,
      preferredSlug: preferredSlug(cat, level.key, named(level.key), chain),
    });
    parent = result.node;
    chain.push(parent);
    if (result.created) created = true;
  }

  const value = type?.path?.partType;
  const newLine = Boolean(parent && value && !(parent.lines ?? []).includes(value));
  if (!created && !newLine) {
    throw ApiError.badRequest(
      `${[type, ...chain].filter(Boolean).map((entry) => entry.name).join(' › ')} is already in the tree. Edit that row instead of adding it twice.`,
      'MODEL_EXISTS',
    );
  }
  if (parent && value) await addLine(cat, parent.slug, value);

  const leaf = parent ?? type;
  if (aliases.length) {
    leaf.aliases = [...new Set([...(leaf.aliases ?? []), ...aliases])];
    await leaf.save();
  }

  invalidateTree();
  invalidateCatalog();
  return { node: shape(leaf.toObject(), await liveCounts(category)) };
}

/**
 * Bulk-adds rows from CSV.
 *
 * ## The format
 *
 * The type's levels, in order, then `Aliases` - one row per tree row, header
 * optional. Aliases are separated by a **vertical bar**, not a comma, because
 * a comma is the column separator and `15 PM, 15 Pro Max` in an unquoted cell
 * would read as two columns.
 *
 * ## Re-importing the same row updates its aliases
 *
 * A shop exports its list, edits aliases in a spreadsheet and imports it back;
 * a create-only importer would refuse every row of that file.
 *
 * ## One bad row does not fail the file
 *
 * Every row is reported - added, updated, or skipped with a reason and its row
 * number. A hundred-row file with one alias clash adds ninety-nine rows and
 * says which one it could not, rather than rolling back work the staff member
 * would have to redo.
 */
async function importCsv(text, categorySlug) {
  const category = await categoryOf(categorySlug);
  const levels = categoryLevels(category);
  const tree = levels.filter((level) => level.key !== 'partType');
  const rowsIn = rowsWithoutHeader(parseCsv(text), ['Category', levels[0]?.label ?? 'Category']);

  if (!rowsIn.length) {
    throw ApiError.badRequest('There are no rows in that file.', 'CSV_EMPTY');
  }
  if (rowsIn.length > 2000) {
    throw ApiError.badRequest(`That file has ${rowsIn.length} rows. Import 2000 or fewer at a time.`, 'CSV_TOO_LARGE');
  }

  const results = { added: 0, updated: 0, skipped: 0, rows: [] };

  for (const [index, cells] of rowsIn.entries()) {
    // "Row N", not "line N": the header, when present, is already gone.
    const rowNumber = index + 1;
    const values = Object.fromEntries(levels.map((level, column) => [level.key, String(cells[column] ?? '').trim()]));
    const label = levels.map((level) => values[level.key]).filter(Boolean).join(' › ') || `Row ${rowNumber}`;
    // The bar is the documented separator; a comma inside a quoted cell works too.
    const aliases = String(cells[levels.length] ?? '').replace(/\|/g, ',');

    try {
      await create({ ...values, aliases, category: category.slug });
      results.added += 1;
      results.rows.push({ row: rowNumber, name: label, status: 'added' });
    } catch (err) {
      if (err.code !== 'MODEL_EXISTS') {
        results.skipped += 1;
        results.rows.push({ row: rowNumber, name: label, status: 'skipped', reason: err.message });
        continue;
      }
      // Already there: re-importing an edited export updates the deepest entry's aliases.
      try {
        const deepest = tree.slice().reverse().find((level) => values[level.key]);
        const leaf = deepest
          ? await db()
              .Taxonomy.findOne({
                ...categoryFilter(category.slug),
                kind: deepest.key,
                name: new RegExp(`^${escapeRegex(values[deepest.key])}$`, 'i'),
              })
              .select('_id')
              .lean()
          : null;
        if (leaf && aliases.trim()) await update(String(leaf._id), { aliases });
        results.updated += 1;
        results.rows.push({ row: rowNumber, name: label, status: 'updated' });
      } catch (aliasErr) {
        results.skipped += 1;
        results.rows.push({ row: rowNumber, name: label, status: 'skipped', reason: aliasErr.message });
      }
    }
  }

  invalidateTree();
  invalidateCatalog();

  return results;
}

/**
 * Edits an entry.
 *
 * **Only the safe fields.** `kind`, `slug`, `parent` and `path` are deliberately
 * not editable here: they are the structure every item's denormalised slugs
 * were written against, and changing one would silently detach items from a
 * tree that still looks correct on screen.
 *
 * A first-level entry renamed renames the label its products carry
 * (`partTypeLabel`), so the website's Component Type list, read off the
 * products, follows.
 */
async function update(id, input) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Not found.', 'TAXONOMY_NOT_FOUND');

  const node = await db().Taxonomy.findById(id);
  if (!node) throw ApiError.notFound('Not found.', 'TAXONOMY_NOT_FOUND');

  const renamed = input.name !== undefined && input.name.trim() !== node.name;
  if (input.name !== undefined) node.name = input.name.trim();
  if (input.aliases !== undefined) node.aliases = normaliseAliases(input.aliases);
  if (input.isActive !== undefined) node.isActive = Boolean(input.isActive);
  if (input.isFeatured !== undefined) node.isFeatured = Boolean(input.isFeatured);
  if (input.order !== undefined) node.order = Number(input.order) || 0;

  // An alias that duplicates another entry's is refused rather than stored:
  // two models answering to `15pm` makes the search box ambiguous in a way no
  // amount of ranking fixes, and the staff member is the only one who knows
  // which one is right.
  if (node.aliases.length) {
    const clash = await db()
      .Taxonomy.findOne({
        _id: { $ne: node._id },
        aliases: { $in: node.aliases },
        ...categoryFilter(node.category || 'parts'),
      })
      .select('name aliases')
      .lean();

    if (clash) {
      const overlap = node.aliases.filter((alias) => clash.aliases.includes(alias));
      throw ApiError.badRequest(
        `“${overlap[0]}” is already an alias for ${clash.name}. An alias can only point at one entry.`,
        'ALIAS_IN_USE',
      );
    }
  }

  await node.save();
  const category = await categoryOf(node.category);
  if (renamed && node.kind === 'partType' && category.kind !== 'service') {
    await db().Product.updateMany(
      { ...categoryFilter(category.slug), partType: node.path?.partType },
      { $set: { partTypeLabel: node.name } },
    );
  }
  invalidateTree();
  invalidateCatalog();

  return { node: shape(node.toObject(), await liveCounts(category)) };
}

/**
 * Removes an entry - only when nothing points at it.
 *
 * Two guards, both refusing rather than cascading: an entry with items behind
 * it, and an entry with entries under it. Cascading either would delete
 * catalogue structure from a screen whose job is editing labels.
 */
async function remove(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Not found.', 'TAXONOMY_NOT_FOUND');

  const node = await db().Taxonomy.findById(id);
  if (!node) throw ApiError.notFound('Not found.', 'TAXONOMY_NOT_FOUND');

  const children = await db().Taxonomy.countDocuments({ parent: node._id });
  if (children) {
    throw ApiError.badRequest(
      `${node.name} has ${children} ${children === 1 ? 'entry' : 'entries'} under it. Remove or move those first.`,
      'TAXONOMY_HAS_CHILDREN',
    );
  }

  const category = await categoryOf(node.category);
  const counts = await liveCounts(category);
  const used = counts.get(node.slug) ?? 0;
  const noun = category.kind === 'service' ? 'service' : 'product';
  if (used) {
    throw ApiError.badRequest(
      `${node.name} is used by ${used} ${used === 1 ? noun : `${noun}s`}. Deactivate it instead - deleting it would leave those ${noun}s pointing at nothing.`,
      'TAXONOMY_IN_USE',
    );
  }

  await node.deleteOne();
  // Its rows go with it.
  if (node.kind === 'partType') {
    await db().Taxonomy.updateMany({ ...categoryFilter(category.slug), lines: node.path?.partType }, { $pull: { lines: node.path?.partType } });
  }
  invalidateTree();
  invalidateCatalog();

  return { removed: true, name: node.name };
}

/**
 * A row's id (`rows` makes them): `<value>|<entry id>` for a product line,
 * `<entry id>` for a deepest entry with no first level, `<value>|` for a
 * first-level entry with no rows yet.
 */
async function rowParts(category, rowId) {
  const text = String(rowId ?? '');
  const [first, second] = text.includes('|') ? text.split('|') : [null, text];
  const value = first || null;
  const leaf = second && mongoose.isValidObjectId(second) ? await db().Taxonomy.findById(second) : null;
  const type = value
    ? await db().Taxonomy.findOne({ ...categoryFilter(category.slug), kind: 'partType', 'path.partType': value })
    : null;
  if (!leaf && !type) throw ApiError.notFound('That row is not in the tree any more.', 'TAXONOMY_ROW_NOT_FOUND');

  const chain = [];
  for (let at = leaf; at; at = at.parent ? await db().Taxonomy.findById(at.parent) : null) chain.unshift(at);
  return { value, leaf, type, chain };
}

/**
 * Edit one row of the category tree as a whole (client ruling 2026-10-02:
 * "each row should be a single product tree following add row form, also the
 * rows should be editable").
 *
 * `names` holds a name per level, exactly as the add form sends them. A
 * changed name renames that entry, which is shared: Apple renamed here is
 * Apple renamed in every row that has it, and a renamed first-level entry
 * renames the label its products carry (`update`). The row's aliases and its
 * on/off switch belong to its deepest entry. The row cannot be moved under
 * another brand from here: every item stores the path it was filed under.
 */
async function updateRow({ category: categorySlug, row, names = {}, aliases, isActive }) {
  const category = await categoryOf(categorySlug);
  const { leaf, type, chain } = await rowParts(category, row);
  const levels = categoryLevels(category);

  for (const level of levels) {
    const entry = level.key === 'partType' ? type : chain.find((node) => node.kind === level.key);
    const next = String(names[level.key] ?? '').trim();
    if (entry && next && next !== entry.name) await update(String(entry._id), { name: next });
    if (!entry && next) {
      throw ApiError.badRequest(
        `This row has no ${level.label.toLowerCase()}. Add a new row to file it deeper.`,
        'TAXONOMY_ROW_SHAPE',
      );
    }
  }

  const owner = leaf ?? type;
  const patch = {};
  if (aliases !== undefined) patch.aliases = aliases;
  if (isActive !== undefined) patch.isActive = isActive;
  if (Object.keys(patch).length) await update(String(owner._id), patch);

  invalidateTree();
  invalidateCatalog();
  return { updated: true };
}

/**
 * Take one row out of the tree. A product line is unmarked from its entry,
 * and the entry itself goes once nothing else needs it (no other row, nothing
 * under it, no item filed there). Refused while items are filed on the row,
 * naming how many, because deleting it would leave them pointing at nothing.
 */
async function removeRow({ category: categorySlug, row }) {
  const category = await categoryOf(categorySlug);
  const { value, leaf, type } = await rowParts(category, row);
  const isService = category.kind === 'service';
  const model = isService ? db().Service : db().Product;
  const noun = isService ? 'service' : 'product';

  if (leaf && value && isService) {
    // A Services row exists because services of that type are offered there.
    const root = (await rowParts(category, row)).chain[0];
    const offered = (await db().Service.find({ isActive: true, category: value }).lean()).filter((service) =>
      serviceApplies(service, leaf.path ?? {}, root?.name ?? ''),
    ).length;
    if (offered) {
      throw ApiError.badRequest(
        `${offered} active ${offered === 1 ? 'service offers' : 'services offer'} this repair on this device. Change ${offered === 1 ? 'it' : 'them'} in Purchase › Services to take the row away.`,
        'TAXONOMY_ROW_OFFERED',
      );
    }
  }

  if (leaf && value) {
    const filed = await model.countDocuments({
      ...(isService ? {} : categoryFilter(category.slug)),
      [isService ? 'category' : 'partType']: value,
      [`${leaf.kind}Slug`]: leaf.slug,
    });
    if (filed) {
      throw ApiError.badRequest(
        `${filed} ${filed === 1 ? noun : `${noun}s`} ${filed === 1 ? 'is' : 'are'} filed on this row. Move or switch ${filed === 1 ? 'it' : 'them'} off first.`,
        'TAXONOMY_ROW_IN_USE',
      );
    }
    await db().Taxonomy.updateOne({ _id: leaf._id }, { $pull: { lines: value } });
    const fresh = await db().Taxonomy.findById(leaf._id).lean();
    const children = await db().Taxonomy.countDocuments({ parent: leaf._id });
    const used = (await liveCounts(category)).get(leaf.slug) ?? 0;
    if (!fresh.lines?.length && !children && !used) await db().Taxonomy.deleteOne({ _id: leaf._id });
  } else {
    await remove(String((leaf ?? type)._id));
  }

  invalidateTree();
  invalidateCatalog();
  return { removed: true };
}

export default { list, rows, fullTree, get, create, importCsv, update, remove, updateRow, removeRow, normaliseAliases };

export { normaliseAliases, list, rows, fullTree, get, create, importCsv, update, remove, updateRow, removeRow };
