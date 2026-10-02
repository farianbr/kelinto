import mongoose from 'mongoose';

import { db } from '../db/models.js';
import ApiError from '../utils/ApiError.js';
import { likeRegex } from '../utils/regex.js';
import { parseCsv, rowsWithoutHeader } from '../utils/csv.js';
import { canSeePricing } from '../middleware/auth.js';
import { servicePhotoFor } from '../../../shared/catalog.js';
import { addLine, categoryFacet, deviceTypeNameOf, invalidateCatalog, serviceApplies } from './catalogService.js';
import storage, { urlOf } from './storageService.js';
import { currentContext } from '../db/context.js';

/**
 * The repair types a service is filed under: the Services finder's first
 * step, edited in Settings › Taxonomy (2026-10-02; a fixed list before).
 */
async function repairTypes() {
  return (await categoryFacet('services')).options;
}

/** "Other" when the list has it, else its first entry: where an unknown type lands. */
function fallbackType(types) {
  return types.find((option) => option.value === 'other')?.value ?? types[0]?.value ?? 'other';
}

/** A posted repair type, checked against the list. */
async function repairTypeOf(value) {
  const types = await repairTypes();
  return types.some((option) => option.value === value) ? value : fallbackType(types);
}

/**
 * A service narrowed to a device is a row of the Services category tree:
 * Screen › Phone › Apple › iPhone 15 (2026-10-02).
 */
async function markLine(service) {
  const at = service.modelSlug || service.seriesSlug || service.brandSlug || service.deviceTypeSlug;
  await addLine('services', at, service.category);
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * A slug for a service, unique within its business: the name's, or the
 * name's with -2, -3 when another service already holds it.
 */
async function uniqueSlug(name, business, exceptId = null) {
  const base = slugify(name) || 'service';
  for (let n = 1; n < 50; n += 1) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    const taken = await db().Service.exists({
      business: business ?? null,
      slug: candidate,
      ...(exceptId ? { _id: { $ne: exceptId } } : {}),
    });
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** A service's picture is this business's own upload or nothing, never a hotlink. */
function assertOwnImage(url) {
  if (url && !storage.isAllowedUrl(url, currentContext()?.code)) {
    throw ApiError.badRequest('Upload the picture here rather than linking to another site.', 'ASSET_NOT_OURS');
  }
}

/** The website's picture for a service: its own upload, else the stock photo by name. */
function pictureOf(row) {
  return urlOf(row.image) || servicePhotoFor(row.name) || '';
}

/**
 * The repair services a shop sells (Sales § Services).
 *
 * **Named `serviceCatalogService` rather than `serviceService`** - the second
 * reads as a typo in every import line, and this file is about a catalogue.
 *
 * Two rules live here and are worth not routing around:
 *
 * **A service in use is deactivated, never deleted.** Quote and ticket lines
 * snapshot the name and price they were created with, so deleting one would not
 * corrupt a single document - but it would break every report that groups
 * historical work by service, and those are the reports that answer "what do we
 * actually make money on". `remove` refuses when a line points at it and offers
 * deactivation instead.
 *
 * **The price here is a starting point, not a price.** It is what the picker
 * fills into a line; the line's own figure is what gets totalled. A screen on a
 * bent frame costs more than the list says, and a staff member who cannot override
 * the number will put the difference somewhere worse.
 */

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value ?? ''));
}

/**
 * The API shape.
 *
 * Cents in, dollars out for display, and both are sent: the picker needs the
 * cents to fill a line without a rounding trip through a float.
 */
