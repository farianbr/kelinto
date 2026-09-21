import { db } from '../db/models.js';
import '../models/Supplier.js';
import { DELIVERY_STATUSES } from '../models/PurchaseOrder.js';
import ApiError from '../utils/ApiError.js';
import * as agreementService from './agreementService.js';
import * as notificationService from './notificationService.js';
import * as supplierMail from './supplierMail.js';
import { renderProformaHtml } from './proformaDocument.js';
import { sendingBusiness } from './sendingBusiness.js';

/**
 * Supplier bidding on a purchase order - ask several, negotiate, confirm one
 * (§6.8a, re-ruled 2026-09-11).
 *
 * This is what `rfqService` used to be. A `Rfq` document asked the question and
 * a `PurchaseOrder` recorded the answer, which meant one purchase lived in two
 * records and "who did we ask, and what did we pay" needed both of them open.
 * The PO now carries its own bids and the RFQ is gone.
 *
 * **Five rules survive that move unchanged**, because none of them was ever
 * about the RFQ record - they are what makes buying from several suppliers at
 * once fair and auditable:
 *
 *   1. **One supplier never learns another's price.** `shapeForSupplier` returns
 *      that supplier's own bid and nothing else - no rank, no gap to the leader.
 *      Enforced by the serializer rather than by remembering to filter.
 *   2. **An incomplete bid never ranks best.** A supplier who could not fill
 *      every line has a smaller total for a smaller order.
 *   3. **A quoted price and quantity are the supplier's; every total is ours.**
 *      The one payload in this app where a price is accepted and kept. A
 *      quantity joined it on 2026-09-13, because a supplier holding 30 of the
 *      40 asked for could previously only quote for 40 they cannot ship or
 *      decline the line entirely. It is **capped at what we asked for** - a
 *      bigger number is a different order - and every subtotal is still
 *      recomputed here from the lines, never accepted (§8, invariant 8).
 *   4. **Supplier credentials live on `Supplier`, behind their own cookie.**
 *      See `middleware/supplierAuth.js`.
 *   5. **Money never moves here.** Confirming a supplier copies their prices on
 *      to the PO lines; paying and receiving stay in `purchaseService`, so a PO
 *      that came through bidding is indistinguishable downstream from one
 *      raised by hand.
 */

// ---- money ------------------------------------------------------------------

/**
 * Totals for one bid, from the supplier's unit costs and the quantity they can
 * actually supply.
 *
 * **Their quantity, capped at ours.** A supplier short on stock quotes for what
 * they hold, and the total has to reflect that or we would compare an offer of
 * 30 units against one of 40 as though they were the same purchase. A number
 * *above* what we asked for is still ignored, for exactly that reason.
 *
 * Lines marked `available: false` contribute nothing - "cannot supply" is not a
 * price of zero, and counting it as one would make the supplier who can fill
 * least look cheapest. A short line still ranks below a complete one, because
 * `complete` counts lines filled in full.
 */
function recomputeBid(bid, qtyBySku) {
  bid.subtotal = (bid.lines ?? [])
    .filter((line) => line.available !== false)
    .reduce((sum, line) => sum + (line.unitCost ?? 0) * suppliedQty(line, qtyBySku), 0);
  bid.total = bid.subtotal + (bid.tax ?? 0) + (bid.shipping ?? 0);
  return bid;
}

/**
 * How many of a line this bid actually covers.
 *
 * The supplier's own `qty` when they gave one, ours otherwise - and never more
 * than we asked for. A supplier offering 60 against an order for 40 has not
 * quoted our order, and totalling it at 60 would rank them against a different
 * purchase.
 *
 * Undefined `qty` means "all of them", which is what every line quoted before
 * the field existed meant, so an old bid totals exactly as it always did.
 */
function suppliedQty(line, qtyBySku) {
  const asked = qtyBySku.get(line.sku) ?? 0;
  if (line.qty == null) return asked;
  return Math.min(Math.max(0, line.qty), asked);
}

function qtyMap(po) {
  return new Map((po.items ?? []).map((item) => [item.sku, item.qtyOrdered]));
}

function findBid(po, supplierId) {
  return (po.bids ?? []).find(
    (candidate) => String(candidate.supplier?._id ?? candidate.supplier) === String(supplierId),
  );
}

// ---- serialising ------------------------------------------------------------

/**
 * The admin's view: every bid, every price, and which one leads.
 *
 * `isBest` is derived here rather than stored, for the same reason a PO's
 * overdue flag is: it is a reading of the current answers, and a stored copy
 * would be wrong the moment a late bid arrives.
 */
function shapeBids(po) {
  const lineQty = qtyMap(po);
  const lineCount = (po.items ?? []).length;

  const bids = (po.bids ?? []).map((bid) => {
    const lines = (bid.lines ?? []).map((line) => {
      const asked = lineQty.get(line.sku) ?? 0;
      const supplied = line.available === false ? 0 : suppliedQty(line, lineQty);

      return {
        sku: line.sku,
        unitCost: line.unitCost,
        available: line.available !== false,
        note: line.note ?? null,
        // What we asked for and what they can actually send. Both, because a
        // buyer comparing offers needs to see a short line as short rather
        // than as a smaller total with no explanation.
        qty: asked,
        suppliedQty: supplied,
        short: line.available !== false && supplied < asked,
        lineTotal: (line.unitCost ?? 0) * supplied,
      };
    });

    const quotedLines = lines.filter((line) => line.available).length;
    // Filled IN FULL, not merely answered: a supplier who can send 30 of 40
    // has not covered that line, and letting a short bid rank as complete is
    // the same bug as letting an unpriced one rank on a smaller total.
    const filledLines = lines.filter((line) => line.available && !line.short).length;
    const shortLines = lines.filter((line) => line.short).length;

    return {
      id: bid._id.toString(),
      supplier: bid.supplier?.name
        ? {
            id: bid.supplier._id.toString(),
            name: bid.supplier.name,
            email: bid.supplier.email ?? null,
            componentTypes: bid.supplier.componentTypes ?? [],
          }
        : {
            id: String(bid.supplier ?? ''),
            name: bid.supplierName ?? '-',
            email: null,
            componentTypes: [],
          },
      status: bid.status,
      sentAt: bid.sentAt ?? null,
      viewedAt: bid.viewedAt ?? null,
      quotedAt: bid.quotedAt ?? null,
      lines,
      subtotal: bid.subtotal ?? 0,
      tax: bid.tax ?? 0,
      shipping: bid.shipping ?? 0,
      total: bid.total ?? 0,
      leadTimeDays: bid.leadTimeDays ?? null,
      validUntil: bid.validUntil ?? null,
      note: bid.note ?? null,
      declineReason: bid.declineReason ?? null,
      proforma: bid.proforma ? shapeProforma(bid.proforma) : null,
      /**
       * What accepting this PI would change about the order.
       *
       * Sent with the board rather than fetched when a row is expanded: it is
       * cheap, it is derived from data already loaded, and a preview that
       * arrives a beat after the panel opens is one a staff member scrolls past
       * before it renders. `null` once accepted - the order already matches, so
       * there is nothing left to preview.
       */
      proformaDiff:
        bid.proforma && bid.proforma.review !== 'accepted'
          ? diffProforma(po, bid.proforma, bid)
          : null,
      negotiations: (bid.negotiations ?? []).map((round) => ({
        id: round._id?.toString() ?? null,
        round: round.round,
        askedTotal: round.askedTotal ?? null,
        askedLines: (round.askedLines ?? []).map((line) => ({
          sku: line.sku,
          unitCost: line.unitCost,
        })),
        theirCounter: round.theirCounter ?? null,
        note: round.note ?? null,
        at: round.at,
        channels: round.channels ?? [],
        respondedAt: round.respondedAt ?? null,
      })),
      delivery: bid.delivery
        ? {
            status: bid.delivery.status ?? 'pending',
            carrier: bid.delivery.carrier ?? null,
            trackingNumber: bid.delivery.trackingNumber ?? null,
            dispatchedAt: bid.delivery.dispatchedAt ?? null,
            expectedAt: bid.delivery.expectedAt ?? null,
            deliveredAt: bid.delivery.deliveredAt ?? null,
            note: bid.delivery.note ?? null,
          }
        : null,
      // Whether this supplier can fill every requested line IN FULL. The
      // comparison sorts on total, and a partial answer sorted beside a
      // complete one is how the cheapest-looking bid turns out not to cover
      // the order - which is as true of a short line as of an unpriced one.
      complete: filledLines === lineCount && filledLines > 0,
      // How many they answered short, so the panel can say so rather than
      // leaving a smaller total unexplained.
      shortLines,
      quotedLines,
    };
  });

  // Cheapest complete answer first. Ties keep insertion order, which is the
  // order they were invited in.
  const ranked = bids
    .filter((bid) => bid.status === 'quoted' && bid.complete)
    .sort((a, b) => a.total - b.total);
  const bestId = ranked[0]?.id ?? null;

  return bids.map((bid) => ({ ...bid, isBest: bid.id === bestId }));
}

