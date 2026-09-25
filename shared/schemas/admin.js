import { z } from 'zod';
// The one password rule, shared rather than restated: an account an admin opens
// must not be allowed a weaker password than one a business opens for itself.
import { passwordSchema } from './auth.js';
import { DEFAULT_COUNTRY } from '../countries.js';
import { PROVINCES } from './checkout.js';
import { isValidPostal, postalExampleFor } from '../regions.js';
import { businessSlugProblem, customDomainProblem, normaliseDomain } from '../hosts.js';
// Identity colours, and the mapping that accepts the semantic tokens this
// field used to hold. See shared/businessPalette.js for why the two lists are
// separate now.
import {
  BUSINESS_COLOR_TOKENS as IDENTITY_COLOR_TOKENS,
  DEFAULT_BUSINESS_COLOR,
  migrateColorToken,
} from '../businessPalette.js';

/**
 * Accepts a legacy token and normalises it, rather than rejecting it.
 *
 * Every business in the database predates the identity palette and carries one
 * of the old semantic names. A bare enum would refuse the form the moment a
 * staff member opened an existing business and pressed Save on an unrelated field:
 * a validation error about a colour they never touched. Preprocessing maps the
 * old value across, so the edit succeeds and the record repairs itself.
 *
 * Defined here, beside the import, rather than next to the other business
 * constants further down - two schemas reference it and the first of them is
 * above that point, which is a use-before-initialisation the moment this
 * module is evaluated.
 */
const colorTokenSchema = z
  .preprocess(
    (value) => (value == null ? value : migrateColorToken(value)),
    z.enum(IDENTITY_COLOR_TOKENS),
  )
  .default(DEFAULT_BUSINESS_COLOR);

const cents = z.coerce.number().int().min(0).max(100_000_000);

/**
 * Approving a business is where credit terms get set - it is one decision, not
 * two, so the approval payload carries them.
 */
const approveUserSchema = z.object({
  creditLimit: cents.default(0),
  terms: z.enum(['prepaid', 'net15', 'net30', 'net60']).default('prepaid'),
  accountRep: z
    .object({
      name: z.string().trim().max(80).optional(),
      email: z.string().trim().email().or(z.literal('')).optional(),
      phone: z.string().trim().max(40).optional(),
    })
    .optional(),
});

const rejectUserSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason - it goes in the notification email.').max(400),
});

const creditSchema = z.object({
  creditLimit: cents,
  terms: z.enum(['prepaid', 'net15', 'net30', 'net60']),
});

/**
 * An admin opening a client account directly, rather than waiting for the
 * business to register itself (§7.2's `+ Create > Client`).
 *
 * Deliberately **not** `registerSchema` with extra fields. Two differences
 * matter enough to keep them apart: an admin-opened account defaults to
 * `approved` - the admin is the approval, and making them create a pending
 * account only to approve it a second later is a step that means nothing - and
 * the account it opens carries credit terms from the first moment, which a
 * self-registration never does.
 */
const clientSchema = z.object({
  // Optional: an account is identified by the person (§0). A private customer
  // or a sole trader may have no registered company name, and the endpoint has
  // to accept the account the form can now open.
  businessName: z.string().trim().max(160).optional(),
  contactName: z.string().trim().min(2, 'Enter a contact name.').max(80),
  // A real address, not the empty-string-tolerant idiom `supplierSchema` uses:
  // this one is the account's sign-in identity, so it cannot be blank.
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  phone: z.string().trim().min(7, 'Enter a phone number.').max(40),
  /**
   * No `password` field: an admin-opened account gets a generated one and the
   * credentials are emailed to the customer. An admin typing a password meant
   * they then had to pass it on out of band, which in practice was a phone
   * call or a second email nobody could audit.
   */
  businessType: z.string().trim().max(80).optional(),
  website: z.string().trim().max(200).optional(),
  taxId: z.string().trim().max(40).optional(),
  address: z
    .object({
      line1: z.string().trim().min(2, 'Enter a street address.').max(120),
      line2: z.string().trim().max(120).optional(),
      city: z.string().trim().min(2, 'Enter a city.').max(80),
      // `max(2)` was a Canadian assumption: `NSW` and `QLD` are three letters,
      // and a free-text region can be a word. The country decides what is valid.
      region: z.string().trim().min(2, 'Select a region.').max(60),
      postal: z.string().trim().min(1, 'Enter a postal code.').max(20),
      country: z.string().trim().max(60).default('Canada'),
    })
    .optional()
    .refine((address) => !address?.postal || isValidPostal(address.postal, address.country), {
      message: 'Enter a valid postal code.',
      path: ['postal'],
    }),
  status: z.enum(['pending', 'approved']).default('approved'),
  creditLimit: cents.default(0),
  terms: z.enum(['prepaid', 'net15', 'net30', 'net60']).default('prepaid'),
  /**
   * What the customer has told the admin they agree to be contacted on (CASL).
   *
   * Absent is not the same as all-false. An admin who ticked nothing has
   * recorded no answer, so `createUser` writes no consent record at all rather
   * than stamping four declines the customer never gave.
   */
  contactConsent: z
    .object({
      sms: z.boolean().default(false),
      whatsapp: z.boolean().default(false),
      email: z.boolean().default(false),
      call: z.boolean().default(false),
    })
    .optional(),
});

/**
 * What the admin's new-customer FORM validates, as opposed to what the endpoint
 * accepts.
 *
 * The difference is the address. On the wire an address is either absent or
 * complete, which is the right rule for stored data. In a form it is a set of
 * inputs that all start empty and get filled in some order, so validating them
 * as a required group would mark a blank optional section invalid the moment
 * anything else failed. Here the address block is checked only once somebody
 * has started it, and `ClientForm` drops it entirely when the street is blank.
 *
 * The address fields are also flat-optional rather than a nested `.optional()`
 * object, because React Hook Form always sends the sub-object - with empty
 * strings in it - and an `.optional()` wrapper never sees `undefined`.
 */
/**
 * The object half of `clientFormSchema`, exported so a form can reshape it.
 *
 * `clientFormSchema` itself is a `ZodEffects` once `.superRefine` is attached,
 * and a `ZodEffects` has no `.omit()` / `.extend()`. The new-customer form asks
 * for the contact's name as two fields and composes one `contactName` on
 * submit - the same trick the storefront sign-up plays - so it needs the plain
 * object to build from. Derived, never restated: a field added below is
 * validated on both forms.
 */
const clientFormBase = z
  .object({
    // Optional, and no longer the first thing asked for. An account is
    // identified by the person (§0): a sole trader or a walk-in customer may
    // have no registered company name at all, and requiring one turned an
    // optional detail into a barrier on the one form an admin fills in while
    // somebody is on the phone.
    businessName: z.string().trim().max(160).optional(),
    contactName: z.string().trim().min(2, 'Enter a contact name.').max(80),
    email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
    phone: z.string().trim().min(7, 'Enter a phone number.').max(40),
    businessType: z.string().trim().max(80).optional(),
    taxId: z.string().trim().max(40).optional(),
    status: z.enum(['pending', 'approved']),
    terms: z.enum(['prepaid', 'net15', 'net30', 'net60']),
    creditLimitDollars: z.string(),
    address: z.object({
      line1: z.string().trim().max(120),
      line2: z.string().trim().max(120),
      city: z.string().trim().max(80),
      region: z.string().trim().max(2),
      postal: z.string().trim(),
      // Defaulted rather than required: almost every account is Canadian, and
      // the field exists so the handful that are not can say so.
      country: z.string().trim().max(60).default('Canada'),
    }),
    contactConsent: z.object({
      sms: z.boolean(),
      whatsapp: z.boolean(),
      email: z.boolean(),
      call: z.boolean(),
    }),

    /**
     * Which channel to reach this customer on.
     *
     * **`contactConsent` above answers "may we", this answers "how".** They are
     * different questions and the first cannot stand in for the second: somebody
     * may consent to SMS, email and calls without that saying which one they
     * actually read. Every ticket status update goes out on this one channel, so
     * guessing wrong means messaging somebody who never sees it and then
     * wondering why nobody collected their device.
     *
     * Empty is a real answer and the default: it means nobody has asked yet,
     * which is different from choosing email. Treating silence as a choice would
     * start messaging people on a channel they never picked.
     */
    preferredContact: z.enum(['', 'sms', 'whatsapp', 'email', 'call']).optional(),

    /**
     * How this customer first reached the business.
     *
     * Attribution only - nothing reads it as authority. It answers "where is our
     * work coming from", which no other field on the record can. Distinct from
     * `referredBy`, which is the commission edge: a customer can be `referral`
     * here with nobody to pay, because a friend's recommendation earns no
     * commission and is still why they walked in.
     */
    source: z.enum(['', 'walk_in', 'call', 'web_quote', 'referral', 'kiosk']).optional(),
  });

/**
 * The address block's "started it, so finish it" rule, as a function.
 *
 * Named rather than inline so `clientFormSchema` and the new-customer form's
 * reshaped variant apply the identical check - an inline copy in each is how
 * two forms end up disagreeing about what a valid address is.
 */
const refineClientAddress = (values, ctx) => {
  const { line1, city, postal } = values.address;
  // Untouched block: nothing to check, and the form will not send it.
  if (!line1 && !city && !postal) return;

  if (line1.length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['address', 'line1'],
      message: 'Enter a street address.',
    });
  }
  if (city.length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['address', 'city'],
      message: 'Enter a city.',
    });
  }
  // The rule is the country's, not Canada's. This used to check `A1A 1A1` for
  // Canada and merely "at least three characters" for everywhere else, which
  // accepted `abc` as a US ZIP. `regions.js` knows the real pattern for the
  // countries Cellvix trades with, and honestly accepts anything for the ones
  // where there is no fixed format.
  const country = values.address.country || 'Canada';
  if (!postal || postal.length < 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['address', 'postal'],
      message: 'Enter a postal or ZIP code.',
    });
  } else if (!isValidPostal(postal, country)) {
    const example = postalExampleFor(country);
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['address', 'postal'],
      message: example ? `Enter a valid postal code (${example}).` : 'Enter a valid postal code.',
    });
  }
};

const clientFormSchema = clientFormBase.superRefine(refineClientAddress);

/**
 * What the new-customer **form** holds, which is not quite what the API takes.
 *
 * The contact's name is asked as two fields and stored as one, exactly as the
 * storefront sign-up does it: `contactName` is what the model, the welcome mail
 * and every admin screen read, so the halves are composed on submit rather than
 * split in the model. The resolver runs over this shape; `onSubmit` builds the
 * payload `clientFormSchema` describes.
 */
const clientCreateFormSchema = clientFormBase
  .omit({ contactName: true })
  .extend({
    firstName: z.string().trim().min(1, 'Enter a first name.'),
    lastName: z.string().trim().min(1, 'Enter a last name.'),
  })
  .superRefine(refineClientAddress);

/**
 * Editing a customer's profile.
 *
 * Not `clientSchema.partial()`: this endpoint writes a **strictly smaller set
 * of fields**. Password is absent because a reset is its own flow, and status,
 * `creditLimit` and `terms` are absent because each has an endpoint that does
 * more than set the field - an edit form that also wrote `status` would be a
 * second approval path with no reason, no rep and no audit trail of its own.
 *
 * The optional descriptors accept an empty string so a staff member can clear a
 * tax ID they typed by mistake; the identity fields keep `clientSchema`'s
 * minimums, because they are still what the account is known by.
 */
const clientUpdateSchema = z.object({
  // Accepts an empty string, like the other optional descriptors: an admin who
  // recorded a company name against what turned out to be a private customer
  // has to be able to clear it again.
  businessName: z.string().trim().max(160).optional(),
  contactName: z.string().trim().min(2, 'Enter a contact name.').max(80).optional(),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').optional(),
  phone: z.string().trim().min(7, 'Enter a phone number.').max(40).optional(),
  businessType: z.string().trim().max(80).optional(),
  website: z.string().trim().max(200).optional(),
  taxId: z.string().trim().max(40).optional(),
  // Both accept an empty string, so a staff member can clear a channel or an
  // attribution recorded by mistake and put the record back to "not asked yet".
  preferredContact: z.enum(['', 'sms', 'whatsapp', 'email', 'call']).optional(),
  source: z.enum(['', 'walk_in', 'call', 'web_quote', 'referral', 'kiosk']).optional(),
  address: z
    .object({
      line1: z.string().trim().min(2, 'Enter a street address.').max(120),
      line2: z.string().trim().max(120).optional(),
      city: z.string().trim().min(2, 'Enter a city.').max(80),
      region: z.string().trim().min(2, 'Select a province.').max(2),
      postal: z.string().trim().min(3, 'Enter a postal or ZIP code.'),
      country: z.string().trim().max(60).default('Canada'),
    })
    // The Canadian pattern is checked only on a Canadian address - see the note
    // on `clientFormSchema`. A UK or US address is valid and has its own shape.
    .superRefine((address, ctx) => {
      if ((address.country || 'Canada') !== 'Canada') return;
      if (!/^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(address.postal)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['postal'],
          message: 'Enter a valid postal code.',
        });
      }
    })
    .optional(),
});

/** The contact channels consent is recorded against (CASL, §6.13). */
const CONSENT_CHANNELS = ['sms', 'whatsapp', 'email', 'call'];

/**
 * The preferred-channel picker's options.
 *
 * The same four channels as `CONSENT_CHANNELS`, with an explicit empty first
 * entry: "not asked yet" is a real state and has to be selectable, so a
 * staff member can put a record back to it rather than being forced to leave a
 * guess behind.
 */
const PREFERRED_CONTACT_OPTIONS = [
  { value: '', label: 'Not asked yet' },
  { value: 'sms', label: 'SMS' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
  { value: 'call', label: 'Phone call' },
];

/**
 * Where a customer came from.
 *
 * `web_quote` is the storefront enquiry form and `kiosk` is the self-service
 * check-in - both are set by the system rather than typed, but they appear here
 * so a staff member editing the record can see and correct what was recorded.
 */
const CUSTOMER_SOURCE_OPTIONS = [
  { value: '', label: 'Not recorded' },
  { value: 'walk_in', label: 'Walk-in visit' },
  { value: 'call', label: 'Call' },
  { value: 'web_quote', label: 'Web quote' },
  { value: 'referral', label: 'Referral' },
  { value: 'kiosk', label: 'Kiosk check-in' },
];

/**
 * What a customer agreed to be contacted on.
 *
 * Every channel is required rather than optional: this endpoint records an
 * *answer*, and a partial payload would leave the unnamed channels at whatever
 * they were, which is indistinguishable from having been asked about them. The
 * form always sends all four.
 */
const contactConsentSchema = z.object({
  sms: z.boolean(),
  whatsapp: z.boolean(),
  email: z.boolean(),
  call: z.boolean(),
});

/** Membership tiers. A label - it never touches price (see the User model). */
const MEMBERSHIP_TIERS = [
  { value: 'standard', label: 'Standard' },
  { value: 'silver', label: 'Silver' },
  { value: 'gold', label: 'Gold' },
  { value: 'platinum', label: 'Platinum' },
];

const tierSchema = z.object({
  tier: z.enum(['standard', 'silver', 'gold', 'platinum']),
});

const internalNoteSchema = z.object({
  body: z.string().trim().min(1, 'Write the note.').max(2000),
});

/**
 * Admin store-credit allocation. Signed: a negative amount is a correction, and
 * the reason is required for one because "where did $200 go" is a question
 * somebody will ask later.
 */
const storeCreditSchema = z.object({
  amountDollars: z.coerce
    .number()
    .refine((value) => value !== 0, 'Enter an amount.')
    .refine((value) => Math.abs(value) <= 1_000_000, 'That is more than this form will take.'),
  note: z.string().trim().max(240).optional(),
});

/** Refunds go to store credit - see storeCreditService.refundOrder. */
const refundSchema = z.object({
  amountDollars: z.coerce.number().positive('Enter an amount to refund.'),
  note: z.string().trim().max(240).optional(),
});

const userStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'suspended']),
});

const productSchema = z.object({
  sku: z.string().trim().min(3, 'Enter a SKU.').max(40),
  name: z.string().trim().min(3, 'Enter a product name.').max(160),
  description: z.string().trim().max(2000).optional(),
  partType: z.string().trim().min(2, 'Enter a part type slug.'),
  partTypeLabel: z.string().trim().min(2, 'Enter a part type label.'),
  grade: z.enum(['NEW', 'OEM', 'PULL-A', 'PULL-B', 'AFTERMARKET']),
  price: cents,
  compareAtPrice: cents.optional(),
  stock: z.coerce.number().int().min(0).max(1_000_000),
  deviceTypeSlug: z.string().trim().min(1, 'Select a device type.'),
  brandSlug: z.string().trim().min(1, 'Select a brand.'),
  seriesSlug: z.string().trim().min(1, 'Select a series.'),
  modelSlug: z.string().trim().min(1, 'Select a model.'),
  isActive: z.boolean().default(true),
});

