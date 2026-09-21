import mongoose from 'mongoose';

import { SERVICE_CATEGORIES } from '../models/Service.js';
import { db } from '../db/models.js';
import ApiError from '../utils/ApiError.js';
import { likeRegex } from '../utils/regex.js';
import { parseCsv, rowsWithoutHeader } from '../utils/csv.js';

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

    priceCents: service.priceCents ?? 0,
    price: (service.priceCents ?? 0) / 100,
    // Undefined rather than 0 when never recorded - an unknown cost and a zero
    // cost produce very different margins, and the screen says so.
    costCents: service.costCents ?? null,
    cost: service.costCents == null ? null : service.costCents / 100,

    durationMinutes: service.durationMinutes ?? 0,
    warrantyDays: service.warrantyDays ?? 0,
    deviceTypes: service.deviceTypes ?? [],
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
    categories: SERVICE_CATEGORIES,
  };
}

async function getService(id) {
  if (!isObjectId(id)) throw ApiError.notFound('Service not found.', 'SERVICE_NOT_FOUND');
  const service = await db().Service.findById(id).lean();
  if (!service) throw ApiError.notFound('Service not found.', 'SERVICE_NOT_FOUND');
  return { service: shapeService(service) };
}

async function createService(body = {}, actor, business = null) {
  const name = String(body.name ?? '').trim();
  if (name.length < 2) {
    throw ApiError.badRequest('Give the service a name.', 'SERVICE_NAME_REQUIRED');
  }

  const payload = {
    name,
    description: String(body.description ?? '').trim() || undefined,
    business: business ?? null,
    category: SERVICE_CATEGORIES.includes(body.category) ? body.category : 'other',
    priceCents: toCents(body.price) ?? 0,
    costCents: toCents(body.cost),
    durationMinutes: Math.max(Number(body.durationMinutes) || 0, 0),
    warrantyDays: Math.max(Number(body.warrantyDays) || 0, 0),
    deviceTypes: normaliseDeviceTypes(body.deviceTypes) ?? [],
    taxable: body.taxable !== false,
    isActive: body.isActive !== false,
    order: Number(body.order) || 0,
    createdBy: actor ?? null,
  };

  try {
    const service = await db().Service.create(payload);
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
  if (body.category !== undefined && SERVICE_CATEGORIES.includes(body.category)) {
    service.category = body.category;
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

  try {
    await service.save();
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

    const category = String(categoryCell ?? '').trim().toLowerCase();

    const payload = {
      name,
      category: SERVICE_CATEGORIES.includes(category) ? category : 'other',
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

  return results;
}

export {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
  usageCount,
  shapeService,
  importServices,
};
export default {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
  importServices,
};
