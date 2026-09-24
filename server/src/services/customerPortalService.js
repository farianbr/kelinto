import crypto from 'node:crypto';

import { controlModels, db } from '../db/models.js';
import { dbFor } from '../db/connections.js';
import { runInBusiness } from '../db/context.js';
// Registers the schema so `controlModels().Business` can bind it. The model is
// never used through this binding - see `business()` below for why.
import '../models/Business.js';
import ApiError from '../utils/ApiError.js';
import env from '../config/env.js';
import { resolveFeatures, featureEnabled } from '../../../shared/schemas/features.js';
import { sendCustomerPortalLink } from './customerPortalMail.js';
import { storefrontOrigin } from './linkOrigins.js';

/**
 * The customer portal (§6.13a).
 *
 * **A service business has no storefront, so its customers have nowhere to look
 * themselves up.** A wholesale buyer signs in at the shop and reads their own
 * orders; somebody who left a phone at a repair counter has no account, was
 * never asked to make one, and should not be asked to make one now in order to
 * find out whether the phone is ready. This is the screen they get instead: one
 * link, no password, read-only.
 *
 * ## Why the URL is the credential, and what that costs
 *
 * There is no sign-in because there is nothing to sign in to - most of these
 * customers were created at a counter and have no password, no verified email
 * and often no email at all. So the link itself is the secret, which is the same
 * bargain the unsubscribe link already makes and has exactly two requirements:
 *
 * 1. **Unguessable and non-enumerable.** The token is an HMAC keyed on
 *    `JWT_SECRET`, never the customer id - a link holding an id is a link that
 *    invites the next id along to be tried.
 * 2. **Read-only, and narrow.** Everything below serialises a deliberate subset.
 *    Nothing here writes, and nothing here returns a field the customer should
 *    not see: `technicianNotes`, internal notes, cost prices, margins, another
 *    customer's anything. A leaked link must cost this customer their own
 *    service history and nothing else.
 *
 * **A link is revoked by rotating `User.portalSalt`**, which invalidates that one
 * customer's link and nobody else's. That is the entire reason the salt exists;
 * a bare `hmac(id)` would be unrevocable short of changing the deployment secret
 * for every customer at once.
 *
 * ## Why the business rides in the token
 *
 * Databases are split per business (§4.1), and a public route has no session, no
 * `?business=` and no staff account to be scoped by - so there is nothing for
 * `businessScope` to read. The business code is therefore part of what is
 * signed, and `openPortal` opens that business's database itself through
 * `runInBusiness`. Signed rather than merely carried: a code the caller could
 * edit would be an invitation to walk the installation business by business.
 */

/** Long enough that guessing is hopeless, short enough to read down a phone line. */
const TOKEN_LENGTH = 40;

/**
 * The signature half of a link.
 *
 * Truncated to 40 hex characters - 160 bits. An HMAC is not weakened by
 * truncation the way a hash used as an identifier would be, and a URL somebody
 * has to dictate to a customer is a URL that actually gets used.
 */
function sign(businessCode, userId, salt) {
  return crypto
    .createHmac('sha256', env.JWT_SECRET)
    .update(`portal:${businessCode ?? ''}:${String(userId)}:${salt}`)
    .digest('hex')
    .slice(0, TOKEN_LENGTH);
}

/**
 * Compare two tokens without leaking where they first differ.
 *
 * `===` on a secret is a timing oracle. It is a small one here - an attacker
 * would need a great many samples to read 160 bits out of it - but the fix is
 * one function call and the alternative is arguing about how small.
 */
function tokensMatch(given, expected) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * `Business` **through the control-plane registry, never the direct import.**
 *
 * A business record lives in `<prefix>_control`, not in any business database
 * (§4.1) - the record naming a business cannot live inside the thing it names.
 * The model imported straight from `models/Business.js` is bound to Mongoose's
 * default connection, which under the split holds none of them: every lookup
 * answers `null` with no error, which reads exactly like a business that does
 * not exist. That is what it did here, and every portal link 404'd because of
 * it. `controlModels()` is the binding that actually points at the control
 * plane, whatever business the request is otherwise scoped to.
 */
function business() {
  return controlModels().Business;
}

/** id -> code, so minting a link does not re-read `Business` every time. */
const codes = new Map();

async function businessCodeFor(businessId) {
  if (!businessId) return null;
  const key = String(businessId);
  if (codes.has(key)) return codes.get(key);
  const found = await business().findById(key).select('code').lean();
  const code = found?.code ?? null;
  codes.set(key, code);
  return code;
}

