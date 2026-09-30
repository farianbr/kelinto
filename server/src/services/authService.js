import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { controlModels, db } from '../db/models.js';
import '../models/User.js';
import '../models/RevokedToken.js';
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
import { originOfStorefront } from './linkOrigins.js';

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
/**
 * `sid` is this session's own random id, which is what signing out revokes
 * (`models/RevokedToken.js`). `parent` is set only on a website session opened
 * from the ERP, and names the ERP session it came from, so signing out there
 * ends this one too.
 */
function issueSession(res, user, remember = false, businessId = null, { parent = null, expiresIn = null } = {}) {
  const claims = {
    sub: user._id.toString(),
    sid: crypto.randomBytes(16).toString('base64url'),
    ...(businessId ? { biz: String(businessId) } : {}),
    ...(parent ? { parent } : {}),
  };
  const token = jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: expiresIn ?? (remember ? '90d' : env.JWT_EXPIRES_IN),
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

/** The signed claims of a session cookie, or null when there is none or it is not ours. */
function readSession(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, env.JWT_SECRET);
  } catch {
    return null;
  }
}

/**
 * End a session on the server, not just in this browser.
 *
 * Writes the token's `sid` to the revocation list until the token would have
 * expired anyway. Idempotent: signing out twice is not an error. A token with
 * no `sid` predates this and is refused by `authenticate` regardless.
 */
async function revokeSession(claims) {
  if (!claims?.sid || !claims.exp) return;
  await controlModels()
    .RevokedToken.updateOne(
      { _id: claims.sid },
      { $setOnInsert: { kind: 'session', expiresAt: new Date(claims.exp * 1000) } },
      { upsert: true },
    )
    .catch((error) => console.error(`  Could not revoke session - ${error.message}`));
}

/**
 * Replace the current session with a fresh one for the same person, keeping
 * its business, its "remember me" and its ERP parent.
 *
 * Used after somebody changes their own password: the change ends every
 * session opened before it, including the one making the change, and signing
 * the person out of the screen they are standing on would be a punishment for
 * doing the right thing.
 */
async function reissueSession(req, res, user) {
  const claims = readSession(req.cookies?.[env.COOKIE_NAME]);
  if (!claims?.sid) return;
  await revokeSession(claims);
  const remember = claims.exp - claims.iat > 8 * 24 * 60 * 60;
  issueSession(res, user, remember, claims.biz ?? null, { parent: claims.parent ?? null });
}

/** Is this session, or the ERP session it was opened from, signed out? */
async function isRevoked(claims) {
  const ids = [claims?.sid, claims?.parent].filter(Boolean);
  if (!ids.length) return false;
  return Boolean(await controlModels().RevokedToken.exists({ _id: { $in: ids } }));
}