function shapeProforma(proforma) {
  return {
    number: proforma.number ?? null,
    revision: proforma.revision ?? 1,
    issuedAt: proforma.issuedAt ?? null,
    validUntil: proforma.validUntil ?? null,
    // What the supplier is invoicing, at their quantities. Empty on a PI raised
    // before line detail existed - the panel falls back to the order's own
    // lines there rather than showing an empty table.
    lines: (proforma.lines ?? []).map((line) => ({
      sku: line.sku,
      name: line.name ?? line.sku,
      qty: line.qty,
      unitCost: line.unitCost,
      lineTotal: line.qty * line.unitCost,
      note: line.note ?? null,
    })),
    subtotal: proforma.subtotal ?? 0,
    tax: proforma.tax ?? 0,
    shipping: proforma.shipping ?? 0,
    total: proforma.total ?? 0,
    paymentTerms: proforma.paymentTerms ?? null,
    bankDetails: proforma.bankDetails ?? null,
    note: proforma.note ?? null,
    review: proforma.review ?? 'pending',
    acceptedAt: proforma.acceptedAt ?? null,
    revisionRequestedAt: proforma.revisionRequestedAt ?? null,
    revisionNote: proforma.revisionNote ?? null,
    history: (proforma.history ?? []).map((entry) => ({
      revision: entry.revision,
      total: entry.total,
      issuedAt: entry.issuedAt,
      supersededAt: entry.supersededAt,
    })),
  };
}

/**
 * The portal's view: this supplier's own bid, and **nothing about any other**.
 *
 * Rule 1, enforced by the serializer rather than by remembering to filter at
 * each call site. Nothing here names another supplier, counts how many were
 * asked, or says where this bid ranks.
 */
function shapeForSupplier(po, supplierId) {
  const bid = findBid(po, supplierId);
  if (!bid) return null;

  const closed = Boolean(po.closesAt && new Date(po.closesAt) < new Date());
  const isWinner = String(po.confirmedBid ?? '') === String(bid._id);

  // What the supplier is told, which is not our internal status: a PO confirmed
  // to somebody else reads as `closed` to them, and `draft` is never visible
  // because a draft has not been sent.
  let state = 'open';
  if (po.status === 'cancelled') state = 'cancelled';
  else if (['confirmed', 'partial', 'received'].includes(po.status)) {
    state = isWinner ? 'won' : 'closed';
  } else if (closed) state = 'closed';

  return {
    id: po._id.toString(),
    poNumber: po.poNumber,
    title: po.title ?? null,
    state,
    items: (po.items ?? []).map((item) => ({
      sku: item.sku,
      name: item.name,
      qty: item.qtyOrdered,
    })),
    myBid: {
      status: bid.status,
      lines: (bid.lines ?? []).map((line) => ({
        sku: line.sku,
        unitCost: line.unitCost,
        // What they said they could supply, so the form comes back showing
        // their own answer rather than resetting to the full quantity.
        qty: line.qty ?? null,
        available: line.available !== false,
        note: line.note ?? null,
      })),
      subtotal: bid.subtotal ?? 0,
      tax: bid.tax ?? 0,
      shipping: bid.shipping ?? 0,
      total: bid.total ?? 0,
      leadTimeDays: bid.leadTimeDays ?? null,
      validUntil: bid.validUntil ?? null,
      note: bid.note ?? null,
      quotedAt: bid.quotedAt ?? null,
      proforma: bid.proforma ? shapeProforma(bid.proforma) : null,
      // Their own negotiation history. What we asked them for is theirs to see;
      // what we asked anybody else is not.
      negotiations: (bid.negotiations ?? []).map((round) => ({
        round: round.round,
        askedTotal: round.askedTotal ?? null,
        askedLines: (round.askedLines ?? []).map((line) => ({
          sku: line.sku,
          unitCost: line.unitCost,
        })),
        note: round.note ?? null,
        at: round.at,
        respondedAt: round.respondedAt ?? null,
      })),
      delivery: isWinner && bid.delivery
        ? {
            status: bid.delivery.status ?? 'pending',
            carrier: bid.delivery.carrier ?? null,
            trackingNumber: bid.delivery.trackingNumber ?? null,
            dispatchedAt: bid.delivery.dispatchedAt ?? null,
            expectedAt: bid.delivery.expectedAt ?? null,
            deliveredAt: bid.delivery.deliveredAt ?? null,
            note: bid.delivery.note ?? null,
          }
        : null,
    },
    closesAt: po.closesAt ?? null,
    closed,
    expectedDate: po.expectedDate ?? null,
    createdAt: po.createdAt,
  };
}

// ---- the supplier picker ----------------------------------------------------

/**
 * Who can be asked for a price on these component types.
 *
 * **The tag is what makes bidding possible.** A purchasing clerk asks "who
 * sells batteries", not "which of forty suppliers do I remember"; a supplier
 * who could have quoted and was never asked is the failure this prevents.
 */
