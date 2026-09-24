import { z } from 'zod';

/** Shared by the server's validate() middleware and the client's React Hook Form resolvers. */

const passwordSchema = z
  .string()
  .min(8, 'At least 8 characters.')
  .regex(/[A-Za-z]/, 'Include a letter.')
  .regex(/[0-9]/, 'Include a number.');

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
  remember: z.boolean().optional().default(false),
  // Sent only after the server answered BUSINESS_CHOICE_REQUIRED: one address
  // with panel accounts at several businesses, and the person picked one.
  business: z.string().trim().regex(/^[a-f\d]{24}$/i, 'Choose a business.').optional(),
});

const registerSchema = z.object({
  // Optional: the account is identified by the person (`contactName`), and a
  // sole trader may not have a registered company name at all. They can add it
  // later from Account & security.
  businessName: z.string().trim().min(2, 'Enter your company name.').max(160).optional().or(z.literal('')),
  /**
   * Asked as two fields and stored as one.
   *
   * `contactName` is what the model, the welcome mail, the approvals queue and
   * ~150 other references call it, so splitting it in the model to split it on
   * one form would be the tail wagging the dog - same call as `phone` and its
   * dial code. The form composes the two halves and sends this; `firstName` and
   * `lastName` never leave the client.
   */
  contactName: z.string().trim().min(2, 'Enter a contact name.'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  phone: z.string().trim().min(7, 'Enter a phone number.'),
  password: passwordSchema,
  businessType: z.string().trim().optional(),
  website: z.string().trim().optional(),
  taxId: z.string().trim().optional(),
  // A referral code from an existing account (ERP rework §6.13). Optional, and
  // uppercased here so the buyer can type it however it was written down. An
  // unrecognised code is refused server-side rather than ignored - silently
  // dropping it costs a real referrer real money.
  referralCode: z
    .string()
    .trim()
    .toUpperCase()
    .max(16)
    .optional()
    .or(z.literal('')),
  /**
   * Which channels the business agreed to be contacted on (CASL §6.13).
   *
   * Optional, and every channel defaults to false: registering is implied
   * consent for transactional mail under s.10(9) regardless of what is ticked
   * here, and `marketingConsent` records that separately. This is the narrower
   * question of which channels they actively said yes to, and an untouched
   * form must record "not asked for" rather than a fabricated opt-in.
   */
  contactConsent: z
    .object({
      sms: z.boolean().optional().default(false),
      whatsapp: z.boolean().optional().default(false),
      email: z.boolean().optional().default(false),
      call: z.boolean().optional().default(false),
    })
    .optional(),
  address: z
    .object({
      line1: z.string().trim().min(2, 'Enter a street address.'),
      city: z.string().trim().min(2, 'Enter a city.'),
      region: z.string().trim().min(2, 'Select a province.'),
      postal: z
        .string()
        .trim()
        .regex(/^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/, 'Enter a valid postal code.'),
    })
    .optional(),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
});

/**
 * Setting a new password from a reset link.
 *
 * The token is the whole of the authorisation - there is no session yet and no
 * current password to confirm, which is exactly why it is single-use and
 * short-lived server-side.
 */
const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(20, 'That reset link is not valid.'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

/**
 * A business applying to SELL to Cellvix, from the storefront sign-up.
 *
 * Deliberately not `registerSchema`: this creates no account and no password.
 * Cellvix's suppliers are onboarded by the purchasing team with terms and a
 * code agreed off-platform, so what the storefront can usefully collect is an
 * application for a human to review, not a login.
 *
 * The four required fields match the buyer form's, so "what a sign-up asks
 * for" does not change shape depending on which side of the transaction you are on.
 */
const supplierApplicationSchema = z.object({
  businessName: z.string().trim().min(2, 'Enter your business name.').max(120),
  contactName: z.string().trim().min(2, 'Enter a contact name.').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  phone: z.string().trim().min(7, 'Enter a phone number.').max(40),
  website: z.string().trim().max(200).optional().or(z.literal('')),
  supplies: z.string().trim().max(600).optional().or(z.literal('')),
  address: z
    .object({
      line1: z.string().trim().max(120).optional().or(z.literal('')),
      line2: z.string().trim().max(120).optional().or(z.literal('')),
      city: z.string().trim().max(80).optional().or(z.literal('')),
      region: z.string().trim().max(2).optional().or(z.literal('')),
      postal: z.string().trim().max(10).optional().or(z.literal('')),
      // Suppliers are the one group who genuinely are often not Canadian, so
      // the country is asked rather than assumed. Defaulted all the same.
      country: z.string().trim().max(60).default('Canada'),
    })
    .optional(),
});

export { passwordSchema, loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema, supplierApplicationSchema };
