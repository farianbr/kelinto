import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import { WEBSITE_PAGES } from '../../../shared/websitePages.js';
import '../models/Business.js';
import '../models/PageContent.js';
import '../models/GoogleReview.js';
import '../models/Settings.js';
import '../models/Faq.js';

/**
 * Demo copy for the sections at the foot of every website page: an article on
 * each page that takes one, a few questions on each page that takes an FAQ, a
 * set of Google reviews, and the rating line above
 * them (`shared/websitePages.js`, 2026-09-30).
 *
 * ADDITIVE, and it never overwrites an owner's words:
 *
 * - an article is written only on a page that has none (heading and body both
 *   empty); a page somebody wrote for is skipped, published or not;
 * - reviews are added only when the business has no Google reviews at all, so
 *   re-running does not stack a second set on the first;
 * - the rating line is filled only while it is still zero.
 *
 * The reviewers are invented. These stand in for a business's real Google
 * reviews until the owner copies those in (SEO › Reviews › Google), and a demo
 * that put words in a real person's mouth would be a worse placeholder than an
 * empty section.
 *
 * `{name}` in the copy becomes the business's own name, since the same seed runs
 * on every business.
 */

const daysAgo = (days) => new Date(Date.now() - days * 86_400_000);

/** One article per page key. Written for a business that repairs devices and sells parts. */
const ARTICLES = {
  home: {
    heading: 'Repair, parts and phones under one roof',
    body: `{name} fixes phones, tablets and laptops at the counter and sells the parts that go into them. Most repairs are quoted before any work starts, and most screens and batteries are done the same day.

## What we fix

- Cracked and unresponsive screens
- Batteries that no longer hold a charge
- Charging ports, speakers and cameras
- Water damage, assessed before we quote

## Why people come back

Every repair carries a written warranty, and the parts we fit are the parts we sell, so we know exactly where each one came from. If something is not right after a repair, bring it back and we look at it again.`,
  },
  shop: {
    heading: 'How to find the right part the first time',
    body: `A part that looks right and does not fit costs a return and a week. The filters on this page narrow the catalogue the way a technician thinks: the kind of part first, then the device, the brand, the series and the exact model.

## Start with the component

Pick the component type before the model. Two phones in the same series often take different screens, and starting from the part keeps the list short enough to compare.

## Check the grade

Every part carries a grade. New and OEM parts are the closest to what left the factory; pulled parts are genuine but used, and priced accordingly. The grade decides the warranty, so it is worth a second look.

If the model you need is not listed, ask us. We source parts that are not in the catalogue yet.`,
  },
  clearance: {
    heading: 'Why these parts are marked down',
    body: `Clearance is stock we are moving on, not stock with something wrong with it. A model that has stopped selling, a line we are replacing with a newer revision, or simply more on the shelf than we need.

## What stays the same

- The grade printed on each part is the grade you receive
- The warranty for that grade still applies
- Returns follow the same policy as full-price parts

## What changes

The price, and only while stock lasts. Clearance lines are not restocked, so when a part is gone from this page it is gone.`,
  },
  preowned: {
    heading: 'What happens to a phone before we sell it',
    body: `Every pre-owned phone on this page was bought from a customer at our counter, with identification checked and the seller's ownership confirmed. Then it goes through the same bench as a repair.

## Our checks

- The phone is wiped and reset to factory settings
- Screen, battery health, cameras and ports are tested
- It is checked against lost and stolen lists
- Anything that failed a test is repaired or the phone is not listed

## What you get

A working phone at a fair price, one of each, with the condition written on its page. If it is listed, it passed.`,
  },
  services: {
    heading: 'How a repair works at {name}',
    body: `Bring the device in, or book ahead. We look at it with you at the counter, tell you what it needs and what it costs, and only start once you agree.

## Before we start

We check the fault you describe and anything else we notice, so there are no surprises on the invoice. If a repair would cost more than the device is worth, we say so.

## While it is with us

Most screens and batteries are done the same day. If a part has to be ordered we tell you when it is expected and message you when the repair is ready.

## After

Every repair carries a written warranty. Keep your invoice; it is your proof of the repair and the date it was done.`,
  },
  membership: {
    heading: 'What a membership changes',
    body: `A membership lengthens the warranty on every repair you have done with us. The higher the tier, the longer each repair is covered.

## How a tier is decided

Tiers follow how often you come back. A customer who brings every device in the house to us is covered for longer than one we see once.

## What it does not change

The price of a repair. Every customer is quoted the same way; a membership is about how long we stand behind the work, not about a discount.`,
  },
  offers: {
    heading: 'How our offers work',
    body: `Offers on this page apply at checkout automatically, or with the code shown on the offer. Only one offer applies to each part, and we always pick the one that saves you the most.

## Combo deals

A fixed set of parts at one bundle price, cheaper together than apart. The bundle price is the price; nothing else stacks on top of it.

## Catalogue deals

A discount across a range of the catalogue, a brand or a kind of part, for a limited time. The end date is on the offer.`,
  },
  deals: {
    heading: 'What an exclusive deal is',
    body: `An exclusive deal is one part at one price for a short time, with a countdown on its page. When the clock runs out, the price goes back.

We run one at a time, on parts we have in stock in quantity, so the deal price is not a teaser for something that sells out in an hour. When no deal is running, this page says so.`,
  },
  deal: {
    heading: 'Before you buy on a deal',
    body: `The deal price applies to this one part until the countdown ends. Everything else about it is the same as a full-price purchase.

## Good to know

- The grade and warranty are exactly as listed on the part
- The deal price cannot be combined with a promo code
- Returns follow the usual policy

If the timer has ended when you reach checkout, the part is charged at its normal price, and the cart shows you that before you pay.`,
  },
  about: {
    heading: 'The people behind {name}',
    body: `{name} started as a repair counter and grew into a parts supplier because we kept needing parts we could trust. Today the same team repairs devices for walk-in customers and supplies parts to other repairers.

## What we care about

- Telling you what a repair really needs, and what it does not
- Fitting parts we would sell, and selling parts we would fit
- Standing behind the work with a written warranty

If you have a question about anything we do, ask at the counter or send us a message below.`,
  },
  contact: {
    heading: 'Getting the fastest answer',
    body: `The more we know when you first get in touch, the fewer messages it takes.

## For a repair quote

Tell us the make and model, what happened, and what the device does now. A photo of the damage helps.

## For a part

The model number from the back of the device or its settings screen is the most useful thing you can send.

## For an order you placed

Include the order or invoice number, and we can look it up straight away.`,
  },
  blog: {
    heading: 'Why we write these guides',
    body: `Most questions we are asked at the counter have been asked before. These posts are the answers, written down properly: how to look after a battery, what water damage really means, how to tell a genuine part from a copy.

We write about what we see on the bench every week, not about what is in the news. If there is something you would like us to cover, send us a message and it may become the next post.`,
  },
  faq: {
    heading: 'If your question is not listed',
    body: `The questions on this page are the ones we are asked most. If yours is not here, the fastest route is the contact form below or a message on WhatsApp.

Tell us which device you have and what you need, and a person from our team will reply. We add new questions to this page as they come up, so yours may help the next person who asks.`,
  },
};