const ORDER_STATUS_FLOW = [
  'placed',
  'processing',
  'shipped',
  'out_for_delivery',
  'delivered',
];

/**
 * An order still owing somebody work: placed, and not yet delivered or
 * cancelled.
 *
 * **This exists so a count and its own link cannot disagree.** The dashboard's
 * "Open orders" tile counted these four statuses and then linked to
 * `?status=placed`, so a tile reading 2 opened a list showing one row - or an
 * empty one, when both open orders happened to be `shipped`. The staff member is
 * told a number and then shown something that contradicts it, which makes the
 * whole row untrustworthy.
 *
 * Exported as one list and read by both sides: the counter in
 * `adminService.stats`, the `?status=open` filter in `listOrders`, and the
 * pill on the orders screen.
 */
const ORDER_OPEN_STATUSES = ['placed', 'processing', 'shipped', 'out_for_delivery'];

/**
 * An order that has not gone out yet - the picking queue.
 *
 * Narrower than `ORDER_OPEN_STATUSES`: a shipped order is still open, but
 * nobody has to pack it. Same reason as above for existing as a shared list
 * the "Fulfil orders" card counts these two and has to link to the same two.
 */
const ORDER_UNFULFILLED_STATUSES = ['placed', 'processing'];

const orderStatusSchema = z.object({
  status: z.enum([...ORDER_STATUS_FLOW, 'cancelled']),
  note: z.string().trim().max(300).optional(),
  tracking: z
    .object({
      carrier: z.string().trim().max(60).optional(),
      number: z.string().trim().max(60).optional(),
      url: z.string().trim().max(300).optional(),
    })
    .optional(),
});

const CARRIERS = [
  { value: 'Purolator', label: 'Purolator', url: 'https://www.purolator.com/en/shipping/tracker' },
  {
    value: 'Canada Post',
    label: 'Canada Post',
    url: 'https://www.canadapost-postescanada.ca/track-reperage',
  },
  { value: 'FedEx Canada', label: 'FedEx Canada', url: 'https://www.fedex.com/fedextrack' },
  { value: 'UPS Canada', label: 'UPS Canada', url: 'https://www.ups.com/track' },
];

/**
 * The admin sidebar, two levels deep (ERP rework §5).
 *
 * Shape: a flat `Home` row, then six groups whose children are the real
 * screens. `icon` names a lucide export; the shell maps it - the schema stays
 * a plain data module so the server can read it too.
 *
 * `badge` names a counter on `GET /admin/stats`; the sidebar renders it when
 * the count is non-zero.
 *
 * `badgeLabel` is what that number COUNTS, as a noun the staff member would say
 * out loud - "waiting for approval", "out of stock or running low". It is not
 * decoration: a bare number in a sidebar is unreadable twice over. A sighted
 * staff member cannot tell whether "6" is unread, overdue or merely total, and a
 * screen reader announces "Tickets 6" with no clue what six means. The label
 * supplies the noun for both, as a `title`, an `aria-label` and a line in the
 * page header it lands on.
 *
 * `badgePhrase` is the same fact written as a standalone clause, for the
 * collapsed group's roll-up where several are joined with commas. Stitching
 * the label onto the row name produced "1 invoices overdue" and "4 rma /
 * returns still to resolve"; a written phrase costs one line each and reads
 * like English.
 *
 * It is written `[singular, plural]` because these counts pass through one
 * routinely - one overdue invoice is the good day, and "1 overdue invoices" in
 * the tooltip is exactly the kind of detail that makes an interface feel
 * unfinished.
 *
 * `badgeFilter` is the view that shows exactly the badged rows. The rule it
 * enforces: **a count must be reachable**. Inventory badged 189 and opened a
 * list of 420 with no 189 anywhere on it, which teaches a staff member that the
 * numbers are decorative. The row still navigates to the unfiltered page
 * that is what a nav row is for - and the page states the count and offers the
 * filter on arrival, so the number is explained where it is doubted rather
 * than only in a tooltip nobody hovers.
 *
 * `area` is the permission area this item lives under (§7.6). Group-level, so
 * every child inherits its parent's area - a per-page matrix is twenty rows
 * nobody maintains correctly.
 */
const ADMIN_NAV = [
  { key: 'home', label: 'Home', to: '/admin', icon: 'Home', area: 'home' },
  {
    key: 'sales',
    label: 'Sales',
    icon: 'ShoppingBag',
    area: 'sales',
    children: [
      {
        // "Customers" in the sidebar; the key and the route stay `clients`,
        // because the key is what highlighting and permissions match on and
        // the URL is linked to from the dashboard, the bell and bookmarks.
        key: 'clients',
        label: 'Customers',
        to: '/admin/clients',
        icon: 'Users',
        badge: 'pendingUsers',
        badgeLabel: 'waiting for approval',
        badgePhrase: ['customer waiting for approval', 'customers waiting for approval'],
        badgeFilter: 'status=pending',
      },
      {
        key: 'tickets',
        label: 'Tickets',
        to: '/admin/tickets',
        icon: 'ClipboardList',
        badge: 'openTickets',
        badgeLabel: 'open',
        badgePhrase: ['open ticket', 'open tickets'],
        badgeFilter: 'status=open',
      },
      {
        key: 'rma',
        // "Returns", not "RMA / Returns": the staff member says returns, and the
        // acronym was only ever there to disambiguate from the supplier-side
        // row, which is now switched off.
        label: 'Returns',
        to: '/admin/rma',
        icon: 'RotateCcw',
        badge: 'openRmas',
        badgeLabel: 'still to resolve',
        badgePhrase: ['return to resolve', 'returns to resolve'],
        badgeFilter: 'status=open',
      },
      { key: 'orders', label: 'Orders', to: '/admin/orders', icon: 'Package' },
      {
        key: 'invoices',
        label: 'Invoices',
        to: '/admin/invoices',
        icon: 'FileText',
        badge: 'overdueInvoices',
        badgeLabel: 'overdue',
        badgePhrase: ['overdue invoice', 'overdue invoices'],
        badgeFilter: 'status=overdue',
      },
      { key: 'quotes', label: 'Quotes', to: '/admin/quotes', icon: 'FileSignature' },
      // Enquiries from the storefront's contact form, before anybody has priced
      // them. Under Quotes because that is what they usually become.
      { key: 'web-quotes', label: 'Web Quote', to: '/admin/web-quotes', icon: 'Globe' },
      // The labour price list. Under Sales rather than Settings because it is
      // what the quote and ticket forms pick from every day, not something
      // configured once - and a price list buried two menus deep is a price
      // list that goes stale.
      { key: 'services', label: 'Services', to: '/admin/services', icon: 'Wrench' },
    ],
  },
  {
    key: 'purchase',
    label: 'Purchase',
    icon: 'ShoppingCart',
    area: 'purchase',
    children: [
      { key: 'suppliers', label: 'Suppliers', to: '/admin/suppliers', icon: 'Truck' },
      {
        // Requests for Quote used to sit above this row. It is gone: a purchase
        // order now carries its own bidding, so asking several suppliers and
        // recording what was bought are one record and one screen rather than
        // two that had to be read together (re-ruled 2026-09-11).
        key: 'pos',
        label: 'Purchase Orders',
        to: '/admin/purchase-orders',
        icon: 'ClipboardList',
      },
      {
        // The purchase-side counterpart of Sales § RMA: stock going back OUT to
        // a supplier, and a credit claimed rather than given.
        //
        // **Switched off for Cellvix, not deleted** (SAAS_PLATFORM §5.5). The
        // business does not return stock to suppliers, and the row was also the
        // second "RMA / Returns" in the sidebar - the same words under Sales
        // and under Purchase meaning opposite directions of travel, which is a
        // question the nav should never have been asking.
        //
        // The screen, its routes, its model and its schema all stay. Removing
        // `hidden` is the whole of switching it back on.
        key: 'supplier-returns',
        label: 'RMA / Returns',
        to: '/admin/supplier-returns',
        icon: 'RotateCcw',
        hidden: true,
      },
      {
        key: 'supplier-subscriptions',
        label: 'Subscription Plans',
        to: '/admin/supplier-subscriptions',
        icon: 'CalendarClock',
      },
      {
        key: 'supplier-services',
        label: 'Service Products',
        to: '/admin/supplier-services',
        icon: 'Wrench',
      },
      { key: 'expenses', label: 'Expenses', to: '/admin/expenses', icon: 'Receipt' },
      {
        key: 'inventory',
        label: 'Inventory',
        to: '/admin/inventory',
        icon: 'Boxes',
        badge: 'lowStock',
        // Two conditions in one number, so the label says both rather than
        // leaving "189" to be read as one of them.
        badgeLabel: 'out of stock or running low',
        badgePhrase: [
          'product out of stock or running low',
          'products out of stock or running low',
        ],
        badgeFilter: 'stock=attention',
      },
    ],
  },
  {
    key: 'reports',
    label: 'Reports',
    icon: 'BarChart3',
    area: 'reports',
    children: [
      { key: 'business', label: 'Business Overview', to: '/admin/reports/business', icon: 'LineChart' },
      // `isDefault` marks the view a bare `/admin/reports` lands on. The page
      // deletes `?tab=summary` from the URL rather than carrying a redundant
      // parameter, so without this the sidebar would highlight nothing there.
      {
        key: 'summary',
        label: 'Summary',
        to: '/admin/reports?tab=summary',
        icon: 'PieChart',
        isDefault: true,
      },
      { key: 'pl', label: 'Profit & Loss', to: '/admin/reports?tab=pl', icon: 'Scale' },
      { key: 'r-sales', label: 'Sales', to: '/admin/reports?tab=sales', icon: 'FileText' },
      { key: 'r-expense', label: 'Expense', to: '/admin/reports?tab=expense', icon: 'Receipt' },
      { key: 'r-inv', label: 'Inventory', to: '/admin/reports?tab=inventory', icon: 'Boxes' },
      { key: 'r-tax', label: 'Tax', to: '/admin/reports?tab=tax', icon: 'Percent' },
      { key: 'r-staff', label: 'Staff Performance', to: '/admin/reports?tab=staff', icon: 'Users' },
    ],
  },
  {
    key: 'marketing',
    label: 'Marketing',
    icon: 'Megaphone',
    area: 'marketing',
    children: [
      { key: 'calls', label: 'Call', to: '/admin/marketing/calls', icon: 'Phone' },
      { key: 'email', label: 'Email', to: '/admin/marketing/email', icon: 'Mail' },
      { key: 'sms', label: 'SMS', to: '/admin/marketing/sms', icon: 'MessageSquare' },
      { key: 'whatsapp', label: 'WhatsApp', to: '/admin/marketing/whatsapp', icon: 'MessageCircle' },
      /**
       * Offers and Referrals moved to Settings → Financial on 2026-09-21, at
       * the client's request.
       *
       * Both are configuration rather than campaigns: a promo code and a
       * commission percentage are set once and left, where the rows above this
       * are things a staff member sends. The nav rows are gone; the screens
       * and their routes are unchanged, and `requireFeature` still gates them
       * on `marketing.offers` / `marketing.referrals` - a feature key names a
       * capability, not a screen's position in a menu.
       */
    ],
  },
  {
    /**
     * Content published to the storefront for search engines and shoppers to
     * find, as opposed to Marketing, which is outbound: campaigns, calls and
     * offers pushed AT a known audience.
     *
     * Blog and FAQ were under Marketing because they are things you publish,
     * but publishing is where the similarity ends - nobody writes a help
     * article as part of a campaign, and a staff member looking for one had to
     * think of it as marketing first. They keep their `/admin/marketing/*`
     * URLs: those are bookmarked and linked from the storefront, and moving a
     * row in the nav is not a reason to break a link.
     */
    key: 'seo',
    label: 'SEO',
    icon: 'Globe',
    // Under `marketing` rather than a new permission area: a role that can
    // publish a campaign can publish a help article, and a seventh area is a
    // column nobody maintains correctly in the roles matrix (§7.6).
    area: 'marketing',
    children: [
      { key: 'blog', label: 'Blog', to: '/admin/marketing/blog', icon: 'Newspaper' },
      { key: 'faq', label: 'FAQ', to: '/admin/marketing/faq', icon: 'HelpCircle' },
      { key: 'articles', label: 'Articles', to: '/admin/marketing/articles', icon: 'FileText' },
      { key: 'reviews', label: 'Reviews', to: '/admin/marketing/reviews', icon: 'Star' },
    ],
  },
  {
    key: 'business',
    label: 'Businesses',
    icon: 'Store',
    area: 'business',
    children: [
      { key: 'business-list', label: 'All Businesses', to: '/admin/businesses', icon: 'List' },
      { key: 'business-add', label: 'Add Business', to: '/admin/businesses/add', icon: 'PlusCircle' },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: 'Settings',
    area: 'settings',
    children: [
      { key: 's-summary', label: 'Summary', to: '/admin/settings', icon: 'LayoutGrid' },
      {
        key: 's-business',
        label: 'Business',
        to: '/admin/settings?cat=business',
        icon: 'Building2',
      },
      { key: 's-finance', label: 'Financial', to: '/admin/settings?cat=financial', icon: 'Coins' },
      {
        key: 's-users',
        label: 'Users & Access',
        to: '/admin/settings?cat=users',
        icon: 'UsersRound',
      },
      {
        key: 's-sched',
        label: 'Scheduling & Booking',
        to: '/admin/settings?cat=scheduling',
        icon: 'CalendarDays',
      },
      {
        key: 's-comms',
        // The sidebar is 220px wide; the full name is what the breadcrumb and
        // the Settings summary card use.
        label: 'Communications',
        to: '/admin/settings?cat=communications',
        icon: 'Bell',
      },
      {
        key: 's-system',
        label: 'System & Logs',
        to: '/admin/settings?cat=system',
        icon: 'ClipboardList',
      },
      {
        key: 's-api',
        label: 'Integrations & API',
        to: '/admin/settings?cat=integrations',
        icon: 'Plug',
      },
    ],
  },
  {
    /*
      The tenant's line to the platform (SAAS_PLATFORM §4.5).

      **A top-level row, not a Settings child.** It sat under Settings because
      it concerns the account rather than the shop's trading - but Settings is
      where you go to change how this business works, and this is where you go
      when something is wrong with it. Somebody looking for help does not think
      "this is a setting", and burying the support line one level down inside
      the longest menu in the panel is the wrong place for the thing you reach
      for when you are already stuck.

      It carries no `area`: reaching the people who run the platform is not a
      capability a role grants or withholds.
    */
    key: 'support',
    label: 'Kelinto support',
    to: '/admin/support',
    icon: 'LifeBuoy',
  },
];

/**
 * Old flat-admin URLs, kept alive as redirects rather than 404s (§4). Someone
 * has `/admin/products` bookmarked and there is no reason to punish them.
 */
const ADMIN_LEGACY_REDIRECTS = {
  '/admin/approvals': '/admin/clients?status=pending',
  '/admin/products': '/admin/inventory',
  '/admin/customers': '/admin/clients',
  '/admin/offers': '/admin/marketing/offers',
  '/admin/blog': '/admin/marketing/blog',
  '/admin/faqs': '/admin/marketing/faq',
  '/admin/expenses/categories': '/admin/settings/expense-categories',
  // Requests for quote folded into the purchase order on 2026-09-11. A
  // bookmarked or emailed `/admin/rfqs` link lands on the screen that now does
  // that job rather than on a 404 that says only that something used to exist.
  '/admin/rfqs': '/admin/purchase-orders',
  // Invoice messages folded into Invoice statuses as a tab on 2026-09-21: two
  // sibling settings screens with near-identical names meant reading the menu
  // twice to find either. The old path keeps working for a bookmark.
  '/admin/settings/invoice-status': '/admin/settings/invoice-labels',
};

/**
 * Recording a payment against an invoice.
 *
 * The client sends an amount, a date, a method and a reference - never a status
 * and never a running total. `amountPaid` and the invoice status are both
 * recomputed server-side from the payment rows.
 */
const invoicePaymentSchema = z.object({
  amountDollars: z.coerce.number().positive('Enter an amount to record.'),
  at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.')
    .optional(),
  method: z.string().trim().max(40).optional(),
  reference: z.string().trim().max(80).optional(),
});

/**
 * Correcting an invoice, the clerical half.
 *
 * The due date, the PO reference and the note - what the detail screen's
 * inline controls send. `invoiceUpdateSchema` below accepts this OR the full
 * invoice body the edit page sends; this half is the one that carries no
 * `user`, which is how the two are told apart.
 */
const invoiceClericalSchema = z.object({
  dueDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a due date.').optional(),
  poNumber: z.string().trim().max(60).or(z.literal('')).optional(),
  note: z.string().trim().max(500).or(z.literal('')).optional(),
});

/** Cash paid against the line of credit. Spread across unpaid invoices server-side. */
const creditPaymentSchema = z.object({
  amountDollars: z.coerce.number().positive('Enter an amount to record.'),
  method: z.string().trim().max(40).optional(),
  reference: z.string().trim().max(80).optional(),
});

/** Moving a web enquiry through the queue. Three states, nothing else. */
const webQuoteStatusSchema = z.object({
  status: z.enum(['new', 'read', 'closed']),
});

const invoiceVoidSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason - it stays on the invoice.').max(240),
});