function shapeService(service) {
  if (!service) return null;

  return {
    id: String(service._id),
    name: service.name,
    description: service.description ?? '',
    category: service.category ?? 'other',
    // The upload only, so the form shows an empty slot rather than the stock
    // photo it would replace; `picture` is what the website will draw.
    image: urlOf(service.image) ?? '',
    picture: pictureOf(service),
    details: service.details ?? '',
    slug: service.slug ?? '',

    priceCents: service.priceCents ?? 0,
    price: (service.priceCents ?? 0) / 100,
    // Undefined rather than 0 when never recorded - an unknown cost and a zero
    // cost produce very different margins, and the screen says so.
    costCents: service.costCents ?? null,
    cost: service.costCents == null ? null : service.costCents / 100,

    durationMinutes: service.durationMinutes ?? 0,
    warrantyDays: service.warrantyDays ?? 0,
    deviceTypes: service.deviceTypes ?? [],
    // Where it applies in the Services taxonomy; all blank is every device.
    scope: {
      deviceType: service.deviceTypeSlug ?? '',
      brand: service.brandSlug ?? '',
      series: service.seriesSlug ?? '',
      model: service.modelSlug ?? '',
      label: service.scopeLabel ?? '',
    },
    taxable: service.taxable !== false,
    isActive: service.isActive !== false,
    order: service.order ?? 0,

    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}

/**
 * Dollars to integer cents, or `undefined` when nothing was sent.
 *
 * `undefined` and `0` have to stay distinct here: the first leaves `costCents`
 * unset, the second records a genuinely free service.
 */
function toCents(dollars) {
  if (dollars === undefined || dollars === null || dollars === '') return undefined;
  const amount = Number(dollars);
  if (!Number.isFinite(amount) || amount < 0) {
    throw ApiError.badRequest('Enter a valid amount.', 'SERVICE_AMOUNT_INVALID');
  }
  return Math.round(amount * 100);
}

function normaliseDeviceTypes(value) {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : String(value).split(',');
  return [
    ...new Set(
      list
        .map((entry) => String(entry ?? '').trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 20),
    ),
  ];
}

/**
 * The catalogue, filtered.
 *
 * `status` defaults to active because every caller but the settings screen
 * wants what can be sold today - a picker offering a retired service is a
 * picker that puts retired work on a quote.
 */
async function listServices({
  q,
  category,
  deviceType,
  status = 'active',
  business,
  limit,
  page,
} = {}) {
  const query = {};

  // Scoped the way every other business-owned read is: resolved by
  // `resolveBusinessScope`, never read off the query string.
  if (business) query.business = business;

  if (status === 'active') query.isActive = true;
  else if (status === 'inactive') query.isActive = false;

  if (category && category !== 'all') query.category = String(category);

  /**
   * A device type matches a service that names it **or one that names none**.
   *
   * An empty `deviceTypes` means "offer it for anything" - a diagnostic fee
   * applies to a laptop and a handset alike - so filtering it out would hide
   * exactly the services that are always relevant.
   */
  if (deviceType) {
    const type = String(deviceType).trim().toLowerCase();
    query.$and = [
      ...(query.$and ?? []),
      { $or: [{ deviceTypes: type }, { deviceTypes: { $size: 0 } }, { deviceTypes: { $exists: false } }] },
    ];
  }

  if (q) {
    const rx = likeRegex(q);
    query.$and = [...(query.$and ?? []), { $or: [{ name: rx }, { description: rx }] }];
  }

  const perPage = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const current = Math.max(Number(page) || 1, 1);

  const [rows, total] = await Promise.all([
    db()
      .Service.find(query)
      .sort({ order: 1, name: 1 })
      .skip((current - 1) * perPage)
      .limit(perPage)
      .lean(),
    db().Service.countDocuments(query),
  ]);

  return {
    services: rows.map(shapeService),
    total,
    page: current,
    pages: Math.max(Math.ceil(total / perPage), 1),
    // The Services finder's first step (Repair Type), which a service is filed
    // under; edited in Settings › Taxonomy since 2026-10-02.
    repairTypes: await repairTypes(),
  };
}

async function getService(id) {
  if (!isObjectId(id)) throw ApiError.notFound('Service not found.', 'SERVICE_NOT_FOUND');
  const service = await db().Service.findById(id).lean();
  if (!service) throw ApiError.notFound('Service not found.', 'SERVICE_NOT_FOUND');
  return { service: shapeService(service) };
}

/**
 * A service's place in the Services taxonomy, from a picker's answer: the
 * deepest node chosen, read back from the tree so the four slugs and the label
 * always agree with it. Blank clears the scope, which means "every device".
 */
async function scopeFrom(nodeId) {
  const blank = { deviceTypeSlug: '', brandSlug: '', seriesSlug: '', modelSlug: '', scopeLabel: '' };
  if (!nodeId) return blank;
  if (!isObjectId(nodeId)) throw ApiError.badRequest('Pick the device from the list.', 'SCOPE_UNKNOWN');
  const node = await db().Taxonomy.findOne({ _id: nodeId, category: 'services' }).lean();
  if (!node) throw ApiError.badRequest('That device is not in the Services list.', 'SCOPE_UNKNOWN');

  const slugs = Object.values(node.path ?? {}).filter(Boolean);
  const chain = await db().Taxonomy.find({ category: 'services', slug: { $in: slugs } }).select('kind name').lean();
  const order = ['deviceType', 'brand', 'series', 'model'];
  const label = chain
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map((entry) => entry.name)
    .join(' › ');

  return {
    deviceTypeSlug: node.path?.deviceType ?? '',
    brandSlug: node.path?.brand ?? '',
    seriesSlug: node.path?.series ?? '',
    modelSlug: node.path?.model ?? '',
    scopeLabel: label,
  };
}

async function createService(body = {}, actor, business = null) {
  const name = String(body.name ?? '').trim();
  if (name.length < 2) {
    throw ApiError.badRequest('Give the service a name.', 'SERVICE_NAME_REQUIRED');
  }

  assertOwnImage(body.image);

  const payload = {
    name,
    description: String(body.description ?? '').trim() || undefined,
    business: business ?? null,
    category: await repairTypeOf(body.category),
    priceCents: toCents(body.price) ?? 0,
    costCents: toCents(body.cost),
    durationMinutes: Math.max(Number(body.durationMinutes) || 0, 0),
    warrantyDays: Math.max(Number(body.warrantyDays) || 0, 0),
    deviceTypes: normaliseDeviceTypes(body.deviceTypes) ?? [],
    taxable: body.taxable !== false,
    isActive: body.isActive !== false,
    order: Number(body.order) || 0,
    image: storage.toKey(body.image) || '',
    details: String(body.details ?? '').trim(),
    slug: await uniqueSlug(name, business),
    createdBy: actor ?? null,
    ...(body.scopeNode !== undefined ? await scopeFrom(body.scopeNode) : {}),
  };

  try {
    const service = await db().Service.create(payload);
    await markLine(service);
    await storage.claim([service.image], currentContext()?.code);
    invalidateCatalog();
    return { service: shapeService(service.toObject()) };
  } catch (error) {
    // The compound unique index on `{ business, name }`. Caught rather than
    // pre-checked: a pre-check races, the index does not.
    if (error?.code === 11000) {
      throw ApiError.badRequest(
        `"${name}" is already on the service list.`,
        'SERVICE_DUPLICATE',
      );
    }
    throw error;
  }
}

async function updateService(id, body = {}) {
  if (!isObjectId(id)) throw ApiError.notFound('Service not found.', 'SERVICE_NOT_FOUND');

  const service = await db().Service.findById(id);
  if (!service) throw ApiError.notFound('Service not found.', 'SERVICE_NOT_FOUND');

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2) {
      throw ApiError.badRequest('Give the service a name.', 'SERVICE_NAME_REQUIRED');
    }
    service.name = name;
  }

  if (body.description !== undefined) {
    service.description = String(body.description).trim() || undefined;
  }
  if (body.category !== undefined) {
    service.category = await repairTypeOf(body.category);
  }
  if (body.price !== undefined) service.priceCents = toCents(body.price) ?? 0;
  if (body.cost !== undefined) service.costCents = toCents(body.cost);
  if (body.durationMinutes !== undefined) {
    service.durationMinutes = Math.max(Number(body.durationMinutes) || 0, 0);
  }
  if (body.warrantyDays !== undefined) {
    service.warrantyDays = Math.max(Number(body.warrantyDays) || 0, 0);
  }
  if (body.deviceTypes !== undefined) {
    service.deviceTypes = normaliseDeviceTypes(body.deviceTypes) ?? [];
  }
  if (body.taxable !== undefined) service.taxable = Boolean(body.taxable);
  if (body.isActive !== undefined) service.isActive = Boolean(body.isActive);
  if (body.order !== undefined) service.order = Number(body.order) || 0;
  if (body.scopeNode !== undefined) Object.assign(service, await scopeFrom(body.scopeNode));
  if (body.details !== undefined) service.details = String(body.details).trim();
  if (!service.slug) service.slug = await uniqueSlug(service.name, service.business, service._id);

  assertOwnImage(body.image);
  const imageBefore = service.image ?? '';
  if (body.image !== undefined) service.image = storage.toKey(body.image) || '';

  try {
    await service.save();
    await markLine(service);
    if (body.image !== undefined) {
      const owner = currentContext()?.code;
      await storage.claim([service.image], owner);
      await storage.releaseReplaced([imageBefore], [service.image], owner);
    }
    invalidateCatalog();
  } catch (error) {
    if (error?.code === 11000) {
      throw ApiError.badRequest(
        `"${service.name}" is already on the service list.`,
        'SERVICE_DUPLICATE',
      );
    }
    throw error;
  }

  return { service: shapeService(service.toObject()) };
}

