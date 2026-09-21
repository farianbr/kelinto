import mongoose from 'mongoose';
import { MESSAGE_CHANNELS } from './MessageLog.js';

/**
 * Reusable message bodies (ERP rework §6.13, §8, §6.15).
 *
 * Not on the §6b register, deliberately: templates are **fully functional on
 * email from day one**, because email works in this codebase. A template picked
 * on the SMS screen fills the textarea perfectly well - it is the *sending*
 * that waits on Twilio, not the text. So this is a real feature with one
 * channel's delivery pending, rather than a UI-only surface.
 *
 * `document` optionally ties a template to a record type, which is what lets
 * the quote and invoice screens offer "the ones that make sense here" instead
 * of the whole list.
 */

/**
 * The records a template can be attached to.
 *
 * `ticket` was missing until 2026-09-21, which made the list a wholesaler's:
 * orders, invoices, quotes and returns. A repair shop messages its customers
 * about TICKETS more than anything else - that is the record a device moves
 * through - so a notification screen offering every document except that one
 * could not express its main case.
 */
const TEMPLATE_DOCUMENTS = ['none', 'ticket', 'order', 'invoice', 'quote', 'rma'];

/**
 * Placeholders a body may contain. Substitution is literal and total - an
 * unknown token is left as written rather than replaced with an empty string,
 * so a typo shows up in the preview as `{{bussiness}}` instead of silently
 * sending a sentence with a hole in it.
 */
const TEMPLATE_TOKENS = [
  { token: '{{businessName}}', label: "The customer's company" },
  { token: '{{contactName}}', label: 'Contact name' },
  { token: '{{email}}', label: 'Email address' },
  // Was labelled "Cellvix", which is the wholesaler rather than the sender.
  // On CellShoppe this resolves to CellShoppe, and a label naming another
  // business is how the wrong company ends up in a customer-facing message.
  { token: '{{shopName}}', label: 'This business' },
  { token: '{{ticketNumber}}', label: 'Ticket number' },
  { token: '{{invoiceNumber}}', label: 'Invoice number' },
  { token: '{{status}}', label: 'Current status' },
  { token: '{{amount}}', label: 'Amount due' },
];

const messageTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    channel: { type: String, enum: MESSAGE_CHANNELS, required: true, index: true },
    document: { type: String, enum: TEMPLATE_DOCUMENTS, default: 'none' },

    /**
     * The status this message belongs to, within its document.
     *
     * **One message per status, per channel.** A repair shop does not keep a
     * bag of loosely-named templates; it keeps the thing it says when a
     * ticket reaches Diagnosis, and the thing it says when it reaches Ready
     * to Pickup. Storing the status turns a free-form list into that grid,
     * and it is what lets a status change look up its own message rather
     * than asking a staff member to pick one.
     *
     * Free text rather than an enum, because the statuses differ per document
     * (a ticket has Diagnosis, an invoice does not) and a business may add
     * its own. Empty means a general template tied to no status, which is
     * every template written before this field existed.
     */
    status: { type: String, trim: true, maxlength: 60, default: '', index: true },

    // Email only; ignored on the other channels rather than being conditionally
    // required, because a template that changes channel should not lose text.
    subject: { type: String, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 5000 },

    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

messageTemplateSchema.index({ channel: 1, isActive: 1 });

/**
 * One message per status, per document, per channel.
 *
 * Partial, so the general templates - the ones carrying no status - are not
 * forced to be unique against each other: a shop may keep several unattached
 * email templates, and only the status-bound ones form a grid with one cell
 * each. Each business owns its own database, so the scope is structural and
 * needs no business key here.
 */
messageTemplateSchema.index(
  { channel: 1, document: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $gt: '' } },
  },
);

/**
 * Fills a body against one account. Unknown tokens survive untouched - see the
 * note on TEMPLATE_TOKENS.
 *
 * `context` carries what the account cannot: which business is sending, and
 * the record the message is about. **The shop name is passed in rather than
 * hardcoded** - this said 'Cellvix' for every business, so a CellShoppe
 * customer was told their Cellvix repair was ready. A caller that supplies
 * nothing gets an empty string, which is a visible gap rather than another
 * company's name.
 */
messageTemplateSchema.statics.render = function render(body, user, context = {}) {
  const values = {
    '{{businessName}}': user?.businessName ?? '',
    '{{contactName}}': user?.contactName ?? '',
    '{{email}}': user?.email ?? '',
    '{{shopName}}': context.shopName ?? '',
    '{{ticketNumber}}': context.ticketNumber ?? '',
    '{{invoiceNumber}}': context.invoiceNumber ?? '',
    '{{status}}': context.status ?? '',
    '{{amount}}': context.amount ?? '',
    // Kept so bodies written before `{{shopName}}` existed still resolve.
    '{{companyName}}': context.shopName ?? '',
  };

  return String(body ?? '').replace(
    /\{\{\s*\w+\s*\}\}/g,
    (match) => values[match.replace(/\s/g, '')] ?? match,
  );
};

const MessageTemplate = mongoose.model('MessageTemplate', messageTemplateSchema);

export { TEMPLATE_DOCUMENTS, TEMPLATE_TOKENS, MessageTemplate };
export default MessageTemplate;