/**
 * Three or four questions per page, written for what a person on that page is
 * deciding. Added only to a page with no questions of its own, so an owner's
 * list is never mixed with these.
 */
const PAGE_FAQS = {
  home: [
    ['Do I need an appointment for a repair?', 'No. Walk in during store hours and we will look at the device at the counter. Booking ahead through the contact form helps on busy days.'],
    ['How long does a typical repair take?', 'Most screens and batteries are done the same day, often within an hour. If a part has to be ordered we tell you when it is expected before you leave.'],
    ['Is my repair covered by a warranty?', 'Yes. Every repair carries a written warranty, and the length is printed on your invoice.'],
    ['Do you repair laptops and tablets as well as phones?', 'Yes, phones, tablets and laptops. Tell us the make and model and we will say whether it is something we fix.'],
  ],
  shop: [
    ['How do I know a part fits my device?', 'Filter by component type first, then device, brand, series and model. Every part is listed against the exact models it fits.'],
    ['What do the grades mean?', '**New** and **OEM** are the closest to factory. **Pull** grades are genuine parts taken from other devices, priced lower. The grade also decides the warranty.'],
    ['Can I pick up an order instead of having it shipped?', 'Yes. Choose pickup at checkout and collect it from the counter during store hours.'],
    ['The part I need is not listed. Can you get it?', 'Often, yes. Send us the model and the part through the contact form and we will check with our suppliers.'],
  ],
  clearance: [
    ['Is there anything wrong with clearance parts?', 'No. Clearance is stock we are moving on, not faulty stock. The grade on each part is the grade you receive.'],
    ['Do clearance parts have a warranty?', 'Yes, the same warranty as the grade carries at full price.'],
    ['Will a clearance part come back in stock?', 'No. Clearance lines are not restocked, so when one is gone from this page it is gone.'],
  ],
  preowned: [
    ['Where do your pre-owned phones come from?', 'Every one was bought from a customer at our counter, with identification checked and ownership confirmed.'],
    ['Are they checked before they are sold?', 'Yes. Each phone is wiped, tested and checked against lost and stolen lists. Anything that fails is repaired or not listed.'],
    ['Can I sell you my phone?', 'Yes. Bring it to the counter with photo identification and we will make you an offer.'],
  ],
  services: [
    ['Will I know the price before you start?', 'Yes. We quote at the counter after looking at the device, and nothing starts until you agree.'],
    ['What if the repair costs more than the device is worth?', 'We tell you. Sometimes replacing is the better choice, and we would rather say so than take the job.'],
    ['Do I lose my data during a repair?', 'Most repairs do not touch your data. If one might, such as a board repair, we tell you first so you can back up.'],
    ['Can I wait while you do it?', 'For most screens and batteries, yes. We give you a time when you drop the device off.'],
  ],
  membership: [
    ['What does a membership give me?', 'A longer warranty on every repair we do for you. The higher the tier, the longer the cover.'],
    ['How do I move up a tier?', 'Tiers follow how often you come back. Ask at the counter where you are now.'],
    ['Does a membership change what I pay?', 'No. Every customer is quoted the same way. A membership is about how long we stand behind the work.'],
  ],
  offers: [
    ['Can I use more than one offer on the same part?', 'No. One offer applies per part, and we always apply the one that saves you the most.'],
    ['Do I need a code?', 'Some offers apply automatically at checkout; others show a code on the offer. If there is a code, enter it at checkout.'],
    ['How long does an offer last?', 'The end date is shown on each offer. After it passes, the price goes back.'],
  ],
  deals: [
    ['How often is there an exclusive deal?', 'We run one at a time, on parts we have plenty of. When none is running, this page says so.'],
    ['Can I combine an exclusive deal with a promo code?', 'No. The deal price is the price for that part.'],
    ['What happens when the countdown ends?', 'The part goes back to its normal price straight away.'],
  ],
  deal: [
    ['Is the deal part the same as the full-price one?', 'Yes. Same grade and same warranty; only the price is different while the countdown runs.'],
    ['What if the timer ends while it is in my cart?', 'The cart shows the normal price before you pay, so you are never charged something you did not see.'],
    ['Can I return a deal part?', 'Yes, on the same terms as any other part.'],
  ],
  about: [
    ['Where are you located?', 'The address, hours and a map are just below, with a link for directions.'],
    ['Do you supply other repairers?', 'Yes. Repair businesses can open an account for wholesale pricing on parts.'],
    ['Who does the repairs?', 'Our own technicians, at the bench behind the counter. Your device does not leave the store.'],
  ],
  contact: [
    ['How quickly will you reply?', 'We answer messages during store hours, usually the same day.'],
    ['Can I get a quote without bringing the device in?', 'For common repairs, yes. Send the make, model and what happened, ideally with a photo, and we will give you an estimate.'],
    ['Can I message you on WhatsApp?', 'Yes. The WhatsApp button next to our address opens a chat with the store.'],
  ],
  blog: [
    ['Who writes these posts?', 'The team at the counter and on the bench. The name on each post is the person who wrote it.'],
    ['Can I suggest a topic?', 'Please do. Send it through the contact form below and it may become a post.'],
    ['Do you publish repair guides for doing it yourself?', 'Some. Where a repair is risky to do at home, the post says so and explains why.'],
  ],
  'blog-post': [
    ['Can you do this repair for me instead?', 'Yes. Bring the device to the counter or send us a message for a quote.'],
    ['Do you sell the parts mentioned in this post?', 'Most of them. Search the shop by model and part, or ask us if you cannot find it.'],
    ['Is this advice right for my exact model?', 'It covers the common case. If your model is different in a way that matters, ask us before you start.'],
  ],
};

