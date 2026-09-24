import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/Product.js';
import '../models/ProductArticle.js';
import { ARTICLES } from './articles.data.js';

/**
 * Seeds the per-product SEO articles.
 *
 * ADDITIVE, never destructive: it upserts by product, so re-running refreshes
 * the wording without touching anything else in the database and without
 * costing anyone their cart. `npm run seed` wipes everything and is the wrong
 * tool once a database has real content in it.
 *
 * ## Which products get one
 *
 * EVERY active product whose component type has copy written for it. That is
 * the client's call and it is what makes the demo show the section populated
 * rather than showing the admin list mostly empty.
 *
 * The argument for partial coverage is still real and is recorded on
 * `MODELS_PER_TYPE` below: on a live catalogue an article is written by a
 * person over months, and hundreds of pages of near-identical prose is what
 * search engines penalise. The knob is left in place for that reason.
 *
 * ## Why the copy is per component type
 *
 * What separates a good screen from a bad one is the same argument on an
 * iPhone 13 and a Galaxy S24. The model name is substituted into the heading so
 * each product carries a heading about itself, and the body speaks about the
 * component. Writing hundreds of genuinely different articles is a job for the
 * client's copywriter, not for a seed script pretending to be one.
 */

/**
 * How many models per component type get an article.
 *
 * `Infinity` means every one of them, which is the client's call: the demo
 * should show the section populated rather than show the admin list with work
 * outstanding. The cap is kept as a knob rather than deleted, because the
 * argument for a smaller number is still real - on a LIVE catalogue, copy is
 * written over months, and 700 pages of near-identical prose is what search
 * engines penalise. Set it to a number to go back to partial coverage.
 */
const MODELS_PER_TYPE = Infinity;

/**
 * The bylines these articles are written under, cycled across the catalogue.
 *
 * The same three people the blog posts are attributed to, so a reader who meets
 * Marc on a grading post and again on a screen article meets one person rather
 * than two with the same job. No `photo`: there are no staff photographs in the
 * project, and a URL pointing at nothing would render the broken-image path on
 * 773 pages. The card draws their initials instead, which is the designed
 * fallback rather than a missing asset.
 */
const ARTICLE_AUTHORS = [
  {
    name: 'Marc Deveau',
    role: 'Quality lead, Toronto warehouse',
    bio: 'Grades every pull batch that reaches the Toronto warehouse and wrote the sheet the graders work to. Fourteen years on the tools before that.',
    links: { linkedin: 'https://www.linkedin.com/in/marc-deveau-cellvix' },
  },
  {
    name: 'Priya Raman',
    role: 'Technical support',
    bio: 'Takes the calls when a part does not behave, which means she sees the same five faults more often than anyone else here.',
    links: { linkedin: 'https://www.linkedin.com/in/priya-raman-cellvix', x: 'https://x.com/cellvix' },
  },
  {
    name: 'Dan Whitfield',
    role: 'Parts desk',
    bio: 'Sources the parts this catalogue runs on and settles the arguments about which grade a job actually needs.',
    links: { website: 'https://cellvix.ca/about' },
  },
];

const WORDS_PER_MINUTE = 220;

function readMinutes(body) {
  const words = String(body ?? '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

async function seedArticles({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  const { Product, ProductArticle } = db();

  const products = await Product.find({ isActive: true })
    .sort({ partType: 1, modelSlug: 1, grade: 1 })
    .lean();

  if (products.length === 0) {
    log('  no products in this database - skipped');
    return { articles: 0, skipped: true };
  }

  /**
   * One article per PRODUCT, grade siblings included.
   *
   * An earlier pass wrote one per model per component type, on the argument that
   * two grades of the same part would otherwise carry duplicate text on two
   * pages that link to each other. That argument loses to the simpler one now
   * that coverage is meant to be complete: a product page with no article, sat
   * next to a sibling that has one, looks broken rather than restrained.
   *
   * The duplication is real and is the price of seeded copy. It is also exactly
   * what `MODELS_PER_TYPE` exists to avoid on a live catalogue.
   */
  const perType = new Map();
  const chosen = [];

  for (const product of products) {
    const copy = ARTICLES[product.partType];
    if (!copy) continue;

    const used = perType.get(product.partType) ?? 0;
    if (used >= MODELS_PER_TYPE) continue;

    perType.set(product.partType, used + 1);
    chosen.push({ product, copy });
  }

  let written = 0;
  for (const { product, copy } of chosen) {
    const heading = copy.heading.replace('{model}', product.modelName ?? product.name);
    const body = copy.body;

    await ProductArticle.updateOne(
      { product: product._id },
      {
        $set: {
          heading,
          body,
          // A byline, so the product page draws the same author rail the blog
          // does. Cycled across the desk rather than one name on all 773: a
          // single author on every article in the catalogue reads as a
          // placeholder, which is what it would be.
          author: ARTICLE_AUTHORS[written % ARTICLE_AUTHORS.length],
          status: 'published',
          readMinutes: readMinutes(body),
        },
        // Stamped once. Re-running the seed refreshes the wording; it does not
        // claim the article was written again today.
        $setOnInsert: { product: product._id, publishedAt: new Date() },
      },
      { upsert: true },
    );
    written += 1;
  }

  const byType = [...perType.entries()].map(([type, n]) => `${type} ${n}`).join(', ');
  log(`  product articles: ${written} (${byType})`);

  return { articles: written };
}

/**
 * CLI entry: `npm run seed:articles`.
 *
 * Every business gets its own pass, each against its own database. A standalone
 * seed has to open that context itself - there is no request middleware here to
 * do it, and without it `db()` has no business to resolve against.
 *
 * A service business has no catalogue, so `seedArticles` finds no products and
 * returns `skipped` rather than throwing: an article needs a part to be about.
 */
if (process.argv[1] && process.argv[1].endsWith('articles.js')) {
  (async () => {
    console.log('\n  Seeding product articles…\n');
    await connectDb();

    const businesses = await db().Business.find({ deletedAt: null }).select('name code').lean();
    if (!businesses.length) {
      throw new Error('No businesses found. Run `npm run seed` first.');
    }

    for (const business of businesses) {
      console.log(`  ${business.name} (${business.code})`);
      await runInBusiness(
        {
          businessId: String(business._id),
          code: business.code,
          connection: dbFor(business.code),
        },
        () => seedArticles(),
      );
    }

    console.log('\n  Done.\n');
    await disconnectDb();
    await mongoose.connection.close();
    process.exit(0);
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { seedArticles };
export default seedArticles;