async function suppliersForComponentTypes(componentTypes = []) {
  const types = (Array.isArray(componentTypes) ? componentTypes : [componentTypes])
    .map((type) => String(type ?? '').trim())
    .filter(Boolean);

  if (!types.length) return { suppliers: [], componentTypes: [] };

  const suppliers = await db().Supplier.find({
    isActive: true,
    componentTypes: { $in: types },
  })
    .sort({ name: 1 })
    .select(
      'name code email contactName componentTypes paymentTerms ordersCount totalSpent portalInviteAt',
    )
    .lean();

  return {
    componentTypes: types,
    suppliers: suppliers.map((supplier) => ({
      id: supplier._id.toString(),
      name: supplier.name,
      code: supplier.code ?? null,
      email: supplier.email ?? null,
      contactName: supplier.contactName ?? null,
      componentTypes: supplier.componentTypes ?? [],
      // Which of the requested types this supplier actually covers. A supplier
      // tagged for batteries only, on an order covering batteries and screens,
      // is worth asking - and worth showing as the partial match they are.
      matched: (supplier.componentTypes ?? []).filter((type) => types.includes(type)),
      paymentTerms: supplier.paymentTerms,
      ordersCount: supplier.ordersCount ?? 0,
      totalSpent: supplier.totalSpent ?? 0,
      // Whether they can actually answer online. A supplier with no portal
      // access can still be asked - the mail carries the line list - but the
      // screen should say so rather than let a clerk expect a price that has
      // nowhere to be typed.
      hasPortal: Boolean(supplier.portalInviteAt),
    })),
  };
}

// ---- admin: invite, send, negotiate, confirm --------------------------------

async function loadPo(id, { populate = true } = {}) {
  const query = db().PurchaseOrder.findById(id);
  if (populate) query.populate('bids.supplier', 'name email componentTypes contactConsent preferredChannel');
  const po = await query;
  if (!po) throw ApiError.notFound('Purchase order not found.', 'PO_NOT_FOUND');
  return po;
}

/**
 * Add suppliers to a purchase order.
 *
 * Additive and idempotent: a supplier already on the order is skipped rather
 * than duplicated or reset, because re-running the picker after adding one line
 * must not wipe the prices already collected.
 */
async function inviteSuppliers(id, { supplierIds = [] } = {}) {
  const po = await loadPo(id, { populate: false });

  if (['confirmed', 'partial', 'received', 'cancelled'].includes(po.status)) {
    throw ApiError.badRequest(
      `${po.poNumber} has already been decided.`,
      'PO_ALREADY_DECIDED',
    );
  }

  const ids = [...new Set(supplierIds.map(String))];
  const existing = new Set((po.bids ?? []).map((bid) => String(bid.supplier)));
  const wanted = ids.filter((supplierId) => !existing.has(supplierId));

  if (!wanted.length) return { added: 0, po: await getBidBoard(po._id) };

  const suppliers = await db().Supplier.find({ _id: { $in: wanted }, isActive: true })
    .select('name email')
    .lean();

  suppliers.forEach((supplier) => {
    po.bids.push({
      supplier: supplier._id,
      supplierName: supplier.name,
      status: 'invited',
      // Sent immediately if the order is already out; otherwise `sendPurchaseOrder`
      // stamps it, so a draft never claims to have been sent.
      sentAt: po.status === 'draft' ? undefined : new Date(),
    });
  });

  await po.save();

  // Mail only the ones added to an order already out with others.
  if (po.status !== 'draft') {
    await Promise.all(
      suppliers.map((supplier) => sendInvitationSafely(po, supplier)),
    );
  }

  return { added: suppliers.length, po: await getBidBoard(po._id) };
}

async function removeSupplier(id, supplierId) {
  const po = await loadPo(id, { populate: false });

  const bid = findBid(po, supplierId);
  if (!bid) throw ApiError.notFound('That supplier is not on this order.', 'BID_NOT_FOUND');

  if (bid.status === 'confirmed') {
    throw ApiError.badRequest(
      'That supplier is confirmed for this order - cancel the order instead.',
      'BID_CONFIRMED',
    );
  }

  bid.deleteOne();
  await po.save();

  return { po: await getBidBoard(po._id) };
}

/**
 * `draft → sent`: the order goes out to everybody on it.
 *
 * Mail failures never fail the send. A supplier whose mail bounced is still on
 * the order and can still be chased; refusing the whole send because one
 * address is dead would hold up the other four.
 */
async function sendPurchaseOrder(id, { note } = {}) {
  const po = await loadPo(id, { populate: false });

  if (po.status !== 'draft') {
    throw ApiError.badRequest(`${po.poNumber} has already been sent.`, 'PO_ALREADY_SENT');
  }
  if (!po.items.length) {
    throw ApiError.badRequest('Add a line before sending this order.', 'PO_EMPTY');
  }
  if (!po.bids.length) {
    throw ApiError.badRequest(
      'Add at least one supplier before sending this order.',
      'PO_NO_SUPPLIERS',
    );
  }

  const now = new Date();
  po.status = 'sent';
  po.bids.forEach((bid) => {
    if (bid.status === 'invited' && !bid.sentAt) bid.sentAt = now;
  });
  po.timeline.push({
    status: 'sent',
    at: now,
    note: note ?? `Sent to ${po.bids.length} supplier(s).`,
  });

  await po.save();

  const suppliers = await db().Supplier.find({ _id: { $in: po.bids.map((bid) => bid.supplier) } })
    .select('name email')
    .lean();
  const results = await Promise.all(
    suppliers.map((supplier) => sendInvitationSafely(po, supplier)),
  );

  return {
    po: await getBidBoard(po._id),
    mailed: results.filter(Boolean).length,
    total: suppliers.length,
  };
}

/** Never lets a dead mailbox fail the thing being notified about. */
async function sendInvitationSafely(po, supplier) {
  try {
    const result = await supplierMail.sendPurchaseOrderInvitation({ supplier, po });
    return result?.delivered ?? false;
  } catch (error) {
    console.error(`  Purchase: invitation to ${supplier.name} failed - ${error.message}`);
    return false;
  }
}

/**
 * Push back on a supplier's price.
 *
 * Append-only. The supplier is mailed and, where they have consented, messaged
 * on their other channels - and `channels` records where it actually went,
 * never where we meant it to go.
 */
async function negotiate(id, supplierId, { askedTotal, askedLines, note } = {}, by) {
  const po = await loadPo(id, { populate: false });

  if (['confirmed', 'partial', 'received', 'cancelled'].includes(po.status)) {
    throw ApiError.badRequest(`${po.poNumber} has already been decided.`, 'PO_ALREADY_DECIDED');
  }

  const bid = findBid(po, supplierId);
  if (!bid) throw ApiError.notFound('That supplier is not on this order.', 'BID_NOT_FOUND');

  if (!['quoted', 'negotiating'].includes(bid.status)) {
    throw ApiError.badRequest(
      'There is nothing to negotiate yet - this supplier has not priced the order.',
      'BID_NOT_QUOTED',
    );
  }

  const round = (bid.negotiations?.length ?? 0) + 1;
  const supplier = await db().Supplier.findById(supplierId).lean();

  const channels = await notifySupplier(supplier, {
    subject: `We would like to revisit ${po.poNumber}`,
    po,
    askedTotal,
    note,
  });

  bid.negotiations.push({
    round,
    askedTotal: askedTotal != null ? Math.max(0, Math.round(askedTotal)) : undefined,
    askedLines: (askedLines ?? []).map((line) => ({
      sku: line.sku,
      unitCost: Math.max(0, Math.round(line.unitCost ?? 0)),
    })),
    theirCounter: bid.total ?? 0,
    note,
    at: new Date(),
    by,
    channels,
  });
  bid.status = 'negotiating';

  if (po.status === 'sent') po.status = 'negotiating';
  po.timeline.push({
    status: 'negotiating',
    at: new Date(),
    note: `Round ${round} with ${bid.supplierName ?? 'a supplier'}.`,
  });

  await po.save();
  return { po: await getBidBoard(po._id) };
}

