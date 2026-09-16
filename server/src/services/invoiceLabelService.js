import mongoose from 'mongoose';

import { db } from '../db/models.js';
import '../models/InvoiceLabel.js';
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
 * **The warranty email goes out once per invoice, ever.** A label may be
 * configured to send it the first time it lands on a paid invoice;
 * `Invoice.labelEmailSentAt` is the guard, so clearing the label and re-setting
 * it sends nothing. See `models/InvoiceLabel.js` for why that lives on the
 * invoice rather than on the label.
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
    sendsWarrantyEmail: label.sendsWarrantyEmail === true,
    isActive: label.isActive !== false,
    order: label.order ?? 0,
  };
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
      sendsWarrantyEmail: Boolean(body.sendsWarrantyEmail),
      isActive: body.isActive !== false,
      order: Number(body.order) || 0,
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
  if (body.sendsWarrantyEmail !== undefined) {
    label.sendsWarrantyEmail = Boolean(body.sendsWarrantyEmail);
  }
  if (body.isActive !== undefined) label.isActive = Boolean(body.isActive);
  if (body.order !== undefined) label.order = Number(body.order) || 0;

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
 * Returns `{ invoice, emailed }` so the screen can say whether the warranty
 * email actually went - a side effect the person clicking cannot otherwise see.
 *
 * `labelId` of `null` clears it. Clearing does **not** reset
 * `labelEmailSentAt`: the email either went to that customer or it did not, and
 * forgetting that is how they receive it twice.
 */
async function setInvoiceLabel(number, { labelId } = {}) {
  const invoice = await db().Invoice.findOne({ number });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  if (!labelId) {
    invoice.label = null;
    invoice.labelSetAt = null;
    await invoice.save();
    return { cleared: true, emailed: false, label: null };
  }

  if (!isObjectId(labelId)) throw ApiError.notFound('Status not found.', 'LABEL_NOT_FOUND');
  const label = await db().InvoiceLabel.findById(labelId).lean();
  if (!label) throw ApiError.notFound('Status not found.', 'LABEL_NOT_FOUND');

  invoice.label = label._id;
  invoice.labelSetAt = new Date();

  /**
   * The warranty email, at most once per invoice.
   *
   * Three conditions, all of them load-bearing:
   *
   *   - the label is configured to send it - which label means "finished with
   *     this customer" differs per shop, so it is data rather than a phrase in
   *     a conditional;
   *   - the invoice is **paid** - thanking somebody for support while they
   *     still owe money reads as a dunning letter with the wrong words on it;
   *   - it has never been sent for this invoice.
   */
  const shouldSend =
    label.sendsWarrantyEmail === true && invoice.status === 'paid' && !invoice.labelEmailSentAt;

  let emailed = false;
  if (shouldSend) {
    try {
      const { sendWarrantyEmail } = await import('./invoiceWarrantyMail.js');
      const result = await sendWarrantyEmail(invoice);
      emailed = result.delivered === true;
      // Stamped only on a real send. Stamping on a failure would burn the one
      // chance this invoice has to reach the customer.
      if (emailed) invoice.labelEmailSentAt = new Date();
    } catch {
      // A mail failure must not fail the status change - the same rule the
      // ticket notifier follows. The caller is told through `emailed`.
      emailed = false;
    }
  }

  await invoice.save();

  // The shaped label goes back so the screen can repaint the pill without a
  // second round trip; `emailed` is the half it could not work out for itself.
  return {
    cleared: false,
    emailed,
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