/**
 * Bulk order status advancement.
 *
 * Same rule as the single-order route: only forward transitions, and the server
 * decides which of the selected orders can actually make the move rather than
 * trusting the client's selection.
 */
const bulkOrderStatusSchema = z.object({
  orderNumbers: z
    .array(z.string().trim().min(3))
    .min(1, 'Select at least one order.')
    .max(100, 'That is more orders than this action will take at once.'),
  status: z.enum([...ORDER_STATUS_FLOW, 'cancelled']),
  note: z.string().trim().max(300).optional(),
});

// ---- phase 5: purchase ------------------------------------------------------

/**
 * A supplier. `paymentTerms` reuses the same vocabulary as a client's line of
 * credit, read the other way round - what Cellvix owes, not what it is owed.
 */
const supplierSchema = z.object({
  name: z.string().trim().min(2, 'Enter a supplier name.').max(120),
  code: z.string().trim().max(20).optional(),
  email: z.string().trim().email('Enter a valid email.').or(z.literal('')).optional(),
  phone: z.string().trim().max(40).optional(),
  contactName: z.string().trim().max(80).optional(),
  website: z.string().trim().max(200).optional(),
  address: z
    .object({
      line1: z.string().trim().max(120).optional(),
      line2: z.string().trim().max(120).optional(),
      city: z.string().trim().max(80).optional(),
      region: z.string().trim().max(2).optional(),
      postal: z.string().trim().max(10).optional(),
      // A country **name**, matching customers and businesses - not the 2-letter
      // code this field briefly held. One convention across the app is what
      // lets `COUNTRY_OPTIONS` serve every address form (see shared/countries).
      country: z.string().trim().max(60).default(DEFAULT_COUNTRY),
    })
    .optional(),
  paymentTerms: z.enum(['prepaid', 'net15', 'net30', 'net60']).default('net30'),
  /**
   * The agreements this supplier signs before they may quote.
   *
   * A list, because a supplier often signs more than one thing: the master
   * supply agreement, an NDA, a quality annex for one product line. An empty
   * array means none is required, which is a real answer for a supplier whose
   * paperwork was done on paper, and is distinct from omitting the field (which
   * leaves the current list alone).
   */
  agreementTemplates: z.array(z.string().trim().length(24)).max(20).optional(),
  notes: z.string().trim().max(2000).optional(),
  isActive: z.boolean().default(true),
  /**
   * The component types this supplier is tagged with - `Product.partType`
   * slugs, which is what a request for quote picks suppliers by.
   *
   * Not an enum: the list of component types is derived from the catalogue
   * (`taxonomyService.getComponentTypes`), so hard-coding one here would be a
   * second source of truth that goes stale the first time a new part type is
   * stocked. The picker offers the live list; this just validates the shape.
   */
  componentTypes: z.array(z.string().trim().min(1).max(60)).max(60).default([]),
  // Optional, unlike the customer-side `contactConsentSchema`, which is a
  // dedicated endpoint recording an answer. This rides along on a create or an
  // edit that may not have touched the ticks at all, and omitting it has to
  // mean "unchanged" rather than "all four declined".
  contactConsent: contactConsentSchema.optional(),
});

/**
 * A purchase-order line.
 *
 * `unitCost` is what Cellvix pays and **is** sent by the client - unlike a
 * sales price, which is always read from the catalogue. A purchase price is
 * negotiated per order and has no server-side source of truth to read it from;
 * what the server still owns is every total computed from it (§8, invariant 8).
 */
const purchaseOrderItemSchema = z.object({
  product: z.string().trim().min(1, 'Pick a product.'),
  qtyOrdered: z.coerce.number().int().min(1, 'Order at least one.').max(100_000),
  // Optional since the bidding rework: a line is raised to ask what it costs,
  // and the price arrives from the confirmed supplier's bid. A cost typed at
  // this stage is a starting expectation, not the figure the order is placed at.
  unitCost: cents.default(0),
});

/**
 * Raising a purchase order.
 *
 * **`supplier` is gone and `suppliers` replaces it** (re-ruled 2026-09-11). An
 * order is now put to several suppliers and confirmed to one, so at the moment
 * it is raised there is nobody it is with yet - naming a single required
 * supplier would mean picking the winner before anybody had quoted.
 *
 * `unitCost` is likewise no longer collected here: the whole point of sending
 * the order out is to find out what it costs. `confirmSupplier` copies the
 * winning bid's prices on to the lines.
 */
const purchaseOrderSchema = z.object({
  title: z.string().trim().max(200).optional(),
  componentTypes: z.array(z.string().trim().min(1).max(60)).max(60).default([]),
  items: z.array(purchaseOrderItemSchema).min(1, 'Add at least one line.').max(200),
  suppliers: z.array(z.string().trim().min(1)).max(50).default([]),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.').optional(),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.').optional(),
  // A full timestamp, not a calendar day: "answers close Friday at 5" is a real
  // deadline, where a bare date leaves whether Friday itself counts unanswered.
  closesAt: z.string().trim().max(40).optional().or(z.literal('')),
  tax: cents.default(0),
  shipping: cents.default(0),
  notes: z.string().trim().max(2000).optional(),
});

/** `draft → sent` and `cancelled` are the only staff member-chosen transitions. */
const purchaseOrderStatusSchema = z.object({
  status: z.enum(['sent', 'cancelled']),
  note: z.string().trim().max(300).optional(),
});

/**
 * Receiving. The client sends quantities received **in this delivery**, never a
 * running total and never a status: the status is derived from whether any line
 * is still short, and stock is incremented server-side with a `StockMovement`
 * written for each line (§6.8, automation contract).
 */
const purchaseReceiveSchema = z.object({
  lines: z
    .array(
      z.object({
        sku: z.string().trim().min(1),
        qty: z.coerce.number().int().min(0).max(100_000),
      }),
    )
    .min(1, 'Nothing to receive.')
    .max(200),
  note: z.string().trim().max(300).optional(),
});

/** Recording a PO payment creates an `Expense` row - server-side, once. */
const purchasePaymentSchema = z.object({
  method: z.string().trim().max(40).optional(),
  reference: z.string().trim().max(80).optional(),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.').optional(),
  category: z.string().trim().optional(),
});

// ---- requests for quote (supplier process flow, §6.8a) ----------------------

/**
 * A request for quote: one line list, several suppliers, no prices.
 *
 * `componentTypes` is what the suppliers were **chosen by**, and it is sent
 * alongside the lines rather than derived from them - a clerk who picks
 * "battery", invites the battery suppliers and then adds a screen to the list
 * has still asked the battery suppliers, and recomputing would rewrite that.
 */
/** Adding suppliers to an order that is already being priced. */
const purchaseInviteSchema = z.object({
  supplierIds: z.array(z.string().trim().min(1)).min(1, 'Pick a supplier.').max(50),
});

const purchaseSendSchema = z.object({
  note: z.string().trim().max(300).optional(),
});

/**
 * Pushing back on a supplier's price.
 *
 * Either a target for the whole order or a per-line ask - both are optional,
 * because "can you do better?" with a note and no number is a real opening
 * move. What is never accepted is a total: `askedTotal` is what we are *asking
 * for*, and the supplier's answer arrives as a fresh bid that is recomputed
 * from its own lines.
 */
const purchaseNegotiateSchema = z.object({
  askedTotal: cents.optional(),
  askedLines: z
    .array(z.object({ sku: z.string().trim().min(1), unitCost: cents.default(0) }))
    .max(200)
    .default([]),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Confirming the supplier this order is placed with.
 *
 * The client names the **supplier**, never a price: the costs the order carries
 * are the ones that supplier already submitted, read from their stored bid. A
 * price in this payload would be a way to confirm one number and order at
 * another.
 */
/**
 * Sending a proforma invoice back for a new one.
 *
 * The note is required and is shown to the supplier verbatim: "please revise"
 * with no reason is a round trip that teaches them nothing, and they will guess
 * - usually at the wrong line.
 */
const proformaRevisionSchema = z.object({
  note: z
    .string()
    .trim()
    .min(1, 'Say what needs changing - the supplier sees this.')
    .max(2000),
});

const purchaseConfirmSchema = z.object({
  supplierId: z.string().trim().min(1, 'Pick the supplier to confirm.'),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.').optional().or(z.literal('')),
  note: z.string().trim().max(300).optional(),
});

/**
 * A supplier's price, submitted from the portal.
 *
 * **The one payload in this app where a price is accepted and kept**, because
 * collecting prices from outside is the entire purpose of sending the order
 * out. Lines are matched against the order's own SKUs server-side, so a
 * supplier cannot add a line nobody asked for, and every total is still
 * recomputed against **our** quantities (§8).
 *
 * `available: false` is how a supplier says "not this one" - distinct from a
 * price of zero, which is a legitimate answer for a sample.
 */
const supplierQuoteSchema = z.object({
  lines: z
    .array(
      z.object({
        sku: z.string().trim().min(1),
        unitCost: cents.default(0),
        /**
         * How many they can actually supply.
         *
         * **Short is the normal case, not an error.** A supplier with 30 of the
         * 40 we asked for had only two ways to answer: quote for 40 they cannot
         * ship, or mark the line unavailable and lose the 30 they can. Both are
         * worse than the truth. Omitted means "all of them", which is what
         * every quote sent before this field existed meant.
         *
         * Capped at what we asked for server-side: a supplier offering *more*
         * than the order wants is not a quote, it is a different order.
         */
        qty: z.coerce.number().int().min(0).max(1_000_000).optional(),
        available: z.boolean().default(true),
        note: z.string().trim().max(300).optional(),
      }),
    )
    .min(1, 'Price at least one line.')
    .max(200),
  tax: cents.default(0),
  shipping: cents.default(0),
  leadTimeDays: z.coerce.number().int().min(0).max(365).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.').optional().or(z.literal('')),
  note: z.string().trim().max(2000).optional(),
});

const supplierDeclineSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

/**
 * A proforma invoice, raised by the supplier against an order they have priced.
 *
 * **No totals are accepted.** The supplier states their reference, their terms
 * and their bank details; every figure on the document is computed from the bid
 * lines already stored. A PI whose total disagreed with the prices it was
 * raised from would be a document nobody could reconcile.
 */
const supplierProformaSchema = z.object({
  number: z.string().trim().max(60).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.').optional().or(z.literal('')),
  /**
   * What the supplier is actually invoicing, at **their** quantities.
   *
   * A quantity is accepted here - the same exception a unit cost gets on a bid,
   * and for the same reason: the point of a proforma is the supplier saying what
   * they will ship, and a short line or a case pack that rounds 36 up to 40 has
   * to be expressible or the document cannot be reconciled against the invoice
   * that follows it. Zero means "cannot supply this after all".
   *
   * Omitting `lines` entirely means "as quoted, at the quantities you asked
   * for", which is what every proforma meant before line detail existed.
   * Totals are never accepted - the server recomputes all three from these.
   */
  lines: z
    .array(
      z.object({
        sku: z.string().trim().min(1),
        qty: z.coerce.number().int().min(0).max(1_000_000),
        unitCost: cents.optional(),
        note: z.string().trim().max(300).optional(),
      }),
    )
    .max(200)
    .optional(),
  tax: cents.optional(),
  shipping: cents.optional(),
  paymentTerms: z.string().trim().max(300).optional(),
  bankDetails: z.string().trim().max(1000).optional(),
  note: z.string().trim().max(2000).optional(),
});

/** What the confirmed supplier reports about getting the goods to us. */
const supplierDeliverySchema = z.object({
  status: z.enum(['pending', 'preparing', 'dispatched', 'in_transit', 'delivered']),
  carrier: z.string().trim().max(120).optional(),
  trackingNumber: z.string().trim().max(120).optional(),
  expectedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.').optional().or(z.literal('')),
  note: z.string().trim().max(1000).optional(),
});

// ---- the supplier portal's own session --------------------------------------

const supplierLoginSchema = z.object({
  email: z.string().trim().email('Enter a valid email.'),
  password: z.string().min(1, 'Enter your password.'),
});

// ---- the super-admin console (SAAS_PLATFORM §4.5) ---------------------------

const superAdminLoginSchema = z.object({
  email: z.string().trim().email('Enter a valid email.'),
  password: z.string().min(1, 'Enter your password.'),
});

const tenantSchema = z.object({
  name: z.string().trim().min(1, 'Give the tenant a name.').max(120),
  // Derived from the name when omitted - the service slugifies either way, so
  // this never has to be typed.
  slug: z.string().trim().max(60).optional(),
  status: z.enum(['active', 'past_due', 'suspended', 'cancelled']).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactEmail: z.string().trim().email('Enter a valid email.').optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional(),
  slots: z.coerce.number().int().min(0).max(500).optional(),
  plan: z.string().trim().optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional(),
});

const tenantSlotsSchema = z.object({
  slots: z.coerce.number().int().min(0, 'Slots cannot be negative.').max(500),
});

/**
 * A business's web address: the `<slug>.<platform>` label. Shared by create
 * and by the address editor so both refuse the same things for the same reason
 * (`shared/hosts.js`). The server re-checks, and adds the one test this cannot
 * make: whether another business already holds it.
 */
const businessSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((value, ctx) => {
    const problem = businessSlugProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

const superAdminBusinessSchema = z.object({
  name: z.string().trim().min(1, 'Give the business a name.').max(120),
  businessType: z.enum(['product', 'service', 'both']),
  colorToken: colorTokenSchema.optional(),
  // Optional: derived from the name when left blank, so a quick create still
  // gives the business somewhere to be reached.
  slug: businessSlugSchema.optional().or(z.literal('')),
});

/**
 * Where a business answers: its slug, and optionally a domain it owns.
 *
 * The domain is checked for shape here and against the platform's own domains
 * on the server, which is the only side that knows them. Empty clears it.
 */
/** A tenant asking for a web address. The platform approves it. */
const addressRequestSchema = z.object({
  slug: businessSlugSchema,
});

/** Turning a request down. The reason is shown to the tenant, so it is required. */
const addressRejectSchema = z.object({
  note: z.string().trim().min(1, 'Say why, so the business can ask for something else.').max(500),
});

/** A domain the business owns, as typed or pasted. Empty clears it. */
const customDomainField = z
  .string()
  .transform(normaliseDomain)
  .superRefine((value, ctx) => {
    const problem = customDomainProblem(value);
    if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  })
  .optional()
  .or(z.literal(''));

const businessAddressSchema = z
  .object({
    slug: businessSlugSchema,
    // Where the business's customers go: its storefront.
    domain: customDomainField,
    // Where its staff go: its ERP panel, on a domain it owns.
    panelDomain: customDomainField,
  })
  .superRefine((value, ctx) => {
    if (value.domain && value.panelDomain && value.domain === value.panelDomain) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['panelDomain'],
        message: 'One address cannot be both the website and the ERP. Use a second one, like app.' + value.domain + '.',
      });
    }
  });

const businessAssignSchema = z.object({
  // Empty unassigns, which is a different act from moving it and has to stay
  // expressible.
  tenant: z.string().trim().optional().or(z.literal('')),
});

/**
 * One message in a tenant's support conversation (SAAS_PLATFORM §4.5).
 *
 * `business` is optional and only meaningful from the platform side - the
 * tenant's own messages are pinned to whichever business they are working in,
 * which the server already knows and does not need to be told.
 */
const supportMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write something first.')
    .max(5000, 'That is longer than a support message should be.'),
  business: z.string().trim().optional().or(z.literal('')),
});

