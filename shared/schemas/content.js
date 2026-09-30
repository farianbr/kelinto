import { z } from 'zod';
import { PAGE_SECTIONS } from '../websitePages.js';

/**
 * Editorial content: blog posts, FAQs and offers.
 *
 * All three are admin-authored and publicly read, so the same file serves the
 * admin forms (client) and the `validate()` middleware (server). Money is
 * integer cents here as everywhere else (PROJECT_INSTRUCTIONS.md §5.8).
 */

/**
 * The optional half of a byline, shared by blog posts and product articles.
 *
 * `authorName` is NOT here: the blog requires one and a product article does
 * not, so each schema states its own rule for that field and spreads these.
 * The caps match `shared/author.js` exactly, so anything that validates here
 * cannot be silently truncated on write.
 *
 * The link fields are `url()` rather than free strings - a social link that is
 * not a URL renders as a dead icon, and the form is the only place that can
 * still tell the author about it.
 */
const authorLink = z.string().trim().url('Enter a full URL, including https://').max(300).optional().or(z.literal(''));

const authorFields = {
  authorRole: z.string().trim().max(80).optional().or(z.literal('')),
  authorBio: z.string().trim().max(400).optional().or(z.literal('')),
  authorPhoto: z.string().trim().max(500).optional().or(z.literal('')),
  authorLinkedin: authorLink,
  authorX: authorLink,
  authorFacebook: authorLink,
  authorWebsite: authorLink,
};

const cents = z.coerce.number().int().min(0).max(100_000_000);
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Not a valid account id.');
const optionalDate = z.string().trim().optional().nullable().or(z.literal(''));

// --- blog --------------------------------------------------------------------

const BLOG_CATEGORIES = [
  { value: 'repair-guides', label: 'Repair guides' },
  { value: 'industry-news', label: 'Industry news' },
  { value: 'product-updates', label: 'Product updates' },
  { value: 'business-tips', label: 'Business tips' },
];

const BLOG_STATUSES = ['draft', 'published'];

const blogPostSchema = z.object({
  title: z.string().trim().min(4, 'Give the post a title.').max(160),
  excerpt: z.string().trim().min(10, 'Write a one-line summary.').max(320),
  // Plain text with a tiny markup vocabulary - see client/src/lib/richText.jsx.
  // Never HTML: the renderer builds React nodes, so there is nothing to inject.
  body: z.string().trim().min(40, 'The post needs a body.').max(40_000),
  category: z.enum(BLOG_CATEGORIES.map((c) => c.value)),
  tags: z.array(z.string().trim().min(1).max(30)).max(8).default([]),
  coverImage: z.string().trim().max(500).optional().or(z.literal('')),
  authorName: z.string().trim().min(2, 'Who wrote it?').max(80),
  ...authorFields,
  status: z.enum(BLOG_STATUSES).default('draft'),
  publishedAt: optionalDate,
  isFeatured: z.boolean().default(false),
});

// --- faq ---------------------------------------------------------------------

const FAQ_CATEGORIES = [
  { value: 'ordering', label: 'Ordering' },
  { value: 'accounts', label: 'Accounts & approval' },
  { value: 'pricing', label: 'Pricing & credit' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'returns', label: 'Returns & warranty' },
  { value: 'products', label: 'Parts & grading' },
];

const FAQ_SCOPES = [
  { value: 'general', label: 'General - FAQ page' },
  { value: 'product', label: 'Product - product detail pages' },
];

/**
 * A product-scoped FAQ with no `partType` and no `deviceTypeSlug` applies to
 * every product. Filling either one narrows it; that is how "every product
 * detail page has an FAQ" holds without authoring 420 of them.
 */
