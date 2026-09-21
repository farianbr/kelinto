import mongoose from 'mongoose';

import { db } from '../db/models.js';
import ApiError from '../utils/ApiError.js';
import '../models/Taxonomy.js';
import '../models/Product.js';
import '../models/Service.js';
import '../models/Quote.js';
import '../models/Ticket.js';
import '../models/Invoice.js';
import '../models/InvoiceLabel.js';
// Direct imports, not `db()`: `invoiceStatusService` reads these models the same
// way, and a `db().InvoiceStatusRule` resolves to nothing at all - which reads
// as 'rule not found' rather than as a wiring mistake.
import InvoiceStatusRule, { InvoiceStatusRun } from '../models/InvoiceStatusRule.js';
import '../models/Expense.js';
import '../models/ExpenseCategory.js';
import '../models/Offer.js';
import '../models/Order.js';
import '../models/DeviceCatalog.js';

/**
 * What a delete would actually take with it.
 *
 * ## Why this exists
 *
 * Every delete in this system already knows its own impact - `deleteService`
 * counts the quotes and tickets using it, `deleteLabel` counts the invoices,
 * `taxonomyAdminService.remove` counts products and children. But each computes
 * that count **at delete time**, so a staff member presses Delete and only then
 * learns that the category was deactivated instead, or that the entry could not
 * be removed at all.
 *
 * That is the wrong order. The decision needs the facts, so this is the same
 * arithmetic asked a moment earlier, and the confirm dialog shows it before
 * anybody commits.
 *
 * ## One endpoint, a registry, not 28 routes
 *
 * Each record type contributes one entry: how to find it, what to call it, and
 * what to count. A new deletable type is a few lines here rather than a new
 * controller, a new route and a new client hook - and, more to the point, the
 * shape of the answer stays identical across every screen, so one dialog can
 * render all of them.
 *
 * ## The answer is advisory, never the authority
 *
 * The delete itself keeps its own guards. This tells a person what will happen;
 * `deleteService` and friends still decide what may happen, and they re-check
 * at the moment of the write. Between a preview and a confirm somebody else can
 * raise a ticket against the service being deleted, and the guard is what
 * catches that - not a count taken seconds earlier.
 */

/**
 * `blocks: true` means the delete will be refused outright.
 * `blocks: false` means it proceeds, and this row is a consequence to read.
 */
function impact({ count, singular, plural, blocks = false, note }) {
  if (!count) return null;
  return {
    count,
    label: `${count} ${count === 1 ? singular : plural}`,
    blocks,
    note,
  };
}

