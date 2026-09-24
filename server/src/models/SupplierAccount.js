import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * A supplier's identity on the platform - one login, every business they supply.
 *
 * ## Why this exists beside `Supplier`
 *
 * `Supplier` lives in each business's own database and is the RELATIONSHIP:
 * this business's payment terms with them, the component types this business
 * buys from them, the agreements they signed with this business, and every bid
 * and purchase order hangs off it. That is right and stays.
 *
 * What was wrong was putting the LOGIN there too. A company supplying two
 * businesses on the platform had two unrelated accounts with two passwords, and
 * on the shared admin host (`app.<platform>/supplier`), where no host names a
 * business, sign-in could only look in the default business's database. This
 * is the one login above all of them; `links` says which relationships it opens.
 *
 * ## Links, and why they start as invitations
 *
 * A business sending portal access to an address that already has an account
 * does not get to attach itself silently: the link starts `invited`, and the
 * supplier accepts or declines it in the portal. Being on a business's supplier
 * list means receiving its requests for quote and its agreements - that is the
 * supplier's call to make, not something another company does to them.
 *
 * `supplier` is the `Supplier` document's id **in that business's database** -
 * it means nothing without `business` beside it, which is why the two are
 * always read together.
 */
const linkSchema = new mongoose.Schema(
  {
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['invited', 'active', 'declined'], default: 'invited' },
    invitedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date, default: null },
  },
  { _id: false },
);

const supplierAccountSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Never selected by default, for the reason `User.passwordHash` is not.
    passwordHash: { type: String, select: false },

    // The company and the person, as the supplier states them. Each business
    // keeps its own copy on its `Supplier` record, which is what it prints.
    name: { type: String, trim: true, default: '' },
    contactName: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },

    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },

    // Reset: only the hash of the emailed token is stored, and `resetTokenAt`
    // is the EXPIRY, checked on use.
    resetTokenHash: { type: String, select: false },
    resetTokenAt: { type: Date, select: false },

    links: { type: [linkSchema], default: [] },
  },
  { timestamps: true },
);

supplierAccountSchema.index({ 'links.business': 1 });

supplierAccountSchema.methods.setPassword = async function setPassword(password) {
  this.passwordHash = await bcrypt.hash(String(password), 10);
};

supplierAccountSchema.methods.verifyPassword = function verifyPassword(password) {
  return bcrypt.compare(String(password ?? ''), this.passwordHash ?? '');
};

/** The link to one business, or null. */
supplierAccountSchema.methods.linkFor = function linkFor(businessId) {
  if (!businessId) return null;
  return this.links.find((link) => String(link.business) === String(businessId)) ?? null;
};

const SupplierAccount = mongoose.model('SupplierAccount', supplierAccountSchema);

export { SupplierAccount };
export default SupplierAccount;
