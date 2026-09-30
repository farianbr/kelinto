/**
 * Every website page that carries the standard sections, and which ones it takes.
 *
 * ## The sections
 *
 * Client ruling 2026-09-30: every page of a business's website ends with the same
 * five sections, in this order, each edited in the ERP:
 *
 * 1. `article`  - long-form copy written for that page (ERP › SEO › Articles)
 * 2. `faq`      - questions written for that page (same screen)
 * 3. `reviews`  - the business's Google reviews (ERP › SEO › Reviews)
 * 4. `location` - name, address, phone, hours and the embedded map (Settings › Business info)
 * 5. `contact`  - the contact form, writing to the same inbox as /contact
 *
 * The order is fixed; an owner can hide any section on any page but not reorder
 * them (also ruled 2026-09-30).
 *
 * ## Why a page can lack a section
 *
 * `sections` lists what a page CAN show, not what it shows by default. A page that
 * already IS one of these sections does not repeat it underneath itself: the FAQ
 * page has no page FAQ, the contact page no second contact form, a blog post no
 * second article. The product page has neither an article nor an FAQ here because
 * it already draws its own per-part ones (`ProductArticle`, `ProductFaq`), and it
 * takes no contact form by client ruling: a buyer on a part is one click from the
 * cart, and a form there competes with it.
 *
 * ## Why one registry, read by both halves
 *
 * The website renders the sections from `RootLayout` by matching the route against
 * `path` here, so a page cannot forget to include them; the ERP lists these same
 * entries as the pages it can write for. A page added to the site and not added
 * here simply has no sections, and shows up nowhere in the ERP - one place to add
 * it, rather than a page file and an admin list that drift.
 *
 * `key` is stored on `PageContent` and on page-scoped `Faq` rows, so it is an
 * identifier: never rename one without a migration.
 */

const PAGE_SECTIONS = ['article', 'faq', 'reviews', 'location', 'contact'];

const PAGE_SECTION_LABELS = {
  article: 'Article',
  faq: 'FAQ',
  reviews: 'Google reviews',
  location: 'Location and hours',
  contact: 'Contact form',
};

const ALL = PAGE_SECTIONS;
const withoutContact = PAGE_SECTIONS.filter((section) => section !== 'contact');

const WEBSITE_PAGES = [
  { key: 'home', label: 'Home', path: '/', sections: ALL },
  { key: 'shop', label: 'Shop', path: '/shop', sections: ALL },
  { key: 'clearance', label: 'Clearance', path: '/clearance', sections: ALL },
  { key: 'preowned', label: 'Pre-owned', path: '/pre-owned', sections: ALL },
  { key: 'services', label: 'Services', path: '/services', sections: ALL },
  { key: 'membership', label: 'Membership', path: '/membership', sections: ALL },
  { key: 'offers', label: 'Offers', path: '/offers', sections: ALL },
  { key: 'deals', label: 'Exclusive deals', path: '/deals', sections: ALL },
  {
    key: 'deal',
    label: 'Each deal page',
    path: '/deals/:slug',
    note: 'One article and FAQ shared by every deal page.',
    sections: ALL,
  },
  { key: 'about', label: 'About', path: '/about', sections: ALL },
  { key: 'contact', label: 'Contact', path: '/contact', sections: withoutContact },
  { key: 'blog', label: 'Blog', path: '/blog', sections: ALL },
  {
    key: 'blog-post',
    label: 'Each blog post',
    path: '/blog/:slug',
    note: 'Shared by every post. The post itself is the article.',
    sections: PAGE_SECTIONS.filter((section) => section !== 'article'),
  },
  { key: 'faq', label: 'FAQ', path: '/faq', sections: PAGE_SECTIONS.filter((section) => section !== 'faq') },
  {
    key: 'product',
    label: 'Each product page',
    path: '/product/:slug',
    note: 'Each part has its own article and FAQ, written under Parts.',
    sections: ['reviews', 'location'],
  },
];

const PAGE_KEYS = WEBSITE_PAGES.map((page) => page.key);

function pageByKey(key) {
  return WEBSITE_PAGES.find((page) => page.key === key) ?? null;
}

export { PAGE_SECTIONS, PAGE_SECTION_LABELS, WEBSITE_PAGES, PAGE_KEYS, pageByKey };