const faqSchema = z.object({
  question: z.string().trim().min(6, 'Enter the question.').max(240),
  answer: z.string().trim().min(10, 'Enter the answer.').max(4000),
  category: z.enum(FAQ_CATEGORIES.map((c) => c.value)).default('ordering'),
  scope: z.enum(['general', 'product']).default('general'),
  partType: z.string().trim().max(60).optional().or(z.literal('')),
  deviceTypeSlug: z.string().trim().max(60).optional().or(z.literal('')),
  order: z.coerce.number().int().min(0).max(999).default(0),
  isPublished: z.boolean().default(true),
});

// --- product articles --------------------------------------------------------

/**
 * The article attached to one product, authored under admin SEO.
 *
 * `body` is plain text in the markup vocabulary `lib/richText.jsx` reads, the
 * same one the blog uses. It is never HTML: the project renders admin-authored
 * copy through that renderer precisely so nothing has to be trusted at render
 * time (Instructions §8).
 *
 * The product is NOT in the body - it comes from the URL, so a payload cannot
 * move an article to a different product by accident.
 */
const productArticleSchema = z.object({
  heading: z.string().trim().min(6, 'Enter a heading.').max(140),
  body: z.string().trim().min(40, 'Write the article body.').max(20000),
  // Optional here where the blog requires it: 773 seeded articles carry no
  // byline, and the storefront falls back to the parts-desk line for those.
  authorName: z.string().trim().max(80).optional().or(z.literal('')),
  ...authorFields,
  status: z.enum(['draft', 'published']).default('draft'),
});
// --- product reviews ---------------------------------------------------------

/**
 * A customer review of a product they bought.
 *
 * The ORDER and the PRODUCT are in the body rather than the URL because a
 * review is written against a specific order line, and the pair is what the
 * service checks entitlement on. Neither the author nor the date is here:
 * both come from the session and the clock, and a client that could assert
 * them could forge a review.
 */
const reviewSchema = z.object({
  orderId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  rating: z.coerce.number().int().min(1, 'Choose a rating.').max(5),
  title: z.string().trim().max(120).optional().or(z.literal('')),
  body: z.string().trim().min(10, 'Tell other shops what you thought.').max(2000),
});

/** Admin moderation: hide or restore one review. */
const reviewModerationSchema = z.object({
  isHidden: z.boolean(),
  reason: z.string().trim().max(200).optional().or(z.literal('')),
});
// --- offers ------------------------------------------------------------------

/**
 * The three things an admin can author, as the admin thinks of them.
 *
 * `exclusive` is NOT a third `kind` in the database - it is `kind: 'combo'`
 * carrying `isExclusive`, which is what gives it a real `bundlePrice` the
 * pricing service already knows how to charge and lets it check out through
 * `/cart/bundles` like every other offer. Splitting it into its own kind would
 * have meant a second path deciding what one product costs.
 *
 * But an admin does not think "a combo with a flag on it", they think "the
 * exclusive deal page", so the FORM offers three types and maps the choice onto
 * the two fields. The label is the storefront's own name for each surface, so
 * the person setting one up can tell which page they are filling in.
 *
 * The third storefront offer page, Stock clearance, is deliberately not here:
 * clearance is a flag on each PRODUCT (`isClearance` / `clearancePrice`), set
 * from Inventory, because it marks down a part rather than running a promotion
 * over the catalogue.
 */
const OFFER_KINDS = [
  { value: 'combo', label: 'Combo deal - a fixed bundle of SKUs at one bundle price' },
  { value: 'deal', label: 'Catalogue deal - a discount across a slice of the catalogue' },
  { value: 'exclusive', label: 'Exclusive deal - one product, its own page, with a countdown' },
];

const DISCOUNT_TYPES = [
  { value: 'percent', label: '% off' },
  { value: 'amount', label: '$ off' },
  { value: 'free-shipping', label: 'Free shipping' },
];

const OFFER_ACCENTS = ['brand', 'ok', 'info', 'warn'];

