import mongoose from 'mongoose';

import { db } from '../db/models.js';
import '../models/Taxonomy.js';
import '../models/Product.js';
import ApiError from '../utils/ApiError.js';
import { likeRegex } from '../utils/regex.js';
import { invalidateTree } from './taxonomyService.js';
import { parseCsv, rowsWithoutHeader } from '../utils/csv.js';

/**
 * The taxonomy editor (ERP rework §6.15 - CellShoppe's *Device & Models*,
 * phase 11d).
 *
 * The master list behind the searchable picker on every product form and behind
 * the storefront's three filter UIs. Read-side lives in `taxonomyService`; this
 * is the write side, kept separate so the cached public tree has exactly one
 * owner and this file has to go through `invalidateTree` to affect it.
 *
 * **Aliases are the point of this screen** (§6.15). They sit on the model, so
 * one alias covers every SKU that fits that phone.
 *
 * **Nothing here deletes a node that is in use.** A model with products behind
 * it can be deactivated but not removed: deleting it would leave every one of
 * those products pointing at an id that resolves to nothing, and the storefront
 * filters read `path` slugs that would then match no node at all.
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

/** One node, shaped for the table. */
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
    // The stored `productCount` is a denormalised rollup maintained by the
    // seed. `counts` is the live figure, which is what decides whether a node
    // may be deleted - so the screen shows the number the rule uses.
    productCount: counts?.get(node.slug) ?? 0,
  };
}

/**
 * The taxonomy table.
 *
 * Search spans name, slug **and aliases**, because a screen whose whole purpose
 * is managing aliases has to be able to find a node by one.
 */
async function list({ search, kind, parent, includeInactive, page = 1, limit = 50 } = {}) {
  const filter = {};

  if (kind && kind !== 'all') filter.kind = kind;
  if (parent) filter.parent = parent;
  if (!includeInactive || includeInactive === 'false') filter.isActive = { $ne: false };

  if (search) {
    const rx = likeRegex(search);
    filter.$or = [{ name: rx }, { slug: rx }, { aliases: rx }];
  }

  const perPage = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const current = Math.max(Number(page) || 1, 1);

  const [nodes, total, counts, stats] = await Promise.all([
    db().Taxonomy.find(filter)
      .sort({ kind: 1, order: 1, name: 1 })
      .skip((current - 1) * perPage)
      .limit(perPage)
      .lean(),
    db().Taxonomy.countDocuments(filter),
    liveCounts(),
    // The KPI row counts the whole collection, never the filtered page: a
    // staff member filtering to one brand still needs to know the totals.
    db().Taxonomy.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $ne: ['$isActive', false] }, 1, 0] } },
          brands: { $sum: { $cond: [{ $eq: ['$kind', 'brand'] }, 1, 0] } },
          withAliases: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$aliases', []] } }, 0] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const summary = stats[0] ?? { total: 0, active: 0, brands: 0, withAliases: 0 };

  return {
    nodes: nodes.map((node) => shape(node, counts)),
    total,
    page: current,
    pages: Math.max(Math.ceil(total / perPage), 1),
    stats: {
      total: summary.total,
      active: summary.active,
      inactive: summary.total - summary.active,
      brands: summary.brands,
      withAliases: summary.withAliases,
    },
  };
}

/**
 * How many live products sit under each taxonomy slug.
 *
 * Counted from `db().Product.path` rather than read off `db().Taxonomy.productCount`,
 * which the seed writes and nothing else maintains. The delete rule depends on
 * this being true right now, not true at the last seed.
 */
async function liveCounts() {
  // `Product` carries flat `*Slug` fields, not a nested `path` - the nested
  // shape is `Taxonomy`'s. One product contributes to all four of its ancestors,
  // so a brand's count is every part under every model it makes.
  const rows = await db().Product.aggregate([
    { $match: { isActive: true } },
    {
      $project: {
        slugs: ['$deviceTypeSlug', '$brandSlug', '$seriesSlug', '$modelSlug'],
      },
    },
    { $unwind: '$slugs' },
    { $match: { slugs: { $nin: [null, ''] } } },
    { $group: { _id: '$slugs', count: { $sum: 1 } } },
  ]);

  return new Map(rows.map((row) => [row._id, row.count]));
}