/**
 * How many quote and ticket lines point at this service.
 *
 * Counted across both, because either is enough to make deletion the wrong
 * answer - and a service quoted but never ticketed is exactly the case somebody
 * would otherwise delete thinking it was unused.
 */
async function usageCount(id) {
  const [quotes, tickets] = await Promise.all([
    db().ServiceQuote.countDocuments({ 'devices.services.service': id }),
    db().Ticket.countDocuments({ 'devices.services.service': id }),
  ]);
  return quotes + tickets;
}

/**
 * Remove a service that was never used; refuse one that was.
 *
 * The refusal names the count and points at deactivation, because "cannot
 * delete" without a reason or an alternative is a dead end the staff member has to
 * guess their way out of.
 */
async function deleteService(id) {
  if (!isObjectId(id)) throw ApiError.notFound('Service not found.', 'SERVICE_NOT_FOUND');

  const service = await db().Service.findById(id).lean();
  if (!service) throw ApiError.notFound('Service not found.', 'SERVICE_NOT_FOUND');

  const used = await usageCount(id);
  if (used > 0) {
    throw ApiError.badRequest(
      `"${service.name}" is on ${used} quote${used === 1 ? '' : 's'} or ticket${used === 1 ? '' : 's'}. ` +
        'Deactivate it instead - it will stop appearing on new work and the history stays readable.',
      'SERVICE_IN_USE',
    );
  }

  await db().Service.deleteOne({ _id: id });
  invalidateCatalog();
  return { deleted: true, name: service.name };
}

