import { db } from '../db/models.js';
import { currentContext } from '../db/context.js';
import '../models/Buyback.js';
import '../models/PreownedDevice.js';
import { CONDITION_PARTS } from '../models/Ticket.js';
import '../models/User.js';
import '../models/Settings.js';
import { DEFAULT_PAYMENT_METHODS } from '../models/Settings.js';
import ApiError from '../utils/ApiError.js';
import secrets from '../utils/secrets.js';
import { canSeePricing } from '../middleware/auth.js';
import privateStorage from './privateStorageService.js';
import storage from './storageService.js';
import storeCreditService from './storeCreditService.js';
import notificationService from './notificationService.js';
import auditService from './auditService.js';
import { resolveCustomer, readCustomerToken } from './kioskService.js';

/**
 * Buying phones from customers, and selling them on (Sales § Sell your phone).
 *
 * ## The loop
 *
 * 1. **The kiosk** (`sell`): a customer offers a phone. The sale is recorded
 *    as a `Buyback` with a fresh photo of the seller and, the first time, their
 *    photo ID, and the phone is handed to staff.
 * 2. **Inventory › Pre-owned › Requests** (`accept` / `decline`): a staff member
 *    agrees a price with the customer at the counter, records what was paid and
 *    how, and the phone becomes a `PreownedDevice` in stock. Paid in store
 *    credit, the amount goes onto the customer's account through
 *    `storeCreditService`, the only place a balance moves.
 * 3. **The website** (`publicList`, and the cart's pre-owned line): listed
 *    phones are sold like anything else, prices shown only to approved
 *    accounts (client ruling, 2026-09-29).
 * 4. **The customer's account** (`accountList`): "Phones you sold us".
 */

// ---- numbering ---------------------------------------------------------------

/**
 * A flat running series (`BB-00001`, `PO-00001`), like the kiosk's `KS-`.
 * No year segment: these are counted for the life of the business, and a
 * yearly reset in a flat series is how two records end up sharing a number.
 */