/**
 * Who wrote each page's article, so the author rail beside it has a person in it
 * the way a product article does. Invented staff, like the product seed's; an
 * owner replaces them in the page editor's byline fields.
 */
const PAGE_AUTHORS = {
  bench: {
    name: 'Jun Okafor',
    role: 'Lead technician',
    bio: 'Runs the repair bench and quotes most of the jobs that come through the door. Ten years of screens, boards and batteries.',
  },
  parts: {
    name: 'Leah Tremblay',
    role: 'Parts and stock',
    bio: 'Buys the parts we fit and sell, and grades every one before it reaches a shelf.',
  },
  counter: {
    name: 'Owen Mercer',
    role: 'Front counter',
    bio: 'The first person most customers talk to. Books repairs, answers the phone and knows where every job is.',
  },
};

/** Which author writes for which page. */
const AUTHOR_FOR_PAGE = {
  home: 'bench',
  shop: 'parts',
  clearance: 'parts',
  preowned: 'bench',
  services: 'bench',
  membership: 'counter',
  offers: 'parts',
  deals: 'parts',
  deal: 'parts',
  about: 'counter',
  contact: 'counter',
  blog: 'bench',
  faq: 'counter',
};

const authorFor = (key) => ({ ...PAGE_AUTHORS[AUTHOR_FOR_PAGE[key] ?? 'counter'], photo: '', links: {} });