/**
 * The tenant's own administrator (SAAS_PLATFORM §6 phase 16).
 *
 * **No password field, deliberately.** The owner sets their own through the
 * invitation link; a console that collected one would mean every tenant's first
 * credential passed through a staff member's hands.
 */
const tenantOwnerSchema = z.object({
  contactName: z.string().trim().min(1, 'Give the owner a name.').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email.'),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  // Optional only while the tenant has exactly one business - the service
  // refuses to guess when there are several.
  business: z.string().trim().optional().or(z.literal('')),
});

/**
 * Stepping into a business for support (SAAS_PLATFORM §4.5).
 *
 * **`reason` is required and has no default.** It is written into the tenant's
 * own activity log, where their owner reads it - a reason nobody had to type
 * would render as a filled-in field carrying no information, which is worse
 * than an empty one because it looks answered.
 */
const impersonationSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(4, 'Say why you are stepping in - the business owner sees this.')
    .max(500),
  // Bounded server-side too; this keeps the console from offering a standing key.
  minutes: z.coerce.number().int().min(5).max(240).optional(),
});

/**
 * Switching one feature for one business.
 *
 * `enabled` is **nullable on purpose**: `null` clears the override and returns
 * the key to its plan or business-type default, which is not the same as
 * switching it off. A boolean-only field would make "back to default"
 * unreachable from the console.
 */
const businessFeatureSchema = z.object({
  key: z.string().trim().min(1),
  enabled: z.boolean().nullable(),
});

const planSchema = z.object({
  name: z.string().trim().min(1, 'Give the plan a name.').max(80),
  slug: z.string().trim().max(60).optional(),
  description: z.string().trim().max(500).optional(),
  priceCents: cents.default(0),
  includedSlots: z.coerce.number().int().min(0).max(500).default(1),
  // A retired plan keeps its subscribers and stops being offered, so this is an
  // edit rather than a deletion.
  isActive: z.boolean().optional(),
});

/**
 * One feature default on a plan.
 *
 * `null` clears the key so it falls back to the business type - a different act
 * from switching it off, and the only way back to a default, exactly as it is
 * on a per-business override.
 */
const planFeatureSchema = z.object({
  key: z.string().trim().min(1),
  enabled: z.boolean().nullable(),
});

/**
 * A business's own trading status, distinct from its tenant's subscription.
 *
 * The values are spelled out rather than referencing `BUSINESS_STATUSES`, which
 * is declared further down this file - a `const` read before its declaration is
 * a temporal-dead-zone error at module load, not a hoisted undefined.
 */
const businessStatusSchema = z.object({
  status: z.enum(['active', 'inactive', 'maintenance']),
});

const supplierForgotSchema = z.object({
  email: z.string().trim().email('Enter a valid email.'),
});

/** Mirrors the buyer-side password rule, so both sides hold one standard. */
const supplierPortalPassword = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(128)
  .regex(/[A-Za-z]/, 'Include a letter.')
  .regex(/[0-9]/, 'Include a number.');

const supplierResetSchema = z.object({
  token: z.string().trim().min(10),
  password: supplierPortalPassword,
});

const supplierPasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  password: supplierPortalPassword,
});

const expenseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.'),
  description: z.string().trim().min(2, 'Say what this was for.').max(240),
  category: z.string().trim().min(1, 'Pick a category.'),
  payee: z.string().trim().max(120).optional(),
  method: z.string().trim().max(40).optional(),
  status: z.enum(['pending', 'paid']).default('paid'),
  amount: cents.refine((value) => value > 0, 'Enter an amount.'),
  tax: cents.default(0),
  taxIncluded: z.boolean().default(true),
  reference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const expenseCategorySchema = z.object({
  name: z.string().trim().min(2, 'Enter a category name.').max(60),
  colorToken: z.string().trim().max(24).default('ink'),
  gstApplicable: z.boolean().default(true),
  isActive: z.boolean().default(true),
  order: z.coerce.number().int().min(0).max(999).default(0),
});

/**
 * A manual stock adjustment.
 *
 * Signed, and the reason is required: "why is this 40 and not 47" is a question
 * somebody asks later, and an unexplained correction cannot answer it.
 */
const stockAdjustSchema = z.object({
  qtyChange: z.coerce
    .number()
    .int()
    .refine((value) => value !== 0, 'Enter a change.')
    .refine((value) => Math.abs(value) <= 1_000_000, 'That is more than this form will take.'),
  type: z.enum(['adjustment', 'damage', 'return', 'transfer']).default('adjustment'),
  note: z.string().trim().min(3, 'Give a reason - it stays on the movement.').max(300),
});

/** The ERP fields on a product (§6.10). Separate from `productSchema` so the
 *  existing product form is unchanged and this can be sent on its own. */
const productOpsSchema = z.object({
  minStock: z.coerce.number().int().min(0).max(1_000_000).default(0),
  cost: cents.default(0),
  location: z.string().trim().max(40).optional(),
  supplier: z.string().trim().optional(),
  barcode: z.string().trim().max(60).optional(),
});

// ---- phase 7: quotes & RMA --------------------------------------------------

/**
 * A quote line.
 *
 * `unitPrice` **is** sent by the client here, unlike a sale - a quote is a
 * negotiated number and has no server-side source of truth to read it from.
 * Zero means "use the catalogue price", so a staff member quoting at list does not
 * have to retype it. Every total computed from it stays the server's.
 */
const quoteItemSchema = z.object({
  product: z.string().trim().min(1, 'Pick a product.'),
  qty: z.coerce.number().int().min(1, 'Quote at least one.').max(100_000),
  unitPrice: cents.default(0),
});

