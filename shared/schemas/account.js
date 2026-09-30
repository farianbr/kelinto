import { z } from 'zod';
import { addressShape, withPostalRule } from './checkout.js';

const profileSchema = z.object({
  businessName: z.string().trim().min(2, 'Enter your company name.').max(160).optional().or(z.literal('')),
  contactName: z.string().trim().min(2, 'Enter a contact name.'),
  phone: z.string().trim().min(7, 'Enter a phone number.'),
  website: z.string().trim().max(120).optional(),
  businessType: z.string().trim().max(80).optional(),
  taxId: z.string().trim().max(40).optional(),
  resellerCert: z.string().trim().max(60).optional(),
});

/**
 * Saved addresses reuse the checkout address shape plus a label and defaults.
 *
 * Extends `addressShape` - the plain object - and then re-applies the country's
 * postal rule, because `.extend()` exists on an object schema and not on the
 * refined one. Extending the refined schema silently threw at import time.
 */
const savedAddressSchema = withPostalRule(
  addressShape.extend({
    label: z.string().trim().min(1, 'Give this address a label.').max(40),
    isDefaultShipping: z.boolean().optional().default(false),
    isDefaultBilling: z.boolean().optional().default(false),
  }),
);

const paymentMethodSchema = z.object({
  type: z.enum(['card', 'ach']).default('card'),
  brand: z.string().trim().max(24).optional(),
  last4: z.string().trim().regex(/^\d{4}$/, 'Enter the last four digits.'),
  expMonth: z.coerce.number().int().min(1).max(12).optional(),
  expYear: z.coerce.number().int().min(2024).max(2100).optional(),
  isDefault: z.boolean().optional().default(false),
});

/**
 * Quick order pad: a list of SKUs and quantities, pasted or typed. Unresolvable
 * SKUs come back named rather than silently dropped.
 */
const bulkAddSchema = z.object({
  lines: z
    .array(
      z.object({
        sku: z.string().trim().min(2).max(40),
        qty: z.coerce.number().int().min(1).max(9999).default(1),
      }),
    )
    .min(1, 'Add at least one SKU.')
    .max(200),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z
      .string()
      .min(8, 'At least 8 characters.')
      .regex(/[A-Za-z]/, 'Include a letter.')
      .regex(/[0-9]/, 'Include a number.'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

/**
 * The account sidebar, two levels deep - the same shape as `ADMIN_NAV`, so one
 * nav-tree pattern serves both sides of the product.
 *
 * A flat `Overview` row, then three groups whose children are the real screens.
 * Ten flat rows was a list an eye had to read end to end to find anything in;
 * grouped, the buyer picks the heading first and scans four items instead of
 * ten. The groups are the three reasons a buyer opens this area: to follow
 * money owed, to buy something, or to change a setting.
 *
 * `icon` names a lucide export that `accountIcons.js` maps - the schema stays a
 * plain data module the server can also read.
 *
 * `badge` names a counter on `GET /account/summary`; the sidebar renders it
 * only when the count is non-zero.
 */
const ACCOUNT_NAV = [
  { key: 'overview', label: 'Overview', to: '/account', icon: 'LayoutDashboard' },
  {
    key: 'billing',
    label: 'Orders & billing',
    icon: 'Receipt',
    children: [
      { key: 'orders', label: 'Orders & tracking', to: '/account/orders', icon: 'Package', badge: 'openOrders' },
      {
        key: 'invoices',
        label: 'Invoices & statements',
        to: '/account/invoices',
        icon: 'FileText',
        badge: 'outstandingInvoices',
      },
      { key: 'credit', label: 'Credit & balance', to: '/account/credit', icon: 'Wallet' },
      { key: 'activity', label: 'Activity', to: '/account/activity', icon: 'History' },
    ],
  },
  {
    key: 'purchasing',
    label: 'Purchasing',
    icon: 'ShoppingCart',
    children: [
      { key: 'quick-order', label: 'Quick order pad', to: '/account/quick-order', icon: 'Zap' },
      { key: 'referrals', label: 'Refer & earn', to: '/account/referrals', icon: 'Gift' },
      // Phones sold to us at the kiosk (Sales § Sell your phone).
      { key: 'sold-phones', label: 'Phones you sold us', to: '/account/sold-phones', icon: 'Smartphone' },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: 'Settings',
    children: [
      { key: 'addresses', label: 'Saved addresses', to: '/account/addresses', icon: 'MapPin' },
      { key: 'payment', label: 'Payment methods', to: '/account/payment-methods', icon: 'CreditCard' },
      { key: 'company', label: 'Account & security', to: '/account/company', icon: 'Building2' },
    ],
  },
];

/**
 * Every leaf in `ACCOUNT_NAV`, flat and in render order.
 *
 * The tree is the sidebar's shape, but three callers want the destinations and
 * not the grouping - the mobile section dropdown, the header account menu, and
 * the active-route lookup. Derived here rather than kept as a second list,
 * because two hand-maintained lists of the same routes is how a screen goes
 * missing from one of them.
 */
const ACCOUNT_NAV_ITEMS = ACCOUNT_NAV.flatMap((item) => item.children ?? [item]);

/**
 * Advance recharge: the buyer prepays and holds the money as store credit.
 * Bounded at both ends - a $5 top-up costs more in gateway fees than it is
 * worth, and five figures should be a phone call to the sales desk.
 */
const rechargeSchema = z.object({
  amountDollars: z.coerce
    .number()
    .min(25, 'Top up at least $25.')
    .max(25_000, 'For a top-up this size, talk to your account rep.'),
  poNumber: z.string().trim().max(40).optional(),
});

/**
 * Paying an invoice, or paying the line of credit down.
 *
 * **No amount.** What is owed is a fact the server already holds, and §5.3 is
 * explicit that the client never sends a price - an amount here would be a
 * number a buyer could edit into an underpayment that still marked an invoice
 * settled. The invoice's own balance is the amount, every time.
 *
 * `useStoreCredit` asks for credit to be drawn first and the card charged only
 * for what is left; how much that turns out to be is decided server-side too.
 *
 * The card fields are **display only** and are not read by the payment path.
 * They exist because the gateway is a mock (`services/payment.js`) and a
 * payment form with nothing in it does not demonstrate anything. Nothing here
 * is stored - the repo holds no PAN anywhere, by design.
 */
const invoicePaymentSchema = z.object({
  useStoreCredit: z.boolean().optional().default(false),
  poNumber: z.string().trim().max(40).optional(),
});

const creditPayoffSchema = z.object({
  useStoreCredit: z.boolean().optional().default(false),
  poNumber: z.string().trim().max(40).optional(),
});

export { profileSchema, savedAddressSchema, paymentMethodSchema, bulkAddSchema, changePasswordSchema, ACCOUNT_NAV, ACCOUNT_NAV_ITEMS, rechargeSchema, invoicePaymentSchema, creditPayoffSchema };