/** Invented reviewers, varied in length and rating the way a real profile is. */
const REVIEWS = [
  { authorName: 'Priya Malhotra', rating: 5, days: 12, text: 'Screen replaced in under an hour and the phone looks brand new. They explained the difference between the screen options before I chose, and did not push the expensive one.' },
  { authorName: 'Jordan Ellis', rating: 5, days: 26, text: 'Honest and quick. Told me my laptop was not worth repairing and saved me money. Came back a month later to have my phone battery done.' },
  { authorName: 'Mei Chen', rating: 5, days: 41, text: 'Great service, fair price.' },
  { authorName: 'Samuel Okafor', rating: 4, days: 63, text: 'Charging port fixed the same day. Had to wait a little longer than quoted because they were busy, but they messaged me when it was ready and the repair has been perfect since.' },
  { authorName: 'Alexandra Novak', rating: 5, days: 95, text: 'Brought in a tablet that had been dropped in water. They were upfront that it might not come back, tested it properly and got it working. Very knowledgeable staff and a clean, organised counter.' },
  { authorName: 'Marcus Reid', rating: 5, days: 140, text: 'Bought a pre-owned phone here. Battery health was exactly as listed and it came wiped and ready to set up. Would buy again.' },
  { authorName: 'Fatima Haddad', rating: 5, days: 188, text: 'Friendly, patient and they actually listen. Fixed my son’s game console quickly and professionally.' },
  { authorName: 'Tom Brennan', rating: 5, days: 230, text: 'Excellent repairs at the right cost. Warranty was explained clearly and they honoured it without any fuss when a speaker played up weeks later.' },
];

