import { z } from 'zod';
import { isValidPostal, postalExampleFor } from '../regions.js';

/**
 * Canadian provinces and territories.
 *
 * Kept as a named export because tax, GST/HST and the seller's own address are
 * still Canadian facts, and several screens want exactly this list. An address
 * FORM should not read it directly - use `regionsFor(country)`, which returns
 * this for Canada and the right list everywhere else.
 */
const PROVINCES = [
  { value: 'AB', label: 'Alberta' },
  { value: 'BC', label: 'British Columbia' },
  { value: 'MB', label: 'Manitoba' },
  { value: 'NB', label: 'New Brunswick' },
  { value: 'NL', label: 'Newfoundland and Labrador' },
  { value: 'NS', label: 'Nova Scotia' },
  { value: 'NT', label: 'Northwest Territories' },
  { value: 'NU', label: 'Nunavut' },
  { value: 'ON', label: 'Ontario' },
  { value: 'PE', label: 'Prince Edward Island' },
  { value: 'QC', label: 'Quebec' },
  { value: 'SK', label: 'Saskatchewan' },
  { value: 'YT', label: 'Yukon' },
];

/**
 * An address anywhere.
 *
 * **Postal validation depends on the country**, so it cannot be a field-level
 * regex - the rule is only knowable once `country` has been read. A
 * `superRefine` runs after both fields are parsed and asks `regions.js` what
 * shape this country uses; a country with no fixed format accepts anything
 * non-empty, which is the honest answer rather than a false rejection.
 *
 * `region` says "region" and not "province" because it is a province in Canada,
 * a state in the US and a prefecture in Japan. The stored field was always
 * called `region`; only the validation assumed otherwise.
 *
 * **The raw object and the refined schema are separate exports.** A
 * `superRefine` returns a `ZodEffects`, which has no `.extend()` - and
 * `account.js` extends this to add a saved-address label. So the object stays
 * extendable as `addressShape`, and `withPostalRule()` applies the country
 * check to it or to anything built from it. An extender that forgets to call it
 * loses only the postal format check, never a field.
 */
const addressShape = z.object({
  contactName: z.string().trim().min(2, 'Enter a contact name.'),
  company: z.string().trim().optional(),
  line1: z.string().trim().min(2, 'Enter a street address.'),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(2, 'Enter a city.'),
  region: z.string().trim().min(2, 'Select a region.'),
  postal: z.string().trim().min(1, 'Enter a postal code.'),
  country: z.string().trim().default('Canada'),
  phone: z.string().trim().min(7, 'Enter a phone number.'),
});

/** Applies the country's postal rule to any schema carrying postal + country. */
const withPostalRule = (schema) =>
  schema.superRefine((value, ctx) => {
    if (!value.postal || isValidPostal(value.postal, value.country)) return;

    const example = postalExampleFor(value.country);
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['postal'],
      message: example
        ? `Enter a valid postal code (${example}).`
        : 'Enter a valid postal code.',
    });
  });

/** The address as everything but an extender should use it. */
const addressSchema = withPostalRule(addressShape);

/** Flat-rate placeholder until the client confirms carriers (PROGRESS.md Q5). */
const DELIVERY_METHODS = [
  {
    code: 'ground',
    label: 'Ground',
    detail: '2–4 business days',
    cost: 1895,
    etaDays: 3,
    freeOver: 50_000,
  },
  { code: 'express', label: 'Express', detail: 'Next business day', cost: 3495, etaDays: 1 },
  { code: 'pickup', label: 'Warehouse pickup', detail: 'Ready in 2 hours', cost: 0, etaDays: 0 },
];

/**
 * How an order is paid.
 *
 * `counter` is the kiosk's: a customer shopping on the tablet in the shop picks
 * the parts up there and pays a person for them. It is only accepted from a
 * request carrying the kiosk's session (`orderController.create`), because
 * from a phone at home "pay at the counter" is an order nobody has agreed to
 * pay for.
 */
const PAYMENT_METHODS = ['card', 'terms', 'counter'];

const checkoutSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
    /**
     * Required everywhere except a counter order, which is collected in the shop
     * the tablet stands in. Asking a customer at a kiosk to type a street
     * address for a parcel nobody will post is a form asking for the sake of it.
     */
    shippingAddress: addressSchema.optional(),
    billingSameAsShipping: z.boolean().default(true),
    billingAddress: addressSchema.optional(),
    deliveryMethod: z.enum(['ground', 'express', 'pickup']),
    paymentMethod: z.enum(PAYMENT_METHODS),
    // A flag, never an amount: how much store credit an order draws is decided
    // server-side from the live balance (PROJECT_INSTRUCTIONS.md §5.3).
    useStoreCredit: z.boolean().default(false),
    poNumber: z.string().trim().max(40).optional(),
    deliveryNotes: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.paymentMethod === 'counter') {
      if (value.deliveryMethod !== 'pickup') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['deliveryMethod'],
          message: 'An order paid at the counter is picked up there.',
        });
      }
      return;
    }
    if (!value.shippingAddress) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['shippingAddress', 'line1'],
        message: 'Enter a shipping address.',
      });
    }
  });

/** The checkout sections, in the order the conversational flow opens them. */
const CHECKOUT_STEPS = [
  { key: 'contact', label: 'Contact' },
  { key: 'shipping', label: 'Shipping address' },
  { key: 'delivery', label: 'Delivery method' },
  { key: 'payment', label: 'Payment' },
  { key: 'review', label: 'Review' },
];

/** Placeholder rate - awaiting the client's real tax rules (PROGRESS.md Q4). */
const TAX_RATE = 0.13;

export { PROVINCES, addressShape, withPostalRule, addressSchema, DELIVERY_METHODS, PAYMENT_METHODS, checkoutSchema, CHECKOUT_STEPS, TAX_RATE };