const quoteSchema = z.object({
  user: z.string().trim().min(1, 'Pick a client.'),
  items: z.array(quoteItemSchema).min(1, 'Add at least one line.').max(200),
  shipping: cents.default(0),
  validUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.')
    .optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * `converted` is absent on purpose: that status is written only as the result
 * of an order actually being created, never chosen by hand. A status that can
 * be set directly is a status that can lie about whether an order exists.
 */
const quoteStatusSchema = z.object({
  status: z.enum(['sent', 'accepted', 'rejected']),
  note: z.string().trim().max(300).optional(),
});

/**
 * Conversion. `acknowledgeDrift` is the admin confirming they have seen the
 * catalogue prices that moved since the quote was issued - without it the
 * server refuses and returns the comparison instead.
 */
const quoteConvertSchema = z.object({
  acknowledgeDrift: z.boolean().default(false),
  deliveryCode: z.enum(['ground', 'express', 'pickup']).default('ground'),
});


/**
 * An admin raising an order directly - a phone order, a walk-in, an account
 * that placed it by email (§7.2's `+ Create > Order`).
 *
 * Shaped like `quoteSchema` because it is the same act one step further along,
 * and `unitPrice` carries the same meaning: zero means "use the catalogue
 * price". What it does **not** carry is any total, discount or tax - those are
 * recomputed server-side from live products, exactly as at checkout, because a
 * client that can send a price is a client that can set one.
 */
const adminOrderSchema = z.object({
  user: z.string().trim().min(1, 'Pick a customer.'),
  items: z.array(quoteItemSchema).min(1, 'Add at least one line.').max(200),
  shipping: cents.default(0),
  deliveryCode: z.enum(['ground', 'express', 'pickup']).default('ground'),
  /**
   * Which shop fulfils this order.
   *
   * Optional, and the server falls back to the business the staff member is working
   * in. It is asked explicitly because the answer is not always that one: a
   * customer collecting in person picks the shop nearest them, and a delivery
   * goes out from whichever shop holds the stock.
   */
  business: z.string().trim().length(24).optional().or(z.literal('')),
  poNumber: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * A standalone invoice - one raised against an account for something no order
 * covers: a restocking fee, a repair, an agreed adjustment (§7.2's
 * `+ Create > Invoice`).
 *
 * `Invoice.order` has always been optional; this is the first thing to use
 * that. There are no line items because the model has no place to put them
 * an invoice stores a single `amount`, and inventing an items array here would
 * mean the number on screen and the number in the database came from different
 * places.
 */
/**
 * Canadian sales tax, by province, as a single combined rate.
 *
 * One number per province rather than a GST/PST/HST breakdown: the invoice
 * shows one tax line, which is what an HST province genuinely has, and the
 * participating provinces are the ones where the distinction matters least. A
 * business that has to file GST and PST separately needs a bookkeeping package,
 * not a second row on this form.
 *
 * The rate is a DEFAULT. The form lets a staff member override it, because zero is
 * a real answer - an exempt customer, an out-of-country sale - and a rate the
 * software insists on is a rate somebody works around by editing the total.
 */
/** The province codes, taken from the one list the checkout already uses. */
const PROVINCE_CODES = PROVINCES.map((province) => province.value);

const TAX_RATES = {
  AB: 5, BC: 12, MB: 12, NB: 15, NL: 15, NS: 14, NT: 5,
  NU: 5, ON: 13, PE: 15, QC: 14.975, SK: 11, YT: 5,
};

/**
 * What the tax is CALLED in each province.
 *
 * The rate alone does not tell a staff member which tax they are charging, and
 * "12%" is two different things in BC (GST+PST) and Manitoba (GST+PST at a
 * different split) - while 5% in Alberta is GST with no provincial tax at all.
 * A counter quoting a customer says "thirteen percent HST", so the picker
 * should say it too rather than making them remember which provinces are
 * harmonised.
 *
 * Naming only, never arithmetic: `TAX_RATES` above stays the single source of
 * the number, and every total is still computed server-side from it.
 */
const TAX_LABELS = {
  AB: 'GST', BC: 'GST+PST', MB: 'GST+PST', NB: 'HST', NL: 'HST', NS: 'HST',
  NT: 'GST', NU: 'GST', ON: 'HST', PE: 'HST', QC: 'GST+QST', SK: 'GST+PST',
  YT: 'GST',
};

/**
 * The province picker's options, each carrying its tax.
 *
 * Built here rather than in each form so the ticket, the quote and both
 * invoices offer the same list in the same order - three screens that price
 * the same work should not disagree about what Quebec charges.
 *
 * **Ordered by rate, then by name.** Alphabetical puts Alberta's 5% next to
 * British Columbia's 12% and buries the four 15% provinces apart from each
 * other; grouping by what is actually charged is what makes the list scannable
 * for somebody checking a figure rather than hunting a name.
 */
function provinceTaxOptions(placeholder = '– Pick province –') {
  const sorted = [...PROVINCES].sort(
    (a, b) => (TAX_RATES[a.value] ?? 0) - (TAX_RATES[b.value] ?? 0) || a.label.localeCompare(b.label),
  );

  return [
    { value: '', label: placeholder },
    ...sorted.map((province) => ({
      value: province.value,
      label: `${province.value} · ${province.label} (${TAX_LABELS[province.value] ?? 'Tax'} ${TAX_RATES[province.value] ?? 0}%)`,
    })),
  ];
}

/**
 * One priced line - a service performed, or a part fitted.
 *
 * Services and parts are the same shape because they are the same thing on an
 * invoice: a description, a quantity and a price. `product` links a part back
 * to the catalogue row it came from, which is what lets stock move when the
 * invoice is raised; a service has no product and never will.
 */
/** How the job reached the workshop. Mirrors the ticket's own sources. */
/**
 * How the device reaches the shop, and how it gets back.
 *
 * **Labels changed, values did not.** `pickup` reads "Pick-up & Drop-off"
 * because that is the round trip a customer is actually buying; `onsite` is
 * "On-site Repair" because a technician travelling to them is a different job
 * from either. Renaming the stored values would orphan every invoice and ticket
 * already written, and the words on screen are not what a query matches on.
 *
 * `mail_in` stays in the list but is **not offered on a service invoice** - a
 * repair shop taking a device by post is a different operation from the three
 * a counter runs, and the value is kept so existing records still render.
 */
const INVOICE_SERVICE_TYPES = [
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'pickup', label: 'Pick-up & Drop-off' },
  { value: 'onsite', label: 'On-site Repair' },
  { value: 'mail_in', label: 'Mail-in' },
];

/** The three a service business actually offers at the counter. */
const SERVICE_INVOICE_TYPES = INVOICE_SERVICE_TYPES.filter(
  (entry) => entry.value !== 'mail_in',
);

const invoiceLineSchema = z.object({
  name: z.string().trim().min(1, 'Name the line.').max(160),
  description: z.string().trim().max(300).or(z.literal('')).optional(),
  priceDollars: z.coerce.number().min(0).max(1_000_000).default(0),
  qty: z.coerce.number().int().min(1).max(999).default(1),
  /** The catalogue product, for a part. Absent on a service. */
  product: z.string().trim().length(24).optional(),
});

/**
 * A device on an invoice, with the work done to it.
 *
 * Deliberately the same shape as `ticketDeviceSchema` minus the intake-only
 * fields (condition grid, passcode): a repair invoice describes the same object
 * a ticket does, and two different shapes for one thing is how a ticket stops
 * being convertible into an invoice.
 */
const invoiceDeviceSchema = z.object({
  category: z.string().trim().max(60).or(z.literal('')).optional(),
  brand: z.string().trim().max(60).or(z.literal('')).optional(),
  series: z.string().trim().max(120).or(z.literal('')).optional(),
  model: z.string().trim().max(120).or(z.literal('')).optional(),
  serial: z.string().trim().max(80).or(z.literal('')).optional(),

  problem: z.string().trim().max(500).or(z.literal('')).optional(),
  solution: z.string().trim().max(500).or(z.literal('')).optional(),
  notes: z.string().trim().max(500).or(z.literal('')).optional(),

  services: z.array(invoiceLineSchema).max(40).default([]),
  parts: z.array(invoiceLineSchema).max(40).default([]),
});

/**
 * Raising an invoice by hand (§7.2).
 *
 * Two shapes, one schema. A **flat charge** sends `amount` and nothing else
 * a restocking fee, an agreed adjustment, the case this form was built for. An
 * **itemised invoice** sends `devices`, and the server computes the amount
 * from the lines; whatever `amount` the client sent is ignored, because a
 * total the browser calculated is a total the browser can be wrong about.
 *
 * The flat path stays because most standalone invoices are one number and
 * making a staff member open a device panel to type it would be a worse form.
 */
/**
 * The invoice body, before the itemised-or-flat rule is applied.
 *
 * Split out so `invoiceUpdateSchema` can reuse the exact same field set for
 * the edit page. Describing those fields twice is how an edit form ends up
 * accepting something the create form rejects, or silently dropping a field
 * somebody added to only one of them.
 */
const adminInvoiceFields = z.object({
  user: z.string().trim().min(1, 'Pick a customer.'),
  // Required for a flat charge, ignored when `devices` carries lines - the
  // superRefine below enforces exactly that.
  amount: cents.optional(),

  devices: z.array(invoiceDeviceSchema).max(20).default([]),

  /** Province drives the default rate; the rate itself is what gets applied. */
  province: z.enum(PROVINCE_CODES).or(z.literal('')).optional(),
  taxPercent: z.coerce.number().min(0).max(100).default(0),

  discountDollars: z.coerce.number().min(0).max(1_000_000).default(0),
  discountCode: z.string().trim().max(40).or(z.literal('')).optional(),

  /**
   * The distance driven. Internal: it produces a mileage allowance for the
   * shop's own books and is never added to what the customer owes.
   *
   * **The rate is not sent with it.** `Settings.financial.travelRateCentsPerKm`
   * decides what a kilometre is worth, and the server multiplies - a client
   * able to send the rate could overstate a mileage claim.
   */
  travelKm: z.coerce.number().min(0).max(100_000).default(0),

  /**
   * The one travel figure that IS charged, when the job is out of area.
   *
   * Only the flag now. The amount used to travel with it because no
   * service-area rate was configured anywhere; `Settings.financial
   * .extendedServiceFeeCents` is that setting, so the client says whether to
   * charge and the business says how much. `extendedServiceFeeDollars` is still
   * accepted and ignored, so an older form does not fail validation.
   */
  extendedServiceFee: z.boolean().default(false),
  extendedServiceFeeDollars: z.coerce.number().min(0).max(100_000).default(0),

  technician: z.string().trim().max(24).or(z.literal('')).optional(),
  serviceType: z.enum(['walk_in', 'pickup', 'onsite', 'mail_in']).default('walk_in'),

  /** Rendered on the document. `internalNotes` never is. */
  customerNotes: z.string().trim().max(2000).or(z.literal('')).optional(),
  technicianNotes: z.string().trim().max(2000).or(z.literal('')).optional(),
  internalNotes: z.string().trim().max(2000).or(z.literal('')).optional(),
  terms: z.enum(['prepaid', 'net15', 'net30', 'net60']).default('prepaid'),
  issuedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.')
    .optional(),
  // Left blank, the server derives it from the terms. Sent, it wins - an
  // agreed due date is a fact about the arrangement, not about the terms table.
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.')
    .optional(),
  reference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * An invoice must bill from lines or from a typed figure, never from neither.
 *
 * Shared by the create and the full-edit paths so the two cannot disagree
 * about what a complete invoice is.
 */
function requireAmountOrLines(value, ctx) {
  const hasLines = (value.devices ?? []).some(
    (device) => (device.services?.length ?? 0) + (device.parts?.length ?? 0) > 0,
  );

  // An itemised invoice computes its own total, so an amount is not asked
  // for. A flat one has nothing else to bill from, so it is required - and
  // an invoice for nothing is not a document.
  if (!hasLines && !(value.amount > 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['amount'],
      message: 'Enter an amount, or add a service or part.',
    });
  }
}

const adminInvoiceSchema = adminInvoiceFields.superRefine(requireAmountOrLines);

/**
 * Correcting an invoice: either half, chosen by what the body carries.
 *
 * The edit page sends the whole invoice - customer, devices, lines, tax,
 * travel - and is validated exactly as the create form is, because it IS the
 * create form with a record loaded into it. The detail screen's inline
 * controls send three clerical fields and nothing else.
 *
 * **Branched on `user` rather than written as a `z.union`.** A union reports a
 * failure as a nested `invalid_union` whose issues carry no usable top-level
 * path, so a bad line price on the edit page would have reached the form as an
 * error against nothing and shown up nowhere. Picking the branch first means a
 * full edit fails with `devices.0.services.0.priceDollars` intact, which is
 * what the field-level error display needs (§5.1).
 *
 * The check is presence of `user`: the clerical patch never sends one, and the
 * edit page always does. A body that means to be a full edit but has lost its
 * customer therefore fails the full branch with "Pick a customer." rather than
 * passing quietly as a clerical patch that changes nothing.
 */
const invoiceUpdateSchema = z
  .any()
  .superRefine((value, ctx) => {
    const schema = value && typeof value === 'object' && 'user' in value
      ? adminInvoiceFields
      : invoiceClericalSchema;

    const result = schema.safeParse(value);
    if (result.success) {
      if (schema === adminInvoiceFields) requireAmountOrLines(result.data, ctx);
      return;
    }

    for (const issue of result.error.issues) ctx.addIssue(issue);
  })
  .transform((value) => {
    const schema = value && typeof value === 'object' && 'user' in value
      ? adminInvoiceFields
      : invoiceClericalSchema;

    // Re-parsed rather than returned raw, so the caller receives the COERCED
    // values (numbers from numeric strings, defaults filled) that the service
    // then relies on - the same data the create path gets.
    const result = schema.safeParse(value);
    return result.success ? result.data : value;
  });

const RMA_ITEM_DISPOSITIONS = ['pending', 'restock', 'scrap', 'return_to_supplier', 'reject'];

const rmaSchema = z.object({
  orderNumber: z.string().trim().min(3, 'Enter the order number.'),
  items: z
    .array(
      z.object({
        sku: z.string().trim().min(1),
        qty: z.coerce.number().int().min(1, 'Return at least one.').max(100_000),
        reason: z.string().trim().max(300).optional(),
      }),
    )
    .min(1, 'Add at least one line.')
    .max(100),
  reason: z.string().trim().min(3, 'Say why this is coming back.').max(500),
});

/**
 * `resolved` is absent: resolving decides money and stock, so it goes through
 * its own action which carries that decision with it.
 */
const rmaStatusSchema = z.object({
  status: z.enum(['approved', 'in_transit', 'received', 'inspecting', 'rejected']),
  note: z.string().trim().max(300).optional(),
});

const rmaInspectSchema = z.object({
  items: z
    .array(
      z.object({
        sku: z.string().trim().min(1),
        condition: z.string().trim().max(300).optional(),
        disposition: z.enum(RMA_ITEM_DISPOSITIONS).optional(),
      }),
    )
    .max(100)
    .optional(),
  inspectionNotes: z.string().trim().max(2000).optional(),
});

/**
 * Resolution. The amount is only read for a refund, and it routes through
 * `storeCreditService` - this schema never carries a balance, only an intent.
 */
const rmaResolveSchema = z
  .object({
    resolution: z.enum(['refund', 'replace', 'reject']),
    amountDollars: z.coerce.number().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine(
    (value) => value.resolution !== 'refund' || (value.amountDollars ?? 0) > 0,
    { message: 'Enter an amount to refund.', path: ['amountDollars'] },
  );

// ---- repair tickets ---------------------------------------------------------

/**
 * The status vocabulary, duplicated from `models/Ticket.js` for the same reason
 * the permission areas below are: `shared/` is the boundary both halves read,
 * and importing from `server/` would drag mongoose into the browser bundle.
 */
const TICKET_STATUSES = [
  'diagnosis',
  'accepted',
  'waiting_for_parts',
  'ready_to_repair',
  'processing',
  'retention_policy',
  'ready_to_pickup',
  'completed',
  'cancelled',
];

const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

/** Money taken before the invoice exists. Dollars in; the server stores cents. */
const ticketDepositSchema = z.object({
  amountDollars: z.coerce.number().positive('Enter a deposit amount.').max(1_000_000),
  method: z.enum(['cash', 'card', 'debit', 'transfer', 'cheque', 'other']).default('cash'),
  note: z.string().trim().max(300).or(z.literal('')).optional(),
});

/**
 * Turning a finished repair into its invoice.
 *
 * Only the terms are asked: everything billed comes off the ticket, which is
 * where the job was priced. A form that let a staff member restate the lines here
 * would be a second place for them to differ.
 */
const ticketConvertSchema = z.object({
  terms: z.enum(['prepaid', 'net15', 'net30', 'net60']).default('prepaid'),
});
const TICKET_SOURCES = ['counter', 'kiosk', 'web', 'phone'];

/**
 * Converting an estimate into the repair ticket that does the work.
 *
 * Only how the job arrived and how urgent it is: the lines come off the quote,
 * because that is what the customer agreed to. Declared here rather than beside
 * `quoteConvertSchema` because it reads the two ticket constants above it.
 */
const quoteToTicketSchema = z.object({
  priority: z.enum(TICKET_PRIORITIES).default('normal'),
  source: z.enum(TICKET_SOURCES).default('counter'),
});

/** Human labels, so the pills and the selects cannot drift apart. */
const TICKET_STATUS_LABELS = {
  diagnosis: 'Diagnosis',
  accepted: 'Accepted',
  waiting_for_parts: 'Waiting for Parts',
  ready_to_repair: 'Ready to Repair',
  processing: 'Processing',
  retention_policy: 'Retention Policy',
  ready_to_pickup: 'Ready to Pickup',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/**
 * Opening a ticket.
 *
 * The customer is a name and a phone, not an account id - a repair is a
 * walk-in, and requiring an approved business first would make the counter
 * unusable. The phone is required because it is how the shop calls someone to
 * say their device is ready; without it the ticket cannot be closed out.
 */
/** One priced line - a service performed or a part fitted. Same shape for both. */
const ticketLineSchema = z.object({
  name: z.string().trim().min(1, 'Name the line.').max(160),
  description: z.string().trim().max(300).or(z.literal('')).optional(),
  priceDollars: z.coerce.number().min(0).max(1_000_000).default(0),
  qty: z.coerce.number().int().min(1).max(999).default(1),
  product: z.string().trim().length(24).optional(),
});

/**
 * How a component tested at drop-off, and which components a counter checks.
 *
 * Declared here rather than only on the model so the intake form renders the
 * same grid the server will accept - a form offering a ninth component the
 * schema rejects is a form that fails on submit.
 */
const CONDITION_GRADES = [
  { value: 'working', label: 'Working' },
  { value: 'faulty', label: 'Faulty' },
  { value: 'not_present', label: 'Not present' },
  { value: 'untested', label: 'Untested' },
];

const CONDITION_PARTS = [
  { key: 'screen', label: 'Screen' },
  { key: 'battery', label: 'Battery' },
  { key: 'chargingPort', label: 'Charging Port' },
  { key: 'backGlass', label: 'BackGlass' },
  { key: 'frontCamera', label: 'Front Camera' },
  { key: 'backCamera', label: 'Back Camera' },
  { key: 'loudSpeaker', label: 'Loud Speaker' },
  { key: 'earSpeaker', label: 'Ear Speaker' },
];

const conditionGradeSchema = z.enum(CONDITION_GRADES.map((grade) => grade.value));

/**
 * One device on the intake form.
 *
 * Only the model is required. A counter taking in a cracked handset at speed
 * knows what it is; making them fill a serial and a condition grid before the
 * ticket can be saved is how intake stops being done at the counter at all.
 */
const ticketDeviceSchema = z.object({
  category: z.string().trim().max(60).or(z.literal('')).optional(),
  brand: z.string().trim().max(60).or(z.literal('')).optional(),
  series: z.string().trim().max(120).or(z.literal('')).optional(),
  model: z.string().trim().min(1, 'Pick a model.').max(120),
  serial: z.string().trim().max(80).or(z.literal('')).optional(),
  passcode: z.string().trim().max(60).or(z.literal('')).optional(),

  problem: z.string().trim().max(500).or(z.literal('')).optional(),
  solution: z.string().trim().max(500).or(z.literal('')).optional(),
  notes: z.string().trim().max(500).or(z.literal('')).optional(),

  condition: z.record(z.string(), conditionGradeSchema).optional(),

  services: z.array(ticketLineSchema).max(40).default([]),
  parts: z.array(ticketLineSchema).max(40).default([]),
});

const ticketSchema = z.object({
  customerName: z.string().trim().min(2, 'Enter the customer name.').max(120),
  customerPhone: z.string().trim().min(7, 'Enter a contact number.').max(40),
  customerEmail: z.string().trim().email('Enter a valid email.').or(z.literal('')).optional(),

  /**
   * The account this ticket belongs to, when it has one.
   *
   * Optional because the customer above is free text: a repair walks in off
   * the street and the counter must be able to open a ticket without creating
   * an account first. Set when the ticket is raised from a customer profile,
   * which is what lets that profile count its own open jobs.
   */
  user: z.string().trim().length(24).optional(),

  deviceBrand: z.string().trim().max(60).optional(),
  deviceModel: z.string().trim().max(120).optional(),
  deviceSerial: z.string().trim().max(80).optional(),
  /**
   * The reported fault, as one line for the list and the search index.
   *
   * Optional on the wire, because the intake form records the fault **per
   * device** now - a two-device ticket has two problems and no single sentence
   * that is honestly "the" issue. `createTicket` falls back to the first
   * device's `problem`, so the column is still filled; requiring it here would
   * reject the very form that supersedes it.
   */
  issue: z.string().trim().max(500).optional(),

  status: z.enum(TICKET_STATUSES).default('diagnosis'),
  priority: z.enum(TICKET_PRIORITIES).default('normal'),
  source: z.enum(TICKET_SOURCES).default('counter'),

  // Empty string means "unassigned" - a select cannot emit `undefined`.
  technician: z.string().trim().or(z.literal('')).optional(),

  estimateDollars: z.coerce.number().min(0).max(1_000_000).optional(),
  notes: z.string().trim().max(2000).optional(),

  // The richer intake shape. All optional, so the short form that existed
  // before this - name, phone, one device, one estimate - still validates.
  devices: z.array(ticketDeviceSchema).max(10).optional(),
  clientNotes: z.string().trim().max(2000).or(z.literal('')).optional(),
  technicianNotes: z.string().trim().max(2000).or(z.literal('')).optional(),
  discountDollars: z.coerce.number().min(0).max(1_000_000).optional(),
  discountCode: z.string().trim().max(40).or(z.literal('')).optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  province: z.string().trim().max(2).or(z.literal('')).optional(),
  dueDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional(),
});

/** Everything on the create form is editable afterwards except the status. */
const ticketUpdateSchema = ticketSchema
  .omit({ status: true })
  .partial()
  .extend({ finalDollars: z.coerce.number().min(0).max(1_000_000).optional() });

/**
 * Moving a ticket.
 *
 * Any status to any status: a repair genuinely goes backwards when the wrong
 * part arrives, so the ladder is not enforced. The move is recorded on the
 * ticket timeline instead - the audit trail is the control here.
 */
const ticketStatusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
  note: z.string().trim().max(300).optional(),

  /**
   * Which channels the staff member allowed for this one move.
   *
   * **A permission list, not a send list.** The customer is messaged on the ONE
   * channel they chose (`User.preferredContact`); this says which channels are
   * allowed to carry it. So unticking SMS means "do not text them this time",
   * and unticking everything means "change the status silently" - which is the
   * case the confirmation exists to make possible.
   *
   * Absent means all of them, so an older client, a script or the bulk path
   * keeps the behaviour it had before this field existed.
   */
  channels: z.array(z.enum(['email', 'sms', 'whatsapp', 'call'])).optional(),
});

// ---- phase 8: businesses, roles and staff --------------------------------------

/**
 * Access areas and levels (§7.6). Duplicated from `models/Role.js` rather than
 * imported: `shared/` is the boundary both halves read, and a schema that
 * imports from `server/` would drag mongoose into the browser bundle.
 */
const PERMISSION_AREAS = [
  'clients',
  'sales',
  'purchase',
  'reports',
  'marketing',
  'business',
  'settings',
];

const PERMISSION_LEVELS = ['none', 'view', 'full'];

/**
 * Settings, broken into the seven categories the panel already groups by.
 *
 * ## Why these are sub-areas rather than seven more top-level ones
 *
 * `settings` stayed a single area for a long time and it was too coarse the
 * moment a business had more than one staff member: a bookkeeper who needs the
 * expense categories had to be given the screen that mints API keys and the one
 * that grants roles. But they are not peers of `sales` and `purchase` either -
 * they are parts of one section, and a role that says "Settings: read only"
 * should not then have to say it seven more times.
 *
 * So each one **inherits by default** (`inherit`, rendered as "Same as
 * Settings") and is only pinned where it differs. That keeps the common role -
 * everything the same - a single choice, and makes the exception explicit.
 *
 * The keys match `SETTINGS_CATEGORIES` in `client/src/lib/adminRoutes.js`, so a
 * category added there gets a permission row rather than silently falling
 * outside the system.
 */
const SETTINGS_SUBAREAS = [
  'business',
  'financial',
  'users',
  'scheduling',
  'communications',
  'system',
  'integrations',
];

/** The permission area key for one settings category. */
const settingsAreaKey = (category) => `settings.${category}`;

/** Human labels for the Roles & Access selects. */
const PERMISSION_LEVEL_LABELS = {
  none: 'No access',
  view: 'Read only',
  full: 'Full',
};

/**
 * What a sub-area may hold. `inherit` is the default and the fourth option the
 * three top-level levels do not have - it is the whole point of the nesting.
 */
const SUBAREA_LEVELS = ['inherit', ...PERMISSION_LEVELS];

const SUBAREA_LEVEL_LABELS = {
  inherit: 'Same as Settings',
  ...PERMISSION_LEVEL_LABELS,
};

const BUSINESS_STATUSES = ['active', 'inactive', 'maintenance'];
const BUSINESS_COLOR_TOKENS = IDENTITY_COLOR_TOKENS;

const POSTAL_CA = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;

const businessHoursSchema = z.object({
  day: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  open: z.string().trim().max(5).optional(),
  close: z.string().trim().max(5).optional(),
  closed: z.boolean().default(false),
});

/**
 * `code` is absent on purpose - it is assigned server-side (§6.14). A code the
 * form proposes is a code two staff can pick in the same moment.
 */
const businessSchema = z.object({
  name: z.string().trim().min(1, 'Enter an business name.').max(120),
  status: z.enum(BUSINESS_STATUSES).default('active'),
  colorToken: colorTokenSchema,
  address: z
    .object({
      street: z.string().trim().max(200).optional(),
      line2: z.string().trim().max(200).optional(),
      city: z.string().trim().max(120).optional(),
      region: z.string().trim().max(60).optional(),
      // Empty is allowed - an business can be filed before its lease is signed
      // but a value that is present must be a real postal code FOR ITS OWN
      // COUNTRY. Checked in the refinement below, because the rule cannot be
      // known until `country` has been read.
      postal: z.string().trim().max(20).optional().or(z.literal('')),
      country: z.string().trim().max(60).default('Canada'),
    })
    .default({}),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email('Enter a valid email.').optional().or(z.literal('')),
  manager: z.string().trim().max(120).optional(),
  hours: z.array(businessHoursSchema).max(7).optional(),
  notes: z.string().trim().max(2000).optional(),
}).superRefine((value, ctx) => {
  const postal = value.address?.postal;
  if (!postal || isValidPostal(postal, value.address?.country)) return;

  const example = postalExampleFor(value.address?.country);
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['address', 'postal'],
    message: example ? `Enter a valid postal code (${example}).` : 'Enter a valid postal code.',
  });
});

/**
 * The seven top-level areas, plus a row per settings category.
 *
 * Sub-areas default to `inherit`, so a payload that names none of them - every
 * client written before they existed - produces a role that behaves exactly as
 * it did: `settings` decides the whole section.
 */
const areasSchema = z.object({
  ...PERMISSION_AREAS.reduce(
    (out, area) => ({ ...out, [area]: z.enum(PERMISSION_LEVELS).default('none') }),
    {},
  ),
  ...SETTINGS_SUBAREAS.reduce(
    (out, area) => ({
      ...out,
      [settingsAreaKey(area)]: z.enum(SUBAREA_LEVELS).default('inherit'),
    }),
    {},
  ),
});

const roleSchema = z.object({
  name: z.string().trim().min(1, 'Enter a role name.').max(60),
  areas: areasSchema.default({}),
});

/**
 * Creating a Cellvix person. `accountType` is the account kind; `staffRole` is
 * the permission set, and is required for staff - enforced here and again in
 * the service, because access granted by an omitted field is access nobody
 * chose to grant.
 */
const staffUserSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name.').max(120),
    email: z.string().trim().email('Enter a valid email.'),
    password: z.string().min(8, 'Use at least 8 characters.').max(200),
    phone: z.string().trim().max(40).optional(),
    accountType: z.enum(['staff', 'admin']).default('staff'),
    staffRole: z.string().trim().optional(),
    business: z.string().trim().optional(),
  })
  .refine((value) => value.accountType !== 'staff' || Boolean(value.staffRole), {
    message: 'Choose a role for this staff member.',
    path: ['staffRole'],
  });

/** The edit form. No password - changing one has its own route and its own rules. */
const staffUserUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  accountType: z.enum(['staff', 'admin']).optional(),
  staffRole: z.string().trim().nullable().optional(),
  business: z.string().trim().nullable().optional(),
  locked: z.boolean().optional(),
});

