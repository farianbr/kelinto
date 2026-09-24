import mongoose from 'mongoose';

/**
 * One episode of a platform operator working inside a tenant's business
 * (SAAS_PLATFORM §4.5, §6 phase 16).
 *
 * **Control plane, not the business database.** The row is evidence *about* the
 * platform's own conduct, so it must survive the business being suspended,
 * deleted or migrated - a record of who entered a business that vanishes when
 * that business does is not a record. The business's own `AuditLog` gets the
 * matching entry-and-exit pair, and that is the copy the owner reads; this is
 * the copy the platform answers for.
 *
 * **The token is not stored, only its lifetime.** Every check that matters
 * expiry, revocation, which business - is re-read from this document on each
 * request, so a signed token that outlives its grant is refused. Storing the
 * token itself would add a second thing to keep in step with no gain: the JWT
 * already carries its own signature, and a stolen one is defeated by revoking
 * the grant, not by comparing strings.
 *
 * **`endedAt` is set on the way out, and never on the way in.** An open row is
 * therefore a staff member who is inside a business *right now*, which is the
 * question the console most needs to answer and the one a "sessions" screen
 * built from tokens could never answer honestly.
 */

/** How long a grant may run before it has to be renewed deliberately. */
const IMPERSONATION_MINUTES = 60;

/** The cap a staff member may request. An eight-hour grant is a standing key. */
const IMPERSONATION_MAX_MINUTES = 240;

const impersonationGrantSchema = new mongoose.Schema(
  {
    /**
     * Who went in. A `SuperAdmin`, never a `User` - the whole point is that
     * this actor belongs to the platform rather than to the business.
     */
    superAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SuperAdmin',
      required: true,
      index: true,
    },
    // Denormalised for the same reason the audit row denormalises its actor: a
    // staff member who leaves the company must not take the legibility of the
    // record with them.
    superAdminName: { type: String, default: '' },
    superAdminEmail: { type: String, default: '' },

    /** Which business was entered, and which tenant owns it. */
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
      index: true,
    },
    businessName: { type: String, default: '' },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true },

    /**
     * Why. Free text, required, and never defaulted to something like
     * "support" - a reason nobody had to type is a field that reads as
     * completed while carrying no information.
     */
    reason: { type: String, required: true, trim: true, maxlength: 500 },

    startedAt: { type: Date, default: Date.now, index: true },

    /**
     * When the grant stops being honoured.
     *
     * Checked on every request rather than trusted from the token's own `exp`,
     * because the two can disagree: revoking a grant shortens this, and a token
     * already in a browser keeps its original expiry regardless.
     */
    expiresAt: { type: Date, required: true, index: true },

    /** Set when the staff member leaves, or when the grant is revoked. Null = live. */
    endedAt: { type: Date, default: null },

    /** `left` is the staff member closing it; `revoked` is somebody else closing it. */
    endedReason: {
      type: String,
      enum: ['left', 'revoked', 'expired', null],
      default: null,
    },

    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },

    /**
     * The one handoff this grant may still be claimed with, when the console
     * and the panel are on different hosts.
     *
     * A cookie set on the console's host is never sent to the panel's, so
     * stepping in mints a short-lived token and the panel host claims it. The
     * id is stored here and cleared atomically on the claim, which is what
     * makes the link single-use: replaying it finds nothing to match.
     */
    handoffJti: { type: String, default: null },
  },
  { timestamps: true },
);

// The console reads "who is inside something right now" and "what happened in
// this business", and both want newest first.
impersonationGrantSchema.index({ endedAt: 1, expiresAt: -1 });
impersonationGrantSchema.index({ business: 1, startedAt: -1 });

/**
 * Whether this grant still authorises anything.
 *
 * A method rather than a stored flag: a grant expires by the clock passing it,
 * and nothing writes a row at that moment. A boolean field would be correct
 * only until the next minute.
 */
impersonationGrantSchema.methods.isLive = function isLive() {
  return !this.endedAt && this.expiresAt > new Date();
};

impersonationGrantSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    superAdmin: this.superAdmin?.toString() ?? null,
    superAdminName: this.superAdminName,
    superAdminEmail: this.superAdminEmail,
    business: this.business?.toString() ?? null,
    businessName: this.businessName,
    tenant: this.tenant?.toString() ?? null,
    reason: this.reason,
    startedAt: this.startedAt,
    expiresAt: this.expiresAt,
    endedAt: this.endedAt,
    endedReason: this.endedReason,
    live: this.isLive(),
    ip: this.ip,
  };
};

const ImpersonationGrant = mongoose.model('ImpersonationGrant', impersonationGrantSchema);

export { IMPERSONATION_MINUTES, IMPERSONATION_MAX_MINUTES, ImpersonationGrant };
export default ImpersonationGrant;