const offerSchema = z
  .object({
    title: z.string().trim().min(4, 'Give the offer a title.').max(120),
    subtitle: z.string().trim().max(200).optional().or(z.literal('')),
    description: z.string().trim().max(2000).optional().or(z.literal('')),
    terms: z.string().trim().max(1000).optional().or(z.literal('')),
    kind: z.enum(['deal', 'combo']).default('deal'),
    isExclusive: z.boolean().default(false),
    badge: z.string().trim().max(30).optional().or(z.literal('')),
    accent: z.enum(OFFER_ACCENTS).default('brand'),
    code: z.string().trim().max(24).optional().or(z.literal('')),

    // deal
    discountType: z.enum(['percent', 'amount', 'free-shipping']).default('percent'),
    discountPercent: z.coerce.number().int().min(0).max(90).default(0),
    discountAmount: cents.default(0),
    minQty: z.coerce.number().int().min(0).max(9999).default(0),
    minSpend: cents.default(0),
    target: z
      .object({
        deviceTypeSlug: z.string().trim().max(60).optional().or(z.literal('')),
        brandSlug: z.string().trim().max(60).optional().or(z.literal('')),
        partType: z.string().trim().max(60).optional().or(z.literal('')),
        grade: z.string().trim().max(20).optional().or(z.literal('')),
      })
      .default({}),

    // combo
    items: z
      .array(
        z.object({
          sku: z.string().trim().min(2).max(40),
          qty: z.coerce.number().int().min(1).max(999).default(1),
        }),
      )
      .max(20)
      .default([]),
    bundlePrice: cents.default(0),

    // --- the exclusive deal page ------------------------------------------
    // Every one of these was seed-only until now, which meant the page could be
    // created but never edited: an admin could see it on the storefront and had
    // no way to change a word of it. All optional, because the page renders
    // each section only when it has content - an exclusive promoted before
    // anybody writes the FAQ is a valid page, not a scaffold of empty headings.
    videoUrl: z.string().trim().max(500).optional().or(z.literal('')),
    videoPoster: z.string().trim().max(500).optional().or(z.literal('')),
    pitch: z.string().trim().max(4000).optional().or(z.literal('')),
    highlights: z.array(z.string().trim().max(140)).max(8).default([]),
    faqs: z
      .array(
        z.object({
          question: z.string().trim().min(4).max(200),
          answer: z.string().trim().min(4).max(2000),
        }),
      )
      .max(12)
      .default([]),

    // who may redeem, and how often
    redemption: z.enum(['multi', 'single']).default('multi'),
    usageLimit: z.coerce.number().int().min(0).max(1_000_000).default(0),
    eligibility: z.enum(['all', 'accounts']).default('all'),
    allowedUsers: z.array(objectId).max(500).default([]),

    startsAt: optionalDate,
    endsAt: optionalDate,
    isActive: z.boolean().default(true),
    isFeatured: z.boolean().default(false),
    order: z.coerce.number().int().min(0).max(999).default(0),
  })
  .superRefine((value, ctx) => {
    // A combo with no SKUs is an empty page section, and a combo with no bundle
    // price has no offer in it - both are worth refusing at the boundary rather
    // than rendering as a broken card.
    if (value.kind === 'combo') {
      // An exclusive deal is ONE product - that is the whole definition of it,
      // and the storefront page is built around a single part. A plain combo
      // needs at least two, or it is a bundle of one thing.
      if (value.isExclusive) {
        if (value.items.length !== 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['items'],
            message: 'An exclusive deal is exactly one SKU.',
          });
        }
      } else if (value.items.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items'],
          message: 'A combo needs at least two SKUs.',
        });
      }

      if (value.bundlePrice <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['bundlePrice'],
          message: value.isExclusive ? 'Enter the deal price.' : 'Enter the bundle price.',
        });
      }
    }

    // The exclusive page leads with a countdown - it is the reason the deal has
    // a page of its own rather than a card in the combo list. Without an end
    // date the hero renders a clock with nothing in it.
    if (value.isExclusive && !value.endsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'An exclusive deal needs an end date - the countdown is the point of the page.',
      });
    }

    // An account-restricted offer with nobody on the list is a dead offer that
    // looks live in the admin table - refuse it where it is still cheap to fix.
    if (value.eligibility === 'accounts' && value.allowedUsers.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowedUsers'],
        message: 'Pick at least one account, or open the offer to everyone.',
      });
    }

    // Single-use is per account, so it needs an account to be per. An offer
    // with no code cannot be single-use: it applies automatically to whoever
    // qualifies, which is the opposite of a one-shot redemption.
    if (value.redemption === 'single' && !value.code) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['redemption'],
        message: 'Single-use needs a promo code - an automatic offer cannot be redeemed once.',
      });
    }

    if (value.kind === 'deal') {
      if (value.discountType === 'percent' && value.discountPercent <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['discountPercent'],
          message: 'Enter a percentage.',
        });
      }
      if (value.discountType === 'amount' && value.discountAmount <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['discountAmount'],
          message: 'Enter an amount.',
        });
      }
    }
  });