/**
 * Email always, plus every channel the supplier has consented to.
 *
 * Email is the record - it is where the paperwork lands and what a dispute
 * reads back - so it goes regardless of what else does. The extra channels are
 * a courtesy on top, gated on consent (CASL, §6.13) and on the provider
 * actually being configured. Returns what genuinely went out.
 */
async function notifySupplier(supplier, payload) {
  if (!supplier) return [];

  const sent = [];

  try {
    const result = await supplierMail.sendNegotiationEmail({ supplier, ...payload });
    if (result?.delivered) sent.push('email');
  } catch (error) {
    console.error(`  Purchase: negotiation mail to ${supplier.name} failed - ${error.message}`);
  }

  // The preferred channel first, then anything else consented to. Both are
  // best-effort: an unconfigured provider is a logged no-op, never a throw.
  const consent = supplier.contactConsent ?? {};
  const extra = ['sms', 'whatsapp'].filter((channel) => consent[channel]);
  const ordered = supplier.preferredChannel && extra.includes(supplier.preferredChannel)
    ? [supplier.preferredChannel, ...extra.filter((c) => c !== supplier.preferredChannel)]
    : extra;

  for (const channel of ordered) {
    try {
      const delivered = await supplierMail.sendSupplierMessage({
        supplier,
        channel,
        ...payload,
      });
      if (delivered) sent.push(channel);
    } catch (error) {
      console.error(`  Purchase: ${channel} to ${supplier.name} failed - ${error.message}`);
    }
  }

  return sent;
}

/**
 * Pick the supplier this order is placed with.
 *
 * **This is where a bid becomes the purchase order.** The winner's unit costs
 * are copied on to the PO lines, `supplier` is set to them, and everything
 * downstream - receiving, the stock ledger, the `Expense` a payment writes,
 * the spend totals - then works exactly as it does for an order raised by
 * hand. Rule 5.
 *
 * Only lines the winner marked available are priced. A supplier who could fill
 * nine of ten lines gets an order for nine; the tenth is left unbought rather
 * than ordered from somebody who said they did not have it, and the response
 * names what was dropped so the clerk can raise a second order for them.
 */
async function confirmSupplier(id, { supplierId, expectedDate, note } = {}) {
  const po = await loadPo(id, { populate: false });

  if (['confirmed', 'partial', 'received'].includes(po.status)) {
    throw ApiError.badRequest(`${po.poNumber} is already confirmed.`, 'PO_ALREADY_CONFIRMED');
  }
  if (po.status === 'cancelled') {
    throw ApiError.badRequest(`${po.poNumber} is cancelled.`, 'PO_CANCELLED');
  }

  const bid = findBid(po, supplierId);
  if (!bid) throw ApiError.notFound('That supplier is not on this order.', 'BID_NOT_FOUND');
  if (!['quoted', 'negotiating'].includes(bid.status)) {
    throw ApiError.badRequest(
      'That supplier has not priced this order.',
      'BID_NOT_QUOTED',
    );
  }

  const asked = qtyMap(po);
  const priced = new Map(
    (bid.lines ?? [])
      .filter((line) => line.available !== false)
      .map((line) => [line.sku, { unitCost: line.unitCost ?? 0, qty: suppliedQty(line, asked) }]),
  );

  const dropped = [];
  const shortened = [];

  po.items.forEach((item) => {
    const quoted = priced.get(item.sku);

    // Nothing quoted, or quoted at zero: either way they are shipping none of
    // it, and a line for zero units is a line that does not belong on the
    // order.
    if (!quoted || quoted.qty <= 0) {
      dropped.push({ sku: item.sku, name: item.name });
      return;
    }

    /**
     * **The order follows the quantity they can actually supply.**
     *
     * Confirming at our quantity when the winner quoted fewer would put a
     * number nobody agreed to into receiving, into the expense a payment
     * writes, and into every margin report downstream - and the discrepancy
     * would surface as a short delivery weeks later with no record of why.
     */
    if (quoted.qty < item.qtyOrdered) {
      shortened.push({
        sku: item.sku,
        name: item.name,
        from: item.qtyOrdered,
        to: quoted.qty,
      });
      item.qtyOrdered = quoted.qty;
    }

    item.unitCost = quoted.unitCost;
    item.lineTotal = item.qtyOrdered * item.unitCost;
  });

  // Lines the winner cannot supply leave the order rather than sitting on it at
  // a price nobody quoted.
  if (dropped.length) {
    const droppedSkus = new Set(dropped.map((line) => line.sku));
    po.items = po.items.filter((item) => !droppedSkus.has(item.sku));
  }

  if (!po.items.length) {
    throw ApiError.badRequest(
      'That supplier cannot supply any line on this order.',
      'BID_SUPPLIES_NOTHING',
    );
  }

  const now = new Date();

  po.supplier = bid.supplier;
  po.confirmedBid = bid._id;
  po.confirmedAt = now;
  po.status = 'confirmed';
  po.shipping = bid.shipping ?? 0;
  po.tax = bid.tax ?? 0;
  if (expectedDate) po.expectedDate = new Date(expectedDate);

  po.subtotal = po.items.reduce((sum, item) => sum + item.lineTotal, 0);
  po.total = po.subtotal + (po.tax ?? 0) + (po.shipping ?? 0);

  bid.status = 'confirmed';
  bid.delivery = { ...(bid.delivery?.toObject?.() ?? bid.delivery ?? {}), status: 'pending' };
  if (bid.proforma && !bid.proforma.acceptedAt) bid.proforma.acceptedAt = now;

  // Both halves of the decision are written together, so an order can never
  // have two confirmed suppliers or a winner without losers.
  po.bids.forEach((other) => {
    if (String(other._id) !== String(bid._id) && other.status !== 'declined') {
      other.status = 'lost';
    }
  });

  po.timeline.push({
    status: 'confirmed',
    at: now,
    note:
      note ??
      // Short lines are named in the timeline, because the order's own
      // quantities just changed and the reason has to survive the click.
      `Confirmed with ${bid.supplierName ?? 'supplier'}.${
        shortened.length
          ? ` ${shortened.length} line${shortened.length === 1 ? '' : 's'} reduced to what they can supply.`
          : ''
      }`,
  });

  await po.save();

  return { po: await getBidBoard(po._id), dropped, shortened };
}

// ---- reviewing a proforma ---------------------------------------------------