const TYPES = {
  /**
   * A taxonomy node, and the two things that stop it going.
   *
   * Both block, and both are real structure rather than clutter: a node with
   * children holds a branch up, and one with products behind it is what their
   * denormalised `path` points at.
   */
  taxonomy: {
    label: 'device entry',
    async load(id) {
      const node = await db().Taxonomy.findById(id).lean();
      if (!node) return null;
      return { name: node.name, node };
    },
    async impacts({ node }) {
      const [children, products] = await Promise.all([
        db().Taxonomy.countDocuments({ parent: node._id }),
        db().Product.countDocuments({
          isActive: true,
          $or: [
            { deviceTypeSlug: node.slug },
            { brandSlug: node.slug },
            { seriesSlug: node.slug },
            { modelSlug: node.slug },
          ],
        }),
      ]);

      return [
        impact({
          count: children,
          singular: 'entry underneath it',
          plural: 'entries underneath it',
          blocks: true,
          note: 'Remove or move those first.',
        }),
        impact({
          count: products,
          singular: 'product uses it',
          plural: 'products use it',
          blocks: true,
          note: 'Deactivate it instead - deleting it would leave those products pointing at nothing.',
        }),
      ];
    },
  },

  service: {
    label: 'service',
    async load(id) {
      const service = await db().Service.findById(id).lean();
      if (!service) return null;
      return { name: service.name, service };
    },
    async impacts({ service }) {
      const [quotes, tickets] = await Promise.all([
        // The same paths `serviceCatalogService.usageCount` counts: a service
        // is attached per DEVICE on a quote or ticket, not to a flat line list.
        db().ServiceQuote.countDocuments({ 'devices.services.service': service._id }),
        db().Ticket.countDocuments({ 'devices.services.service': service._id }),
      ]);

      return [
        impact({
          count: quotes,
          singular: 'quote has it',
          plural: 'quotes have it',
          blocks: true,
        }),
        impact({
          count: tickets,
          singular: 'ticket has it',
          plural: 'tickets have it',
          blocks: true,
          note: 'Deactivate it instead - it stops appearing on new work and the history stays readable.',
        }),
      ];
    },
  },

  /**
   * An expense category, and the one type here that does NOT block.
   *
   * `deleteExpenseCategory` deactivates a category in use rather than refusing
   * it, which is the right behaviour and the most surprising: the button says
   * Delete and the record survives. Saying so first is most of the value of
   * this whole feature.
   */
  'expense-category': {
    label: 'expense category',
    async load(id) {
      const category = await db().ExpenseCategory.findById(id).lean();
      if (!category) return null;
      return { name: category.name, category };
    },
    async impacts({ category }) {
      const expenses = await db().Expense.countDocuments({ category: category._id });

      return [
        impact({
          count: expenses,
          singular: 'expense is filed under it',
          plural: 'expenses are filed under it',
          note: 'It will be deactivated rather than deleted, so those expenses keep their category.',
        }),
      ];
    },
  },

  'invoice-label': {
    label: 'invoice status',
    async load(id) {
      const label = await db().InvoiceLabel.findById(id).lean();
      if (!label) return null;
      return { name: label.name, label };
    },
    async impacts({ label }) {
      const invoices = await db().Invoice.countDocuments({ label: label._id });

      return [
        impact({
          count: invoices,
          singular: 'invoice is set to it',
          plural: 'invoices are set to it',
          blocks: true,
          note: 'Retire it instead - it stops appearing in the picker and those invoices stay readable.',
        }),
      ];
    },
  },

  /**
   * A time-lapse invoice message.
   *
   * Nothing blocks it: the rule is a template, and an invoice that already
   * received it keeps the message that was sent. What is worth saying is that
   * the send history goes, because that is what stops it being re-sent.
   */
  'invoice-rule': {
    label: 'invoice message',
    async load(id) {
      const rule = await InvoiceStatusRule.findById(id).lean();
      if (!rule) return null;
      return { name: rule.label, rule };
    },
    async impacts({ rule }) {
      // `InvoiceStatusRun` is the once-per-invoice ledger - the rule itself
      // carries no counter, and the unique index on (rule, invoice) is what
      // makes this the true number of sends.
      const sent = await InvoiceStatusRun.countDocuments({ rule: rule._id, status: 'sent' });

      return [
        impact({
          count: sent,
          singular: 'invoice has already received it',
          plural: 'invoices have already received it',
          note: 'Those messages stay sent. Deleting this only stops it going out again.',
        }),
      ];
    },
  },

  offer: {
    label: 'discount code',
    async load(id) {
      const offer = await db().Offer.findById(id).lean();
      if (!offer) return null;
      return { name: offer.title, offer };
    },
    async impacts({ offer }) {
      // Orders that were placed with this code. They keep their own snapshot of
      // what was discounted, so this is history rather than a blocker.
      // Matched on the offer id rather than its code: a code can be renamed,
      // and the order stores which offer it was.
      const orders = await db().Order.countDocuments({ 'promo.offer': offer._id });

      return [
        impact({
          count: orders,
          singular: 'order used this code',
          plural: 'orders used this code',
          note: 'Those orders keep the discount they were given - the amount is stored on the order.',
        }),
      ];
    },
  },

  device: {
    label: 'device',
    async load(id) {
      const device = await db().DeviceCatalog.findById(id).lean();
      if (!device) return null;
      return { name: device.name, device };
    },
    async impacts({ device }) {
      const children = await db().DeviceCatalog.countDocuments({ parent: device._id });

      return [
        impact({
          count: children,
          singular: 'entry underneath it',
          plural: 'entries underneath it',
          blocks: true,
          note: 'Remove or move those first.',
        }),
      ];
    },
  },
};

/**
 * What deleting one record would do.
 *
 * Returns the record's own name - so the dialog can name it rather than saying
 * "this item" - plus the impacts, and whether any of them refuses the delete.
 */
async function preview(type, id) {
  const entry = TYPES[type];
  if (!entry) {
    throw ApiError.badRequest(`There is no delete preview for “${type}”.`, 'UNKNOWN_PREVIEW_TYPE');
  }
  if (!mongoose.isValidObjectId(id)) {
    throw ApiError.notFound('Not found.', 'PREVIEW_NOT_FOUND');
  }

  const loaded = await entry.load(id);
  if (!loaded) throw ApiError.notFound('Not found.', 'PREVIEW_NOT_FOUND');

  const impacts = (await entry.impacts(loaded)).filter(Boolean);

  return {
    type,
    id,
    name: loaded.name,
    typeLabel: entry.label,
    impacts,
    // One `blocks` row is enough to refuse the whole delete, and the dialog
    // switches from "are you sure" to "you cannot, here is why".
    blocked: impacts.some((row) => row.blocks),
  };
}

export { preview, TYPES };
export default { preview, TYPES };
