import mongoose from 'mongoose';

/**
 * Where a panel account lives, so the shared admin login can find it
 * (CONSOLIDATE_AND_ROUTING §1).
 *
 * ## The problem this solves
 *
 * `User` is a per-business collection: a staff member's account, password hash
 * and role live inside their business's own database. Signing in used to work
 * because the HOST named the business before anybody typed a password - the
 * login form on `cellshoppe.<platform>` could only mean CellShoppe.
 *
 * The admin panel moves to one host for every tenant (`app.<platform>`), and
 * that host names no business. Without this collection the login would search
 * the default business only, and every other business's staff would be told
 * their password was wrong.
 *
 * ## What it holds, and what it does not
 *
 * **An address and a pointer. Never a password, never a role.** The hash stays
 * in the business database with the account; login reads this to learn which
 * databases to look in, then verifies the password there. A leak of the control
 * plane reveals which addresses work where, not how to get in.
 *
 * **Panel accounts only** - `staff`, and the older business-database `admin`.
 * A buyer signs in on their own storefront host, which already names the
 * business, and a tenant admin already lives in the control plane.
 *
 * ## Keyed on where the account is STORED
 *
 * `business` is the database that holds the `User` document, not
 * `User.business`. The two can differ - `createStaff` saves into the current
 * request's database and lets the form name a different business - and login
 * needs the one it can actually open.
 *
 * ## One address, several businesses
 *
 * Allowed and expected: somebody working two shifts at two businesses of the
 * same tenant, or at two tenants, has two accounts. Login asks which one only
 * when the password is right for more than one.
 */
const loginEntrySchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { timestamps: true },
);

// One entry per account. The pair is the identity; the email is what changes.
loginEntrySchema.index({ business: 1, user: 1 }, { unique: true });

const LoginEntry = mongoose.model('LoginEntry', loginEntrySchema);

export { LoginEntry };
export default LoginEntry;