/**
 * What accepting a supplier's proforma would do to this order, line by line.
 *
 * **Computed before the write and shown to the staff member**, because accepting a
 * PI rewrites the order's lines and a rewrite nobody previewed is one nobody
 * agreed to. A supplier who short-ships one line and rounds another up to a
 * case pack is normal, not exceptional - but it changes what we pay, what we
 * expect to receive and what eventually restocks, so it has to be read first.
 *
 * Returns a row per SKU touched by either side, tagged with what changes:
 * `added` (on the PI, not on the order), `removed` (they cannot supply it),
 * `qty`, `cost`, `both`, or `same`.
 */
function diffProforma(po, proforma, bid) {
  const ours = new Map((po.items ?? []).map((item) => [item.sku, item]));

  /**
   * A PI raised before line detail existed carries totals and nothing else.
   *
   * Reading its empty `lines` literally would say the supplier is shipping
   * *none* of the order - every row "removed", a total of zero - which is the
   * opposite of what those documents meant. They meant "as quoted, at the
   * quantities you asked for", so that is what they are reconstructed as: the
   * bid's own available lines against our `qtyOrdered`. The same fallback
   * `submitProforma` applies when a supplier sends no lines, kept in step here
   * so an old PI and a new one describe the same thing.
   */
  const stored = proforma?.lines ?? [];
  const effective = stored.length
    ? stored
    : (bid?.lines ?? [])
        .filter((line) => line.available !== false)
        .map((line) => {
          const item = ours.get(line.sku);
          return {
            sku: line.sku,
            name: item?.name ?? line.sku,
            qty: item?.qtyOrdered ?? 0,
            unitCost: line.unitCost ?? 0,
          };
        });

  const theirs = new Map(effective.map((line) => [line.sku, line]));

  const rows = [];
  for (const sku of new Set([...ours.keys(), ...theirs.keys()])) {
    const a = ours.get(sku);
    const b = theirs.get(sku);

    if (!b || b.qty === 0) {
      rows.push({
        sku,
        name: a?.name ?? b?.name ?? sku,
        change: 'removed',
        fromQty: a?.qtyOrdered ?? 0,
        toQty: 0,
        fromCost: a?.unitCost ?? 0,
        toCost: b?.unitCost ?? a?.unitCost ?? 0,
      });
      continue;
    }

    if (!a) {
      rows.push({
        sku,
        name: b.name ?? sku,
        change: 'added',
        fromQty: 0,
        toQty: b.qty,
        fromCost: 0,
        toCost: b.unitCost,
      });
      continue;
    }

    const qtyMoved = a.qtyOrdered !== b.qty;
    // A line that was never priced sits at zero, so "0 → a real price" is the
    // normal case rather than a change worth flagging on its own.
    const costMoved = (a.unitCost ?? 0) !== b.unitCost && (a.unitCost ?? 0) > 0;

    rows.push({
      sku,
      name: a.name,
      change: qtyMoved && costMoved ? 'both' : qtyMoved ? 'qty' : costMoved ? 'cost' : 'same',
      fromQty: a.qtyOrdered,
      toQty: b.qty,
      fromCost: a.unitCost ?? 0,
      toCost: b.unitCost,
    });
  }

  rows.sort((x, y) => x.sku.localeCompare(y.sku));

  const subtotal = rows
    .filter((row) => row.change !== 'removed')
    .reduce((sum, row) => sum + row.toCost * row.toQty, 0);

  return {
    rows,
    changed: rows.filter((row) => row.change !== 'same').length,
    subtotal,
    tax: proforma?.tax ?? 0,
    shipping: proforma?.shipping ?? 0,
    total: subtotal + (proforma?.tax ?? 0) + (proforma?.shipping ?? 0),
  };
}

/**
 * Accept a supplier's proforma, and make the order match it.
 *
 * **The PI becomes the order of record.** Its quantities and prices are written
 * onto `po.items`, because that is what we are agreeing to pay, what the
 * warehouse should expect and what receiving will count against - leaving the
 * order saying 40 while the invoice says 36 would put a discrepancy into
 * inventory, payment and the margin on every downstream report, each of which
 * would then need explaining separately.
 *
 * A line the PI drops leaves the order rather than sitting on it at a quantity
 * nobody is shipping. A line the PI adds is **refused**: a supplier cannot
 * enlarge an order we did not place by invoicing for it, and the honest answer
 * to "we also sent you these" is a conversation, not a silent line item.
 *
 * Accepting does **not** confirm the supplier. Those are different decisions
 * "this document is right" and "we are buying from you" - and an order out to
 * three suppliers may have two acceptable PIs on it. `confirmSupplier` still
 * has to be called, and it now finds the lines already agreed.
 */
async function acceptProforma(id, { supplierId, acceptedBy } = {}) {
  const po = await loadPo(id, { populate: false });

  if (['partial', 'received', 'cancelled'].includes(po.status)) {
    throw ApiError.badRequest(
      `${po.poNumber} has moved past pricing.`,
      'PO_NOT_EDITABLE',
    );
  }

  const bid = findBid(po, supplierId);
  if (!bid) throw ApiError.notFound('That supplier is not on this order.', 'BID_NOT_FOUND');
  if (!bid.proforma) {
    throw ApiError.badRequest(
      'That supplier has not issued a proforma invoice.',
      'PROFORMA_NOT_FOUND',
    );
  }
  if (bid.proforma.review === 'accepted') {
    throw ApiError.badRequest('That proforma is already accepted.', 'PROFORMA_ACCEPTED');
  }

  const diff = diffProforma(po, bid.proforma, bid);

  const added = diff.rows.filter((row) => row.change === 'added');
  if (added.length) {
    throw ApiError.badRequest(
      `The proforma invoices for ${added.map((row) => row.sku).join(', ')}, which ${added.length === 1 ? 'is' : 'are'} not on this order. Ask the supplier to reissue it, or add the ${added.length === 1 ? 'line' : 'lines'} to the order first.`,
      'PROFORMA_HAS_EXTRA_LINES',
    );
  }

  /**
   * What to write, taken from the **diff** rather than from the PI directly.
   *
   * `diffProforma` is where the legacy fallback lives - a PI raised before line
   * detail existed has no `lines`, and reading those straight off the document
   * would empty the order rather than leave it as quoted. Going through the
   * diff means the rows a staff member was shown are exactly the rows that get
   * written, which is the only way the preview can be trusted.
   */
  const keep = new Map(
    diff.rows
      .filter((row) => row.change !== 'removed' && row.toQty > 0)
      .map((row) => [row.sku, { qty: row.toQty, unitCost: row.toCost }]),
  );
  if (!keep.size) {
    throw ApiError.badRequest(
      'That proforma invoices for nothing.',
      'PROFORMA_EMPTY',
    );
  }

  po.items = po.items
    .filter((item) => keep.has(item.sku))
    .map((item) => {
      const line = keep.get(item.sku);
      item.qtyOrdered = line.qty;
      item.unitCost = line.unitCost;
      item.lineTotal = line.qty * line.unitCost;
      return item;
    });

  // Recomputed from the lines, as every total in this file is - the PI's own
  // `subtotal` is the supplier's arithmetic and is not what we store.
  po.subtotal = po.items.reduce((sum, item) => sum + item.lineTotal, 0);
  po.tax = bid.proforma.tax ?? 0;
  po.shipping = bid.proforma.shipping ?? 0;
  po.total = po.subtotal + po.tax + po.shipping;

  const now = new Date();
  bid.proforma.review = 'accepted';
  bid.proforma.acceptedAt = now;
  bid.proforma.acceptedBy = acceptedBy;

  const dropped = diff.rows.filter((row) => row.change === 'removed');
  po.timeline.push({
    status: 'proforma_accepted',
    at: now,
    note: `Accepted ${bid.supplierName ?? 'supplier'}'s proforma${bid.proforma.number ? ` ${bid.proforma.number}` : ''}${
      diff.changed ? ` - ${diff.changed} line${diff.changed === 1 ? '' : 's'} changed` : ''
    }${dropped.length ? `, ${dropped.length} dropped` : ''}.`,
  });

  await po.save();

  return { po: await getBidBoard(po._id), diff };
}