async function nextNumber(model, field, prefix) {
  const last = await db()
    [model].findOne({ [field]: new RegExp(`^${prefix}`) })
    .sort({ [field]: -1 })
    .select(field)
    .lean();
  const sequence = last ? Number(String(last[field]).slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(sequence).padStart(5, '0')}`;
}

// ---- shapes --------------------------------------------------------------------

const GRADE_LABELS = {
  like_new: 'Like new',
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
};

const ID_LABELS = {
  drivers_licence: "Driver's licence",
  passport: 'Passport',
  provincial_id: 'Provincial photo ID',
  other: 'Other government ID',
};

const mapOf = (value) =>
  value instanceof Map ? Object.fromEntries(value) : value ? { ...value } : {};

/** "iPhone 13 · 128 GB · Blue", the line a person reads. */
function deviceTitle(device = {}) {
  return [
    [device.brand, device.model].filter(Boolean).join(' ') || 'Phone',
    device.storage,
    device.colour,
  ]
    .filter(Boolean)
    .join(' · ');
}

async function payoutMethods() {
  const settings = await db().Settings.load();
  const list = settings?.financial?.paymentMethods?.length
    ? settings.financial.paymentMethods
    : DEFAULT_PAYMENT_METHODS;
  // Store credit first: it is the one method that does something beyond being
  // recorded, and so the one a staff member should see stated.
  return [{ code: 'store-credit', label: 'Store credit' }, ...list];
}

function shapeBuyback(doc, methods = []) {
  const review = doc.review ?? {};
  const labelOf = (code) => methods.find((method) => method.code === code)?.label ?? code ?? null;
  return {
    id: String(doc._id),
    number: doc.number,
    status: doc.status,
    createdAt: doc.createdAt,
    customer: {
      id: doc.user ? String(doc.user._id ?? doc.user) : null,
      name: doc.customerName ?? null,
      phone: doc.customerPhone ?? null,
      email: doc.customerEmail || null,
    },
    device: { ...(doc.device ?? {}), title: deviceTitle(doc.device) },
    customerCondition: mapOf(doc.customerCondition),
    identity: {
      idType: doc.identity?.idType ?? null,
      idTypeLabel: ID_LABELS[doc.identity?.idType] ?? null,
      // The masked form a screen may show. The full number needs `revealId`.
      masked: doc.identity?.idLast4 ? `•••• ${doc.identity.idLast4}` : null,
      hasPhoto: Boolean(doc.identity?.photoKey),
    },
    declaredOwnerAt: doc.declaredOwnerAt ?? null,
    review: {
      purchasePriceCents: review.purchasePriceCents ?? null,
      sellingPriceCents: review.sellingPriceCents ?? null,
      payoutMethod: review.payoutMethod ?? null,
      payoutMethodLabel: labelOf(review.payoutMethod),
      payoutReference: review.payoutReference ?? null,
      grade: review.grade ?? null,
      condition: mapOf(review.condition),
      notes: review.notes ?? null,
      declineReason: review.declineReason ?? null,
      reviewedAt: review.reviewedAt ?? null,
      reviewedBy: review.reviewedBy
        ? { id: String(review.reviewedBy._id ?? review.reviewedBy), name: review.reviewedBy.contactName ?? null }
        : null,
    },
    preownedId: doc.preowned ? String(doc.preowned._id ?? doc.preowned) : null,
    timeline: (doc.timeline ?? []).map((entry) => ({
      status: entry.status,
      at: entry.at,
      note: entry.note ?? null,
    })),
  };
}

/** The staff shape of a unit in stock. Carries cost and IMEI; never sent to a customer. */
function shapePreownedAdmin(doc) {
  return {
    id: String(doc._id),
    stockNumber: doc.stockNumber,
    title: deviceTitle(doc),
    category: doc.category ?? null,
    brand: doc.brand ?? null,
    series: doc.series ?? null,
    model: doc.model,
    storage: doc.storage ?? null,
    colour: doc.colour ?? null,
    imei: doc.imei ?? null,
    grade: doc.grade,
    gradeLabel: GRADE_LABELS[doc.grade] ?? doc.grade,
    condition: mapOf(doc.condition),
    description: doc.description ?? '',
    photos: (doc.photos ?? []).map((key) => storage.urlOf(key)),
    costCents: doc.costCents ?? 0,
    priceCents: doc.priceCents,
    status: doc.status,
    listedAt: doc.listedAt ?? null,
    soldAt: doc.soldAt ?? null,
    buybackId: doc.buyback ? String(doc.buyback._id ?? doc.buyback) : null,
    buybackNumber: doc.buyback?.number ?? null,
    orderId: doc.order ? String(doc.order._id ?? doc.order) : null,
    orderNumber: doc.order?.orderNumber ?? null,
    createdAt: doc.createdAt,
  };
}

/**
 * The website's shape. No IMEI, no cost, no condition grid, and **no price for
 * anybody who is not an approved account**: the same server-side gate as the
 * catalogue (Instructions §5.3), not a blur.
 */
function shapePreownedPublic(doc, user) {
  const priced = canSeePricing(user);
  return {
    id: String(doc._id),
    stockNumber: doc.stockNumber,
    title: deviceTitle(doc),
    brand: doc.brand ?? null,
    model: doc.model,
    storage: doc.storage ?? null,
    colour: doc.colour ?? null,
    grade: doc.grade,
    gradeLabel: GRADE_LABELS[doc.grade] ?? doc.grade,
    description: doc.description ?? '',
    photos: (doc.photos ?? []).map((key) => storage.urlOf(key)),
    priceVisible: priced,
    ...(priced ? { priceCents: doc.priceCents } : {}),
  };
}

// ---- the kiosk -----------------------------------------------------------------

/**
 * Take a phone at the kiosk.
 *
 * ## The ID
 *
 * Required once per customer: a returning seller whose account already holds
 * one (`User.identity`) skips it, a new seller or one without gives it here.
 * The number is encrypted before it is written and never comes back out of this
 * function. A number typed at a later sale replaces the one on file, because
 * the newest document the customer showed is the one that is current.
 *
 * ## The photo
 *
 * Every sale, returning seller or not: it is the evidence of who stood at the
 * tablet this time. Stored in the private bucket before the record is written,
 * so a sale whose photo failed to store is a sale that did not happen rather
 * than a record pointing at nothing.
 */
async function sell(intake, req) {
  const businessId = req.businessScope ?? null;
  const owner = currentContext()?.code;
  if (!owner) throw ApiError.badRequest('No business is selected.', 'NO_BUSINESS');

  const now = new Date();

  if (intake.customerToken && !readCustomerToken(intake.customerToken, businessId)) {
    throw ApiError.badRequest(
      'That took a little too long. Please find your details again.',
      'KIOSK_CUSTOMER_EXPIRED',
    );
  }

  const { user } = await resolveCustomer(
    { ...intake, contactChannels: [] },
    businessId,
    now,
  );

  const withId = await db().User.findById(user._id).select('+identity.idNumberCipher');
  const idNumber = String(intake.idNumber ?? '').replace(/\s+/g, '').trim();

  if (idNumber) {
    if (!intake.idType) throw ApiError.badRequest('Choose the type of ID.', 'ID_TYPE_REQUIRED');
    withId.identity = {
      idType: intake.idType,
      idNumberCipher: secrets.encrypt(idNumber),
      idLast4: idNumber.slice(-4),
      recordedAt: now,
    };
    await withId.save();
  } else if (!withId.identity?.idNumberCipher) {
    throw ApiError.badRequest('We need a photo ID to buy a phone.', 'ID_REQUIRED');
  }

  const photoKey = await privateStorage.storeIdentityPhoto({ owner, dataUrl: intake.photo });

  const buyback = await db().Buyback.create({
    number: await nextNumber('Buyback', 'number', 'BB-'),
    user: user._id,
    customerName: user.contactName,
    customerPhone: user.phone,
    customerEmail: user.email?.endsWith('@no-email.invalid') ? '' : user.email,
    business: businessId,
    source: 'kiosk',
    device: {
      category: intake.category || undefined,
      brand: intake.brand || undefined,
      series: intake.series || undefined,
      model: intake.model,
      storage: intake.storage || undefined,
      colour: intake.colour || undefined,
      imei: intake.imei,
      passcode: intake.passcode || undefined,
      notes: intake.notes || undefined,
    },
    customerCondition: Object.keys(intake.condition ?? {}).length ? intake.condition : undefined,
    identity: {
      idType: withId.identity.idType,
      idLast4: withId.identity.idLast4,
      photoKey,
    },
    declaredOwnerAt: intake.declaredOwner ? now : null,
    status: 'pending',
    timeline: [{ status: 'pending', at: now, note: 'Offered at the kiosk. Phone handed to staff.' }],
  });

  await notificationService.emit({
    type: 'new_buyback',
    severity: 'info',
    title: `${buyback.number}: ${deviceTitle(buyback.device)} to price`,
    detail: `${user.contactName} · sold at the kiosk`,
    entity: { kind: 'buyback', id: buyback.number, label: buyback.number },
    href: `/admin/preowned/requests/${buyback._id}`,
  });

  return {
    number: buyback.number,
    firstName: intake.customerToken ? '' : String(intake.firstName ?? '').trim(),
  };
}

// ---- the ERP: requests --------------------------------------------------------

async function listBuybacks({ status = 'pending', q = '' } = {}) {
  const query = {};
  if (status && status !== 'all') query.status = status;
  const text = String(q ?? '').trim();
  if (text) {
    const rx = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [
      { number: rx },
      { customerName: rx },
      { customerPhone: rx },
      { 'device.model': rx },
      { 'device.imei': rx },
    ];
  }

  const [rows, counts, methods] = await Promise.all([
    db().Buyback.find(query).sort({ createdAt: -1 }).limit(200).lean(),
    db().Buyback.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    payoutMethods(),
  ]);

  return {
    buybacks: rows.map((row) => shapeBuyback(row, methods)),
    counts: Object.fromEntries(counts.map((row) => [row._id, row.count])),
  };
}

async function findBuyback(id) {
  const doc = await db().Buyback.findById(id).populate('review.reviewedBy', 'contactName');
  if (!doc) throw ApiError.notFound('That request was not found.', 'BUYBACK_NOT_FOUND');
  return doc;
}

async function getBuyback(id) {
  const doc = await findBuyback(id);
  const methods = await payoutMethods();
  return { buyback: shapeBuyback(doc.toObject(), methods), payoutMethods: methods };
}

/**
 * The seller's full ID number, for the staff member who asked.
 *
 * One number, one account, one audit row naming who looked: a masked number is
 * enough for every screen, and the full one is needed only when somebody has to
 * copy it onto a police report or check it against the card in front of them.
 */
async function revealId(id, req) {
  const doc = await findBuyback(id);
  const user = await db().User.findById(doc.user).select('+identity.idNumberCipher contactName email');
  const number = secrets.decrypt(user?.identity?.idNumberCipher);
  if (!number) {
    throw ApiError.notFound(
      'No readable ID is on file for this customer.',
      'ID_NOT_AVAILABLE',
    );
  }

  await auditService.record({
    req,
    kind: 'security',
    action: 'buyback.reveal_id',
    entity: { kind: 'user', id: String(user._id), label: user.email },
    description: `Viewed the photo ID number of ${user.contactName} (${doc.number}).`,
  });

  return { idType: user.identity.idType, idTypeLabel: ID_LABELS[user.identity.idType], number };
}

/** The seller's photo, streamed from the private bucket. Audited like the ID. */
async function photo(id, req) {
  const doc = await findBuyback(id);
  const file = await privateStorage.read(doc.identity?.photoKey);
  if (!file) throw ApiError.notFound('The photo is not available.', 'PHOTO_NOT_FOUND');

  await auditService.record({
    req,
    kind: 'security',
    action: 'buyback.view_photo',
    entity: { kind: 'buyback', id: String(doc._id), label: doc.number },
    description: `Viewed the seller photo on ${doc.number}.`,
  });

  return file;
}

const cents = (dollars) => Math.round(Number(dollars) * 100);

/**
 * Price a phone into stock.
 *
 * ## The payout
 *
 * `store-credit` moves the purchase price onto the customer's account through
 * `storeCreditService.allocate`, which writes the ledger row; nothing here
 * touches a balance. Any other method is one of Settings › Payment methods and
 * is recorded on the buyback as how the money left: a person handed it over
 * at the counter, and there is nothing further for the system to move.
 *
 * ## Order of writes
 *
 * The stock unit, then the credit, then the buyback. A failure after the unit
 * is written leaves a phone in stock against a pending request, which a second
 * press finishes; a failure the other way round would leave a customer paid
 * for a phone that is in no stock list.
 */
async function acceptBuyback(id, body, req) {
  const doc = await findBuyback(id);
  if (doc.status !== 'pending') {
    throw ApiError.conflict(`${doc.number} has already been ${doc.status}.`, 'BUYBACK_DECIDED');
  }

  const methods = await payoutMethods();
  if (!methods.some((method) => method.code === body.payoutMethod)) {
    throw ApiError.badRequest('Choose one of the payment methods in Settings.', 'PAYOUT_METHOD_UNKNOWN');
  }

  const purchasePriceCents = cents(body.purchasePriceDollars);
  const sellingPriceCents = cents(body.sellingPriceDollars);
  const now = new Date();

  // A component left "Not checked" is not a grade. Only real ones are kept.
  const graded = Object.fromEntries(
    Object.entries(body.condition ?? {}).filter(([key, grade]) => CONDITION_PARTS.includes(key) && grade),
  );
  body = { ...body, condition: graded };
  const adminId = req.user?._id ?? null;

  const existing = doc.preowned ? await db().PreownedDevice.findById(doc.preowned) : null;
  const unit =
    existing ??
    (await db().PreownedDevice.create({
      stockNumber: await nextNumber('PreownedDevice', 'stockNumber', 'PO-'),
      buyback: doc._id,
      business: doc.business ?? null,
      category: doc.device?.category,
      brand: doc.device?.brand,
      series: doc.device?.series,
      model: doc.device?.model,
      storage: doc.device?.storage,
      colour: doc.device?.colour,
      imei: doc.device?.imei,
      grade: body.grade,
      condition: body.condition && Object.keys(body.condition).length ? body.condition : undefined,
      description: body.description || undefined,
      costCents: purchasePriceCents,
      priceCents: sellingPriceCents,
      status: body.list ? 'listed' : 'in_stock',
      listedAt: body.list ? now : null,
    }));

  doc.preowned = unit._id;

  if (body.payoutMethod === 'store-credit' && purchasePriceCents > 0) {
    await storeCreditService.allocate(
      doc.user,
      { amount: purchasePriceCents, note: `For the phone you sold us · ${doc.number}` },
      adminId,
    );
  }

  doc.status = 'accepted';
  doc.review = {
    ...(doc.review?.toObject?.() ?? {}),
    purchasePriceCents,
    sellingPriceCents,
    payoutMethod: body.payoutMethod,
    payoutReference: body.payoutReference || undefined,
    grade: body.grade,
    condition: body.condition && Object.keys(body.condition).length ? body.condition : undefined,
    notes: body.notes || undefined,
    reviewedBy: adminId,
    reviewedAt: now,
  };
  doc.timeline.push({
    status: 'accepted',
    at: now,
    by: adminId,
    note: `Bought for ${(purchasePriceCents / 100).toFixed(2)}, paid by ${methods.find((m) => m.code === body.payoutMethod)?.label}. In stock as ${unit.stockNumber}.`,
  });
  await doc.save();

  await auditService.record({
    req,
    action: 'buyback.accept',
    entity: { kind: 'buyback', id: String(doc._id), label: doc.number },
    description: `Accepted ${doc.number} into stock as ${unit.stockNumber}.`,
  });

  return getBuyback(doc._id);
}

async function declineBuyback(id, { reason }, req) {
  const doc = await findBuyback(id);
  if (doc.status !== 'pending') {
    throw ApiError.conflict(`${doc.number} has already been ${doc.status}.`, 'BUYBACK_DECIDED');
  }
  const now = new Date();
  doc.status = 'declined';
  doc.review = {
    ...(doc.review?.toObject?.() ?? {}),
    declineReason: reason,
    reviewedBy: req.user?._id ?? null,
    reviewedAt: now,
  };
  doc.timeline.push({ status: 'declined', at: now, by: req.user?._id ?? null, note: reason });
  await doc.save();

  await auditService.record({
    req,
    action: 'buyback.decline',
    entity: { kind: 'buyback', id: String(doc._id), label: doc.number },
    description: `Declined ${doc.number}: ${reason}`,
  });

  return getBuyback(doc._id);
}

// ---- the ERP: stock -----------------------------------------------------------

async function listPreowned({ status = 'available', q = '' } = {}) {
  const query = {};
  if (status === 'available') query.status = { $in: ['in_stock', 'listed'] };
  else if (status && status !== 'all') query.status = status;
  const text = String(q ?? '').trim();
  if (text) {
    const rx = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ stockNumber: rx }, { model: rx }, { brand: rx }, { imei: rx }];
  }

  const [rows, counts] = await Promise.all([
    db()
      .PreownedDevice.find(query)
      .sort({ createdAt: -1 })
      .limit(300)
      .populate('buyback', 'number')
      .populate('order', 'orderNumber')
      .lean(),
    db().PreownedDevice.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  return {
    devices: rows.map(shapePreownedAdmin),
    counts: Object.fromEntries(counts.map((row) => [row._id, row.count])),
  };
}

/**
 * Edit a unit in stock: its price, grade, words and photos, and whether it is
 * on the website.
 *
 * A `sold` unit is closed: its price is what somebody paid, and relisting it
 * would offer a phone that is no longer here. Photos follow the upload
 * lifecycle every other record uses (`claim`, `releaseReplaced`), so a photo
 * removed from a listing is deleted from the bucket rather than orphaned.
 */
async function updatePreowned(id, body, req) {
  const unit = await db().PreownedDevice.findById(id);
  if (!unit) throw ApiError.notFound('That phone is not in stock.', 'PREOWNED_NOT_FOUND');
  if (unit.status === 'sold') {
    throw ApiError.conflict(`${unit.stockNumber} has been sold and cannot be changed.`, 'PREOWNED_SOLD');
  }

  const owner = currentContext()?.code;
  const before = { ...unit.toObject() };

  if (body.sellingPriceDollars != null) unit.priceCents = cents(body.sellingPriceDollars);
  if (body.grade) unit.grade = body.grade;
  if (body.description != null) unit.description = body.description || undefined;

  if (body.photos) {
    for (const url of body.photos) {
      if (!storage.isAllowedUrl(url, owner)) {
        throw ApiError.badRequest('A photo must be uploaded here, not linked.', 'PHOTO_NOT_OURS');
      }
    }
    const keys = body.photos.map((url) => storage.toKey(url)).filter(Boolean);
    await storage.claim(body.photos, owner);
    await storage.releaseReplaced(
      (unit.photos ?? []).map((key) => storage.urlOf(key)),
      body.photos,
      owner,
    );
    unit.photos = keys;
  }

  if (body.status && body.status !== unit.status) {
    unit.status = body.status;
    if (body.status === 'listed') unit.listedAt = new Date();
  }

  await unit.save();

  await auditService.recordChange({
    req,
    action: 'preowned.update',
    entity: { kind: 'preowned', id: String(unit._id), label: unit.stockNumber },
    before,
    after: unit.toObject(),
    fields: ['priceCents', 'grade', 'description', 'status', 'photos'],
  });

  const fresh = await db()
    .PreownedDevice.findById(unit._id)
    .populate('buyback', 'number')
    .populate('order', 'orderNumber')
    .lean();
  return { device: shapePreownedAdmin(fresh) };
}

// ---- the website and the account -----------------------------------------------

async function publicList(user) {
  const rows = await db()
    .PreownedDevice.find({ status: 'listed' })
    .sort({ listedAt: -1, createdAt: -1 })
    .limit(200)
    .lean();
  return { devices: rows.map((row) => shapePreownedPublic(row, user)) };
}

/**
 * "Phones you sold us", on the customer's own account.
 *
 * What they sold, when, and where it stands. Once accepted: what they were
 * paid and how. Never what we are selling it on for, and never the review
 * notes, which are staff working.
 */
async function accountList(userId) {
  const [rows, methods] = await Promise.all([
    db().Buyback.find({ user: userId }).sort({ createdAt: -1 }).lean(),
    payoutMethods(),
  ]);
  return {
    buybacks: rows.map((row) => ({
      id: String(row._id),
      number: row.number,
      status: row.status,
      createdAt: row.createdAt,
      device: deviceTitle(row.device),
      paidCents: row.status === 'accepted' ? (row.review?.purchasePriceCents ?? null) : null,
      paidBy:
        row.status === 'accepted'
          ? (methods.find((method) => method.code === row.review?.payoutMethod)?.label ?? null)
          : null,
      reviewedAt: row.review?.reviewedAt ?? null,
    })),
  };
}

export {
  GRADE_LABELS,
  deviceTitle,
  sell,
  listBuybacks,
  getBuyback,
  revealId,
  photo,
  acceptBuyback,
  declineBuyback,
  listPreowned,
  updatePreowned,
  publicList,
  accountList,
};
export default {
  sell,
  listBuybacks,
  getBuyback,
  revealId,
  photo,
  acceptBuyback,
  declineBuyback,
  listPreowned,
  updatePreowned,
  publicList,
  accountList,
};
