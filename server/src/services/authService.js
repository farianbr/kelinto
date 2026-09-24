import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { controlModels, db } from '../db/models.js';
import '../models/User.js';
import '../models/Supplier.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import referralService from './referralService.js';
import notificationService from './notificationService.js';
import { sendWelcomeEmail, sendPasswordResetEmail } from './welcomeMail.js';
import { displayNameOf } from '../utils/displayName.js';
import { currentBusinessId } from '../db/context.js';
import { businessesFor, inBusinessDb } from './loginDirectory.js';
import { businessConfig } from '../middleware/businessConfigCache.js';

// "Remember me" drives a long-lived cookie so the buyer is auto-signed-in on
// return visits (brief §8.1).
const REMEMBER_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Sign the session cookie.
 *
 * **`biz` names the database that holds the account**, for every account that
 * lives in one. A tenant admin lives in the control plane and carries none.
 *
 * It exists for the shared admin host. There the host names no business, so
 * without the claim every request after sign-in would open the default
 * business's database, fail to find the staff member, and sign them straight
 * back out. `resolveBusiness` reads it before the query string, because an
 * account only exists in the one database it was signed into - a `?business=`
 * naming another could only ever produce "not signed in".
 *
 * Signed, so a client cannot point itself at another database by editing it.
 */
function issueSession(res, user, remember = false, businessId = null) {
  const claims = { sub: user._id.toString(), ...(businessId ? { biz: String(businessId) } : {}) };
  const token = jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: remember ? '90d' : env.JWT_EXPIRES_IN,
  });

  res.cookie(env.COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    // Without "Remember me" this is a SESSION cookie - no maxAge, so the browser
    // drops it on close. It previously carried a 7-day maxAge, which meant both
    // branches survived a restart and the checkbox changed nothing the buyer
    // could observe. The brief makes this control the thing that drives
    // persistence, so unchecked has to mean "do not persist".
    ...(remember ? { maxAge: REMEMBER_MS } : {}),
    path: '/',
  });
}

function clearSession(res) {
  res.clearCookie(env.COOKIE_NAME, { path: '/' });
}

async function register(data, { ip } = {}) {
  const existing = await db().User.findOne({ email: data.email });
  if (existing) {
    throw ApiError.conflict(
      'An account already exists for that email. Try signing in instead.',
      'EMAIL_IN_USE',
    );
  }

  // Resolved before the account is written, so an unrecognised code fails the
  // registration outright rather than creating an account whose referrer was
  // quietly dropped (§6.13). Self-referral is impossible here - this account
  // does not exist yet, so it cannot be its own referrer.
  const referredBy = data.referralCode
    ? await referralService.resolveReferralCode(data.referralCode)
    : null;

  const user = new (db().User)({
    businessName: data.businessName,
    contactName: data.contactName,
    email: data.email,
    phone: data.phone,
    businessType: data.businessType,
    website: data.website,
    taxId: data.taxId,
    // Every new B2B account starts gated. An admin unlocks wholesale pricing.
    status: 'pending',
    role: 'buyer',
    // CASL (§6.13). Opening a wholesale account is implied consent under s.10(9)
    // for messages about the business relationship - recorded explicitly, with
    // its source and the IP it came from, because an implied basis nobody
    // wrote down is one nobody can defend later. The buyer can withdraw it at
    // any time through the unsubscribe link, which sets `unsubscribedAt` and
    // outranks this.
    marketingConsent: { granted: true, source: 'registration', at: new Date(), ip },
    // The narrower question of which channels they actively ticked. Written
    // only when the form sent something: an untouched control must leave the
    // field unset - "never asked" and "asked and declined every channel" are
    // different facts, and the model's read path relies on the difference.
    ...(data.contactConsent
      ? {
          contactConsent: {
            ...data.contactConsent,
            at: new Date(),
            source: 'registration',
          },
        }
      : {}),
    // Set once, at signup, and never editable afterwards (§6.13) - a referrer
    // that can be changed later is a way to redirect money already earned.
    referredBy,
    addresses: data.address
      ? [{ ...data.address, country: data.address.country || 'Canada', isDefaultShipping: true, isDefaultBilling: true }]
      : [],
  });

  await user.setPassword(data.password);
  await user.save();

  // The approvals queue is the one thing in this panel that nobody discovers on
  // their own - a pending account is invisible until somebody opens Clients
  // (§7.3). Emitted after the save, and awaited only to keep ordering tidy
  // `emit` swallows its own failures, because a registration that succeeded
  // must not be reported as failed when the bell write loses a race.
  await notificationService.emit({
    type: 'new_registration',
    severity: 'info',
    title: `${displayNameOf(user)} registered`,
    detail: `${user.contactName} · ${user.email} · awaiting approval`,
    entity: { kind: 'user', id: user._id.toString(), label: displayNameOf(user) },
    href: `/admin/clients/${user._id}`,
  });

  /**
   * No `password` argument: this buyer chose their own, so the message is the
   * confirmation variant with no credentials block. Sending somebody back the
   * password they just typed would put it in an inbox for no reason at all.
   *
   * Fire-and-forget for the same reason as the notification above - a
   * registration that succeeded must not be reported as failed because mail
   * was down.
   */
  await sendWelcomeEmail({ user });

  return user;
}

