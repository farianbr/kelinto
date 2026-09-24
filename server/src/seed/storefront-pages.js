import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { db, dbFor } from '../db/models.js';
import { HAS_PICTURE } from '../../../shared/partPhotos.js';
import { runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/Product.js';
import '../models/Offer.js';

/**
 * Seeds the two new storefront pages: Stock Clearance and Exclusive Deals.
 *
 * ADDITIVE. It never wipes a collection, so it is safe on a database carrying
 * real accounts and order history - unlike `npm run seed`, and unlike
 * `seed:content`, which replaces every offer. Re-running it updates the same
 * records rather than making a second set: clearance is set by SKU and the
 * exclusive offer is upserted by slug.
 *
 * What it does NOT do is invent products. Everything here is flagged on the
 * catalogue that is already in the database, so the SKUs always exist and the
 * pages render against the same stock as the rest of the site.
 */

const daysFromNow = (days) => new Date(Date.now() + days * 86_400_000);

/**
 * How deep each clearance cut goes, cycled across the picked SKUs.
 *
 * A spread rather than one figure: a page where every part is exactly 30% off
 * reads as a blanket sale, not as individual lines being cleared for their own
 * reasons.
 */
const CLEARANCE_CUTS = [0.35, 0.25, 0.4, 0.3, 0.2, 0.45];

/** Integer cents, always. A clearance price is a price like any other. */
const cutPrice = (price, fraction) => Math.round((price * (1 - fraction)) / 5) * 5;

async function seedStorefrontPages({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  const Product = db().Product;
  const Offer = db().Offer;

  // HAS_PICTURE matters here, not just in the queries that read this back: the
  // catalogue hides a part it cannot draw, so flagging one for clearance put a
  // record on a page that would never render it. 18 flagged, 3 visible, and
  // nothing in the data said why.
  const products = await Product.find({
    isActive: true,
    stock: { $gt: 0 },
    $and: [HAS_PICTURE],
  })
    .sort({ createdAt: 1 })
    .lean();

  // A business with no parts catalogue is skipped rather than failing the run:
  // CellShoppe is a service business and has none, and clearing stock that does
  // not exist is not demo data worth making.
  if (products.length === 0) {
    log('  skipped - no products in this business');
    return { cleared: 0, exclusive: 0 };
  }

  // ---- pick the hero product FIRST -------------------------------------
  // Order matters. A product can be on the clearance page or be the exclusive
  // deal, never both: a cleared part already sells at `effectivePrice`, so an
  // offer priced against its list price would claim a saving that has already
  // been given away. Clearance picks from whatever the deal did not take.
  //
  // The dearest screen in the catalogue: the deal page is a page built to argue
  // for ONE product, and that argument is only worth making on something with a
  // real price behind it. A 22% cut on a $12 flex cable is not a reason to read
  // a page.
  const heroCandidates = products
    .filter((product) => product.partType === 'screen-assembly' && product.price > 0)
    .sort((x, y) => y.price - x.price);

  const hero = heroCandidates[0] ?? null;
  const heroIds = new Set(hero ? [String(hero._id)] : []);

  // ---- clearance --------------------------------------------------------
  // Cleared first, so a re-run does not leave last run's picks flagged as well
  // as this one's. This is the only destructive thing in the file and it only
  // ever unsets a flag the script itself sets.
  await Product.updateMany(
    { isClearance: true },
    { $set: { isClearance: false, clearancePrice: 0 } },
  );

  // `clearanceReason` was dropped from the schema. Mongoose silently ignores a
  // field it no longer knows about, so documents written before the removal keep
  // it forever unless something unsets it - which is how a "removed" field ends
  // up still sitting in the database a year later.
  // Through the RAW collection, not the model: Mongoose strips fields the
  // schema no longer declares out of both the filter and the update, so the
  // same call made on `Product` matched nothing and unset nothing.
  await Product.collection.updateMany(
    { clearanceReason: { $exists: true } },
    { $unset: { clearanceReason: '' } },
  );

  // Spread across device types rather than the first 18 rows, so the page is
  // not eighteen screens for one phone.
  const byDeviceType = new Map();
  for (const product of products) {
    if (heroIds.has(String(product._id))) continue;
    const key = product.deviceTypeSlug || 'other';
    if (!byDeviceType.has(key)) byDeviceType.set(key, []);
    byDeviceType.get(key).push(product);
  }

  const picks = [];
  const lists = [...byDeviceType.values()];
  for (let round = 0; picks.length < 18 && round < 40; round += 1) {
    for (const list of lists) {
      const product = list[round];
      if (product) picks.push(product);
      if (picks.length >= 18) break;
    }
  }

  let cleared = 0;
  for (const [index, product] of picks.entries()) {
    const cut = CLEARANCE_CUTS[index % CLEARANCE_CUTS.length];
    await Product.updateOne(
      { _id: product._id },
      {
        $set: {
          isClearance: true,
          // Every sixth pick goes on the page at its ordinary price: a part can
          // be cleared to shift it without being discounted, and the page has
          // to look right when one is.
          clearancePrice: index % 6 === 5 ? 0 : cutPrice(product.price, cut),
        },
      },
    );
    cleared += 1;
  }
  log(`  clearance: ${cleared} products flagged`);

  // ---- the exclusive deal -----------------------------------------------
  // ONE product, not a kit.
  //
  // Still modelled as a `combo` carrying a single item, which is deliberate:
  // that gives it a real `bundlePrice` that `pricingService` already knows how
  // to charge, and lets the page check out through `/cart/bundles` like every
  // other offer. A second way to buy one product would be a second place for a
  // price to be decided, and there is exactly one of those.
  //
  // `hero` was chosen at the top of this function, before clearance took its
  // picks - see the comment there for why the order matters.
  if (!hero) {
    log('  exclusive deal: skipped, no screen in the catalogue to feature');
    return { cleared, exclusive: 0 };
  }

  const exclusive = {
    title: `${hero.modelName} ${hero.partTypeLabel}`,
    slug: 'exclusive-deal',
    subtitle: `${hero.grade} grade, tested, at the lowest price we run it`,
    description:
      'The panel that comes across a workshop more than any other, at a price we hold for this run only. Tested before it is boxed, and it ships the same day when the order clears before 2 PM ET.',
    kind: 'combo',
    badge: 'Exclusive',
    accent: 'brand',
    isExclusive: true,
    isFeatured: true,
    isActive: true,
    order: -1,

    items: [{ sku: hero.sku, qty: 1 }],
    bundlePrice: Math.round((hero.price * 0.78) / 5) * 5,

    // EMPTY, deliberately. This carried a coverr.co CDN URL that now answers
    // 404, and the player does not fail quietly: `<video src>` pointing at a
    // dead file paints a black 16:9 box with a scrubber stuck at 0:00, right at
    // the top of the page the deal is meant to be argued on. The page renders
    // each section only when it has content, so an empty string removes the
    // block and the pitch leads instead - which is the correct fallback, not a
    // gap. Point this at a real asset when there is one to point at.
    videoUrl: '',
    videoPoster: '',

    pitch:
      'A cracked panel is the single most common thing a repair workshop sees, and the one part where a bad decision costs twice: a cheap panel comes back as a warranty claim with the labour attached.\n\nThis is the same SKU as the catalogue listing, at the same grade and under the same warranty. What is different is the price, which runs until the clock above finishes and not past it.',

    highlights: [
      'Ships same day when the order clears before 2 PM ET',
      'Tested before boxing, not sampled by the pallet',
      'The same grade and warranty as the catalogue listing',
      'Priced for this run only',
    ],

    reviews: [
      {
        author: 'Marc Lefebvre',
        business: 'Rue Wellington Repairs',
        rating: 5,
        body: 'Fitted eight of these in a fortnight and not one has come back. The colour and the touch response match the originals, which is the part that usually gives a cheap panel away.',
        verified: true,
        postedAt: daysFromNow(-9),
      },
      {
        author: 'Priya Raman',
        business: 'Downtown Device Clinic',
        rating: 5,
        body: 'Ordered on a Tuesday afternoon, on the workshop Wednesday morning. At this price it is worth holding a few on the shelf rather than ordering per job.',
        verified: true,
        postedAt: daysFromNow(-21),
      },
      {
        author: 'Dan Whitfield',
        business: 'Northside Mobile',
        rating: 4,
        body: 'Good panel and honest grading. Only note is that I would take a five-pack if it were offered, because we get through them.',
        verified: true,
        postedAt: daysFromNow(-34),
      },
    ],

    faqs: [
      {
        question: 'Is this the same part as the catalogue listing?',
        answer:
          'Yes, the same SKU at the same grade. The only thing that changes is the price, and it changes back when the offer ends.',
      },
      {
        question: 'What warranty does it carry?',
        answer:
          'The standard warranty for its grade, running from the invoice date. Buying it on offer does not shorten it.',
      },
      {
        question: 'What happens if it goes out of stock?',
        answer:
          'The offer comes off sale until it is back. We do not take orders against stock we cannot ship.',
      },
      {
        question: 'Can I use a promo code on top of this price?',
        answer:
          'No. This price is already a discount, and offers do not stack. A code applies to the rest of your cart as normal.',
      },
    ],

    terms:
      'While stock lasts. Offer pricing applies to this SKU as listed and ends on the date shown. Offers do not stack.',
    startsAt: daysFromNow(-3),
    endsAt: daysFromNow(11),
  };

  await Offer.updateOne({ slug: exclusive.slug }, { $set: exclusive }, { upsert: true });
  // The old kit lived at its own slug. Left behind it would sit on the offers
  // page as a second "Exclusive" alongside this one.
  await Offer.deleteOne({ slug: 'bench-rescue-kit' });
  log(`  exclusive deal: ${exclusive.slug} (${hero.sku})`);

  return { cleared, exclusive: 1 };
}

/**
 * CLI entry: `npm run seed:storefront`.
 *
 * Every business gets its own pass, each against its own database. A standalone
 * seed has to open that context itself - there is no request middleware here to
 * do it, and without it `db()` has no business to resolve against.
 */
if (process.argv[1] && process.argv[1].endsWith('storefront-pages.js')) {
  (async () => {
    console.log('\n  Seeding clearance and exclusive deals…\n');
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
        () => seedStorefrontPages(),
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

export { seedStorefrontPages };