// ---- phase 9: marketing -----------------------------------------------------

/**
 * Duplicated from `models/MessageLog.js` and `models/Campaign.js` for the same
 * reason the permission areas are: `shared/` is the boundary both halves read,
 * and importing from `server/` would drag mongoose into the browser bundle.
 */
/**
 * **`note` is a channel, not a fifth thing.**
 *
 * A customer-facing conversation log that cannot hold "spoke to them at the
 * counter, agreed to replace the screen" is a log with a hole in it, and the
 * hole gets filled by an internal note that the next person reads as staff
 * chatter rather than as part of the conversation. A note is contact history
 * whose transport happened to be a person standing there, so it belongs in the
 * same list, ordered with the calls and the emails around it.
 *
 * It never transmits, which is why it always lands `logged` - the same status a
 * call gets, and for the same reason: it already happened, nobody is sending
 * anything. `InternalNote` stays where it is and keeps its own meaning
 * (staff-only, never shown to a customer, §6.13); this is the opposite record,
 * and the portal shows it.
 */
const MESSAGE_CHANNELS = ['call', 'sms', 'whatsapp', 'email', 'note'];
/**
 * The records a template can be attached to.
 *
 * `ticket` was missing until 2026-09-21, which made the list a wholesaler's:
 * orders, invoices, quotes and returns. A repair shop messages its customers
 * about TICKETS more than anything else - that is the record a device moves
 * through - so a notification screen offering every document except that one
 * could not express its main case.
 */
const TEMPLATE_DOCUMENTS = ['none', 'ticket', 'order', 'invoice', 'quote', 'rma'];
const CAMPAIGN_AUDIENCES = ['approved', 'pending', 'all_customers', 'with_orders'];

const CAMPAIGN_AUDIENCE_LABELS = {
  approved: 'Approved accounts',
  pending: 'Pending accounts',
  all_customers: 'All customer accounts',
  with_orders: 'Accounts that have ordered',
};

/**
 * Composing on a channel.
 *
 * There is no `status` field, and that is the point: whether a message was sent
 * is decided by the server from the provider's real state (§6b rule 4). A
 * client that could name its own status could report a send that never
 * happened.
 */
const messageSchema = z
  .object({
    userId: z.string().trim().min(1, 'Choose an account.'),
    subject: z.string().trim().max(200).optional(),
    body: z.string().trim().max(5000).optional(),
    // Calls are the only inbound-capable channel today - somebody rang us.
    direction: z.enum(['inbound', 'outbound']).default('outbound'),
    recordingUrl: z.string().trim().url('Enter a valid URL.').optional().or(z.literal('')),
    templateId: z.string().trim().optional(),
  })
  .refine((value) => Boolean(value.body?.trim()) || Boolean(value.templateId), {
    message: 'Write a message or pick a template.',
    path: ['body'],
  });

/** Logging a call. Notes stand in for the body, and there is nothing to send. */
const callLogSchema = z.object({
  userId: z.string().trim().min(1, 'Choose an account.'),
  direction: z.enum(['inbound', 'outbound']).default('outbound'),
  body: z.string().trim().min(1, 'Write what the call was about.').max(5000),
  recordingUrl: z.string().trim().url('Enter a valid URL.').optional().or(z.literal('')),
});

const messageTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Name this template.').max(120),
  channel: z.enum(MESSAGE_CHANNELS),
  document: z.enum(TEMPLATE_DOCUMENTS).default('none'),

  /**
   * The status within that document this message belongs to.
   *
   * Free text, matching the model: the statuses differ per document and a
   * business may add its own, so an enum here would be a second list to keep
   * in step with the first. Empty means a general template bound to no
   * status.
   */
  status: z.string().trim().max(60).optional().or(z.literal('')),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1, 'Write the message.').max(5000),
  isActive: z.boolean().default(true),
});

/**
 * A campaign. `audience` names a filter, never a list of recipients - consent
 * is resolved at send time, so a list captured here would be both stale and
 * unlawful to rely on (§6.13).
 */
const campaignSchema = z.object({
  name: z.string().trim().min(1, 'Name this campaign.').max(120),
  subject: z.string().trim().min(1, 'Write a subject line.').max(200),
  body: z.string().trim().min(1, 'Write the email.').max(20000),
  audience: z
    .object({ filter: z.enum(CAMPAIGN_AUDIENCES).default('approved') })
    .default({ filter: 'approved' }),
});

/**
 * The public unsubscribe payload - the account id and the HMAC from the link.
 * Deliberately unauthenticated: CASL requires the mechanism to work without a
 * sign-in, and the token is what stands in for one.
 */
const unsubscribeSchema = z.object({
  u: z.string().trim().min(1),
  t: z.string().trim().min(1),
});

// ---- phase 10: referral commission ------------------------------------------

/**
 * The commission rate, as a percentage - 5 means 5%.
 *
 * This is the only writable field in the whole referral feature. Accruals are
 * produced by payments and reversed by refunds; nothing may write one by hand,
 * and `referredBy` is set once at registration and never edited (§6.13).
 */
const referralRateSchema = z.object({
  percent: z.coerce
    .number()
    .min(0, 'A rate cannot be negative.')
    .max(100, 'A rate above 100% would pay out more than was collected.'),
});

// ---- phase 11a: settings ----------------------------------------------------

/**
 * Business Info (§6.15, category 1).
 *
 * Feeds invoices, transactional email and the storefront footer. Only the name
 * is required - a business that has not yet been given a website should be able
 * to save the fields it does have rather than being blocked on the ones it
 * does not.
 */
const businessInfoSchema = z.object({
  name: z.string().trim().min(2, 'Enter the business name.').max(120),
  tagline: z.string().trim().max(160).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  email: z.string().trim().email('Enter a valid email address.').optional().or(z.literal('')),
  website: z.string().trim().url('Enter a valid URL.').optional().or(z.literal('')),
  taxNumber: z.string().trim().max(40).optional().or(z.literal('')),

  /**
   * Where a happy customer is sent to leave a review.
   *
   * A real URL or nothing. Validated rather than free text because it is
   * printed as a link on the warranty sheet and mailed as a button: a typo
   * here is a dead end the shop never sees, since the customer who hits it
   * has no reason to report it.
   */
  reviewUrl: z.string().trim().url('Enter a valid URL.').optional().or(z.literal('')),

  /** The storefront wordmark. Empty renders the business name as text. */
  logoUrl: z.string().trim().url('Enter a valid URL.').optional().or(z.literal('')),

  // Where a customer writes TO. Both fall back to `email` when read, so a
  // business with one mailbox types it once.
  supportEmail: z
    .string()
    .trim()
    .email('Enter a valid email address.')
    .optional()
    .or(z.literal('')),
  billingEmail: z
    .string()
    .trim()
    .email('Enter a valid email address.')
    .optional()
    .or(z.literal('')),

  // A wa.me number, digits and an optional leading `+`. Not an email-style
  // validation: what goes in the link is the digits, and a business that types
  // its number with spaces or brackets should not be told it is wrong.
  whatsapp: z
    .string()
    .trim()
    .max(32)
    .regex(/^[+\d][\d\s()-]*$/, 'Enter a phone number.')
    .optional()
    .or(z.literal('')),
  mapUrl: z.string().trim().url('Enter a valid URL.').optional().or(z.literal('')),

  /**
   * Opening hours, printed rather than computed.
   *
   * Free text on both halves: "Mon – Fri" and "By appointment" are both real
   * answers, and a structured weekday model cannot hold the second.
   */
  hours: z
    .array(
      z.object({
        days: z.string().trim().min(1, 'Name the days.').max(60),
        time: z.string().trim().min(1, 'Give the hours.').max(60),
      }),
    )
    .max(10, 'Ten rows is enough for any week.')
    .optional(),

  /**
   * Social profiles, one row per network the business is actually on.
   *
   * `handle` is printed beside the icon so a reader knows which account they
   * are about to open before they click.
   */
  social: z
    .array(
      z.object({
        network: z.string().trim().min(1).max(40),
        url: z.string().trim().url('Enter a valid URL.'),
        handle: z.string().trim().max(60).optional().or(z.literal('')),
      }),
    )
    .max(12)
    .optional(),

  address: z.object({
    line1: z.string().trim().max(160).optional().or(z.literal('')),
    line2: z.string().trim().max(160).optional().or(z.literal('')),
    city: z.string().trim().max(80).optional().or(z.literal('')),
    region: z.string().trim().max(2).optional().or(z.literal('')),
    postal: z
      .string()
      .trim()
      .regex(POSTAL_CA, 'Enter a valid postal code (A1A 1A1).')
      .optional()
      .or(z.literal('')),
    country: z.string().trim().max(2).default('CA'),
  }),
});

/**
 * One province's tax rate.
 *
 * **A fraction, not a percentage** - `0.13`, never `13`. The model stores it
 * this way and `Settings.rateFor` reads it this way, so the conversion happens
 * once, in the screen, rather than being a thing every reader has to remember.
 * The 0.35 ceiling is a sanity bound: no Canadian combined rate is close to it,
 * and a value above it is far more likely to be a percentage typed into a
 * fraction field than a real rate.
 */
const taxRateRowSchema = z.object({
  province: z.string().trim().length(2),
  rate: z.coerce
    .number()
    .min(0, 'A tax rate cannot be negative.')
    .max(0.35, 'That looks like a percentage. Enter a fraction - 13% is 0.13.'),
  kind: z.enum(['GST', 'HST', 'GST+PST', 'GST+QST']),
});

/**
 * Sale Settings (§6.15, category 2).
 *
 * `warrantyByGrade` is keyed on **product grade**, not membership tier
 * wholesale warranties on what the part is, not on who bought it (§6.15).
 */
const saleSettingsSchema = z.object({
  timezone: z.string().trim().min(1).max(64),
  defaultDueDays: z.coerce
    .number()
    .int()
    .min(0, 'Due days cannot be negative.')
    .max(365, 'Use 365 days or fewer.'),
  taxRatesByProvince: z.array(taxRateRowSchema).min(1, 'Keep at least one province.'),
  warrantyByGrade: z.record(
    z.string(),
    z.coerce.number().int().min(0, 'A warranty cannot be negative.').max(3650),
  ),
  // Extra days a tier adds on top of the grade. Non-negative by construction:
  // a tier improves cover or leaves it alone, and a negative "bonus" that
  // shortened a warranty would be a penalty wearing the wrong name.
  warrantyBonusByTier: z
    .record(
      z.string(),
      z.coerce.number().int().min(0, 'A tier bonus cannot be negative.').max(3650),
    )
    .optional(),
  rmaSlaDays: z.coerce.number().int().min(1, 'Enter at least one day.').max(365),

  /**
   * How long a ticket may stay open before the board flags it as overdue.
   *
   * **A separate promise from the RMA one**, which is why it is a separate
   * field rather than the same number reused. A return is goods travelling
   * back and is paced by a courier; a repair is work at a bench and is paced by
   * the shop. `ticketService` has read this at nine call sites since tickets
   * shipped - it drives the overdue count and the over-SLA badge - and until
   * now nothing could write it, so every shop was held to a literal 7.
   *
   * Optional, so an older payload cannot write undefined over a figure a shop
   * has already set.
   */
  ticketSlaDays: z.coerce
    .number()
    .int()
    .min(1, 'Enter at least one day.')
    .max(365, 'Use 365 days or fewer.')
    .optional(),

  /**
   * What a kilometre of travel is worth, in **cents**, for an on-site repair.
   *
   * Entered in cents rather than dollars because the CRA rate carries a tenth
   * of a cent - 56.7, not 0.567 rounded to 0.57 - and a shop that types the
   * dollar figure loses it. The form labels it as cents per km for the same
   * reason.
   *
   * This is the shop's own cost for the journey. What the customer pays for an
   * out-of-area visit is typed on the invoice itself, per job.
   */
  travelRateCentsPerKm: z.coerce
    .number()
    .min(0, 'A rate cannot be negative.')
    .max(1000, 'That is more than $10 a kilometre.')
    .optional(),

  /**
   * The warranty every repair carries before any tier bonus, in days.
   *
   * The floor the bonus table adds to, which is why it sits beside it here.
   * Optional so an older payload cannot write undefined over a figure a shop
   * has already set.
   */
  warrantyBaseDays: z.coerce
    .number()
    .int()
    .min(0, 'A warranty cannot be negative.')
    .max(3650, 'Use 3650 days or fewer.')
    .optional(),
});

/**
 * Shipping Rates (§6.15).
 *
 * `code` is present but never written - the service matches on it and refuses
 * anything it does not already have, because checkout validates
 * `deliveryMethod` against a fixed enum and a band invented here would be
 * unselectable.
 *
 * `freeOver` is nullable on purpose: empty means "never ships free", which is
 * a different statement from `0`.
 */
const shippingSettingsSchema = z.object({
  methods: z
    .array(
      z.object({
        code: z.string().trim().min(1),
        label: z.string().trim().min(1, 'Name this method.').max(60),
        detail: z.string().trim().max(120).optional().or(z.literal('')),
        cost: cents,
        etaDays: z.coerce.number().int().min(0).max(60),
        freeOver: cents.nullable().optional(),
      }),
    )
    .min(1),
});

/**
 * Payment Methods (§6.15) - the list staff pick from when recording money
 * moving. **Not** the buyer's saved cards, which are `User.paymentMethods`.
 *
 * `code` is the stable key that expenses and payments store, so it is set once
 * from the label and then frozen.
 */
const paymentMethodsSettingsSchema = z.object({
  methods: z
    .array(
      z.object({
        code: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .regex(/^[a-z0-9-]+$/, 'A code is lowercase letters, numbers and dashes.'),
        label: z.string().trim().min(1, 'Name this method.').max(60),
      }),
    )
    .min(1, 'Keep at least one payment method.'),
});

