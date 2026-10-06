import mongoose from 'mongoose';

import { db } from '../db/models.js';
import { LABEL_CHANNELS } from '../models/InvoiceLabel.js';
import '../models/Invoice.js';
import ApiError from '../utils/ApiError.js';

/**
 * The manual invoice status, and the list it is chosen from (Sales § Invoice).
 *
 * Two rules live here and are worth not routing around:
 *
 * **The label never touches money.** It sits beside `Invoice.status`, which is
 * payment state and is derived from the payment rows. Setting a label moves no
 * balance, changes no total and does not settle anything.
 *
 * **Setting a label sends nothing by itself.** A status's own message goes out
 * with the scheduled messages (`invoiceStatusService.run`), once per invoice.
 * The fixed warranty email a label could arm was removed on 2026-10-01.
 */

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value ?? ''));
}

function shapeLabel(label) {
  if (!label) return null;

  return {
    id: String(label._id),
    name: label.name,
    colorToken: label.colorToken ?? 'ink',
    isActive: label.isActive !== false,
    order: label.order ?? 0,
    delayDays: label.delayDays ?? 0,
    channels: label.channels?.length ? label.channels : ['email'],
    subject: label.subject ?? '',
    message: label.message ?? '',
    messageActive: label.messageActive === true,
  };
}

/**
 * The message half of a status, from a request body (2026-10-01). Only the
 * keys the body carries, so a partial update leaves the rest alone.
 */
function messageFields(body = {}) {
  const out = {};
  if (body.delayDays !== undefined) out.delayDays = Math.max(Number(body.delayDays) || 0, 0);
  if (body.channels !== undefined) {
    const channels = [...new Set((body.channels ?? []).filter((channel) => LABEL_CHANNELS.includes(channel)))];
    out.channels = channels.length ? channels : ['email'];
  }
  if (body.subject !== undefined) out.subject = String(body.subject ?? '').trim();
  if (body.message !== undefined) out.message = String(body.message ?? '').trim();
  if (body.messageActive !== undefined) out.messageActive = Boolean(body.messageActive);
  return out;
}

/**
 * The list a picker reads.
 *
 * `status` defaults to active because every caller but the settings screen is a
 * picker, and offering a retired label puts it back on an invoice. The settings
 * screen passes `all`, which is the only place a retired one should be visible.
 */
async function listLabels({ status = 'active' } = {}) {
  const filter = {};
  if (status === 'active') filter.isActive = true;
  else if (status === 'inactive') filter.isActive = false;

  const rows = await db().InvoiceLabel.find(filter).sort({ order: 1, name: 1 }).lean();
  return { labels: rows.map(shapeLabel) };
}

async function createLabel(body = {}, actor) {
  const name = String(body.name ?? '').trim();
  if (name.length < 1) {
    throw ApiError.badRequest('Give the status a name.', 'LABEL_NAME_REQUIRED');
  }

  try {
    const label = await db().InvoiceLabel.create({
      name,
      colorToken: body.colorToken || 'ink',
      isActive: body.isActive !== false,
      order: Number(body.order) || 0,
      ...messageFields(body),
      createdBy: actor ?? null,
    });

    return { label: shapeLabel(label.toObject()) };
  } catch (error) {
    // The compound unique index. Caught rather than pre-checked: a pre-check
    // races, the index does not.
    if (error?.code === 11000) {
      throw ApiError.badRequest(`"${name}" is already on the status list.`, 'LABEL_DUPLICATE');
    }
    throw error;
  }
}

async function updateLabel(id, body = {}) {
  if (!isObjectId(id)) throw ApiError.notFound('Status not found.', 'LABEL_NOT_FOUND');

  const label = await db().InvoiceLabel.findById(id);
  if (!label) throw ApiError.notFound('Status not found.', 'LABEL_NOT_FOUND');

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw ApiError.badRequest('Give the status a name.', 'LABEL_NAME_REQUIRED');
    label.name = name;
  }
  if (body.colorToken !== undefined) label.colorToken = body.colorToken || 'ink';
  if (body.isActive !== undefined) label.isActive = Boolean(body.isActive);
  if (body.order !== undefined) label.order = Number(body.order) || 0;
  Object.assign(label, messageFields(body));

  try {
    await label.save();
  } catch (error) {
    if (error?.code === 11000) {
      throw ApiError.badRequest(
        `"${label.name}" is already on the status list.`,
        'LABEL_DUPLICATE',
      );
    }
    throw error;
  }

  return { label: shapeLabel(label.toObject()) };
}

/**
 * Remove a status nothing is using; refuse one that is in use.
 *
 * **Refused rather than cascaded.** `Invoice.label` is a reference, so deleting
 * a label in use would leave every invoice carrying it pointing at nothing -
 * the status column would empty out with no record of what it said. Retiring
 * takes it out of the picker and leaves the invoices readable, which is what
 * somebody tidying a list actually wants.
 */
async function deleteLabel(id) {
  if (!isObjectId(id)) throw ApiError.notFound('Status not found.', 'LABEL_NOT_FOUND');

  const label = await db().InvoiceLabel.findById(id).lean();
  if (!label) throw ApiError.notFound('Status not found.', 'LABEL_NOT_FOUND');

  const used = await db().Invoice.countDocuments({ label: label._id });
  if (used > 0) {
    throw ApiError.badRequest(
      `"${label.name}" is set on ${used} invoice${used === 1 ? '' : 's'}. ` +
        'Retire it instead - it stops appearing in the picker and those invoices stay readable.',
      'LABEL_IN_USE',
    );
  }

  await db().InvoiceLabel.deleteOne({ _id: label._id });
  return { deleted: true, name: label.name };
}

/**
 * Set or clear the manual status on one invoice.
 *
 * `labelId` of `null` clears it. `labelSetAt` is what a status's message
 * counts its days from. `channels` is what the confirmation allowed the
 * message to use on this invoice; absent means every channel the status has.
 */
async function setInvoiceLabel(number, { labelId, channels } = {}) {
  const invoice = await db().Invoice.findOne({ number });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  if (!labelId) {
    invoice.label = null;
    invoice.labelSetAt = null;
    invoice.labelChannels = undefined;
    await invoice.save();
    return { cleared: true, label: null };
  }

  if (!isObjectId(labelId)) throw ApiError.notFound('Status not found.', 'LABEL_NOT_FOUND');
  const label = await db().InvoiceLabel.findById(labelId).lean();
  if (!label) throw ApiError.notFound('Status not found.', 'LABEL_NOT_FOUND');

  invoice.label = label._id;
  invoice.labelSetAt = new Date();
  invoice.labelChannels = Array.isArray(channels)
    ? channels.filter((channel) => LABEL_CHANNELS.includes(channel))
    : undefined;

  await invoice.save();

  // The shaped label goes back so the screen can repaint the pill without a
  // second round trip.
  return {
    cleared: false,
    labelName: label.name,
    label: shapeLabel(label),
    labelSetAt: invoice.labelSetAt,
  };
}

export {
  listLabels,
  createLabel,
  updateLabel,
  deleteLabel,
  setInvoiceLabel,
  shapeLabel,
};
export default { listLabels, createLabel, updateLabel, deleteLabel, setInvoiceLabel };