/**
 * Send a proforma back for a new one, with a reason.
 *
 * The reason is required and is shown to the supplier verbatim: "please revise"
 * with no note is a round trip that teaches them nothing, and they will guess
 * usually at the wrong line.
 *
 * The PI is **kept**, not deleted. A superseded revision stays readable for the
 * same reason `submitProforma` keeps its history: what they originally asked
 * for is half of what a negotiation means.
 */
async function requestProformaRevision(id, { supplierId, note } = {}) {
  const po = await loadPo(id, { populate: false });

  const bid = findBid(po, supplierId);
  if (!bid) throw ApiError.notFound('That supplier is not on this order.', 'BID_NOT_FOUND');
  if (!bid.proforma) {
    throw ApiError.badRequest(
      'That supplier has not issued a proforma invoice.',
      'PROFORMA_NOT_FOUND',
    );
  }

  const reason = String(note ?? '').trim();
  if (!reason) {
    throw ApiError.badRequest(
      'Say what needs changing - the supplier sees this.',
      'REVISION_NOTE_REQUIRED',
    );
  }

  const now = new Date();
  bid.proforma.review = 'revision_requested';
  bid.proforma.revisionRequestedAt = now;
  bid.proforma.revisionNote = reason;

  po.timeline.push({
    status: 'proforma_revision',
    at: now,
    note: `Asked ${bid.supplierName ?? 'supplier'} to revise their proforma: ${reason}`,
  });

  await po.save();

  await notifyAdminsByMail({
    subject: `Proforma revision requested for ${po.poNumber}`,
    po,
    supplierName: bid.supplierName,
    kind: 'proforma',
  });

  return { po: await getBidBoard(po._id) };
}

// ---- the portal side --------------------------------------------------------

/**
 * Every order this supplier was asked to price. Their own bid, never another's.
 *
 * **No gate here, deliberately** (re-ruled 2026-09-13). An earlier pass withheld
 * an order's contents until the supplier accepted terms *on that order*, which
 * was the wrong shape twice over: a master supply agreement is signed once for
 * the relationship, not per purchase order, and a supplier who cannot see what
 * they are being asked to quote on cannot judge whether signing is worth it.
 *
 * Reading is open; **committing is not**. `agreementService.assertSigned` gates
 * `submitBid` and `submitProforma`, so a supplier browses freely and signs
 * before they can put a price to anything.
 */
