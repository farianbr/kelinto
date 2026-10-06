import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { db, controlModels } from '../db/models.js';
import '../models/Settings.js';
import '../models/Ticket.js';
import '../models/User.js';
import deviceCatalogService from './deviceCatalogService.js';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { migrateColorToken } from '../../../shared/businessPalette.js';
import { kioskClocks, nameCase } from '../../../shared/kiosk.js';
import { conditionProblems, isConditionValue } from '../../../shared/deviceCondition.js';
import * as authService from './authService.js';
import auditService from './auditService.js';
import referralService from './referralService.js';

/** The four channels `User.contactConsent` records, in the order the tablet offers them. */
const CONSENT_CHANNELS = ['sms', 'whatsapp', 'email', 'call'];

/**
 * Self-service check-in (Sales § Kiosk).
 *
 * A tablet on the counter that lets a customer book their own device in, so a
 * member of staff is not occupied for the five minutes it takes to write down a
 * name, a number and what is wrong.
 *
 * ## What it is allowed to write
 *
 * A **customer profile** and a **partial ticket**, and nothing else. It never
 * prices, never assigns a technician and never grades
 * the device's condition. A customer standing at an iPad cannot answer any of
 * those, and a form that asked them to guess would produce a record that looks
 * like evidence and is not - which is the same reason `ServiceQuote` has no
 * condition grid.
 *
 * Everything it writes is flagged `intake.awaitingReview` so the counter
 * finishes it. **That is a flag, not a status**: the repair really is at
 * `diagnosis`, and spending a status on "a human has not looked at this yet"
 * would mean every status query had to know about a state that says nothing
 * about the device.
 *
 * ## Why the session is its own cookie
 *
 * The same argument the supplier portal makes. A kiosk session is **not a
 * user** - nobody is signed in, and the token says only that somebody entered
 * the shop's PIN on this tablet. Sharing the admin cookie would mean a tablet
 * in a shop window holding a staff session, which is exactly the thing the PIN
 * exists to prevent.
 *
 * ## Why the PIN unlocks for the day, not per customer
 *
 * A member of staff enters it once when the shop opens. The lock is there so
 * the tablet cannot be walked off with and used, not so each customer has to be
 * let in - a kiosk that asks the next customer for a staff PIN is a kiosk
 * nobody uses.
 */

const KIOSK_COOKIE = `${env.COOKIE_NAME}_kiosk`;
/** A working day, with room for a late close. */
const SESSION_HOURS = 16;

function issueSession(res, businessId) {
  const token = jwt.sign(
    // `kind` is what `requireKiosk` checks. Every cookie here is signed with
    // the same secret, so without it a buyer's token would be accepted as a
    // kiosk one - the mistake `middleware/supplierAuth` calls out.
    { sub: String(businessId ?? 'default'), kind: 'kiosk' },
    env.JWT_SECRET,
    { expiresIn: `${SESSION_HOURS}h` },
  );

  res.cookie(KIOSK_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
    path: '/',
  });
}

function clearSession(res) {
  res.clearCookie(KIOSK_COOKIE, { path: '/' });
}

/**
 * What the kiosk shows before anybody has unlocked it.
 *
 * Deliberately says whether a PIN has been **set**, and never what it is. A
 * kiosk nobody has configured offers to be set up rather than refusing entry to
 * a door that was never locked.
 */
async function getPublicConfig(businessId = null) {
  const settings = await db().Settings.findOne({}).select('+kiosk.pinHash').lean();
  const kiosk = settings?.kiosk ?? {};

  /**
   * The shop's name and its identity colour.
   *
   * Read through `controlModels()` rather than `db()`, because `Business` lives
   * in the **control plane** - a business record cannot sit inside the database
   * it names. `db().Business` would resolve against this business's own
   * connection and read an empty collection.
   *
   * The colour matters here more than anywhere else in the system: the kiosk is
   * the one surface a **customer** looks at, it fills the whole screen, and it
   * carries the shop's name at the top. Painting it in another business's brand
   * is the most visible possible version of that mistake.
   */
  let business = null;
  if (businessId) {
    business = await controlModels()
      .Business.findById(businessId)
      .select('name colorToken')
      .lean();
  }

  return {
    businessName: business?.name ?? null,
    colorToken: migrateColorToken(business?.colorToken),
    isEnabled: kiosk.isEnabled === true,
    hasPin: Boolean(kiosk.pinHash),
    welcomeMessage: kiosk.welcomeMessage ?? 'Welcome! Check in your device in just a minute.',
    thankYouMessage:
      kiosk.thankYouMessage ?? "You're all set! Please hand your device to our team.",
    readAloud: kiosk.readAloud !== false,
    requireTerms: kiosk.requireTerms !== false,
    termsText:
      kiosk.termsText ?? "I agree to leave my device for diagnosis and to the shop's repair terms.",
    ...kioskClocks(kiosk),
  };
}

