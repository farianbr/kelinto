import mongoose from 'mongoose';

import { db } from '../db/models.js';
import '../models/Taxonomy.js';
import ApiError from '../utils/ApiError.js';
import { escapeRegex, likeRegex } from '../utils/regex.js';
import { ensureTree, invalidateCatalog } from './catalogService.js';
import { invalidateTree } from './taxonomyService.js';
import taxonomyAdminService from './taxonomyAdminService.js';

/**
 * The devices the counter picks from on a ticket, a quote, an invoice and the
 * kiosk: the Services category tree (client ruling 2026-10-03: "serviced items
 * overlaps with taxonomy category tree. remove serviced items").
 *
 * Until then this read a list of its own (`DeviceCatalog`, Settings ›
 * Serviced items), which the Services tree had been copied from. Two lists
 * of the same devices drifted, so there is now one: Settings › Taxonomy ›
 * Services › Category tree. These endpoints keep their shape, so every picker
 * works unchanged; only where the devices come from moved. `DeviceCatalog`
 * stays in the database for history and seeds a business's Services tree the
 * first time it has none.
 *
 * Two rules carry over:
 *
 * **Nothing is pruned by what is on sale.** A device the counter repairs is a
 * device in the picker whether or not anything is filed under it.
 *
 * **A device in use is switched off, never deleted.** Tickets and quotes
 * snapshot the device name, so the counts below are taken before a delete.
 */

const CATEGORY = 'services';
const KINDS = ['deviceType', 'brand', 'series', 'model'];
/** The level each kind sits at, so a child's kind follows from its parent's. */
const CHILD_KIND = { deviceType: 'brand', brand: 'series', series: 'model', model: null };

const isObjectId = (value) => mongoose.isValidObjectId(value);

const slugify = (value) =>
  String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** A slug under its parent, in the Services namespace. */
const slugFor = (name, parent) => (parent ? slugify(`${parent.slug}-${name}`) : `${CATEGORY}-${slugify(name)}`);

function shapeNode(node, children = []) {
  return {
    id: String(node._id),
    kind: node.kind,
    name: node.name,
    slug: node.slug,
    icon: node.icon ?? null,
    order: node.order ?? 0,
    aliases: node.aliases ?? [],
    isActive: node.isActive !== false,
    path: node.path ?? {},
    parent: node.parent ? String(node.parent) : null,
    children,
  };
}

/** The Services tree's device entries (its first level, Repair Type, is not a device). */
const deviceFilter = (extra = {}) => ({ category: CATEGORY, kind: { $in: KINDS }, ...extra });

/**
 * The whole tree, nested. No pruning and no counting: a device with nothing
 * filed under it is still a device the counter takes in. `status` defaults
 * to active, because every caller is a picker.
 */
async function getTree({ status = 'active' } = {}) {
  await ensureTree(CATEGORY);
  const filter = deviceFilter();
  if (status === 'active') filter.isActive = { $ne: false };
  else if (status === 'inactive') filter.isActive = false;

  const nodes = await db().Taxonomy.find(filter).sort({ order: 1, name: 1 }).lean();
  const byId = new Map(nodes.map((node) => [String(node._id), shapeNode(node)]));
  const roots = [];
  for (const node of nodes) {
    const shaped = byId.get(String(node._id));
    const parentId = node.parent ? String(node.parent) : null;
    // A device whose parent is switched off surfaces at the root rather than
    // vanishing from the picker.
    if (parentId && byId.has(parentId)) byId.get(parentId).children.push(shaped);
    else roots.push(shaped);
  }
  return { tree: roots, total: nodes.length };
}

/** A flat list, searchable by name, slug and alias (the counter types "SM-S911B"). */
async function listNodes({ kind, parent, q, status = 'all' } = {}) {
  await ensureTree(CATEGORY);
  const filter = deviceFilter();
  if (kind && KINDS.includes(kind)) filter.kind = kind;
  if (parent === 'root') filter.parent = null;
  else if (parent && isObjectId(parent)) filter.parent = parent;
  if (status === 'active') filter.isActive = { $ne: false };
  else if (status === 'inactive') filter.isActive = false;
  if (q) {
    const rx = likeRegex(q);
    filter.$or = [{ name: rx }, { slug: rx }, { aliases: rx }];
  }
  const nodes = await db().Taxonomy.find(filter).sort({ kind: 1, order: 1, name: 1 }).limit(500).lean();
  return { nodes: nodes.map((node) => shapeNode(node)), total: nodes.length };
}