/** One node, for the edit form. */
async function get(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Not found.', 'TAXONOMY_NOT_FOUND');

  const node = await db().Taxonomy.findById(id).lean();
  if (!node) throw ApiError.notFound('Not found.', 'TAXONOMY_NOT_FOUND');

  return { node: shape(node, await liveCounts()) };
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
 * Finds a node by slug, or creates it.
 *
 * The write half of "add a model": a staff member types
 * `Phone › Apple › iPhone 15 › iPhone 15 Pro Max` and any of those four levels
 * may not exist yet. Each is looked up by slug first, so adding a second
 * Samsung model does not mint a second Samsung.
 *
 * **Created nodes are ordered last**, not inserted alphabetically. The wizard
 * reads `order`, and renumbering siblings to slot one in would move rows on a
 * storefront that a staff member is not looking at.
 */
async function ensureNode({ kind, name, slug, parent, path }) {
  const existing = await db().Taxonomy.findOne({ slug });
  if (existing) return existing;

  /**
   * `parent` is an ObjectId, not a slug.
   *
   * The seed builds its documents with a `parentSlug` and resolves every one to
   * a real id before inserting - the schema has no such field, so writing a
   * slug there stores nothing and `getTree` drops the node, since it links
   * children by `node.parent`. A node that saves cleanly and then does not
   * appear in the picker is the failure this note exists to prevent.
   */
  const last = await db()
    .Taxonomy.findOne({ kind, parent: parent ?? null })
    .sort({ order: -1 })
    .select('order')
    .lean();

  return db().Taxonomy.create({
    kind,
    name: name.trim(),
    slug,
    parent: parent ?? null,
    path,
    order: (last?.order ?? -1) + 1,
  });
}

/**
 * Adds one model, creating whatever part of its branch is missing.
 *
 * ## Why this takes four names rather than a parent id
 *
 * The screen asks for Category, Brand, Device/Series and Model as plain text,
 * because that is how somebody adding "the new Pixel" thinks - they do not
 * know whether a `Google` brand node exists, and making them find out first
 * would mean three screens to add one phone. So the branch is resolved here:
 * each level is found by slug or created, and only the model is required to be
 * new.
 *
 * **Series is optional**, matching the form. A model with no series hangs off
 * the brand, which is what the seeded data does for the catalogue's flatter
 * corners.
 *
 * **A duplicate model is refused, not silently reused.** Saving the same model
 * twice would otherwise look like it worked while editing nothing, and the
 * second set of aliases would land on the first node.
 */
async function create(input) {
  const deviceTypeName = String(input.deviceType ?? '').trim();
  const brandName = String(input.brand ?? '').trim();
  const seriesName = String(input.series ?? '').trim();
  const modelName = String(input.name ?? '').trim();

  if (!deviceTypeName) throw ApiError.badRequest('Pick a category.', 'CATEGORY_REQUIRED');
  if (!brandName) throw ApiError.badRequest('Name the brand.', 'BRAND_REQUIRED');
  if (!modelName) throw ApiError.badRequest('Name the model.', 'MODEL_REQUIRED');

  const deviceTypeSlug = slugify(deviceTypeName);
  const brandSlug = slugify(brandName);
  const seriesSlug = seriesName ? slugify(seriesName) : null;
  // Prefixed with the brand, exactly as `seed/generate.js` builds it: "Pro" is
  // a model name several brands use, and an unprefixed slug is unique-indexed
  // so the second one would be refused by the database rather than by us.
  const modelSlug = slugify(`${brandSlug}-${modelName}`);

  const clash = await db().Taxonomy.findOne({ slug: modelSlug }).select('name').lean();
  if (clash) {
    throw ApiError.badRequest(
      `${clash.name} is already in the list. Edit that entry instead of adding it twice.`,
      'MODEL_EXISTS',
    );
  }

  const aliases = normaliseAliases(input.aliases);
  if (aliases.length) {
    const aliasClash = await db()
      .Taxonomy.findOne({ aliases: { $in: aliases } })
      .select('name aliases')
      .lean();

    if (aliasClash) {
      const overlap = aliases.filter((alias) => aliasClash.aliases.includes(alias));
      throw ApiError.badRequest(
        `“${overlap[0]}” is already an alias for ${aliasClash.name}. An alias can only point at one model.`,
        'ALIAS_IN_USE',
      );
    }
  }

  const deviceTypeNode = await ensureNode({
    kind: 'deviceType',
    name: deviceTypeName,
    slug: deviceTypeSlug,
    parent: null,
    path: { deviceType: deviceTypeSlug },
  });

  const brandNode = await ensureNode({
    kind: 'brand',
    name: brandName,
    slug: brandSlug,
    parent: deviceTypeNode._id,
    path: { deviceType: deviceTypeSlug, brand: brandSlug },
  });

  let seriesNode = null;
  if (seriesSlug) {
    seriesNode = await ensureNode({
      kind: 'series',
      name: seriesName,
      slug: seriesSlug,
      parent: brandNode._id,
      path: { deviceType: deviceTypeSlug, brand: brandSlug, series: seriesSlug },
    });
  }

  const node = await ensureNode({
    kind: 'model',
    name: modelName,
    slug: modelSlug,
    parent: seriesNode?._id ?? brandNode._id,
    path: {
      deviceType: deviceTypeSlug,
      brand: brandSlug,
      ...(seriesSlug ? { series: seriesSlug } : {}),
      model: modelSlug,
    },
  });

  if (aliases.length) {
    node.aliases = aliases;
    await node.save();
  }

  invalidateTree();

  return { node: shape(node.toObject(), await liveCounts()) };
}

/**
 * Bulk-adds models from CSV.
 *
 * ## The format
 *
 * `Category, Brand, Device, Model, Aliases` - one row per model, header
 * optional. Category, Brand and Model are required; Device (the series) and
 * Aliases are not. Aliases are separated by a **vertical bar**, not a comma,
 * because a comma is the column separator and `15 PM, 15 Pro Max` in an
 * unquoted cell would read as two columns.
 *
 * ## Re-importing the same row updates it
 *
 * Matched by the canonical slug, which is what makes this usable: a shop
 * exports its list, edits aliases in a spreadsheet and imports it back. A
 * create-only importer would refuse every row of that file.
 *
 * ## One bad row does not fail the file
 *
 * Every row is reported - added, updated, or skipped with a reason and its line
 * number. A hundred-row file with one alias clash should add ninety-nine models
 * and say which one it could not, rather than rolling back work the staff
 * member would have to redo.
 */
async function importCsv(text) {
  const rows = rowsWithoutHeader(parseCsv(text), 'Category');

  if (!rows.length) {
    throw ApiError.badRequest('There are no rows in that file.', 'CSV_EMPTY');
  }
  if (rows.length > 2000) {
    throw ApiError.badRequest(
      `That file has ${rows.length} rows. Import 2000 or fewer at a time.`,
      'CSV_TOO_LARGE',
    );
  }

  const results = { added: 0, updated: 0, skipped: 0, rows: [] };

  for (const [index, cells] of rows.entries()) {
    // +1 for zero-indexing; the header line, when present, is already gone, so
    // this is the line number a staff member counts in their own file only when
    // they have no header. Reported as "row N" rather than "line N" for that
    // reason.
    const rowNumber = index + 1;
    const [deviceType, brand, series, name, aliasCell] = cells;

    // The bar is the documented separator, but a file made by hand often uses a
    // comma inside a quoted cell. Both are accepted - `normaliseAliases` splits
    // on commas already, so this only has to turn bars into them.
    const aliases = String(aliasCell ?? '').replace(/\|/g, ',');

    try {
      const existing = await db()
        .Taxonomy.findOne({ slug: slugify(`${slugify(brand ?? '')}-${name ?? ''}`) })
        .select('_id name')
        .lean();

      if (existing) {
        // Update rather than refuse: re-importing an edited export is the
        // normal case, not an error. Only the fields this format carries are
        // touched, so an `isActive: false` set on the screen survives.
        await update(existing._id.toString(), { name: String(name).trim(), aliases });
        results.updated += 1;
        results.rows.push({ row: rowNumber, name: String(name).trim(), status: 'updated' });
        continue;
      }

      const created = await create({ deviceType, brand, series, name, aliases });
      results.added += 1;
      results.rows.push({ row: rowNumber, name: created.node.name, status: 'added' });
    } catch (err) {
      results.skipped += 1;
      results.rows.push({
        row: rowNumber,
        name: String(name ?? '').trim() || `Row ${rowNumber}`,
        status: 'skipped',
        // The service's own messages name the record they collided with, so
        // they are carried through rather than replaced with "invalid row".
        reason: err.message,
      });
    }
  }

  invalidateTree();

  return results;
}

/**
 * Edits a node.
 *
 * **Only the safe fields.** `kind`, `slug`, `parent` and `path` are deliberately
 * not editable here: they are the structure every product's denormalised `path`
 * was written against, and changing one would silently detach products from a
 * tree that still looks correct on screen. Restructuring the taxonomy is a
 * re-seed, not a form.
 */
async function update(id, input) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Not found.', 'TAXONOMY_NOT_FOUND');

  const node = await db().Taxonomy.findById(id);
  if (!node) throw ApiError.notFound('Not found.', 'TAXONOMY_NOT_FOUND');

  if (input.name !== undefined) node.name = input.name.trim();
  if (input.aliases !== undefined) node.aliases = normaliseAliases(input.aliases);
  if (input.isActive !== undefined) node.isActive = Boolean(input.isActive);
  if (input.isFeatured !== undefined) node.isFeatured = Boolean(input.isFeatured);
  if (input.order !== undefined) node.order = Number(input.order) || 0;

  // An alias that duplicates another node's is refused rather than stored: two
  // models answering to `15pm` makes the search box ambiguous in a way no
  // amount of ranking fixes, and the staff member is the only one who knows which
  // one is right.
  if (node.aliases.length) {
    const clash = await db().Taxonomy.findOne({
      _id: { $ne: node._id },
      aliases: { $in: node.aliases },
    })
      .select('name aliases')
      .lean();

    if (clash) {
      const overlap = node.aliases.filter((alias) => clash.aliases.includes(alias));
      throw ApiError.badRequest(
        `“${overlap[0]}” is already an alias for ${clash.name}. An alias can only point at one model.`,
        'ALIAS_IN_USE',
      );
    }
  }

  await node.save();
  invalidateTree();

  return { node: shape(node.toObject(), await liveCounts()) };
}

/**
 * Removes a node - only when nothing points at it.
 *
 * Two guards, both refusing rather than cascading: a node with products behind
 * it, and a node with children. Cascading either would delete catalogue
 * structure from a screen whose job is editing labels.
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

  const counts = await liveCounts();
  const used = counts.get(node.slug) ?? 0;
  if (used) {
    throw ApiError.badRequest(
      `${node.name} is used by ${used} ${used === 1 ? 'product' : 'products'}. Deactivate it instead - deleting it would leave those products pointing at nothing.`,
      'TAXONOMY_IN_USE',
    );
  }

  await node.deleteOne();
  invalidateTree();

  return { removed: true, name: node.name };
}

export default { list, get, create, importCsv, update, remove, normaliseAliases };

export { normaliseAliases, list, get, create, importCsv, update, remove };