async function listForSupplier(supplierId) {
  const orders = await db().PurchaseOrder.find({
    'bids.supplier': supplierId,
    status: { $ne: 'draft' },
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  return {
    orders: orders.map((po) => shapeForSupplier(po, supplierId)).filter(Boolean),
  };
}

/**
 * One order, as its supplier sees it. Marks it viewed on first open.
 *
 * **Open to read** (re-ruled 2026-09-13). This used to return the purchase
 * terms instead of the order until the supplier accepted them on that order
 * a gate that asked again on every single order, which is not how a master
 * supply agreement works. The agreement is signed once, in the portal, and
 * gates the writes: `submitBid` and `submitProforma` call
 * `agreementService.assertSigned`.
 *
 * Fetching marks the bid `viewed`, which is why the dashboard does not prefetch
 * it: "opened it and has not answered" is a fact the purchasing team acts on.
 */
async function getForSupplier(id, supplierId) {
  const po = await db().PurchaseOrder.findOne({
    _id: id,
    'bids.supplier': supplierId,
    status: { $ne: 'draft' },
  });
  if (!po) throw ApiError.notFound('Order not found.', 'PO_NOT_FOUND');

  const bid = findBid(po, supplierId);
  if (bid.status === 'invited') {
    bid.status = 'viewed';
    bid.viewedAt = new Date();
    await po.save();
  }

  return { order: shapeForSupplier(po.toObject(), supplierId) };
}

/**
 * A supplier prices the order.
 *
 * Rule 3 in full: the unit costs are theirs and are kept; every total is
 * recomputed from them against our quantities. Lines naming a SKU this order
 * does not contain are dropped rather than rejected - a supplier pasting an old
 * quote should not be met with a validation wall.
 */
async function submitBid(id, supplierId, body) {
  const po = await db().PurchaseOrder.findOne({
    _id: id,
    'bids.supplier': supplierId,
    status: { $ne: 'draft' },
  });
  if (!po) throw ApiError.notFound('Order not found.', 'PO_NOT_FOUND');

  assertBiddable(po);
  // A price is a commercial commitment, so it sits behind the master agreement.
  // Reading an order does not - see `getForSupplier`.
  await agreementService.assertSigned(supplierId);

  const bid = findBid(po, supplierId);
  const requested = qtyMap(po);

  const lines = (body.lines ?? [])
    .filter((line) => requested.has(line.sku))
    .map((line) => ({
      sku: line.sku,
      unitCost: Math.max(0, Math.round(line.unitCost ?? 0)),
      /**
       * What they can supply, capped at what we asked for.
       *
       * A quantity IS accepted here, which is the same exception a unit cost
       * gets: the supplier is the only one who knows their stock. What is not
       * accepted is a number *above* the order - that would be quoting a
       * different purchase, and it would rank them against one.
       *
       * `undefined` when they did not say, meaning "all of them".
       */
      qty:
        line.qty == null
          ? undefined
          : Math.min(Math.max(0, Math.round(line.qty)), requested.get(line.sku) ?? 0),
      available: line.available !== false,
      note: line.note,
    }));

  if (!lines.length) {
    throw ApiError.badRequest('Price at least one line before sending your quote.', 'BID_EMPTY');
  }

  bid.lines = lines;
  bid.tax = Math.max(0, Math.round(body.tax ?? 0));
  bid.shipping = Math.max(0, Math.round(body.shipping ?? 0));
  bid.leadTimeDays = body.leadTimeDays;
  bid.validUntil = body.validUntil ? new Date(body.validUntil) : undefined;
  bid.note = body.note;
  bid.status = 'quoted';
  bid.quotedAt = new Date();

  recomputeBid(bid, requested);

  // A round that has been answered stops looking outstanding.
  const open = (bid.negotiations ?? []).filter((round) => !round.respondedAt);
  open.forEach((round) => {
    round.respondedAt = new Date();
    round.theirCounter = bid.total;
  });

  po.timeline.push({
    status: 'quoted',
    at: new Date(),
    note: `${bid.supplierName ?? 'A supplier'} sent a price.`,
  });
  await po.save();

  await notificationService.emit({
    type: 'po_quoted',
    severity: 'info',
    title: `${bid.supplierName ?? 'A supplier'} priced ${po.poNumber}`,
    detail: `${lines.length} line(s) priced · awaiting comparison`,
    entity: { kind: 'purchase-order', id: po._id.toString(), label: po.poNumber },
    href: `/admin/purchase-orders/${po._id}`,
  });

  return { order: shapeForSupplier(po.toObject(), supplierId) };
}

function assertBiddable(po) {
  if (['confirmed', 'partial', 'received'].includes(po.status)) {
    throw ApiError.badRequest('This order has already been decided.', 'PO_DECIDED');
  }
  if (po.status === 'cancelled') {
    throw ApiError.badRequest('This order was withdrawn.', 'PO_CANCELLED');
  }
  if (po.closesAt && new Date(po.closesAt) < new Date()) {
    throw ApiError.badRequest('This order has closed.', 'PO_CLOSED');
  }
}

/** "We cannot supply this." A recorded no is worth far more than silence. */
async function declineBid(id, supplierId, { reason } = {}) {
  const po = await db().PurchaseOrder.findOne({
    _id: id,
    'bids.supplier': supplierId,
    status: { $ne: 'draft' },
  });
  if (!po) throw ApiError.notFound('Order not found.', 'PO_NOT_FOUND');

  assertBiddable(po);

  const bid = findBid(po, supplierId);
  bid.status = 'declined';
  bid.declineReason = reason;
  bid.lines = [];
  bid.subtotal = 0;
  bid.total = 0;

  po.timeline.push({
    status: 'declined',
    at: new Date(),
    note: `${bid.supplierName ?? 'A supplier'} declined${reason ? ` - ${reason}` : ''}.`,
  });
  await po.save();

  return { order: shapeForSupplier(po.toObject(), supplierId) };
}

/**
 * A supplier issues a proforma invoice against this order (§6.8b).
 *
 * **Form-driven, never uploaded**: the supplier states the numbers and the
 * server totals them, so the document's arithmetic is ours even though the
 * prices are theirs. `proformaDocument.js` renders it.
 *
 * A second PI supersedes the first rather than overwriting it - the number that
 * was negotiated away has to stay readable.
 */
async function submitProforma(id, supplierId, body) {
  const po = await db().PurchaseOrder.findOne({
    _id: id,
    'bids.supplier': supplierId,
    status: { $ne: 'draft' },
  });
  if (!po) throw ApiError.notFound('Order not found.', 'PO_NOT_FOUND');

  if (po.status === 'cancelled') {
    throw ApiError.badRequest('This order was withdrawn.', 'PO_CANCELLED');
  }

  // The document the agreement exists to precede - "sign before sending any PI"
  // is the rule this enforces.
  await agreementService.assertSigned(supplierId);

  const bid = findBid(po, supplierId);
  if (!['quoted', 'negotiating', 'confirmed'].includes(bid.status)) {
    throw ApiError.badRequest(
      'Send your price before issuing a proforma invoice.',
      'BID_NOT_QUOTED',
    );
  }

  const previous = bid.proforma;
  const revision = previous ? (previous.revision ?? 1) + 1 : 1;

  /**
   * The lines this PI invoices - the supplier's quantities, ours as the default.
   *
   * **A quantity here IS the payload**, which is the same exception `submitBid`
   * makes for a unit cost: the whole point of a proforma is the supplier
   * telling us what they will actually ship, and a case pack that rounds 36 up
   * to 40 or a line they are short on has to be expressible or the document
   * cannot be reconciled against the invoice that follows it.
   *
   * What is still never accepted is a **total**. Every one below is recomputed
   * from these lines, so a PI whose arithmetic disagrees with itself cannot be
   * saved. And a line naming a SKU this order does not contain is dropped
   * rather than rejected - the same forgiveness `submitBid` shows a supplier
   * pasting an old quote.
   *
   * Prices still come from the bid unless the PI restates them: a proforma is
   * the formal version of a price already given, so silence means "as quoted".
   */
  const requested = qtyMap(po);
  const quoted = new Map(
    (bid.lines ?? [])
      .filter((line) => line.available !== false)
      .map((line) => [line.sku, line.unitCost ?? 0]),
  );
  const names = new Map((po.items ?? []).map((item) => [item.sku, item.name]));

  const lines = Array.isArray(body.lines) && body.lines.length
    ? body.lines
        .filter((line) => requested.has(line.sku))
        .map((line) => ({
          sku: line.sku,
          name: names.get(line.sku),
          qty: Math.max(0, Math.round(line.qty ?? 0)),
          unitCost: Math.max(0, Math.round(line.unitCost ?? quoted.get(line.sku) ?? 0)),
          note: line.note,
        }))
    // No lines sent: the PI covers what they quoted, at our quantities. This is
    // what every proforma raised before line detail existed meant, so an old
    // client and a new one produce the same document.
    : [...quoted.entries()].map(([sku, unitCost]) => ({
        sku,
        name: names.get(sku),
        qty: requested.get(sku) ?? 0,
        unitCost,
      }));

  const subtotal = lines.reduce((sum, line) => sum + line.unitCost * line.qty, 0);
  const tax = Math.max(0, Math.round(body.tax ?? bid.tax ?? 0));
  const shipping = Math.max(0, Math.round(body.shipping ?? bid.shipping ?? 0));

  const history = previous
    ? [
        ...(previous.history ?? []),
        {
          revision: previous.revision ?? 1,
          total: previous.total ?? 0,
          issuedAt: previous.issuedAt,
          supersededAt: new Date(),
        },
      ]
    : [];

  bid.proforma = {
    number: body.number,
    revision,
    issuedAt: new Date(),
    validUntil: body.validUntil ? new Date(body.validUntil) : undefined,
    lines,
    subtotal,
    tax,
    shipping,
    total: subtotal + tax + shipping,
    paymentTerms: body.paymentTerms,
    bankDetails: body.bankDetails,
    note: body.note,
    // A new revision is unreviewed by definition - including one raised to
    // answer a revision request, which is exactly the case where leaving the
    // old `revision_requested` standing would tell the buyer their question was
    // still open after it had been answered.
    review: 'pending',
    history,
  };

  po.timeline.push({
    status: 'proforma',
    at: new Date(),
    note: `${bid.supplierName ?? 'A supplier'} issued a proforma invoice${revision > 1 ? ` (rev ${revision})` : ''}.`,
  });
  await po.save();

  await notificationService.emit({
    type: 'po_proforma',
    severity: 'info',
    title: `${bid.supplierName ?? 'A supplier'} sent a proforma for ${po.poNumber}`,
    detail:
      revision > 1
        ? `Revision ${revision} · awaiting review`
        : 'Awaiting review',
    entity: { kind: 'purchase-order', id: po._id.toString(), label: po.poNumber },
    href: `/admin/purchase-orders/${po._id}`,
  });

  await notifyAdminsByMail({
    subject: `Proforma invoice for ${po.poNumber}`,
    po,
    supplierName: bid.supplierName,
    kind: 'proforma',
  });

  return { order: shapeForSupplier(po.toObject(), supplierId) };
}

/**
 * The confirmed supplier reports on getting the goods to us.
 *
 * Only the confirmed supplier may: an order is placed with one of them, and a
 * losing bidder marking a delivery dispatched is a fact about nothing.
 *
 * **This does not move stock.** Receiving is a physical count somebody makes at
 * our end, and a supplier saying "delivered" is a claim, not a receipt
 * `purchaseService.receivePurchaseOrder` stays the only path into the ledger.
 */
async function setDeliveryStatus(id, supplierId, body) {
  const po = await db().PurchaseOrder.findOne({ _id: id, 'bids.supplier': supplierId });
  if (!po) throw ApiError.notFound('Order not found.', 'PO_NOT_FOUND');

  const bid = findBid(po, supplierId);
  if (String(po.confirmedBid ?? '') !== String(bid._id)) {
    throw ApiError.badRequest('This order was not confirmed with you.', 'BID_NOT_CONFIRMED');
  }

  const status = String(body.status ?? '');
  if (!DELIVERY_STATUSES.includes(status)) {
    throw ApiError.badRequest('That is not a delivery status.', 'DELIVERY_STATUS_INVALID');
  }

  const now = new Date();
  bid.delivery = {
    ...(bid.delivery?.toObject?.() ?? bid.delivery ?? {}),
    status,
    carrier: body.carrier ?? bid.delivery?.carrier,
    trackingNumber: body.trackingNumber ?? bid.delivery?.trackingNumber,
    expectedAt: body.expectedAt ? new Date(body.expectedAt) : bid.delivery?.expectedAt,
    note: body.note ?? bid.delivery?.note,
    dispatchedAt:
      status === 'dispatched' ? (bid.delivery?.dispatchedAt ?? now) : bid.delivery?.dispatchedAt,
    deliveredAt:
      status === 'delivered' ? (bid.delivery?.deliveredAt ?? now) : bid.delivery?.deliveredAt,
  };

  po.timeline.push({
    status: 'delivery',
    at: now,
    note: `${bid.supplierName ?? 'Supplier'} marked the delivery ${status.replace('_', ' ')}.`,
  });
  await po.save();

  await notificationService.emit({
    type: 'po_delivery',
    severity: status === 'delivered' ? 'success' : 'info',
    title: `${po.poNumber} - delivery ${status.replace('_', ' ')}`,
    detail: bid.delivery.trackingNumber
      ? `${bid.supplierName ?? 'Supplier'} · ${bid.delivery.trackingNumber}`
      : (bid.supplierName ?? 'Supplier'),
    entity: { kind: 'purchase-order', id: po._id.toString(), label: po.poNumber },
    href: `/admin/purchase-orders/${po._id}`,
  });

  await notifyAdminsByMail({
    subject: `${po.poNumber} - delivery ${status.replace('_', ' ')}`,
    po,
    supplierName: bid.supplierName,
    kind: 'delivery',
    status,
  });

  return { order: shapeForSupplier(po.toObject(), supplierId) };
}

/** Best-effort, like every other notification path here. */
async function notifyAdminsByMail(payload) {
  try {
    await supplierMail.sendPurchaseAdminAlert(payload);
  } catch (error) {
    console.error(`  Purchase: admin alert failed - ${error.message}`);
  }
}

/**
 * One supplier's proforma invoice, as a printable sheet.
 *
 * Readable from both sides: the admin opens it from the PO's supplier panel,
 * and the supplier who raised it can open their own. `supplierId` is supplied
 * by the caller's session in either case, so a supplier can never name another
 * supplier's bid.
 */
async function proformaDocument(id, supplierId, { nonce = null } = {}) {
  const po = await db().PurchaseOrder.findById(id).lean();
  if (!po) throw ApiError.notFound('Purchase order not found.', 'PO_NOT_FOUND');

  const bid = findBid(po, supplierId);
  if (!bid?.proforma) {
    throw ApiError.notFound('No proforma invoice on this order.', 'PROFORMA_NOT_FOUND');
  }

  const supplier = await db().Supplier.findById(bid.supplier).select('name email phone address').lean();
  // The business being billed. "Billed to" on a proforma is who the supplier
  // will invoice, so the house constant here would point a supplier's paperwork
  // at the wrong company entirely.
  const html = renderProformaHtml({ po, bid, supplier, nonce, business: await sendingBusiness() });
  if (!html) throw ApiError.notFound('No proforma invoice on this order.', 'PROFORMA_NOT_FOUND');

  return html;
}

// ---- the admin's bid board --------------------------------------------------

/** Everything the PO detail page's supplier panel renders. */
async function getBidBoard(id) {
  const po = await db().PurchaseOrder.findById(id)
    .populate('bids.supplier', 'name email componentTypes')
    .lean();
  if (!po) throw ApiError.notFound('Purchase order not found.', 'PO_NOT_FOUND');

  const bids = shapeBids(po);

  return {
    id: po._id.toString(),
    poNumber: po.poNumber,
    status: po.status,
    componentTypes: po.componentTypes ?? [],
    closesAt: po.closesAt ?? null,
    closed: Boolean(po.closesAt && new Date(po.closesAt) < new Date()),
    confirmedBid: po.confirmedBid?.toString() ?? null,
    confirmedAt: po.confirmedAt ?? null,
    bids,
    bidCount: bids.length,
    /**
     * How many suppliers **answered**, which is not the same as how many are
     * sitting at `quoted` right now.
     *
     * Confirming an order moves the winner to `confirmed` and everyone else to
     * `lost`, so counting only `quoted` made a decided order report "0 of 2
     * have answered" - the two suppliers who priced it had both been moved on
     * from the status being counted. `negotiating` is the same case mid-flight.
     * A supplier who answered has answered, whatever we did with it afterwards.
     *
     * Counted on **evidence of a price** rather than on status, because
     * confirming also marks an invite nobody ever opened as `lost` - status
     * alone would count that supplier as having answered. `quotedAt` is written
     * only by `submitBid`, so it is the fact that cannot be produced any other
     * way.
     */
    quoteCount: bids.filter((bid) => bid.quotedAt).length,
    bestBid: bids.find((bid) => bid.isBest)?.id ?? null,
  };
}

export {
  acceptProforma,
  confirmSupplier,
  declineBid,
  getBidBoard,
  getForSupplier,
  inviteSuppliers,
  listForSupplier,
  negotiate,
  proformaDocument,
  removeSupplier,
  requestProformaRevision,
  sendPurchaseOrder,
  setDeliveryStatus,
  shapeBids,
  shapeForSupplier,
  submitBid,
  submitProforma,
  suppliersForComponentTypes,
};