/**
 * Inventory Settings (§6.15).
 *
 * Pre-fills the New Product form; a per-product value always wins, and nothing
 * here reprices anything already in the catalogue.
 *
 * Margin stops below 100 because `markup = margin ÷ (100 − margin) × 100`
 * divides by zero at 100 - a 100% margin means selling at infinite markup on a
 * zero cost, which is not a number a form should accept.
 */
const inventorySettingsSchema = z.object({
  defaultMarkupPercent: z.coerce
    .number()
    .min(0, 'A markup cannot be negative.')
    .max(1000, 'Use 1000% or less.'),
  defaultMarginPercent: z.coerce
    .number()
    .min(0, 'A margin cannot be negative.')
    .max(99.9, 'A margin of 100% or more has no finite markup.'),

  /**
   * The reorder point assumed for a product that has none of its own.
   *
   * Unlike the two above this is **not** a pre-fill: it is read live by the
   * dashboard badge, the Inventory pills, the reorder queue, the bell and the
   * inventory report, so changing it re-classifies the catalogue on the next
   * read. The screen says so.
   *
   * Optional, so a client that predates the field cannot blank it by saving
   * the rest of the form.
   */
  lowStockThreshold: z.coerce
    .number()
    .int('Use a whole number of units.')
    .min(1, 'Use at least one unit - zero would mean nothing is ever low.')
    .max(100_000, 'Use 100,000 units or fewer.')
    .optional(),
});

/**
 * Supplier agreements (§6.15) - the documents authored in admin and signed in
 * the portal.
 *
 * **Clauses are rows, not a blob of prose.** The paper form gives every clause
 * its own exceptions box and its own initials, which is how these actually get
 * negotiated: eight clauses accepted, one qualified. A single rich-text body
 * could not hold that.
 */
const agreementClauseSchema = z.object({
  // Optional on the way in: a new clause is assigned one server-side, because a
  // client inventing its own could collide with an existing key and silently
  // move a supplier's note onto the wrong clause.
  key: z.string().trim().max(60).optional(),
  title: z.string().trim().min(1, 'Give the clause a heading.').max(200),
  body: z.string().trim().min(1, 'Write the clause.').max(10_000),
  requiresInitials: z.boolean().default(true),
});

const agreementTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Name the agreement.').max(200),
  description: z.string().trim().max(500).optional(),
  preamble: z.string().trim().max(5_000).optional(),
  clauses: z.array(agreementClauseSchema).min(1, 'Add at least one clause.').max(60),
  /**
   * Our half of the execution block, signed when the agreement is written.
   *
   * A contract signed by one party is a draft, and asking a supplier to
   * countersign an empty rule is asking them to trust a form. The image is
   * validated properly server-side - media type against an allowlist, decoded
   * size against a cap - so this only checks it is a data URL at all.
   */
  buyerSignatory: z
    .object({
      name: z.string().trim().max(200).optional(),
      title: z.string().trim().max(120).optional(),
      company: z.string().trim().max(200).optional(),
      signatureImage: z
        .string()
        .regex(/^data:[a-z/+-]+;base64,/, 'That signature could not be read.')
        .optional()
        .or(z.literal('')),
      signedAt: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.')
        .optional()
        .or(z.literal('')),
    })
    .optional(),
});

/**
 * A supplier signing their agreement.
 *
 * **No clause wording.** The titles and bodies are copied from the template
 * server-side, so a client cannot sign a document it rewrote on the way past.
 * What the supplier sends is theirs: initials, exceptions, signature, name.
 */
const agreementSignSchema = z.object({
  /**
   * Which agreement is being signed.
   *
   * Required, because a supplier can carry several: "their agreement" was
   * unambiguous with one document and is a guess with three. The server checks
   * it against what they actually hold, so naming one they were never sent is
   * refused rather than silently signed.
   */
  template: z.string().trim().length(24),
  clauses: z
    .array(
      z.object({
        key: z.string().trim().min(1),
        initials: z.string().trim().max(10).optional(),
        note: z.string().trim().max(2000).optional(),
      }),
    )
    .max(60)
    .optional(),
  signature: z.object({
    kind: z.enum(['drawn', 'uploaded']),
    // Validated properly server-side - media type against an allowlist and
    // decoded size against a cap. This only checks it is a data URL at all.
    image: z
      .string()
      .min(1, 'Draw or upload your signature.')
      .regex(/^data:[a-z/+-]+;base64,/, 'That signature could not be read.'),
  }),
  signedName: z.string().trim().min(1, 'Type your full name.').max(200),
  signedTitle: z.string().trim().max(120).optional(),
  signedCompany: z.string().trim().max(200).optional(),
});

// ---- phase 11c: provider credentials ----------------------------------------

/**
 * Writing one provider's credentials (§6.15, category 7).
 *
 * Deliberately a loose record rather than a per-provider shape: the field names
 * are validated server-side against `PROVIDER_FIELDS`, which is the list the
 * screen renders from, and duplicating that list here would give it two places
 * to drift.
 *
 * **An empty string is meaningful.** It clears the field - that is how a key is
 * removed - and it has to stay distinguishable from an absent key, which means
 * "leave this one alone". So empty is allowed and `.strict()` is not used.
 *
 * There is no schema for *reading* a credential, because there is no route that
 * returns one.
 */
const providerCredentialSchema = z.record(
  z.string(),
  z.string().trim().max(500, 'That is longer than any provider key.'),
);

// ---- phase 11d: taxonomy & invoice status rules -----------------------------

/**
 * Editing a taxonomy node (§6.15 - *Device & Models*).
 *
 * **Only the safe fields.** `kind`, `slug` and `parent` are absent on purpose:
 * every product carries a denormalised `path` written against that structure,
 * so changing one here would detach products from a tree that still looks
 * correct on screen. Restructuring is a re-seed, not a form.
 */
/**
 * A new model, and the branch it hangs from (Device & Models → Add Model).
 *
 * **Four names, not a parent id.** Somebody adding "the new Pixel" does not
 * know whether a `Google` brand node exists, and making them find out first
 * would be three screens to add one phone. The service finds each level by
 * slug or creates it.
 *
 * `series` is optional, matching the form: a model with no series hangs off
 * the brand, which is what the seeded data does for the catalogue's flatter
 * corners.
 */
const taxonomyCreateSchema = z.object({
  deviceType: z.string().trim().min(1, 'Pick a category.').max(80),
  brand: z.string().trim().min(1, 'Name the brand.').max(80),
  series: z.string().trim().max(80).optional().or(z.literal('')),
  name: z.string().trim().min(1, 'Name the model.').max(120),
  aliases: z
    .union([z.array(z.string().trim().max(60)), z.string().trim().max(600)])
    .optional(),
});

/** A pasted or uploaded CSV of device models. See `taxonomyAdminService.importCsv`. */
const taxonomyImportSchema = z.object({
  text: z
    .string()
    .min(1, 'Paste some rows, or choose a file.')
    .max(900_000, 'That file is too large. Import it in smaller batches.'),
});

const taxonomyNodeSchema = z.object({
  name: z.string().trim().min(1, 'Give this a name.').max(120),
  // Accepts an array or a comma-separated string; the service normalises both
  // to lowercase, deduplicated entries.
  aliases: z
    .union([z.array(z.string().trim().max(60)), z.string().trim().max(600)])
    .optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  order: z.coerce.number().int().min(0).max(9999).optional(),
});

/**
 * One time-lapse invoice message (§6.15).
 *
 * `delayDays` is **signed**: negative means before the trigger, which is how
 * "remind them three days before it is due" is expressed without a second
 * direction field that could contradict it.
 */
const invoiceStatusRuleSchema = z.object({
  label: z.string().trim().min(1, 'Name this message.').max(80),
  trigger: z.enum(['invoice_created', 'invoice_due', 'invoice_overdue', 'invoice_paid']),
  delayDays: z.coerce
    .number()
    .int()
    .min(-365, 'That is more than a year before.')
    .max(365, 'That is more than a year after.')
    .default(0),
  channel: z.enum(MESSAGE_CHANNELS).default('email'),
  subject: z.string().trim().max(200).optional(),
  message: z.string().trim().min(1, 'Write the message.').max(5000),
  isActive: z.boolean().default(false),
});


/**
 * The semantic palette an admin-authored label picks from (§2b).
 *
 * **A meaning, not a colour.** These are the same six the expense categories
 * offer, and the reason they are an enum rather than free text is that a hex
 * typed into a form is how a screen ends up off-brand - and nothing about a
 * colour input guarantees the text on it stays readable.
 */
const LABEL_COLOR_TOKENS = ['ink', 'brand', 'info', 'ok', 'warn', 'danger'];

const LABEL_COLOR_OPTIONS = [
  { value: 'ink', label: 'Neutral' },
  { value: 'brand', label: 'Brand' },
  { value: 'info', label: 'Info' },
  { value: 'ok', label: 'Positive' },
  { value: 'warn', label: 'Warning' },
  { value: 'danger', label: 'Critical' },
];

/**
 * One entry on the manual invoice status list (Sales § Invoice).
 *
 * **`sendsWarrantyEmail` is the field to be careful with.** Ticking it arms an
 * automatic email to a customer the first time this label lands on a paid
 * invoice, so the form has to say so plainly and the route needs `full` on
 * settings rather than on sales. Defaults to false: a label that mails somebody
 * the moment it is picked from a menu is a side effect nobody asked for.
 */
const invoiceLabelSchema = z.object({
  name: z.string().trim().min(1, 'Name this status.').max(60),
  colorToken: z.enum(LABEL_COLOR_TOKENS).default('ink'),
  sendsWarrantyEmail: z.boolean().default(false),
  isActive: z.boolean().default(true),
  order: z.coerce.number().int().min(0).max(999).default(0),
});

/**
 * Setting the manual status on one invoice, or clearing it.
 *
 * `null` clears - and it is `nullable()` rather than `optional()` on purpose:
 * an absent key would be indistinguishable from a form that forgot to send the
 * field, whereas an explicit null is somebody choosing "no status".
 */
const invoiceLabelSetSchema = z.object({
  // Length-checked rather than pattern-matched, matching how every other id
  // field here is written; `invoiceLabelService` is what answers 404 for an id
  // that is well-formed but names nothing.
  labelId: z.string().trim().length(24).nullable().or(z.literal('')),
});


/**
 * Refunding money off an invoice (Sales § Invoice).
 *
 * **Cents, not dollars, and the client does not decide the cap.** The form
 * shows what is left to refund so a staff member can see it, but
 * `invoiceRefundService` reads the invoice's own payment rows and refuses
 * anything larger - a browser that could name the amount is a browser that
 * could name a larger one.
 *
 * `toStoreCredit` is the choice that changes what gets written, so it is
 * required rather than defaulted: "keep the money and owe them goods" and "hand
 * the cash back" are different promises to the customer, and a default would
 * make one of them happen by accident.
 */
const invoiceRefundSchema = z.object({
  amountCents: cents.refine((value) => value > 0, 'Enter an amount to refund.'),
  toStoreCredit: z.boolean(),
  // How the cash went back. Meaningless on a store-credit refund, which records
  // its own method, so it is optional either way.
  method: z.string().trim().max(40).optional().or(z.literal('')),
  reason: z.string().trim().max(240).optional().or(z.literal('')),
});

/**
 * Chasing an unpaid invoice.
 *
 * The note is optional and free text because a chase is a human message - "as
 * discussed on the phone", "before the end of the month" - and the alternative
 * is a fixed sentence that fits nobody.
 */
const invoiceRemindSchema = z.object({
  note: z.string().trim().max(500).optional().or(z.literal('')),
});

// ---- phase 11e: email settings ----------------------------------------------

/**
 * Automatic email and the reminder schedule (§6.15, category 5).
 *
 * Every toggle defaults **off** in the model, and this schema does not
 * re-default them: the form always posts the full set, so an absent key here
 * would mean "switch it off" rather than "leave it alone" - which is the wrong
 * reading for a payload that is meant to be complete.
 */
const communicationsSettingsSchema = z.object({
  invoiceOnOrder: z.boolean(),
  quoteOnCreate: z.boolean(),
  paymentConfirmation: z.boolean(),
  paymentStatusUpdates: z.boolean(),
  accountApproved: z.boolean(),
  accountRejected: z.boolean(),
  invoiceReminders: z.boolean(),
  lowStockAlerts: z.boolean(),

  reminderDaysBefore: z.coerce.number().int().min(0, 'Use 0 or more days.').max(90),
  followUpDaysAfter: z.coerce.number().int().min(0, 'Use 0 or more days.').max(90),
  adminEmail: z.string().trim().email('Enter a valid email address.').optional().or(z.literal('')),
  // Cents. 0 means "never notify on size" - distinct from an empty field.
  notifyAboveAmount: cents.default(0),
  lowStockEmail: z.string().trim().email('Enter a valid email address.').optional().or(z.literal('')),
});

/**
 * One channel s send caps.
 *
 * Saved per channel rather than as one block, because the four are edited
 * separately on the screen and a save of the email caps should not rewrite
 * the SMS ones it happened to have in scope.
 */
const messageLimitSchema = z.object({
  channel: z.enum(MESSAGE_CHANNELS, { required_error: 'Name the channel.' }),
  // 0 is a real answer here: it means this channel sends nothing at all,
  // which is how a business switches one off without removing its templates.
  daily: z.coerce.number().int().min(0, 'Use 0 or more.').max(100000),
  monthly: z.coerce.number().int().min(0, 'Use 0 or more.').max(1000000),
  alertPercent: z.coerce.number().int().min(0, 'Use 0 to 100.').max(100, 'Use 0 to 100.'),
  alertEmail: z.string().trim().email('Enter a valid email address.').optional().or(z.literal('')),
});

/**
 * Returns to a supplier (Purchase § RMA / Returns).
 *
 * `purchaseOrder` is optional on purpose: a fault can surface long after the
 * paperwork, and refusing to record the return because nobody can find the PO
 * helps nobody. Costs are never sent - the server snapshots them from the
 * purchase order, or the product, so the expected credit cannot be typed.
 */
const SUPPLIER_RETURN_REASON_VALUES = [
  'faulty',
  'wrong_item',
  'over_shipped',
  'damaged_in_transit',
  'not_as_described',
  'other',
];