/**
 * The portal token for one customer, minting a salt if they have none.
 *
 * Lazy rather than issued at registration: most accounts never need a link, and
 * a field written for every signup is a field that has to be backfilled for
 * every account that predates it.
 *
 * `rotate` is the revoke path - a new salt makes every link already handed out
 * for this customer answer 404, and nobody else's link changes.
 */
async function tokenFor(userId, { rotate = false } = {}) {
  const user = await db().User.findById(userId).select('+portalSalt business role');
  if (!user) throw ApiError.notFound('Customer not found.', 'USER_NOT_FOUND');

  // Staff and admins have a panel to sign in to. A portal link for one would be
  // a second, weaker door into an account that already has a strong one.
  if (user.role !== 'buyer') {
    throw ApiError.badRequest('Only a customer account has a portal link.', 'NOT_A_CUSTOMER');
  }

  if (!user.portalSalt || rotate) {
    user.portalSalt = crypto.randomBytes(16).toString('hex');
    await user.save();
  }

  const code = await businessCodeFor(user.business);
  return { token: sign(code, user._id, user.portalSalt), code };
}

/**
 * A business code as it appears in a URL.
 *
 * **Codes are `#000002`, and `#` starts a fragment.** A link pasted anywhere
 * real - a text message, an email, the address bar - is silently truncated at
 * the hash, so the server would receive `/portal/` and nothing else and every
 * link would 404 for a reason nobody could see. Percent-encoding it is not
 * enough either: a customer who retypes the visible `%23` gets it wrong, and a
 * messaging app that "helpfully" decodes it puts the hash back.
 *
 * So the hash is dropped. What is left is the digits, which is what actually
 * identifies the business - the `#` is presentation, and `openPortal` putting
 * it back on the way in is the other half of the same decision.
 */