/**
 * Bulk-add services from a pasted or uploaded CSV.
 *
 * Same shape as the taxonomy importer, for the same reason: a shop arriving
 * with a price list already in a spreadsheet should not have to retype forty
 * rows into a modal one at a time.
 *
 * ## The format
 *
 * `Name, Category, Price, Duration (minutes), Warranty (days)` - name is the
 * only required column, and everything after it may be blank or absent. A
 * header row is optional and detected by its first cell.
 *
 * ## Why it updates rather than refuses
 *
 * A name already on the list is **updated**, not rejected. Re-importing an
 * edited export is the normal way somebody does a price rise, and refusing the
 * whole file because forty of its rows already exist turns the common case
 * into an error. Only the columns this format carries are touched, so a
 * service deactivated on the screen stays deactivated.
 *
 * One bad row never fails the file: each is caught and reported by number, so
 * a forty-row import with one unparseable price adds thirty-nine and says
 * which one it could not read.
 */
async function importServices(text, actor, business = null) {
  const rows = rowsWithoutHeader(parseCsv(text), 'Name');

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
  // A row's type is matched on its stored value or its name, either case.
  const types = await repairTypes();

  for (const [index, cells] of rows.entries()) {
    const rowNumber = index + 1;
    const [nameCell, categoryCell, priceCell, durationCell, warrantyCell] = cells;
    const name = String(nameCell ?? '').trim();

    if (!name) {
      results.skipped += 1;
      results.rows.push({ row: rowNumber, name: '', status: 'skipped', error: 'No name in this row.' });
      continue;
    }

    // Blank stays blank rather than becoming zero: an empty price column means
    // "this file does not carry prices", and writing 0 would silently make
    // every service free.
    const number = (cell) => {
      const raw = String(cell ?? '').replace(/[$,]/g, '').trim();
      if (!raw) return undefined;
      const value = Number(raw);
      return Number.isFinite(value) ? value : undefined;
    };

    const typed = String(categoryCell ?? '').trim().toLowerCase();
    const category =
      types.find((option) => option.value === typed || option.label.toLowerCase() === typed)?.value ?? fallbackType(types);

    const payload = {
      name,
      category,
      price: number(priceCell),
      durationMinutes: number(durationCell),
      warrantyDays: number(warrantyCell),
    };

    // Undefined keys would overwrite a stored value with nothing on update.
    for (const key of Object.keys(payload)) {
      if (payload[key] === undefined) delete payload[key];
    }

    try {
      const existing = await db()
        .Service.findOne({ business: business ?? null, name })
        .select('_id')
        .lean();

      if (existing) {
        await updateService(existing._id.toString(), payload);
        results.updated += 1;
        results.rows.push({ row: rowNumber, name, status: 'updated' });
        continue;
      }

      await createService(payload, actor, business);
      results.added += 1;
      results.rows.push({ row: rowNumber, name, status: 'added' });
    } catch (error) {
      results.skipped += 1;
      results.rows.push({
        row: rowNumber,
        name,
        status: 'skipped',
        error: error?.message ?? 'Could not import this row.',
      });
    }
  }

  invalidateCatalog();
  return results;
}