const supplierReturnSchema = z.object({
  supplier: z.string().trim().min(1, 'Choose a supplier.'),
  purchaseOrder: z.string().trim().optional(),
  items: z
    .array(
      z.object({
        product: z.string().trim().min(1, 'Choose a product.'),
        qty: z.coerce.number().int().min(1, 'Return at least one.').max(100_000),
        reason: z.enum(SUPPLIER_RETURN_REASON_VALUES).default('faulty'),
        note: z.string().trim().max(300).optional(),
      }),
    )
    .min(1, 'Add at least one line.'),
  reason: z.string().trim().max(500).optional(),
  supplierRmaNumber: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const supplierReturnStatusSchema = z.object({
  status: z.enum(['requested', 'authorised', 'shipped', 'credited', 'rejected']),
  note: z.string().trim().max(300).optional(),
  carrier: z.string().trim().max(60).optional(),
  trackingNumber: z.string().trim().max(60).optional(),
});

/** The credit a supplier actually gave - recorded, never projected. */
const supplierCreditSchema = z.object({
  amountDollars: z.coerce.number().min(0, 'A credit cannot be negative.').max(1_000_000),
  reference: z.string().trim().max(80).optional(),
  note: z.string().trim().max(300).optional(),
});


/**
 * Bought-in services and supplier subscriptions (Purchase § Service Products,
 * § Subscription Plans).
 *
 * One schema for both: they differ only in `billing`, and a `one_off` charge is
 * a service while anything that repeats is a subscription. `category` is
 * required for the same reason an expense requires one - a cost the reports
 * cannot group becomes an "uncategorised" line that grows until it is the
 * largest on the page.
 */
const SUPPLIER_BILLING_CYCLES = [
  { value: 'one_off', label: 'One-off' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

const supplierServiceSchema = z.object({
  name: z.string().trim().min(2, 'Name it.').max(160),
  code: z.string().trim().max(40).optional(),
  description: z.string().trim().max(2000).optional(),
  supplier: z.string().trim().min(1, 'Choose a supplier.'),
  amount: cents.refine((value) => value > 0, 'Enter an amount.'),
  billing: z.enum(['one_off', 'monthly', 'quarterly', 'yearly']).default('one_off'),
  category: z.string().trim().min(1, 'Pick an expense category.'),
  startedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.').optional(),
  nextRenewalAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.').optional(),
  reference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const supplierServiceUpdateSchema = supplierServiceSchema.partial();

/**
 * Recording a charge. Every field is optional because the plan already knows
 * what it costs - a staff member confirming a renewal at the agreed price should
 * not have to retype it, and an amount sent here overrides it for that charge
 * only.
 */
/**
 * A gratuity on an invoice.
 *
 * Zero is valid and clears one recorded by mistake, which is the difference
 * between this and a payment: a payment of nothing is a mistake, a tip of
 * nothing is a correction.
 */
const invoiceTipSchema = z.object({
  amountDollars: z.coerce.number().min(0).max(100000),
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.').optional(),
});

const supplierChargeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date.').optional(),
  description: z.string().trim().max(240).optional(),
  amount: cents.optional(),
  tax: cents.default(0),
  taxIncluded: z.boolean().default(true),
  method: z.string().trim().max(40).optional(),
  reference: z.string().trim().max(80).optional(),
});

/** The service catalogue's own categories, mirroring `models/Service.js`. */
const SERVICE_CATEGORIES = [
  'screen',
  'battery',
  'charging_port',
  'camera',
  'audio',
  'water_damage',
  'software',
  'data',
  'diagnostic',
  'other',
];

const SERVICE_CATEGORY_LABELS = {
  screen: 'Screen',
  battery: 'Battery',
  charging_port: 'Charging port',
  camera: 'Camera',
  audio: 'Audio',
  water_damage: 'Water damage',
  software: 'Software',
  data: 'Data',
  diagnostic: 'Diagnostic',
  other: 'Other',
};

/**
 * A sellable repair service (Sales § Services).
 *
 * `price` is dollars on the wire and cents in the database, like every other
 * amount a staff member types. `cost` is deliberately NOT defaulted: an unknown
 * cost and a zero cost produce very different margin numbers, and defaulting it
 * would record the first as the second.
 */
const serviceCatalogSchema = z.object({
  name: z.string().trim().min(2, 'Give the service a name.').max(160),
  description: z.string().trim().max(500).or(z.literal('')).optional(),
  category: z.enum(SERVICE_CATEGORIES).default('other'),

  price: z.coerce.number().min(0).max(1_000_000).default(0),
  cost: z.coerce.number().min(0).max(1_000_000).optional(),

  durationMinutes: z.coerce.number().int().min(0).max(100_000).default(0),
  warrantyDays: z.coerce.number().int().min(0).max(3650).default(0),

  // Free-form on purpose: which devices a shop takes in is the shop's business.
  deviceTypes: z.array(z.string().trim().max(40)).max(20).optional(),

  taxable: z.boolean().default(true),
  isActive: z.boolean().default(true),
  order: z.coerce.number().int().min(0).max(10_000).default(0),
});

/** Everything on the create form stays editable afterwards. */
const serviceCatalogUpdateSchema = serviceCatalogSchema.partial();

/**
 * A pasted or uploaded price list. Same shape as `taxonomyImportSchema`: the
 * rows are validated one at a time in the service, because a single bad line
 * must not cost the other thirty-nine.
 */
const serviceImportSchema = z.object({
  text: z
    .string()
    .min(1, 'Paste some rows, or choose a file.')
    .max(900_000, 'That file is too large. Import it in smaller batches.'),
});

/**
 * The devices a service business takes in (Sales § Ticket, § Quote).
 *
 * The same four levels the catalogue tree uses, on its own model - see
 * `models/DeviceCatalog.js` for why a repair shop cannot share `Taxonomy`.
 */
const DEVICE_KINDS = ['deviceType', 'brand', 'series', 'model'];

const DEVICE_KIND_LABELS = {
  deviceType: 'Category',
  brand: 'Brand',
  series: 'Device / series',
  model: 'Model',
};

const deviceCatalogSchema = z.object({
  name: z.string().trim().min(1, 'Give the device a name.').max(120),

  /**
   * The parent, which is what decides the level.
   *
   * **`kind` is deliberately absent from this schema.** The server derives it
   * from the parent's kind; a client that could name the level could hang a
   * device type under a model, and every denormalised `path` below it would be
   * meaningless. An absent parent means a root, which is always a device type.
   */
  parent: z.string().trim().length(24).or(z.literal('')).optional(),

  // Generated from the name when absent. Accepted so an import can keep the
  // slugs it already has.
  slug: z.string().trim().max(80).or(z.literal('')).optional(),

  icon: z.string().trim().max(40).or(z.literal('')).optional(),
  order: z.coerce.number().int().min(0).max(10_000).default(0),
  aliases: z.array(z.string().trim().max(60)).max(20).optional(),
  isActive: z.boolean().default(true),
});

/**
 * Editing.
 *
 * `parent` and `slug` are omitted rather than made optional: neither can change
 * once the node exists. Every ticket already written carries the slug in its
 * `path`, so changing it orphans them, and correcting a display-name typo must
 * not do that.
 */
const deviceCatalogUpdateSchema = deviceCatalogSchema
  .omit({ parent: true, slug: true })
  .partial();

/**
 * Self-service check-in (Sales § Kiosk).
 *
 * **Almost everything is optional**, and that is the design rather than
 * laxness. A customer standing at a tablet gives what they can: the flow lets
 * them skip an email, offers "pick the closest" on the model, and marks the
 * passcode and serial optional in as many words. A schema that demanded a full
 * record would reject exactly the check-ins the kiosk exists to capture, and
 * the counter completes the rest under `intake.awaitingReview`.
 *
 * The phone number is the one exception: it is where every status update goes,
 * and a check-in nobody can be told about is a device that sits uncollected.
 */
const kioskCheckInSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name.').max(60),
  lastName: z.string().trim().max(60).or(z.literal('')).optional(),
  phone: z.string().trim().min(7, 'Enter a phone number we can reach you on.').max(40),
  email: z.string().trim().toLowerCase().email().or(z.literal('')).optional(),

  category: z.string().trim().max(60).or(z.literal('')).optional(),
  brand: z.string().trim().max(60).or(z.literal('')).optional(),
  series: z.string().trim().max(120).or(z.literal('')).optional(),
  model: z.string().trim().max(120).or(z.literal('')).optional(),

  problem: z.string().trim().max(500).or(z.literal('')).optional(),
  passcode: z.string().trim().max(60).or(z.literal('')).optional(),
  serial: z.string().trim().max(80).or(z.literal('')).optional(),

  /**
   * The two things the customer actually agreed to.
   *
   * `termsAccepted` is the shop's protection and the server re-checks it
   * against the business's own `requireTerms` setting - a client that could
   * skip it would be skipping the one row that answers "they never agreed to
   * leave it".
   */
  termsAccepted: z.boolean().default(false),
  updatesConsent: z.boolean().default(false),
});

/** Unlocking the tablet. Digits only; the server compares against a hash. */
const kioskUnlockSchema = z.object({
  pin: z.string().trim().regex(/^\d{4,8}$/, 'Enter the kiosk PIN.'),
});

/** Setting it, from the admin side. Never reachable from the tablet. */
const kioskPinSchema = z.object({
  pin: z.string().trim().regex(/^\d{4,8}$/, 'A kiosk PIN is 4 to 8 digits.'),
});

/**
 * The kiosk settings screen - everything about the tablet except its PIN.
 *
 * **The PIN is not in here, on purpose.** It is a credential and it has its own
 * route (`PATCH /admin/kiosk/pin`), which audits the change and never stores or
 * returns the digits. Folding it into this form would put a credential in the
 * same payload as a welcome message, and would mean re-sending it on every
 * unrelated save.
 *
 * `isEnabled` is the switch that decides whether a tablet may unlock at all,
 * which is not the same question as the `sales.kiosk` feature flag: that one
 * says this business may have a kiosk, this one says the tablet is live today.
 */
const kioskSettingsSchema = z.object({
  isEnabled: z.boolean(),
  welcomeMessage: z.string().trim().max(200, 'Keep the welcome under 200 characters.'),
  thankYouMessage: z.string().trim().max(200, 'Keep the thank you under 200 characters.'),
  readAloud: z.boolean(),
  requireTerms: z.boolean(),
  termsText: z.string().trim().max(1000, 'Keep the terms under 1,000 characters.'),
}).refine((value) => !value.requireTerms || value.termsText.length > 0, {
  // A required tick with nothing written beside it is a customer agreeing to a
  // blank line, which is worth less than not asking at all.
  message: 'Write the terms the customer is agreeing to, or stop requiring them.',
  path: ['termsText'],
});

/**
 * Repair estimates (Sales § Quote, service businesses).
 *
 * The estimate and the ticket share a device shape on purpose, so the line and
 * device schemas are **derived from the ticket's** rather than restated. A
 * field added to a ticket line is then validated on an estimate line too, and
 * the two cannot drift into disagreeing about what a line is.
 */
const SERVICE_QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'expired', 'converted', 'rejected'];
const SERVICE_QUOTE_SOURCES = ['counter', 'phone', 'web', 'kiosk'];

const SERVICE_QUOTE_STATUS_LABELS = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  expired: 'Expired',
  converted: 'Converted',
  rejected: 'Rejected',
};

/** A quoted line, plus where it came from in the service catalogue. */
const serviceQuoteLineSchema = ticketLineSchema.extend({
  service: z.string().trim().length(24).optional(),
});

/**
 * A device on an estimate.
 *
 * `condition` is **omitted deliberately**: a component-by-component check is
 * something a counter does with the hardware in front of them, and a grid of
 * "untested" rows filled in over the phone is a record that looks like evidence
 * and is not.
 */
const serviceQuoteDeviceSchema = ticketDeviceSchema
  .omit({ condition: true })
  .extend({
    services: z.array(serviceQuoteLineSchema).max(40).default([]),
    parts: z.array(serviceQuoteLineSchema).max(40).default([]),
  });

const serviceQuoteSchema = z.object({
  // Required, unlike a ticket's: an estimate exists to be sent to somebody, and
  // one addressed to nobody cannot be.
  user: z.string().trim().length(24, 'Choose a customer.'),

  source: z.enum(SERVICE_QUOTE_SOURCES).default('counter'),
  // `INVOICE_SERVICE_TYPES` is `{value, label}` pairs for a select, so the enum
  // is built from its values - the estimate and the invoice must agree about
  // this vocabulary, and restating it here is how they would stop agreeing.
  serviceType: z.enum(INVOICE_SERVICE_TYPES.map((entry) => entry.value)).default('walk_in'),

  quoteDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional(),
  validUntil: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional(),

  devices: z.array(serviceQuoteDeviceSchema).min(1, 'Add a device.').max(10),

  clientNotes: z.string().trim().max(2000).or(z.literal('')).optional(),
  technicianNotes: z.string().trim().max(2000).or(z.literal('')).optional(),
  internalNotes: z.string().trim().max(2000).or(z.literal('')).optional(),

  discountDollars: z.coerce.number().min(0).max(1_000_000).optional(),
  discountCode: z.string().trim().max(40).or(z.literal('')).optional(),

  extendedServiceFee: z.boolean().default(false),
  extendedServiceFeeDollars: z.coerce.number().min(0).max(1_000_000).optional(),

  taxRate: z.coerce.number().min(0).max(100).optional(),
  province: z.string().trim().max(2).or(z.literal('')).optional(),
});

/**
 * Editing. The customer and the source are fixed once the estimate exists -
 * re-pointing a sent document at a different person is a new estimate, not an
 * edit to this one.
 */
const serviceQuoteUpdateSchema = serviceQuoteSchema.omit({ user: true, source: true }).partial();

const serviceQuoteStatusSchema = z.object({
  status: z.enum(SERVICE_QUOTE_STATUSES),
  note: z.string().trim().max(500).or(z.literal('')).optional(),
});

/** Converting to a ticket. Priority is the one thing the counter adds. */
const serviceQuoteConvertSchema = z.object({
  priority: z.enum(TICKET_PRIORITIES).default('normal'),
});

export { quoteToTicketSchema, ticketDepositSchema, ticketConvertSchema, TAX_RATES, TAX_LABELS, provinceTaxOptions, INVOICE_SERVICE_TYPES, SERVICE_INVOICE_TYPES, ORDER_OPEN_STATUSES, ORDER_UNFULFILLED_STATUSES, approveUserSchema, rejectUserSchema, creditSchema, clientSchema, clientFormSchema, clientCreateFormSchema, clientUpdateSchema, CONSENT_CHANNELS, PREFERRED_CONTACT_OPTIONS, CUSTOMER_SOURCE_OPTIONS, contactConsentSchema, MEMBERSHIP_TIERS, tierSchema, internalNoteSchema, storeCreditSchema, refundSchema, userStatusSchema, productSchema, ORDER_STATUS_FLOW, orderStatusSchema, CARRIERS, ADMIN_NAV, ADMIN_LEGACY_REDIRECTS, invoicePaymentSchema, invoiceTipSchema, invoiceVoidSchema, webQuoteStatusSchema, creditPaymentSchema, invoiceUpdateSchema, bulkOrderStatusSchema, supplierSchema, purchaseOrderSchema, purchaseOrderStatusSchema, purchaseReceiveSchema, purchasePaymentSchema, purchaseInviteSchema, purchaseSendSchema, purchaseNegotiateSchema, purchaseConfirmSchema, proformaRevisionSchema, supplierQuoteSchema, supplierDeclineSchema, supplierProformaSchema, supplierDeliverySchema, superAdminLoginSchema, tenantSchema, tenantSlotsSchema, superAdminBusinessSchema, businessAddressSchema, addressRequestSchema, addressRejectSchema, businessAssignSchema, businessFeatureSchema, impersonationSchema, tenantOwnerSchema, supportMessageSchema, planSchema, planFeatureSchema, businessStatusSchema, supplierLoginSchema, supplierForgotSchema, supplierResetSchema, supplierPasswordSchema, expenseSchema, expenseCategorySchema, stockAdjustSchema, productOpsSchema, quoteSchema, quoteStatusSchema, quoteConvertSchema, adminOrderSchema, adminInvoiceSchema, RMA_ITEM_DISPOSITIONS, rmaSchema, TICKET_STATUSES, TICKET_PRIORITIES, TICKET_SOURCES, TICKET_STATUS_LABELS, CONDITION_GRADES, CONDITION_PARTS, ticketSchema, ticketDeviceSchema, ticketLineSchema, ticketUpdateSchema, ticketStatusSchema, rmaStatusSchema, rmaInspectSchema, rmaResolveSchema, PERMISSION_AREAS, PERMISSION_LEVELS, PERMISSION_LEVEL_LABELS, SETTINGS_SUBAREAS, SUBAREA_LEVELS, SUBAREA_LEVEL_LABELS, settingsAreaKey, BUSINESS_STATUSES, BUSINESS_COLOR_TOKENS, businessSchema, roleSchema, staffUserSchema, staffUserUpdateSchema, MESSAGE_CHANNELS, TEMPLATE_DOCUMENTS, CAMPAIGN_AUDIENCES, CAMPAIGN_AUDIENCE_LABELS, messageSchema, callLogSchema, messageTemplateSchema, campaignSchema, unsubscribeSchema, referralRateSchema, businessInfoSchema, saleSettingsSchema, shippingSettingsSchema, paymentMethodsSettingsSchema, inventorySettingsSchema, agreementTemplateSchema, agreementSignSchema, providerCredentialSchema, taxonomyNodeSchema, taxonomyCreateSchema, taxonomyImportSchema, invoiceStatusRuleSchema, LABEL_COLOR_TOKENS, LABEL_COLOR_OPTIONS, invoiceLabelSchema, invoiceLabelSetSchema, invoiceRefundSchema, invoiceRemindSchema, communicationsSettingsSchema, messageLimitSchema, SUPPLIER_RETURN_REASON_VALUES, supplierReturnSchema, supplierReturnStatusSchema, supplierCreditSchema, SUPPLIER_BILLING_CYCLES, supplierServiceSchema, supplierServiceUpdateSchema, supplierChargeSchema, SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS, serviceCatalogSchema, serviceCatalogUpdateSchema, serviceImportSchema, DEVICE_KINDS, DEVICE_KIND_LABELS, deviceCatalogSchema, deviceCatalogUpdateSchema, kioskCheckInSchema, kioskUnlockSchema, kioskPinSchema, kioskSettingsSchema, SERVICE_QUOTE_STATUSES, SERVICE_QUOTE_SOURCES, SERVICE_QUOTE_STATUS_LABELS, serviceQuoteLineSchema, serviceQuoteDeviceSchema, serviceQuoteSchema, serviceQuoteUpdateSchema, serviceQuoteStatusSchema, serviceQuoteConvertSchema };
