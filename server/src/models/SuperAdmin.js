import mongoose from 'mongoose';

/**
 * A platform-level operator (SAAS_PLATFORM §1, §4.5).
 *
 * **Its own collection, never a `User.role`** - the same argument that put
 * supplier logins on `Supplier`, one level up and with more at stake. A fifth
 * `User.role` would mean every `requireAuth` route in the application silently
 * gained a population that can see across tenants, and the only thing stopping
 * that would be having audited each route. Here the guarantee is structural:
 * `middleware/auth.js` resolves its subject in `User`, where no super admin
 * exists, so a token minted for this collection satisfies nothing on the tenant
 * side. The reverse holds too - `requireSuperAdmin` refuses a subject that is
 * not a live super admin.
 *
 * **A super admin has no row in any business.** They create tenants, grant
 * slots and toggle features; they do not raise invoices or read a customer
 * record, because those belong to a business and this account belongs to the
 * platform.
 *
 * `select: false` on the hash for the reason `User.passwordHash` has it: a
 * serializer that forgets to strip a field it never loaded cannot leak it.
 */

const superAdminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    passwordHash: { type: String, required: true, select: false },

    /**
     * A deactivated super admin cannot sign in, and the check runs on every
     * request rather than only at sign-in - a token stays validly signed until
     * it expires, so revoking access has to bite immediately.
     */
    isActive: { type: Boolean, default: true, index: true },

    lastLoginAt: Date,

    /**
     * A password reset in flight: the sha256 of the emailed token and when it
     * stops working. The link is the only copy of the secret, as for `User`.
     */
    resetTokenHash: { type: String, select: false },
    resetTokenAt: { type: Date, select: false },

    /**
     * Sessions issued before this moment are refused. Set by a password reset,
     * so taking back a stolen password also ends the sessions it opened.
     */
    sessionsValidFrom: Date,
  },
  { timestamps: true },
);

superAdminSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    isActive: this.isActive,
    lastLoginAt: this.lastLoginAt ?? null,
    createdAt: this.createdAt,
  };
};

const SuperAdmin = mongoose.model('SuperAdmin', superAdminSchema);

export { SuperAdmin };
export default SuperAdmin;