/**
 * The website's services page (Shop › Services, 2026-09-30).
 *
 * Active services only, and never the cost. **The price follows the same
 * server-side gate as a part** (Instructions §5.3): a guest or a pending
 * account is told what the shop does, never what it charges.
 *
 * `categories` carries only the ones with something in them, counted, so the
 * mobile menu's drill-down cannot offer a category that opens onto nothing.
 *
 * ## Filtered like the Parts grid (2026-10-01)
 *
 * The Services page is built like the Parts page, so this answers the same
 * query: `partType` is the repair type (the finder's first step; `category`
 * is still read for links made before), the four path levels are the device
 * from the Services taxonomy, `q`, `sort` and `page`. A service matches a
 * device when it applies to it (`catalogService.serviceApplies`): one scoped
 * to nothing applies to every device its type hint allows.
 */
const SERVICE_PAGE_SIZE = 24;

function toList(value) {
  return (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function shapePublicService(row, priced, labels = new Map()) {
  return {
    id: String(row._id),
    slug: row.slug ?? '',
    name: row.name,
    description: row.description ?? '',
    category: row.category ?? 'other',
    categoryLabel: labels.get(row.category ?? 'other') ?? row.category,
    durationMinutes: row.durationMinutes ?? 0,
    warrantyDays: row.warrantyDays ?? 0,
    deviceTypes: row.deviceTypes ?? [],
    scopeLabel: row.scopeLabel ?? '',
    // Its own picture, else the client's stock photo for this repair by name.
    image: pictureOf(row),
    priceVisible: priced,
    ...(priced ? { priceCents: row.priceCents ?? 0 } : {}),
  };
}

async function publicList(user, params = {}) {
  const { business } = params;
  const query = { isActive: true };
  if (business) query.business = business;

  const [rows, types] = await Promise.all([db().Service.find(query).sort({ order: 1, name: 1 }).lean(), repairTypes()]);
  await stampSlugs(rows);
  const priced = canSeePricing(user);
  const labels = new Map(types.map((option) => [option.value, option.label]));

  const path = Object.fromEntries(
    ['deviceType', 'brand', 'series', 'model']
      .filter((level) => typeof params[level] === 'string' && params[level])
      .map((level) => [level, params[level]]),
  );
  const deviceTypeName = await deviceTypeNameOf(path);
  const forDevice = rows.filter((row) => serviceApplies(row, path, deviceTypeName));
  const searched = params.q
    ? forDevice.filter((row) => likeRegex(String(params.q)).test(`${row.name} ${row.description ?? ''}`))
    : forDevice;

  // Counted against everything BUT the repair type, so ticking one does not
  // zero the others; and the mobile menu's `categories` keep their old meaning.
  const counts = new Map();
  for (const row of searched) {
    const key = row.category ?? 'other';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const allCounts = new Map();
  for (const row of rows) {
    const key = row.category ?? 'other';
    allCounts.set(key, (allCounts.get(key) ?? 0) + 1);
  }

  const wanted = [...toList(params.partType), ...toList(params.category).filter((key) => key !== 'all')];
  let matched = wanted.length ? searched.filter((row) => wanted.includes(row.category ?? 'other')) : searched;

  const price = (row) => row.priceCents ?? 0;
  if (params.sort === 'price-asc') matched = [...matched].sort((a, b) => price(a) - price(b));
  else if (params.sort === 'price-desc') matched = [...matched].sort((a, b) => price(b) - price(a));
  else if (params.sort === 'name-asc') matched = [...matched].sort((a, b) => a.name.localeCompare(b.name));

  const page = Math.max(Number(params.page) || 1, 1);
  const total = matched.length;
  const items = matched
    .slice((page - 1) * SERVICE_PAGE_SIZE, page * SERVICE_PAGE_SIZE)
    .map((row) => shapePublicService(row, priced, labels));

  return {
    priceVisible: priced,
    items,
    total,
    page,
    pages: Math.max(Math.ceil(total / SERVICE_PAGE_SIZE), 1),
    facets: {
      // In the order the Services type lists its repair types.
      partType: types
        .filter((option) => counts.has(option.value))
        .map((option) => ({ value: option.value, label: option.label, count: counts.get(option.value) })),
    },
    categories: types
      .filter((option) => allCounts.has(option.value))
      .map((option) => ({ slug: option.value, name: option.label, count: allCounts.get(option.value) })),
    // Every matching service, for a caller that wants the whole list.
    services: matched.map((row) => shapePublicService(row, priced, labels)),
  };
}

/**
 * Services written before slugs existed get one the first time the website
 * lists them, so every card has a detail page to link to.
 */
async function stampSlugs(rows) {
  for (const row of rows) {
    if (row.slug) continue;
    row.slug = await uniqueSlug(row.name, row.business, row._id);
    await db().Service.updateOne({ _id: row._id }, { $set: { slug: row.slug } });
  }
}

/**
 * One service's page on the website (`/services/:slug`, 2026-10-02).
 *
 * The same gate as the list: the price only for an account that may see
 * prices. Carries the long copy and up to four other services of the same
 * repair type, so the page can offer a next step that is not a dead end.
 */
async function publicGet(user, slug, { business } = {}) {
  const query = { isActive: true, slug: String(slug ?? '') };
  if (business) query.business = business;
  const row = await db().Service.findOne(query).lean();
  if (!row) throw ApiError.notFound('That service is not offered any more.', 'SERVICE_NOT_FOUND');

  const priced = canSeePricing(user);
  const labels = new Map((await repairTypes()).map((option) => [option.value, option.label]));
  const related = await db()
    .Service.find({
      isActive: true,
      _id: { $ne: row._id },
      category: row.category ?? 'other',
      ...(business ? { business } : {}),
    })
    .sort({ order: 1, name: 1 })
    .limit(4)
    .lean();
  await stampSlugs(related);

  return {
    service: { ...shapePublicService(row, priced, labels), details: row.details ?? '' },
    related: related.map((entry) => shapePublicService(entry, priced, labels)),
  };
}

export {
  publicGet,
  listServices,
  publicList,
  getService,
  createService,
  updateService,
  deleteService,
  usageCount,
  shapeService,
  importServices,
};
export default {
  publicGet,
  listServices,
  publicList,
  getService,
  createService,
  updateService,
  deleteService,
  importServices,
};