async function register(data, { ip, via = null } = {}) {
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
    // Where a customer came from. Only the kiosk sets it at sign-up: a website
    // registration is the default, and recording it on every row says nothing.
    ...(via === 'kiosk' ? { source: 'kiosk' } : {}),
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
    // A kiosk sign-up is approved the moment it is written (`kioskService`),
    // so the bell must not send somebody to approve an account that is not waiting.
    detail: `${user.contactName} · ${user.email} · ${via === 'kiosk' ? 'signed up at the kiosk' : 'awaiting approval'}`,
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
/**
 * ## Each door opens for its own population only
 *
 * `surface` is the host's application (`utils/surface.js`), and it narrows the
 * list before any password is checked:
 *
 * - **`panel`** (the ERP): tenant admins and staff. A customer's address and
 *   password typed here find nothing.
 * - **`storefront`** (a business's website): that business's customers only.
 *   No tenant admin, no staff, and never the login directory, which would let
 *   one business's website sign in another business's staff. Staff reach the
 *   website from the ERP (`createWebsiteHandoff`), already signed in.
 * - **`any`** (no host split, and plain `localhost`): everybody, as before.
 *
 * An account of the wrong kind is therefore indistinguishable from an address
 * nobody holds: both answer `INVALID_CREDENTIALS`, and the reply says nothing
 * about which kind of account an address belongs to. It used to sign a
 * customer into the ERP and then tell them "that is a customer account".
 */
function allowedHere(user, surface) {
  const panelAccount = user.role === 'admin' || user.role === 'staff';
  if (surface === 'panel') return panelAccount;
  if (surface === 'storefront') return !panelAccount;
  return true;
}

async function loginCandidates(email, { pinned = null, surface = 'any' } = {}) {
  const candidates = [];

  if (surface !== 'storefront') {
    const admin = await controlModels().User.findOne({ email, role: 'admin' }).select('+passwordHash');
    if (admin && (await adminMaySignInHere(admin, pinned))) {
      candidates.push({ user: admin, business: null });
    }
  }

  const hereId = currentBusinessId();
  const here = await db().User.findOne({ email }).select('+passwordHash');
  if (here && allowedHere(here, surface)) {
    const record = hereId
      ? await controlModels().Business.findById(hereId).select('name code').lean()
      : null;
    candidates.push({ user: here, business: record });
  }

  if (pinned || surface === 'storefront') return candidates;

  for (const business of await businessesFor(email)) {
    // Already covered by step 2 - the same account, not a second one.
    if (hereId && String(business._id) === String(hereId)) continue;
    const found = await inBusinessDb(business, () =>
      db().User.findOne({ email }).select('+passwordHash'),
    );
    if (found && allowedHere(found, surface)) candidates.push({ user: found, business });
  }

  return candidates;
}

/**
 * A real bcrypt hash of nothing anybody will type, compared against when an
 * address has no account here, so "no such account" costs the same time as
 * "wrong password" and the delay cannot be used to test addresses.
 */
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 10);

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
async function login({ email, password, business: chosen = null }, { pinned = null, surface = 'any' } = {}) {
  const candidates = await loginCandidates(email, { pinned, surface });

  const matches = [];
  for (const candidate of candidates) {
    if (await candidate.user.verifyPassword(password)) matches.push(candidate);
  }
  if (!candidates.length) await bcrypt.compare(String(password ?? ''), DUMMY_HASH);

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
      'This account was not approved. Contact the business if you think that is a mistake.',
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
async function forgotPassword({ email }, { origin, surface = 'any' } = {}) {
  // The same population the sign-in on this host opens for: a customer's
  // reset link must not be minted by the ERP, where it would sign them in.
  const found = await db().User.findOne({ email });
  const here = found && allowedHere(found, surface) ? found : null;
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
   *
   * Never from a website: the directory holds staff, and a website's door is
   * for its own customers.
   */
  if (surface === 'storefront') return;
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

// ---- ERP to website ----------------------------------------------------------

/** How long a handoff link lives. Long enough to follow, short enough to be spent. */
const HANDOFF_SECONDS = 60;

/**
 * How long a website session opened from the ERP lasts. A working day: it is a
 * viewing session, and it ends sooner if the ERP session it came from does.
 */
const WEBSITE_VIEW_EXPIRES_IN = '12h';

/**
 * A path on the website to land on, or `/`. Only a same-site path: never a
 * scheme, a host or a protocol-relative `//`, so the signed link cannot be
 * turned into a redirect to somewhere else.
 */
function safeLandingPath(to) {
  const path = String(to ?? '/');
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return '/';
  return path.slice(0, 512);
}

/**
 * The link that opens a business's website already signed in as this staff
 * member (the ERP's "View website").
 *
 * ## Why a link and not a shared cookie
 *
 * Sessions are host-only cookies, so the ERP's session never reaches the
 * website, and a cookie on `.kelinto.com` would reach every tenant's website at
 * once. Instead the ERP mints a **single-use, 60-second** signed link that
 * names one business, one person and the ERP session it came from. The website
 * spends it (`claimWebsiteHandoff`) and issues its own session, whose `parent`
 * is that ERP session - so signing out of the ERP signs this person out of the
 * website too, on its next request.
 *
 * Returns `{ url }`. With no host split (`any`), the ERP and the website are one
 * host and one cookie, so the url is simply the path.
 */
async function createWebsiteHandoff({ user, claims, businessId, surface, to }) {
  const landing = safeLandingPath(to);
  if (surface === 'any') return { url: landing };

  const origin = originOfStorefront(await businessConfig(businessId));
  if (!origin) {
    throw ApiError.conflict('This business has no website address yet.', 'NO_WEBSITE');
  }
  if (!claims?.sid) throw ApiError.unauthorized();

  const token = jwt.sign(
    {
      kind: 'website-handoff',
      sub: user._id.toString(),
      biz: String(businessId),
      parent: claims.sid,
      to: landing,
      jti: crypto.randomUUID(),
    },
    env.JWT_SECRET,
    { expiresIn: HANDOFF_SECONDS },
  );

  return { url: `${origin}/api/auth/website-handoff?t=${encodeURIComponent(token)}` };
}

/**
 * Spend a handoff link on the website it names, and sign the person in there.
 *
 * Refused (returns null, and the caller lands the browser on the website signed
 * out) when the link is expired, forged, already spent, meant for another
 * business, or when the ERP session it came from has since been signed out, or
 * the account is gone or locked. Returns : where to land, and who.
 */
async function claimWebsiteHandoff(token, res, { businessId }) {
  const payload = readSession(token);
  if (payload?.kind !== 'website-handoff' || !payload.jti || !payload.parent) return null;
  if (!businessId || String(payload.biz) !== String(businessId)) return null;

  try {
    await controlModels().RevokedToken.create({
      _id: `handoff:${payload.jti}`,
      kind: 'handoff',
      expiresAt: new Date(payload.exp * 1000),
    });
  } catch {
    // Already spent: the insert lost to an earlier claim of the same link.
    return null;
  }

  if (await isRevoked({ parent: payload.parent })) return null;

  const admin = await controlModels().User.findOne({ _id: payload.sub, role: 'admin' });
  const user = admin && (await adminMaySignInHere(admin, businessId))
    ? admin
    : await db().User.findOne({ _id: payload.sub, role: { $in: ['admin', 'staff'] } });
  if (!user || user.lockedAt) return null;

  issueSession(res, user, false, user === admin ? null : businessId, {
    parent: payload.parent,
    expiresIn: WEBSITE_VIEW_EXPIRES_IN,
  });
  return { to: payload.to ?? '/', user };
}

export {
  issueSession,
  clearSession,
  readSession,
  revokeSession,
  reissueSession,
  isRevoked,
  register,
  applyAsSupplier,
  findForAudit,
  login,
  forgotPassword,
  resetPassword,
  hashResetToken,
  RESET_TTL_MS,
  createWebsiteHandoff,
  claimWebsiteHandoff,
};