async function seedWebsiteSections({ businessName = '', quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const { PageContent, GoogleReview, Settings, Faq } = db();
  const fill = (text) => text.replaceAll('{name}', businessName || 'This business');

  // ---- articles ---------------------------------------------------------
  let written = 0;
  let kept = 0;
  let bylined = 0;
  for (const page of WEBSITE_PAGES) {
    const article = ARTICLES[page.key];
    if (!article || !page.sections.includes('article')) continue;

    const existing = await PageContent.findOne({ page: page.key }).select('heading body author').lean();
    if (existing?.heading || existing?.body) {
      // Our own demo copy, written by an earlier run before articles carried a
      // byline: give it one. Matched on the exact heading, so an article an
      // owner wrote or retitled is never touched.
      if (!existing.author?.name && existing.heading === fill(article.heading)) {
        await PageContent.updateOne({ page: page.key }, { $set: { author: authorFor(page.key) } });
        bylined += 1;
      }
      kept += 1;
      continue;
    }

    const body = fill(article.body);
    await PageContent.updateOne(
      { page: page.key },
      {
        $set: {
          heading: fill(article.heading),
          body,
          author: authorFor(page.key),
          status: 'published',
          publishedAt: new Date(),
          readMinutes: Math.max(1, Math.round(body.split(/\s+/).filter(Boolean).length / 220)),
        },
        $setOnInsert: { page: page.key, hiddenSections: [] },
      },
      { upsert: true },
    );
    written += 1;
  }
  log(`    page articles: ${written} written, ${kept} already had one (${bylined} of those given a byline)`);

  // ---- page questions ---------------------------------------------------
  let faqPages = 0;
  for (const page of WEBSITE_PAGES) {
    const questions = PAGE_FAQS[page.key];
    if (!questions || !page.sections.includes('faq')) continue;
    if (await Faq.exists({ scope: 'page', page: page.key })) continue;
    await Faq.insertMany(
      questions.map(([question, answer], index) => ({
        question: fill(question),
        answer: fill(answer),
        scope: 'page',
        page: page.key,
        order: index,
        isPublished: true,
      })),
    );
    faqPages += 1;
  }
  log(`    page questions: added on ${faqPages} page(s); pages that had their own were left alone`);

  // ---- google reviews ---------------------------------------------------
  const haveReviews = await GoogleReview.countDocuments();
  if (haveReviews === 0) {
    await GoogleReview.insertMany(
      REVIEWS.map((review, index) => ({
        authorName: review.authorName,
        rating: review.rating,
        text: review.text,
        reviewedAt: daysAgo(review.days),
        isPublished: true,
        order: index,
      })),
    );
    log(`    google reviews: ${REVIEWS.length} added`);
  } else {
    log(`    google reviews: skipped, ${haveReviews} already present`);
  }

  // ---- rating line ------------------------------------------------------
  const settings = await Settings.findOne({ key: 'singleton' }).select('business').lean();
  if (!settings?.business?.googleRating && !settings?.business?.googleReviewCount) {
    const query = encodeURIComponent(businessName || 'repair');
    await Settings.updateOne(
      { key: 'singleton' },
      {
        $set: {
          'business.googleRating': 4.7,
          'business.googleReviewCount': 137,
          'business.googleReviewsUrl': `https://www.google.com/maps/search/?api=1&query=${query}`,
        },
      },
      { upsert: true },
    );
    log('    google rating: set to 4.7 from 137 reviews');
  } else {
    log('    google rating: kept, already set');
  }

  return { written, kept };
}

// CLI entry: `npm run seed:website`
if (process.argv[1] && process.argv[1].endsWith('website-sections.js')) {
  (async () => {
    console.log('\n  Seeding website page sections…\n');
    await connectDb();

    const businesses = await db().Business.find({ deletedAt: null }).select('name code').lean();
    const targets = businesses.length ? businesses : [null];

    for (const business of targets) {
      if (business) console.log(`  ${business.name} (${business.code})`);
      const work = () => seedWebsiteSections({ businessName: business?.name ?? '' });
      if (business) {
        await runInBusiness(
          { businessId: String(business._id), code: business.code, connection: dbFor(business.code) },
          work,
        );
      } else {
        await work();
      }
    }

    console.log(`\n  Done. ${targets.length} business(es) seeded.\n`);
    await disconnectDb();
    await mongoose.connection.close();
    process.exit(0);
  })().catch((error) => {
    console.error('\n  Seed failed:', error.message, '\n');
    process.exit(1);
  });
}

export { ARTICLES, PAGE_AUTHORS, PAGE_FAQS, REVIEWS, seedWebsiteSections };
export default seedWebsiteSections;