export { BLOG_CATEGORIES, BLOG_STATUSES, blogPostSchema, FAQ_CATEGORIES, FAQ_SCOPES, faqSchema, productArticleSchema, reviewSchema, reviewModerationSchema, OFFER_KINDS, DISCOUNT_TYPES, OFFER_ACCENTS, offerSchema };

// --- website page sections ---------------------------------------------------

/**
 * The article and section switches for one website page (`shared/websitePages.js`).
 *
 * The article is OPTIONAL as a whole, unlike a product article: most pages start
 * with none, and saving only the section switches must not demand one. But half
 * an article is refused - a heading with no body renders a title over nothing.
 * The page is in the URL, never the body, as for a product article.
 */
const pageContentSchema = z
  .object({
    heading: z.string().trim().max(140).optional().or(z.literal('')),
    body: z.string().trim().max(20000).optional().or(z.literal('')),
    authorName: z.string().trim().max(80).optional().or(z.literal('')),
    ...authorFields,
    status: z.enum(['draft', 'published']).default('draft'),
    hiddenSections: z.array(z.enum(PAGE_SECTIONS)).max(PAGE_SECTIONS.length).default([]),
  })
  .superRefine((value, ctx) => {
    const heading = value.heading ?? '';
    const body = value.body ?? '';
    if (!heading && !body) return;
    if (heading.length < 6) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['heading'], message: 'Enter a heading.' });
    }
    if (body.length < 40) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['body'], message: 'Write the article body.' });
    }
  });

/** One question on one page. The page comes from the URL. */
const pageFaqSchema = z.object({
  question: z.string().trim().min(6, 'Enter the question.').max(240),
  answer: z.string().trim().min(10, 'Enter the answer.').max(4000),
  order: z.coerce.number().int().min(0).max(999).default(0),
  isPublished: z.boolean().default(true),
});

// --- google reviews ----------------------------------------------------------

/**
 * One Google review of the business, copied in by hand. `reviewedAt` is the date
 * the reviewer wrote it on Google, which is what the website prints as its age.
 */
const googleReviewSchema = z.object({
  authorName: z.string().trim().min(1, 'Who wrote it?').max(80),
  photoUrl: z.string().trim().max(500).optional().or(z.literal('')),
  rating: z.coerce.number().int().min(1, 'Choose a rating.').max(5),
  text: z.string().trim().min(2, 'Paste what they wrote.').max(2000),
  reviewedAt: z.string().trim().min(1, 'When did they post it?'),
  isPublished: z.boolean().default(true),
  order: z.coerce.number().int().min(0).max(999).default(0),
});

/** The figures above the reviews, as Google shows them on the business profile. */
const googleSummarySchema = z.object({
  rating: z.coerce.number().min(0).max(5, 'Google ratings run to 5.'),
  count: z.coerce.number().int().min(0).max(1_000_000),
  url: z.string().trim().url('Enter the full link, including https://').max(500).optional().or(z.literal('')),
});

export { pageContentSchema, pageFaqSchema, googleReviewSchema, googleSummarySchema };