/**
 * Unlock the tablet.
 *
 * **The PIN is compared against a hash**, and a wrong one gets the same answer
 * whether or not a PIN has ever been set - a screen that says "no PIN
 * configured" to a stranger is a screen that tells them to just press enter.
 */
async function unlock(res, { pin } = {}) {
  const settings = await db().Settings.findOne({}).select('+kiosk.pinHash').lean();
  const hash = settings?.kiosk?.pinHash;

  const candidate = String(pin ?? '').trim();
  if (!hash || !candidate) {
    throw ApiError.badRequest('That PIN is not right.', 'KIOSK_PIN_INVALID');
  }

  const ok = await bcrypt.compare(candidate, hash);
  if (!ok) throw ApiError.badRequest('That PIN is not right.', 'KIOSK_PIN_INVALID');

  if (settings?.kiosk?.isEnabled !== true) {
    throw ApiError.badRequest(
      'The kiosk is switched off for this business.',
      'KIOSK_DISABLED',
    );
  }

  issueSession(res, settings?.business ?? null);
  return { unlocked: true };
}

/** Set or change the PIN. Admin-side; never reachable from the tablet itself. */
async function setPin({ pin } = {}) {
  const candidate = String(pin ?? '').trim();
  if (!/^\d{4,8}$/.test(candidate)) {
    throw ApiError.badRequest('A kiosk PIN is 4 to 8 digits.', 'KIOSK_PIN_WEAK');
  }

  /**
   * `updateOne`, not `load().save()`.
   *
   * `Settings.load` returns a **lean object** - it exists to be read cheaply on
   * every request - so it has no `save`. Writing one field through the model is
   * also narrower than round-tripping the whole settings document, which is
   * what a concurrent edit to an unrelated section would otherwise lose.
   */
  const hash = await bcrypt.hash(candidate, 10);
  await db().Settings.updateOne(
    { key: 'singleton' },
    { $set: { 'kiosk.pinHash': hash } },
    { upsert: true },
  );

  return { set: true };
}

/**
 * The device tree the kiosk's questions 5 to 7 walk.
 *
 * Returned **already nested and active-only**, because the tablet has no
 * business filtering a tree: every option it can offer is one the shop actually
 * takes in.
 */
async function getDeviceOptions() {
  // The Services category tree (2026-10-03; Serviced items before), active only.
  const { tree } = await deviceCatalogService.getTree({ status: 'active' });
  const strip = (nodes) => nodes.map((node) => ({ id: node.id, name: node.name, kind: node.kind, children: strip(node.children) }));
  return { devices: strip(tree) };
}

/**
 * `KS-00001`. **Its own series, separate from the counter's `TKT-`.**
 *
 * A kiosk ticket is not the same object as one a staff member wrote: it is a
 * customer's own account of their device, unpriced, ungraded and unassigned,
 * waiting for somebody to finish it. Sharing one sequence made that invisible on
 * every screen that shows a number and not a badge - a printed slip, a phone
 * call, a search box - and the prefix is the one part of a ticket that travels
 * everywhere with it.
 *
 * No year segment, unlike `TKT-2026-00001`: the counter series restarts each
 * January so its numbers stay short, and this one is a single running count for
 * the life of the shop. Mixing a yearly reset into a flat series is how two
 * tickets end up sharing a number.
 */
const KIOSK_PREFIX = 'KS-';