/**
 * Records a business applying to sell to Cellvix.
 *
 * Creates **no account and no password**: this is an application for the
 * purchasing team, not a login. It lands as a real `Supplier` document so it is
 * reviewed on the screen buyers already use, but with `isActive: false`, which
 * keeps it out of the supplier picker and stops any purchase order being raised
 * against a business nobody has vetted. `appliedAt` is what tells an unreviewed
 * application apart from a supplier that was deliberately deactivated.
 *
 * A repeat application from the same address updates the existing record rather
 * than creating a second one - somebody applying twice is somebody who thinks
 * the first one did not arrive, and two half-identical rows in the review queue
 * help nobody. An already-active supplier is left completely alone: they are
 * onboarded, and a public form must not be able to edit a live supplier.
 */
async function applyAsSupplier(data) {
  const email = String(data.email).toLowerCase().trim();

  const existing = await db().Supplier.findOne({ email });

  // Already trading with us. Answer as though it was recorded - the purchasing
  // team knows them, and telling an anonymous form which businesses are already
  // suppliers is not something this endpoint should do.
  if (existing?.isActive) return { recorded: true };

  const fields = {
    name: data.businessName,
    contactName: data.contactName,
    email,
    phone: data.phone,
    website: data.website || undefined,
    supplies: data.supplies || undefined,
    address: data.address
      ? {
          line1: data.address.line1 || undefined,
          line2: data.address.line2 || undefined,
          city: data.address.city || undefined,
          region: data.address.region || undefined,
          postal: data.address.postal || undefined,
          country: 'CA',
        }
      : undefined,
    isActive: false,
    appliedAt: new Date(),
  };

  const supplier = existing
    ? Object.assign(existing, fields)
    : new (db().Supplier)({ ...fields, paymentTerms: 'net30' });

  await supplier.save();

  // Same reasoning as a new registration: an application nobody is told about
  // sits unread until somebody happens to open the suppliers screen.
  await notificationService.emit({
    type: 'supplier_application',
    severity: 'info',
    title: `${supplier.name} applied to supply`,
    detail: `${supplier.contactName} · ${supplier.email} · awaiting review`,
    entity: { kind: 'supplier', id: supplier._id.toString(), label: supplier.name },
    href: `/admin/suppliers`,
  });

  return { recorded: true };
}

/**
 * Signs a user in.
 *
 * A pending account gets a real session on purpose - the UI needs to show
 * "still under review" rather than a generic credential failure (brief §8.2).
 * Access to pricing and ordering is blocked separately by requireApproved.
 */
/**
 * The account behind an address, for stamping a security-log row (§6.15).
 *
 * **Read-only and never surfaced to the caller.** A failed sign-in returns the
 * same `INVALID_CREDENTIALS` whether or not the address exists - that must not
 * change - but the *log* is allowed to know which account was targeted, because
 * "forty failures against one real account" and "forty failures against
 * addresses that do not exist" are different events and need to look different.
 *
 * Returns null rather than throwing: this is called from a path that is already
 * handling an error, and it must not replace it with its own.
 */
async function findForAudit(email) {
  if (!email) return null;
  try {
    return await db().User.findOne({ email: String(email).toLowerCase().trim() }).lean();
  } catch {
    return null;
  }
}

/**
 * May a tenant admin sign in on this host? Anywhere unpinned; on a business's
 * own panel domain only when their tenant owns that business.
 */
