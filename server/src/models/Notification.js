import mongoose from 'mongoose';

/**
 * Admin notifications (ERP rework §7.3, §6.15, phase 12c).
 *
 * **Only half the bell lives in this collection, and that is deliberate.** §7.3
 * names eight sources, and they are two different kinds of fact:
 *
 * - *Events* - a registration, an order, an accepted quote, a new RMA. These
 *   happened at an instant and stay true forever. They are rows here.
 * - *Standing conditions* - an invoice is overdue, a product is low or out of
 *   stock, a PO is late, an account is still waiting for approval. These are
 *   **true right now and can stop being true** without anybody touching the
 *   bell.
 *
 * A stored row for a standing condition goes stale the moment the invoice is
 * paid or the shelf is restocked, and then the panel is telling a staff member to
 * chase money that already arrived. Keeping them in sync would mean a delete
 * hook on every payment, receipt and stock movement - eight more places to
 * forget. So `notificationService` derives those four from the live records at
 * read time and this collection never sees them. The dropdown merges both and
 * the caller cannot tell them apart.
 *
 * **Read state is per admin, not per row.** `readBy` is an array of accounts
 * rather than a boolean, because one order is one event that several staff each
 * see separately - a boolean would let whoever opened the bell first mark it
 * read for everyone. Same reason `clearedBy` is a list: `Clear All` is a
 * personal action, not a shared one.
 *
 * **Never let a notification break the thing being notified about.** `emit()`
 * swallows its own failures exactly as `auditService.record()` does: an order
 * that was placed and paid must not be reported as failed because the bell
 * write lost a race.
 */

/**
 * The event sources. The four standing conditions (`invoice_overdue`,
 * `reorder_queue`, `po_overdue`, `pending_approval`) are deliberately absent
 * they are derived, never written, and listing them here would invite somebody
 * to `emit()` one.
 *
 * `reorder_queue` replaced a per-product `low_stock` / `out_of_stock` pair: one
 * row carrying the counts and the action that answers them, rather than forty
 * rows restating one fact with no door out. Neither of the old types is emitted
 * any more, and neither was ever stored - they were derived too.
 *
 * `new_registration` and the derived `pending_approval` overlap on purpose and
 * are not the same fact: this one records that an account *was created*, which
 * stays true forever; the derived one records that it is *still waiting*, which
 * stops the moment an admin answers. `notificationService.list()` hides this row
 * while its derived twin is present so one account never occupies two lines.
 */
const NOTIFICATION_TYPES = [
  'new_registration',
  // A business applying to SELL to Cellvix, from the storefront sign-up. Kept
  // apart from `new_registration` because it is not an account and does not
  // route to the approvals queue: it lands in Suppliers as an inactive record
  // for the purchasing team to review.
  'supplier_application',
  /**
   * The three things a supplier does from the portal, against a purchase order
   * they were asked to price. All arrive from **outside** the panel, which is
   * exactly the class of event nobody discovers on their own.
   *
   * They are events, not standing conditions: "they quoted on Tuesday" stays
   * true forever, unlike "this PO is late", which stops being true the moment
   * it arrives and is therefore derived rather than stored (see the note above).
   */
  'po_quoted',
  'po_proforma',
  'po_delivery',
  'new_order',
  'quote_accepted',
  'new_rma',
  // A customer sold us a phone at the kiosk and it is waiting to be priced.
  'new_buyback',
];

/** Tints the row (§6.15): `danger` for out of stock, `warn` for low stock. */
const NOTIFICATION_SEVERITIES = ['info', 'success', 'warn', 'danger'];

const notificationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: NOTIFICATION_TYPES, required: true, index: true },
    severity: { type: String, enum: NOTIFICATION_SEVERITIES, default: 'info' },

    /** One line, already written. The dropdown renders text, not a template. */
    title: { type: String, required: true },
    detail: { type: String, default: '' },

    /**
     * What it is about, in the shape `AuditLog.entity` uses - a string id,
     * because some records are addressed by number (`INV-1043`) and a field
     * that only holds an ObjectId cannot describe the whole panel.
     */
    entity: {
      kind: { type: String, required: true },
      id: { type: String, default: '' },
      label: { type: String, default: '' },
    },

    /** Where the row links. Stored rather than rebuilt, so a route rename does
     * not silently strand old rows on a 404 the reader blames on the record. */
    href: { type: String, default: '' },

    /**
     * The permission area that gates this row (§7.3: role-filtered - a
     * warehouse role sees stock and PO alerts, not overdue invoices).
     *
     * Stamped at write time and read by the service. It is a `PERMISSION_AREAS`
     * value, kept as a plain string rather than an enum so this model does not
     * import from `shared/` - the service validates what it emits.
     */
    area: { type: String, required: true, index: true },

    /** Per-admin read state. Absent from the array means unread for that account. */
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    /**
     * Per-admin dismissal. `Clear All` writes here rather than deleting the
     * row: the same event is still unread for every other admin, and one
     * person tidying their bell must not erase somebody else's queue.
     */
    clearedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The dropdown reads newest-first, filtered to the areas this caller may see.
notificationSchema.index({ area: 1, createdAt: -1 });
notificationSchema.index({ createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

export { NOTIFICATION_TYPES, NOTIFICATION_SEVERITIES, Notification };
export default Notification;
