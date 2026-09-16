import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { db, controlModels } from '../db/models.js';
import '../models/Settings.js';
import '../models/Ticket.js';
import '../models/User.js';
import '../models/DeviceCatalog.js';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { migrateColorToken } from '../../../shared/businessPalette.js';

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
 * prices, never assigns a technician, never sets a priority and never grades
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
  const nodes = await db()
    .DeviceCatalog.find({ isActive: true })
    .sort({ order: 1, name: 1 })
    .select('name kind parent order')
    .lean();

  const byId = new Map();
  for (const node of nodes) {
    byId.set(String(node._id), { id: String(node._id), name: node.name, kind: node.kind, children: [] });
  }

  const roots = [];
  for (const node of nodes) {
    const shaped = byId.get(String(node._id));
    const parentId = node.parent ? String(node.parent) : null;
    if (parentId && byId.has(parentId)) byId.get(parentId).children.push(shaped);
    else roots.push(shaped);
  }

  return { devices: roots };
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
 * Find the customer this check-in belongs to, or create one.
 *
 * **Matched on phone first, then email.** A repair customer is reached by
 * phone - it is the number every status update goes to - and somebody checking
 * in their second device should not become a second account. Email is the
 * fallback because the kiosk lets them skip it.
 *
 * An existing account is **never overwritten** from a kiosk. Somebody typing
 * their name in a hurry on a tablet must not rename an account the shop has
 * been dealing with for two years. The one thing that IS filled in is a missing
 * `preferredContact`: an empty field is not an answer, so recording one is new
 * information rather than a correction.
 */
async function resolveCustomer(intake, businessId) {
  const phone = String(intake.phone ?? '').trim();
  const email = String(intake.email ?? '').trim().toLowerCase();

  let user = null;
  if (phone) user = await db().User.findOne({ phone, role: 'buyer' });
  if (!user && email) user = await db().User.findOne({ email, role: 'buyer' });

  const contactName = [intake.firstName, intake.lastName]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ');

  if (user) {
    /**
     * The one field a kiosk may fill on an existing account.
     *
     * An empty `preferredContact` is not an answer - nobody has asked - so
     * recording one is new information rather than a correction. Every other
     * field is left exactly as it is: somebody typing their name in a hurry on
     * a tablet must not rename an account the shop has dealt with for years.
     */
    if (!user.preferredContact && intake.updatesConsent) {
      user.preferredContact = 'sms';
      await user.save();
    }
    return { user, created: false };
  }

  const created = new (db().User)({
    contactName: contactName || 'Kiosk customer',
    // A kiosk customer may genuinely have no email - the flow lets them skip
    // it - so a placeholder is generated rather than failing. It is unique and
    // obviously not real, which is better than refusing the check-in.
    email: email || `kiosk-${Date.now()}@no-email.invalid`,
    phone,
    role: 'buyer',
    // Approved: this is a walk-in consumer, not a wholesale account waiting on
    // a credit decision. Nothing here can see a wholesale price.
    status: 'approved',
    business: businessId ?? null,
    source: 'kiosk',
    // SMS, because a phone number is the one contact detail the kiosk always
    // has. The counter corrects it when they review the ticket.
    preferredContact: intake.updatesConsent ? 'sms' : undefined,
    contactConsent: intake.updatesConsent
      ? { sms: true, whatsapp: false, email: Boolean(email), call: false, at: new Date(), source: 'kiosk' }
      : undefined,
  });

  // Nobody signs in as a kiosk-created account, but `User` requires a password
  // hash and an account with none could never be recovered into a real one.
  await created.setPassword(`kiosk-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  await created.save();

  return { user: created, created: true };
}

/**
 * Take a check-in.
 *
 * Returns only the ticket number: it is what the done screen shows and what the
 * customer is asked to quote. Nothing else about the shop, the account or the
 * job goes back to a tablet in a public space.
 */
async function checkIn(intake = {}, businessId = null) {
  const settings = await db().Settings.findOne({}).select('+kiosk.pinHash').lean();

  if (settings?.kiosk?.requireTerms !== false && !intake.termsAccepted) {
    throw ApiError.badRequest(
      'Please agree to the repair terms to check in.',
      'KIOSK_TERMS_REQUIRED',
    );
  }

  const phone = String(intake.phone ?? '').trim();
  if (phone.length < 7) {
    throw ApiError.badRequest('Enter a phone number we can reach you on.', 'KIOSK_PHONE_REQUIRED');
  }

  const { user } = await resolveCustomer(intake, businessId);

  const problem = String(intake.problem ?? '').trim();
  const now = new Date();

  const ticket = await db().Ticket.create({
    ticketNumber: await nextTicketNumber(),

    user: user._id,
    customerName: user.contactName,
    customerPhone: phone,
    customerEmail: user.email?.endsWith('@no-email.invalid') ? '' : user.email,
    business: businessId ?? null,

    status: 'diagnosis',
    priority: 'normal',
    source: 'kiosk',

    // The legacy single-device columns the list and search read.
    deviceBrand: intake.brand || undefined,
    deviceModel: intake.model || undefined,
    deviceSerial: intake.serial || undefined,
    issue: problem || 'Checked in at the kiosk; fault not described.',

    devices: [
      {
        category: intake.category || undefined,
        brand: intake.brand || undefined,
        model: intake.model || undefined,
        serial: intake.serial || undefined,
        passcode: intake.passcode || undefined,
        problem: problem || undefined,
        // No condition grid, no services, no parts. The counter adds all three
        // when they review it - a customer cannot grade a back camera.
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
      updatesConsentAt: intake.updatesConsent ? now : null,
    },

    timeline: [
      { status: 'diagnosis', at: now, note: 'Checked in by the customer at the kiosk.' },
    ],
  });

  return { ticketNumber: ticket.ticketNumber, firstName: String(intake.firstName ?? '').trim() };
}

export {
  KIOSK_COOKIE,
  issueSession,
  clearSession,
  getPublicConfig,
  unlock,
  setPin,
  getDeviceOptions,
  checkIn,
};
export default { getPublicConfig, unlock, setPin, getDeviceOptions, checkIn };