async function adminMaySignInHere(admin, pinned) {
  if (!pinned) return true;
  const business = await businessConfig(pinned);
  if (!business || business.deletedAt) return false;
  const tenant = admin.tenant ? String(admin.tenant) : null;
  return tenant === business.tenantId;
}

/**
 * Every account this address might mean, with the database each one lives in.
 *
 * Three places, because the person typing an address has no way to say which
 * kind of account they hold - and "that email and password do not match" when
 * the account plainly exists is the worst possible answer:
 *
 * 1. **A tenant admin**, in the control plane. One login, every business the
 *    tenant owns. `business` is null: an admin belongs to no one database.
 * 2. **This business's own account**, staff or buyer, in the database the
 *    request resolved to. What a storefront login has always meant.
 * 3. **The login directory** (`services/loginDirectory.js`): every OTHER
 *    business where this address has a panel account. This is what makes the
 *    shared admin host work, where the business the request resolved to is only
 *    the default and a staff member's account is usually somewhere else.
 *
 * **On a business's own panel domain (`pinned`) only that business counts.**
 * Its staff, and a tenant admin whose tenant owns it; never the directory's
 * other businesses, because `app.cellshoppe.ca` signing somebody into another
 * company's panel would be that company's password typed into CellShoppe's page.
 */
async function loginCandidates(email, pinned = null) {
  const candidates = [];

  const admin = await controlModels().User.findOne({ email, role: 'admin' }).select('+passwordHash');
  if (admin && (await adminMaySignInHere(admin, pinned))) {
    candidates.push({ user: admin, business: null });
  }

  const hereId = currentBusinessId();
  const here = await db().User.findOne({ email }).select('+passwordHash');
  if (here) {
    const record = hereId
      ? await controlModels().Business.findById(hereId).select('name code').lean()
      : null;
    candidates.push({ user: here, business: record });
  }

  if (pinned) return candidates;

  for (const business of await businessesFor(email)) {
    // Already covered by step 2 - the same account, not a second one.
    if (hereId && String(business._id) === String(hereId)) continue;
    const found = await inBusinessDb(business, () =>
      db().User.findOne({ email }).select('+passwordHash'),
    );
    if (found) candidates.push({ user: found, business });
  }

  return candidates;
}

/**
 * Sign in.
 *
 * Returns `{ user, business }`: the account, and the business whose database
 * holds it (null for a tenant admin). The caller signs the session for that
 * business and writes the audit row inside it.
 *
 * ## One address, several accounts
 *
 * The password is checked against every candidate, and only the ones it opens
 * count. A tenant admin wins outright - they already reach every business the
 * tenant owns, so there is nothing to choose between. Otherwise one match signs
 * in, and more than one answers `BUSINESS_CHOICE_REQUIRED` with the businesses
 * to choose from, and the client sends the choice back as `business`.
 *
 * **The list names only businesses the password opened.** Offering every
 * business an address appears in would tell anybody who types a colleague's
 * email where that colleague works, without knowing their password.
 */
async function login({ email, password, business: chosen = null }, { pinned = null } = {}) {
  const candidates = await loginCandidates(email, pinned);

  const matches = [];
  for (const candidate of candidates) {
    if (await candidate.user.verifyPassword(password)) matches.push(candidate);
  }

  if (!matches.length) {
    throw ApiError.unauthorized('That email and password do not match.', 'INVALID_CREDENTIALS');
  }

  let match = matches.find((candidate) => candidate.business === null);

  if (!match && matches.length === 1) [match] = matches;

  if (!match && chosen) {
    match = matches.find((candidate) => String(candidate.business?._id) === String(chosen));
  }

  if (!match) {
    throw new ApiError(
      409,
      'BUSINESS_CHOICE_REQUIRED',
      'This email signs in to more than one business. Choose which one to open.',
      {
        choices: matches.map((candidate) => ({
          id: String(candidate.business._id),
          name: candidate.business.name,
        })),
      },
    );
  }

  const { user } = match;

  if (user.status === 'rejected') {
    throw ApiError.forbidden(
      'This account was not approved. Contact sales@cellvix.ca if you think that is a mistake.',
      'ACCOUNT_REJECTED',
    );
  }

  // A locked staff account is refused at the door rather than handed a session
  // the guards would reject on every request. The pending-account exception
  // above is deliberate and buyer-only; there is no equivalent staff state that
  // benefits from being signed in but powerless.
  if (user.lockedAt) {
    throw ApiError.forbidden(
      'This account has been locked. Contact an administrator.',
      'STAFF_LOCKED',
    );
  }

  user.lastLoginAt = new Date();
  await user.save();
  return { user, business: match.business };
}

