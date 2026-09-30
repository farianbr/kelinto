import mongoose from 'mongoose';

/**
 * The audit trail (ERP rework §7.5, §6.15 category 6, phase 11b).
 *
 * Money and stock both move through this panel and several staff now touch it,
 * so **"who changed this" has to be answerable**. Phases 8, 9 and 10 each
 * recorded the same gap - a role edit, a referral rate change and a credit
 * allocation all happened with no actor on record. This closes it.
 *
 * **One collection, two screens.** `kind` separates them: `activity` is what
 * staff did to records, `security` is what happened to accounts and sessions.
 * They are one collection because they are the same row shape and the same
 * retention question, and because a single write path is far harder to
 * accidentally bypass than two.
 *
 * **Append-only, by construction and by intent.** There is no update path, no
 * delete route, and the schema has no field a staff member could edit. §6.15 is
 * explicit that neither screen ever deletes from the UI. A log that the person
 * being logged can edit is not evidence of anything.
 *
 * **Never let auditing break the thing being audited.** `record()` swallows its
 * own failures: an allocation that succeeded must not be reported as failed
 * because the log write lost a race. A missing audit row is a gap; a refused
 * payment that actually went through is a much worse problem.
 */

/** What a row can be about. Free-form would make the entity filter useless. */
const AUDIT_ENTITIES = [
  'user',
  'staff',
  'role',
  'order',
  'invoice',
  'product',
  'taxonomy',
  'invoiceStatusRule',
  'supplier',
  'purchaseOrder',
  'expense',
  'quote',
  'rma',
  'offer',
  'business',
  'campaign',
  'settings',
  'referral',
  'storeCredit',
  'session',
  // A phone bought from a customer, and the stock unit it became.
  'buyback',
  'preowned',
];

const auditLogSchema = new mongoose.Schema(
  {
    /**
     * Which log this row belongs to.
     *
     * `security` is admin-only on the read side (§6.15) - sign-in failures name
     * accounts and addresses, which is exactly the material that helps somebody
     * who is guessing at them.
     */
    kind: { type: String, enum: ['activity', 'security'], required: true, index: true },

    /**
     * Which population the actor belongs to.
     *
     * **An actor is not always a `User`.** A platform operator stepping into a
     * business for support is a `SuperAdmin`, and the whole point of logging
     * that is that the business's owner can see it happened - so the row has to
     * be able to say *what kind of account* acted, not merely which id.
     * Without this the two are indistinguishable, and an impersonation would
     * read as though a member of the owner's own staff did it, which is worse
     * than not logging it at all.
     *
     * `system` covers what no person did: a scheduled job, a status rule
     * firing, a webhook. Those genuinely have no actor, and calling them
     * `user` would be a lie in the other direction.
     */
    actorKind: {
      type: String,
      enum: ['user', 'superadmin', 'system'],
      default: 'user',
      index: true,
    },

    /**
     * Who did it. Null for an unauthenticated event - a failed sign-in on an
     * address that does not exist has no actor, and inventing one would be a
     * lie about who was there.
     *
     * **No `ref`, deliberately.** It pointed at `User`, which is exactly what
     * made a super-admin actor unrepresentable. `actorKind` names the
     * collection instead; a populate that could resolve to one of three
     * collections is not something Mongoose can express, and the denormalised
     * fields below mean nothing needs to resolve it anyway.
     */
    actor: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    // Denormalised so a row still reads correctly after the account is renamed
    // or removed. An audit row must not depend on a join that can disappear.
    actorEmail: { type: String, default: '' },
    actorName: { type: String, default: '' },
    actorRole: { type: String, default: '' },

    /** A stable verb: `invoice.void`, `role.update`, `auth.login_failed`. */
    action: { type: String, required: true, index: true },

    entity: {
      kind: { type: String, enum: AUDIT_ENTITIES, required: true },
      // A string rather than an ObjectId: some entities are addressed by number
      // (`INV-1043`) or are singletons (`settings`), and a log that can only
      // reference one identifier shape cannot describe the whole panel.
      id: { type: String, default: '' },
      label: { type: String, default: '' },
    },

    /**
     * What changed, as the changed fields only - never whole documents.
     *
     * A full before/after would put password hashes, tokens and provider
     * secrets into a table two screens can read. `diff()` below builds these,
     * and `REDACTED_KEYS` is what keeps them out.
     */
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },

    /** Human-readable summary, so the list is legible without expanding a row. */
    description: { type: String, default: '' },

    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The two screens both read newest-first, filtered by kind. Compound so the
// sort is served by the same index as the filter.
auditLogSchema.index({ kind: 1, createdAt: -1 });
auditLogSchema.index({ 'entity.kind': 1, 'entity.id': 1, createdAt: -1 });

/**
 * Field names whose values never reach the log, at any depth.
 *
 * The audit trail is readable by anyone with `settings: view`, so a diff that
 * faithfully recorded a password hash would be a credential store with a
 * search box. §6.15's rule for provider secrets - never returned to a client,
 * not even to an admin - would mean nothing if the audit row carried the value.
 */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'passwordConfirm',
  'token',
  'secret',
  'apiKey',
  'accessToken',
  'refreshToken',
  'authToken',
  'sessionToken',
  'creditCard',
  'cardNumber',
  'cvv',
]);

const isRedacted = (key) => REDACTED_KEYS.has(key) || /password|secret|token|apikey/i.test(key);

/** Cheap deep-equality for diffing. Values here are JSON-shaped by definition. */
function sameValue(a, b) {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) {
    return new Date(a ?? 0).getTime() === new Date(b ?? 0).getTime();
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * The changed fields between two documents, redacted.
 *
 * Returns `null` when nothing changed, so a caller can skip writing a row that
 * would say "somebody saved this and altered nothing" - a log full of those is
 * a log nobody reads.
 */
function diff(before = {}, after = {}, { fields } = {}) {
  const keys = fields ?? [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];

  const changedBefore = {};
  const changedAfter = {};
  let changed = false;

  for (const key of keys) {
    if (key === '_id' || key === '__v' || key === 'updatedAt') continue;

    const from = before?.[key];
    const to = after?.[key];
    if (sameValue(from, to)) continue;

    changed = true;
    if (isRedacted(key)) {
      // Recorded as having changed, without saying to what. "The password was
      // changed at 14:02 by this admin" is the useful half; the value is not.
      changedBefore[key] = '[redacted]';
      changedAfter[key] = '[redacted]';
    } else {
      changedBefore[key] = from ?? null;
      changedAfter[key] = to ?? null;
    }
  }

  return changed ? { before: changedBefore, after: changedAfter } : null;
}

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

export { AUDIT_ENTITIES, diff, AuditLog };
export default AuditLog;