async function nextTicketNumber() {
  const last = await db()
    .Ticket.findOne({ ticketNumber: new RegExp(`^${KIOSK_PREFIX}`) })
    .sort({ ticketNumber: -1 })
    .select('ticketNumber')
    .lean();

  const sequence = last ? Number(last.ticketNumber.slice(KIOSK_PREFIX.length)) + 1 : 1;
  return `${KIOSK_PREFIX}${String(sequence).padStart(5, '0')}`;
}

/**
 * A regex matching a stored phone by its digits, whatever it was typed with.
 *
 * `User.phone` is stored as `+1 780 123 4567` by `PhoneField`, older rows as
 * whatever somebody typed, and a customer at a tablet types `7801234567`. So
 * the match is on the last ten digits with anything allowed between them,
 * anchored at the end - which also makes the `+1` optional without having to
 * guess a country.
 */
function phonePattern(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(-10);
  if (digits.length < 7) return null;
  return new RegExp(`${digits.split('').join('\\D*')}\\D*$`);
}

/** Only a customer account is ever found at a tablet, never a member of staff. */
const CUSTOMER_FILTER = { role: 'buyer' };

/** How long "Yes, that's me" stays good for: one check-in, with room to dither. */
const CUSTOMER_TOKEN_MINUTES = 30;

function signCustomerToken(userId, businessId) {
  return jwt.sign(
    { sub: String(userId), biz: String(businessId ?? 'default'), kind: 'kiosk-customer' },
    env.JWT_SECRET,
    { expiresIn: `${CUSTOMER_TOKEN_MINUTES}m` },
  );
}

/**
 * The account id inside a token this business's tablet issued, or null.
 *
 * Null rather than a throw for anything wrong with it: an expired token means a
 * customer dithered for half an hour, and the right answer is to ask again, not
 * to show them an error about cryptography.
 */
function readCustomerToken(token, businessId) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (payload.kind !== 'kiosk-customer') return null;
    if (payload.biz !== String(businessId ?? 'default')) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

/**
 * "Let's find your details": look a customer up by phone or email.
 *
 * ## What comes back
 *
 * A masked name, a masked hint and a token - never the account. The tablet is
 * in a public room and anybody can type any number into it, so the answer has
 * to be recognisable to its owner and useless to everybody else. The token is
 * what "Yes, that's me" hands back to `checkIn`, so a check-in can only attach
 * to an account this tablet looked up.
 *
 * `{ match: null }` for no match, with a 200: "we could not find you" is the
 * normal answer for every new customer, not an error.
 */
async function lookupCustomer({ query } = {}, businessId = null) {
  const text = String(query ?? '').trim();
  let user = null;

  if (text.includes('@')) {
    user = await db()
      .User.findOne({ ...CUSTOMER_FILTER, email: text.toLowerCase() })
      .select('contactName businessName email phone createdAt identity.idLast4')
      .lean();
  } else {
    const pattern = phonePattern(text);
    if (pattern) {
      user = await db()
        .User.findOne({ ...CUSTOMER_FILTER, phone: pattern })
        // The most recently active account, where a number was reused.
        .sort({ updatedAt: -1 })
        .select('contactName businessName email phone createdAt identity.idLast4')
        .lean();
    }
  }

  if (!user) return { match: null };

  return {
    match: {
      token: signCustomerToken(user._id, businessId),
      /**
       * The full name and when they first came to us (client ruling,
       * 2026-10-02), and nothing else. It used to be initials plus a masked
       * number and email; the client wants a customer to recognise themselves
       * at a glance, and the number or email they just typed is not shown back.
       */
      name: user.contactName || user.businessName || 'A customer',
      since: user.createdAt ?? null,
      /**
       * Whether a photo ID is already on file, so "Sell your phone" can skip
       * asking for it again. Only a yes or no: never the type or the digits.
       */
      hasId: Boolean(user.identity?.idLast4),
    },
  };
}

/**
 * The consent a new customer gave, in the shape `User.contactConsent` stores.
 *
 * The first channel they picked becomes `preferredContact`, because the screen
 * lists them in the order a repair customer is most likely to read them and a
 * customer who ticks one ticks the one they mean.
 */