/**
 * How long a reset link is good for.
 *
 * An hour: long enough to walk away from the desk and come back, short enough
 * that a link sitting in a mailbox somebody else later reads is usually dead.
 */
const RESET_TTL_MS = 60 * 60 * 1000;

/** `sha256(token)` - what is stored, so a database dump holds no usable link. */
function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Starts a password reset.
 *
 * **Always resolves the same way**, whether or not the address is registered.
 * The caller returns 204 regardless: an endpoint that answered differently for
 * a known address would be a way to ask "does this business buy from Cellvix",
 * which is the same reason `applyAsSupplier` is silent.
 *
 * A staff account is deliberately included - staff sign in through the same
 * form, and excluding them would leak which addresses are staff.
 */
async function forgotPassword({ email }, { origin } = {}) {
  const here = await db().User.findOne({ email });
  if (here) {
    await issueReset(here, { origin, businessId: currentBusinessId() });
    return;
  }

  /**
   * Nobody here: the login directory, the same way sign-in looks.
   *
   * On the shared admin host "here" is only the default business, and a staff
   * member's account is usually somewhere else. One email per business that
   * holds a panel account for the address, each sent BY that business and
   * resetting only that account - a person who works at two has two passwords,
   * and a link that silently chose one would reset the wrong one half the time.
   */
  for (const business of await businessesFor(email)) {
    await inBusinessDb(business, async () => {
      const user = await db().User.findOne({ email });
      if (user) await issueReset(user, { origin, businessId: String(business._id) });
    });
  }
  // No account anywhere: return quietly, having done nothing. Deliberately not
  // an error - the reply cannot say whether the address is known.
}

/**
 * Mint and send one reset link for one account, in the business that holds it.
 *
 * The link names that business (`&business=`), because the token's hash lives
 * in that business's database and nowhere else. The reset page sends it back,
 * and `resolveBusiness` opens that database before the token is looked up.
 */
async function issueReset(user, { origin, businessId }) {
  // A suspended or rejected account must not be able to let itself back in.
  // Silent, because the reply cannot say which it was.
  if (user.status === 'suspended' || user.status === 'rejected' || user.lockedAt) return;

  // 32 random bytes. The email carries this; only its hash is stored, and
  // issuing a new link invalidates any previous one because there is one slot.
  const token = crypto.randomBytes(32).toString('base64url');
  user.resetTokenHash = hashResetToken(token);
  user.resetTokenAt = new Date(Date.now() + RESET_TTL_MS);
  await user.save();

  await sendPasswordResetEmail({
    user,
    token,
    business: businessId,
    origin: origin || env.publicOrigin,
    expiresMinutes: Math.round(RESET_TTL_MS / 60000),
  });
}

/**
 * Completes a password reset.
 *
 * The token is the entire authorisation, so every check that makes it safe
 * lives here: it must hash to a stored value, must not have expired, and is
 * destroyed on use so the link cannot be replayed.
 *
 * The token is looked up **by its hash**, which is also what makes the lookup
 * constant-work - there is no partial match to time.
 */
async function resetPassword({ token, password }) {
  const user = await db().User.findOne({ resetTokenHash: hashResetToken(token) }).select(
    '+resetTokenHash +resetTokenAt',
  );

  const invalid = ApiError.badRequest(
    'That reset link is no longer valid. Request a new one.',
    'RESET_TOKEN_INVALID',
  );

  if (!user) throw invalid;
  if (!user.resetTokenAt || user.resetTokenAt.getTime() < Date.now()) {
    // Expired links are cleared rather than left to be retried forever.
    user.resetTokenHash = undefined;
    user.resetTokenAt = undefined;
    await user.save();
    throw invalid;
  }

  await user.setPassword(password);
  // Single use: the link dies with the reset it performed.
  user.resetTokenHash = undefined;
  user.resetTokenAt = undefined;
  await user.save();

  return user;
}

export { issueSession, clearSession, register, applyAsSupplier, findForAudit, login, forgotPassword, resetPassword, hashResetToken, RESET_TTL_MS };