function codeSlug(code) {
  return String(code ?? '').replace(/^#/, '');
}

/**
 * The full link an admin copies.
 *
 * `publicOrigin`, not `CLIENT_ORIGIN` - the latter is a comma-separated CORS
 * list, and a link pasted into a text message needs the one real address.
 */
async function portalLink(userId, options) {
  const { token, code } = await tokenFor(userId, options);
  // `-` for a customer with no business, so the URL keeps one shape and the
  // route needs one pattern rather than two.
  const prefix = code ? codeSlug(code) : '-';
  return { token, url: `${await storefrontOrigin()}/portal/${prefix}/${token}` };
}

/**
 * Email a customer their own portal link.
 *
 * **It mints the link rather than taking one**, so the address it sends to and
 * the token it sends are read from the same customer record in one place.
 * Handing this a URL from the client would let a mistyped or stale one be
 * mailed out over the shop's name.
 *
 * The business is read here too, because the mail is *from the shop* - a repair
 * customer receiving Cellvix's name over a link to their phone repair would
 * reasonably read it as phishing.
 *
 * Refuses rather than half-succeeds when there is no address. A customer taken
 * at a counter often has only a phone number, and "sent" against an account
 * with no email is the kind of quiet failure somebody relies on for a week.
 */
async function emailPortalLink(userId) {
  const account = await db().User.findById(userId).select('contactName businessName email business').lean();
  if (!account) throw ApiError.notFound('Customer not found.', 'USER_NOT_FOUND');

  if (!account.email) {
    throw ApiError.badRequest(
      'This customer has no email address on file. Add one, or copy the link and send it another way.',
      'NO_EMAIL',
    );
  }

  const { url } = await portalLink(userId);
  const shop = account.business
    ? await business().findById(account.business).select('name phone address').lean()
    : null;

  const result = await sendCustomerPortalLink({ user: account, business: shop, url });

  // The mailer's own answer, passed through rather than turned into a
  // confirmation: nothing in this system reports a send that did not happen
  // (§6b rule 4), and a `.example` address fails on purpose in development.
  return { sent: Boolean(result?.delivered), to: account.email, error: result?.error ?? null };
}

/**
 * Resolve a token to a customer and run `work` **inside that business's
 * database**.
 *
 * **It takes a callback rather than returning the customer, and that is the
 * whole point.** `runInBusiness` sets an async-local context that lasts exactly
 * as long as the function it wraps, so a version of this that resolved the
 * customer and then returned handed the caller a customer whose own tickets and
 * invoices were no longer reachable - every later query fell back to the default
 * connection and answered zero rows, with no error anywhere. The portal showed a
 * real customer with an empty history and looked, convincingly, like a customer
 * who had never bought anything.
 *
 * Passing the work in means the context is still open when it runs. Everything
 * `work` awaits, however deep, reads the right database.
 *
 * Every failure answers the same 404. A token that named a real customer but
 * failed its signature must be indistinguishable from one that named nobody, or
 * the response itself confirms which ids exist.
 */
async function openPortal(businessCode, token, work) {
  /**
   * Put the `#` back that `codeSlug` took out.
   *
   * The stored code is `#000002`; the URL carries `000002`. Both spellings are
   * accepted here because a staff member who copies a code out of the panel and
   * pastes it into a URL by hand will keep the hash, and refusing that would be
   * refusing the obvious thing to do.
   *
   * `-` is the placeholder for a customer with no business.
   */
  const raw = String(businessCode ?? '').trim();
  const code = !raw || raw === '-' ? null : raw.startsWith('#') ? raw : `#${raw}`;
  const connection = dbFor(code);

  const shop = code
    ? await business()
        .findOne({ code })
        .select('_id code name businessType featureOverrides phone email address')
        .lean()
    : null;

  if (code && !shop) throw ApiError.notFound('Not found.', 'NOT_FOUND');

  return runInBusiness({ businessId: shop?._id ?? null, code, connection }, async () => {
    /**
     * The salt is the only thing that makes this findable, and it is not
     * indexed - so this is a scan of one business's customers. Acceptable
     * because it is bounded by a business rather than the installation, and
     * because the alternative is storing a lookup key, which is a second secret
     * in the database for a system whose whole point is that the secret is not
     * in the database.
     *
     * If this ever gets slow, the fix is an indexed non-secret lookup id in the
     * URL beside the HMAC - not a weaker token.
     */
    const candidates = await db()
      .User.find({ role: 'buyer', portalSalt: { $ne: null } })
      .select('+portalSalt contactName businessName email phone business tier storeCredit createdAt')
      .lean();

    const match = candidates.find(
      (candidate) =>
        candidate.portalSalt && tokensMatch(token, sign(code, candidate._id, candidate.portalSalt)),
    );

    if (!match) throw ApiError.notFound('Not found.', 'NOT_FOUND');

    const features = resolveFeatures({
      businessType: shop?.businessType ?? 'product',
      overrides: shop?.featureOverrides ?? null,
    });

    const context = { user: match, business: shop, features };
    // Still inside `runInBusiness`, which is what makes the caller's queries
    // land in this business's database rather than the default one.
    return work ? work(context) : context;
  });
}

// ---- serialisation ---------------------------------------------------------
//
// Each of these is an allow-list, written out field by field rather than
// spreading a document and deleting what should not go. A spread-and-delete is
// one forgotten field away from publishing a technician's private note, and
// nothing warns you; an allow-list fails the other way, by omitting something
// harmless until somebody notices it is missing.

function portalTicket(row) {
  return {
    number: row.ticketNumber,
    status: row.status,
    priority: row.priority,
    device: [row.deviceBrand, row.deviceModel].filter(Boolean).join(' ') || null,
    // The customer's own description of the fault. `technicianNotes` is
    // deliberately absent: it is where a technician writes "customer is
    // mistaken about the water damage", and it is not written for this screen.
    issue: row.issue,
    // Written to be read by the customer - that is the field's whole purpose,
    // and the reason the ticket carries two notes fields rather than one.
    notes: row.clientNotes || null,
    estimate: row.estimateCents || 0,
    total: row.finalCents || 0,
    promisedAt: row.dueDate ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function portalInvoice(row) {
  return {
    number: row.number,
    status: row.status,
    amount: row.amount ?? 0,
    paid: row.amountPaid ?? 0,
    balance: Math.max(0, (row.amount ?? 0) - (row.amountPaid ?? 0)),
    issuedAt: row.issuedAt,
    dueDate: row.dueDate ?? null,
  };
}

function portalQuote(row) {
  return {
    number: row.quoteNumber,
    status: row.status,
    total: row.total ?? 0,
    validUntil: row.validUntil ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * Payments, flattened off the invoices that hold them.
 *
 * There is no `Payment` collection - a payment is a subdocument of the invoice
 * it settles - so this list is assembled rather than queried. A reversed payment
 * is still listed and marked: a receipt that silently disappears is how a
 * customer ends up certain they paid twice.
 */
function portalPayments(invoices) {
  return invoices
    .flatMap((invoice) =>
      (invoice.payments ?? []).map((payment) => ({
        invoice: invoice.number,
        amount: payment.amount ?? 0,
        method: payment.method ?? null,
        reference: payment.reference ?? null,
        at: payment.at,
        reversedAt: payment.reversedAt ?? null,
      })),
    )
    .sort((a, b) => new Date(b.at) - new Date(a.at));
}

/**
 * A conversation entry, as the customer should see it.
 *
 * **Only what was actually said to them.** An internal note is a different
 * collection and never appears here; a `note`-channel message does, because that
 * channel exists precisely to record something said *to* the customer across a
 * counter.
 *
 * The staff member's name goes out - somebody reading "we called you on Tuesday"
 * should be able to see who - but their email, id and role do not.
 */
function portalMessage(row) {
  return {
    id: String(row._id),
    channel: row.channel,
    direction: row.direction,
    subject: row.subject || null,
    body: row.body || '',
    staffName: row.staffName || null,
    at: row.createdAt,
  };
}

/**
 * Everything one portal page needs, in one response.
 *
 * One call rather than seven: the page is read-only and shows all of it at once,
 * so seven round trips would buy nothing but seven chances to half-load.
 */
async function portalProfile(businessCode, token) {
  /**
   * The work runs INSIDE `openPortal`, not after it.
   *
   * `runInBusiness` opens the business database for the duration of one
   * function call. Reading the customer and then querying their tickets on
   * the way back out put every one of those queries on the default
   * connection, which holds none of this business’s records - so the portal
   * rendered a real customer with an empty history and no error to explain
   * it. Handing the work in is what keeps the context open around it.
   */
  return openPortal(businessCode, token, async ({ user, business: shop, features }) => {
    const has = (key) => featureEnabled(features, key);

    const [tickets, invoices, quotes, messages] = await Promise.all([
      has('sales.tickets')
        ? db().Ticket.find({ user: user._id }).sort({ createdAt: -1 }).limit(100).lean()
        : [],
      db().Invoice.find({ user: user._id }).sort({ issuedAt: -1 }).limit(100).lean(),
      has('sales.quotes') || has('sales.webquotes')
        ? db().Quote.find({ user: user._id }).sort({ createdAt: -1 }).limit(100).lean()
        : [],
      db().MessageLog.find({ user: user._id }).sort({ createdAt: -1 }).limit(100).lean(),
    ]);

    const outstanding = invoices.reduce(
      (sum, invoice) => sum + Math.max(0, (invoice.amount ?? 0) - (invoice.amountPaid ?? 0)),
      0,
    );

    return {
      business: shop
        ? {
            name: shop.name,
            type: shop.businessType,
            phone: shop.phone ?? null,
            email: shop.email ?? null,
            address: shop.address ?? null,
          }
        : null,

      // The person, not the company (§0). `businessName` is a detail about them
      // and is shown as one.
      customer: {
        name: user.contactName || user.businessName || 'Customer',
        businessName: user.businessName || null,
        email: user.email || null,
        phone: user.phone || null,
        since: user.createdAt,
        storeCredit: user.storeCredit ?? 0,
      },

      /**
       * What the page may render.
       *
       * The portal asks the same registry the panel does, so a business with
       * tickets switched off has no Tickets tab here either rather than an empty
       * one - and a product business's customer never sees a service portal's
       * shape by accident.
       */
      features: {
        tickets: has('sales.tickets'),
        quotes: has('sales.quotes'),
        webQuotes: has('sales.webquotes'),
        storeCredit: (user.storeCredit ?? 0) > 0,
      },

      summary: {
        tickets: tickets.length,
        openTickets: tickets.filter(
          (ticket) => ticket.status !== 'completed' && ticket.status !== 'cancelled',
        ).length,
        invoices: invoices.length,
        outstanding,
      },

      tickets: tickets.map(portalTicket),
      invoices: invoices.map(portalInvoice),
      quotes: quotes.filter((row) => row.source !== 'web').map(portalQuote),
      webQuotes: quotes.filter((row) => row.source === 'web').map(portalQuote),
      payments: portalPayments(invoices),
      messages: messages.map(portalMessage),
    };
  });
}

/** Forget the id→code cache. For tests, and after a business is renamed. */
function resetPortalCache() {
  codes.clear();
}

export { emailPortalLink, openPortal, portalLink, portalProfile, resetPortalCache, tokenFor };
export default portalProfile;