function consentFrom(channels = [], hasEmail, now) {
  const picked = new Set(channels.filter((channel) => channel !== 'email' || hasEmail));
  if (picked.size === 0) return { consent: undefined, preferred: undefined };
  return {
    consent: {
      sms: picked.has('sms'),
      whatsapp: picked.has('whatsapp'),
      email: picked.has('email'),
      call: picked.has('call'),
      at: now,
      source: 'kiosk',
    },
    preferred: CONSENT_CHANNELS.find((channel) => picked.has(channel)),
  };
}

/**
 * Find the customer this check-in belongs to, or create one.
 *
 * **A returning customer arrives with a token** from `lookupCustomer`, which is
 * the only way the tablet can name an existing account. Their account is used
 * as it stands: nothing on it is rewritten from a tablet, because somebody
 * typing in a hurry must not rename an account the shop has dealt with for
 * years.
 *
 * **A new customer is still matched on phone, then email,** before an account
 * is created, so somebody who pressed "I'm new" on their second visit does not
 * become a second account. The one exception is the account they refused with
 * "Not me": filing them under the stranger they just said they were not would
 * be the exact mistake the question exists to prevent.
 */
async function resolveCustomer(intake, businessId, now) {
  const tokenUserId = readCustomerToken(intake.customerToken, businessId);
  if (intake.customerToken && !tokenUserId) {
    throw ApiError.badRequest(
      'That took a little too long. Please find your details again.',
      'KIOSK_CUSTOMER_EXPIRED',
    );
  }
  if (tokenUserId) {
    const user = await db().User.findOne({ _id: tokenUserId, ...CUSTOMER_FILTER });
    if (user) return { user, created: false };
  }

  const refused = readCustomerToken(intake.rejectedToken, businessId);
  const notRefused = refused ? { _id: { $ne: refused } } : {};

  const phone = String(intake.phone ?? '').trim();
  const email = String(intake.email ?? '').trim().toLowerCase();

  let user = null;
  const pattern = phonePattern(phone);
  if (pattern) {
    user = await db().User.findOne({ ...CUSTOMER_FILTER, ...notRefused, phone: pattern });
  }
  if (!user && email) {
    user = await db().User.findOne({ ...CUSTOMER_FILTER, ...notRefused, email });
  }

  const { consent, preferred } = consentFrom(intake.contactChannels, Boolean(email), now);

  if (user) {
    /**
     * The one field a kiosk may fill on an existing account.
     *
     * An empty `preferredContact` is not an answer - nobody has asked - so
     * recording one is new information rather than a correction.
     */
    if (!user.preferredContact && preferred) {
      user.preferredContact = preferred;
      await user.save();
    }
    return { user, created: false };
  }

  const contactName = [intake.firstName, intake.lastName]
    .map((part) => nameCase(part ?? ''))
    .filter(Boolean)
    .join(' ');

  /**
   * An email that belongs to a refused account cannot be reused: `email` is
   * unique. The customer keeps their check-in and the counter sorts out the
   * address, which is better than refusing somebody at a tablet over a clash
   * they cannot see.
   */
  const emailTaken = email && (await db().User.exists({ email }));

  const created = new (db().User)({
    contactName: contactName || 'Kiosk customer',
    // A kiosk customer may genuinely have no email - the flow lets them skip
    // it - so a placeholder is generated rather than failing. It is unique and
    // obviously not real, which is better than refusing the check-in.
    email: email && !emailTaken ? email : `kiosk-${Date.now()}@no-email.invalid`,
    phone,
    role: 'buyer',
    // Approved: this is a walk-in consumer, not a wholesale account waiting on
    // a credit decision.
    status: 'approved',
    business: businessId ?? null,
    source: 'kiosk',
    preferredContact: preferred,
    contactConsent: consent,
  });

  // Nobody signs in as a kiosk-created account, but `User` requires a password
  // hash and an account with none could never be recovered into a real one.
  await created.setPassword(`kiosk-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  await created.save();

  return { user: created, created: true };
}

/**
 * Take a repair check-in.
 *
 * Returns only the ticket number and a first name to thank: the number is what
 * the done screen shows and what the customer is asked to quote. Nothing else
 * about the shop, the account or the job goes back to a tablet in a public
 * space, which is also why a returning customer is thanked without a name:
 * the tablet only ever showed them their initials.
 */
async function checkIn(intake = {}, businessId = null) {
  const settings = await db().Settings.findOne({}).select('+kiosk.pinHash').lean();

  if (settings?.kiosk?.requireTerms !== false && !intake.termsAccepted) {
    throw ApiError.badRequest(
      'Please agree to the repair terms to check in.',
      'KIOSK_TERMS_REQUIRED',
    );
  }

  const now = new Date();
  const { user } = await resolveCustomer(intake, businessId, now);
  const returning = Boolean(intake.customerToken);

  /**
   * The number this repair is reached on.
   *
   * The alternate one when the customer said they do not have the account's
   * phone with them, otherwise the account's own. A returning customer never
   * typed a number at all, so theirs comes off the account.
   */
  const alternate = String(intake.alternatePhone ?? '').trim();
  const contactPhone = alternate || user.phone || String(intake.phone ?? '').trim();
  if (contactPhone.replace(/\D/g, '').length < 7) {
    throw ApiError.badRequest('Enter a phone number we can reach you on.', 'KIOSK_PHONE_REQUIRED');
  }

  const problems = (intake.problems ?? []).map((item) => item.trim()).filter(Boolean);
  const problem = problems.join(', ');
  const notes = String(intake.notes ?? '').trim();

  /**
   * Only the parts the customer actually answered, each in its own part's
   * vocabulary. "Not Possible to Check" IS an answer here, so it stays; a part
   * missing from the map was never shown, and inventing a grade for it would
   * be the shop speaking for them.
   */
  const customerCondition = Object.fromEntries(
    Object.entries(intake.condition ?? {}).filter(([key, grade]) =>
      isConditionValue(key, grade),
    ),
  );

  const ticket = await db().Ticket.create({
    ticketNumber: await nextTicketNumber(),

    user: user._id,
    customerName: user.contactName,
    customerPhone: contactPhone,
    customerEmail: user.email?.endsWith('@no-email.invalid') ? '' : user.email,
    business: businessId ?? null,

    status: 'diagnosis',
    source: 'kiosk',

    // The legacy single-device columns the list and search read.
    deviceBrand: intake.brand || undefined,
    deviceModel: intake.model || undefined,
    // The tablet no longer asks "What's wrong with it?" (client ruling
    // 2026-10-02): the eight condition answers say it part by part, so the
    // list's one-line issue falls back to the parts the customer flagged.
    issue:
      problem ||
      notes ||
      conditionProblems(customerCondition) ||
      'Checked in at the kiosk; fault not described.',

    devices: [
      {
        category: intake.category || undefined,
        brand: intake.brand || undefined,
        series: intake.series || undefined,
        model: intake.model || undefined,
        passcode: intake.passcode || undefined,
        problem: problem || undefined,
        notes: notes || undefined,
        // The customer's account of the device, beside the grid the counter
        // fills in rather than inside it. No services and no parts: the
        // counter prices it when they review it.
        customerCondition: Object.keys(customerCondition).length ? customerCondition : undefined,
        services: [],
        parts: [],
      },
    ],

    intake: {
      awaitingReview: true,
      // The model came off a list of buttons with "pick the closest" on it, so
      // the ticket remembers the answer is a guess rather than presenting it as
      // read off the hardware.
      deviceGuessed: true,
      termsAcceptedAt: intake.termsAccepted ? now : null,
      // A returning customer was not asked: their account's consent stands.
      updatesConsentAt: !returning && intake.contactChannels?.length ? now : null,
      alternateContact: Boolean(alternate),
      returningCustomer: returning,
    },

    timeline: [
      {
        status: 'diagnosis',
        at: now,
        note: returning
          ? 'Checked in at the kiosk by a returning customer.'
          : 'Checked in by the customer at the kiosk.',
      },
    ],
  });

  return {
    ticketNumber: ticket.ticketNumber,
    firstName: returning ? '' : nameCase(intake.firstName ?? ''),
  };
}

/**
 * Approve a customer account because they signed in at the kiosk.
 *
 * ## Why a tablet can approve an account at all
 *
 * The approval gate exists so a stranger who fills in a form online cannot see
 * wholesale prices or order on credit before somebody at the business has
 * looked at them. A customer standing at the kiosk has been looked at: they are
 * in the shop, in front of the staff who unlocked the tablet, and they pay at
 * the counter before anything leaves. The client ruled that this is enough
 * (2026-09-29), for new accounts and for pending ones alike.
 *
 * **Only `pending` moves.** A rejected or suspended account was a decision
 * somebody made, and a tablet does not get to reverse it.
 *
 * `approvedBy` stays empty and the security log says how it happened, so the
 * approvals history can tell a kiosk approval from a person's.
 */
async function approveAtKiosk(user, req) {
  if (user.status !== 'pending') return user;

  user.status = 'approved';
  user.approvedAt = new Date();
  user.approvedBy = undefined;
  user.rejectionReason = undefined;
  await referralService.ensureReferralCode(user);
  await user.save();

  await auditService.recordSecurity({
    req,
    action: 'auth.kiosk_approved',
    entity: { kind: 'user', id: user._id.toString(), label: user.email },
    description: `${user.email} was approved by signing in at the in-store kiosk.`,
    subject: user,
  });

  return user;
}

/**
 * How long a website session opened at the kiosk lasts, at most.
 *
 * The idle timer signs a shopper out long before this; this is the backstop for
 * a tablet whose page crashed with somebody signed in. Two hours covers the
 * longest shop visit anybody has, and nothing about a counter purchase needs a
 * session that outlives the visit.
 */
const SHOP_SESSION = '2h';

/**
 * "Buy parts": sign an existing customer in, from the tablet.
 *
 * The same sign-in as the website's (`authService.login`, surface `storefront`,
 * pinned to this business) so the same accounts open and the same ones are
 * refused, and a wrong-kind account fails exactly like a wrong password. Then a
 * pending account is approved (see above) and a website session is issued.
 */
async function shopSignIn(req, res, body) {
  let user;
  try {
    ({ user } = await authService.login(body, {
      pinned: req.businessScope ?? null,
      surface: 'storefront',
    }));
  } catch (error) {
    await auditService.recordSecurity({
      req,
      action: 'auth.login_failed',
      entity: { kind: 'session', id: '', label: body?.email ?? '' },
      description: `Failed sign-in at the kiosk for ${body?.email}.`,
      subject: await authService.findForAudit(body?.email),
    });
    throw error;
  }

  await approveAtKiosk(user, req);
  authService.issueSession(res, user, false, req.businessScope ?? null, { expiresIn: SHOP_SESSION });

  await auditService.recordSecurity({
    req,
    action: 'auth.login',
    entity: { kind: 'session', id: user._id.toString(), label: user.email },
    description: `${user.email} signed in at the kiosk.`,
    subject: user,
  });

  return { user: user.toPublic() };
}

/**
 * "Buy parts": open an account at the tablet and sign straight in.
 *
 * `authService.register` does the work every sign-up does (the duplicate check,
 * CASL consent, the approvals bell, the welcome mail) so a kiosk account is not
 * a second kind of account. Only the outcome differs: it is approved at once
 * and signed in, where a website sign-up waits for a person.
 */
async function shopSignUp(req, res, body) {
  // Recased here as well as on the tablet: the account is named by this.
  const user = await authService.register(
    { ...body, contactName: nameCase(body.contactName) },
    { ip: req.ip, via: 'kiosk' },
  );
  await approveAtKiosk(user, req);
  authService.issueSession(res, user, false, req.businessScope ?? null, { expiresIn: SHOP_SESSION });
  return { user: user.toPublic() };
}

export {
  KIOSK_COOKIE,
  shopSignIn,
  shopSignUp,
  issueSession,
  clearSession,
  getPublicConfig,
  unlock,
  setPin,
  getDeviceOptions,
  lookupCustomer,
  readCustomerToken,
  resolveCustomer,
  checkIn,
};
export default { getPublicConfig, unlock, setPin, getDeviceOptions, lookupCustomer, checkIn };