/**
 * Add a device from a picker (the ticket form's "add it"): a device type at
 * the root, or the next level under the entry it is added to. The kind
 * follows from the parent, never from the request. A name already under that
 * parent is returned rather than added twice.
 */
async function createNode(body = {}) {
  await ensureTree(CATEGORY);
  const name = String(body.name ?? '').trim();
  if (!name) throw ApiError.badRequest('Give the device a name.', 'DEVICE_NAME_REQUIRED');

  let parent = null;
  let kind = 'deviceType';
  if (body.parent) {
    if (!isObjectId(body.parent)) throw ApiError.badRequest('That parent does not exist.', 'DEVICE_PARENT_INVALID');
    parent = await db().Taxonomy.findOne({ _id: body.parent, category: CATEGORY }).lean();
    if (!parent) throw ApiError.badRequest('That parent does not exist.', 'DEVICE_PARENT_INVALID');
    kind = CHILD_KIND[parent.kind];
    if (!kind) throw ApiError.badRequest('A model is the deepest level; nothing goes under it.', 'DEVICE_PARENT_IS_LEAF');
  }

  const exact = new RegExp(`^${escapeRegex(name)}$`, 'i');
  const existing = await db().Taxonomy.findOne(deviceFilter({ kind, parent: parent?._id ?? null, name: exact })).lean();
  if (existing) return { node: shapeNode(existing) };

  let slug = slugFor(name, parent);
  if (!slug) throw ApiError.badRequest('That name cannot be turned into a slug.', 'DEVICE_SLUG_INVALID');
  for (let n = 2; await db().Taxonomy.exists({ slug }); n += 1) slug = `${slugFor(name, parent)}-${n}`;

  const last = await db()
    .Taxonomy.findOne(deviceFilter({ kind, parent: parent?._id ?? null }))
    .sort({ order: -1 })
    .select('order')
    .lean();
  const node = await db().Taxonomy.create({
    category: CATEGORY,
    kind,
    name,
    slug,
    parent: parent?._id ?? null,
    path: { ...(parent?.path ?? {}), [kind]: slug },
    order: (last?.order ?? -1) + 1,
    aliases: [],
    isActive: true,
  });
  invalidateTree();
  invalidateCatalog();
  return { node: shapeNode(node.toObject()) };
}

/** Rename, switch on or off, or re-alias a device: the category tree's own edit. */
async function updateNode(id, body = {}) {
  if (!isObjectId(id)) throw ApiError.notFound('Device not found.', 'DEVICE_NOT_FOUND');
  const result = await taxonomyAdminService.update(id, body);
  return { node: result.node };
}

/**
 * How many tickets and quotes name this device, matched on the name they
 * snapshot (`devices.category` for a device type).
 */
async function usageCount(node) {
  const field = node.kind === 'deviceType' ? 'category' : node.kind;
  const match = { [`devices.${field}`]: node.name };
  const [tickets, quotes] = await Promise.all([
    db().Ticket.countDocuments(match),
    db().ServiceQuote.countDocuments(match),
  ]);
  return tickets + quotes;
}

/** Delete a device nothing points at: no device under it, no ticket or quote, no service. */
async function deleteNode(id) {
  if (!isObjectId(id)) throw ApiError.notFound('Device not found.', 'DEVICE_NOT_FOUND');
  const node = await db().Taxonomy.findOne({ _id: id, category: CATEGORY }).lean();
  if (!node) throw ApiError.notFound('Device not found.', 'DEVICE_NOT_FOUND');
  const used = await usageCount(node);
  if (used > 0) {
    throw ApiError.badRequest(
      `"${node.name}" is on ${used} ticket${used === 1 ? '' : 's'} or quote${used === 1 ? '' : 's'}. Switch it off instead: it leaves the pickers and the history stays readable.`,
      'DEVICE_IN_USE',
    );
  }
  await taxonomyAdminService.remove(id);
  return { deleted: true, name: node.name };
}

export { slugify, slugFor, getTree, listNodes, createNode, updateNode, deleteNode };
export default { getTree, listNodes, createNode, updateNode, deleteNode };
