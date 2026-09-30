import { db } from '../db/models.js';
import '../models/PageContent.js';
import ApiError from '../utils/ApiError.js';
import { authorFromForm, authorToPublic } from '../../../shared/author.js';
import { WEBSITE_PAGES, pageByKey } from '../../../shared/websitePages.js';
import * as faqService from './faqService.js';

/**
 * The sections at the foot of every website page: each page's article, its
 * questions and which sections it shows (`shared/websitePages.js`).
 *
 * Same shape as `productArticleService`, deliberately: the ERP edits both from
 * one screen (SEO › Articles), the page is the address, and saving upserts.
 */

const WORDS_PER_MINUTE = 220;

function readMinutes(body) {
  const words = String(body ?? '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** The registry entry, or a 404 for a page that is not in it. */
function pageOr404(key) {
  const page = pageByKey(String(key ?? ''));
  if (!page) throw ApiError.notFound('No such website page.', 'PAGE_NOT_FOUND');
  return page;
}

/**
 * The sections this page shows: what the registry allows it, less what the
 * owner switched off. Computed here so the website never has to know the
 * difference between "cannot" and "chose not to".
 */
function visibleSections(page, doc) {
  const hidden = new Set(doc?.hiddenSections ?? []);
  return page.sections.filter((section) => !hidden.has(section));
}

function serializeArticle(doc) {
  if (!doc?.heading && !doc?.body) return null;
  return {
    heading: doc.heading,
    body: doc.body,
    author: authorToPublic(doc.author, ''),
    status: doc.status,
    publishedAt: doc.publishedAt ?? null,
    readMinutes: doc.readMinutes ?? 1,
    updatedAt: doc.updatedAt,
  };
}

/**
 * What the website draws under one page.
 *
 * Published article only, and published questions only: a draft is written
 * against a live page, so returning it would publish it the moment somebody
 * started typing. A section with nothing in it is still listed as visible; the
 * website skips an empty one, which keeps the rule "empty draws nothing" in one
 * place rather than here and there.
 */
async function getPublic(key) {
  const page = pageOr404(key);
  const doc = await db().PageContent.findOne({ page: page.key }).lean();
  const sections = visibleSections(page, doc);

  const article = sections.includes('article') && doc?.status === 'published' ? serializeArticle(doc) : null;
  const faqs = sections.includes('faq') ? await faqService.listForPage(page.key) : [];

  return { page: page.key, sections, article, faqs };
}

/** The ERP's list of pages: every registry entry, with what it has. */
async function listForAdmin() {
  const [docs, faqCounts] = await Promise.all([
    db().PageContent.find({}).lean(),
    faqService.countByPage(),
  ]);
  const byPage = new Map(docs.map((doc) => [doc.page, doc]));

  return {
    rows: WEBSITE_PAGES.map((page) => {
      const doc = byPage.get(page.key);
      const hasArticle = Boolean(doc?.heading || doc?.body);
      return {
        key: page.key,
        label: page.label,
        path: page.path,
        note: page.note ?? '',
        takesArticle: page.sections.includes('article'),
        takesFaq: page.sections.includes('faq'),
        // Same three-state vocabulary as the Parts list, so the two tabs read alike.
        articleStatus: hasArticle ? doc.status : 'none',
        heading: doc?.heading ?? '',
        faqCount: faqCounts[page.key] ?? 0,
        sections: page.sections,
        hiddenSections: (doc?.hiddenSections ?? []).filter((section) => page.sections.includes(section)),
        updatedAt: doc?.updatedAt ?? null,
      };
    }),
  };
}

/** The editor's payload: the page, its article and switches, and every question on it. */
async function getForAdmin(key) {
  const page = pageOr404(key);
  const [doc, faqs] = await Promise.all([
    db().PageContent.findOne({ page: page.key }).lean(),
    faqService.listForPage(page.key, { publishedOnly: false }),
  ]);

  return {
    page: { ...page, note: page.note ?? '' },
    article: serializeArticle(doc),
    status: doc?.status ?? 'draft',
    hiddenSections: (doc?.hiddenSections ?? []).filter((section) => page.sections.includes(section)),
    faqs,
  };
}

/**
 * Save one page's article and switches. Upserts, as a product article does.
 *
 * A switch for a section the page cannot take is dropped rather than stored:
 * it could only ever be noise, and storing it would make a later registry change
 * behave differently on pages that happened to carry one.
 */
async function upsert(key, { heading = '', body = '', status = 'draft', hiddenSections = [], ...rest }) {
  const page = pageOr404(key);
  const existing = await db().PageContent.findOne({ page: page.key }).select('publishedAt').lean();
  const hasArticle = Boolean(heading || body);

  const doc = await db()
    .PageContent.findOneAndUpdate(
      { page: page.key },
      {
        $set: {
          heading: heading.trim(),
          body,
          author: authorFromForm(rest),
          // No article is never "published": the status would outlive the words
          // and claim a page has copy it does not.
          status: hasArticle ? status : 'draft',
          readMinutes: readMinutes(body),
          // Stamped the first time it goes live, never moved by an edit.
          publishedAt:
            hasArticle && status === 'published'
              ? (existing?.publishedAt ?? new Date())
              : (existing?.publishedAt ?? null),
          hiddenSections: hiddenSections.filter((section) => page.sections.includes(section)),
        },
        $setOnInsert: { page: page.key },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    )
    .lean();

  return getForAdmin(doc.page);
}

// Page questions, addressed through the page so the key is checked once here.
async function createFaq(key, data) {
  return faqService.createPageFaq(pageOr404(key).key, data);
}
async function updateFaq(key, id, data) {
  return faqService.updatePageFaq(pageOr404(key).key, id, data);
}
async function deleteFaq(key, id) {
  return faqService.deletePageFaq(pageOr404(key).key, id);
}

export default { getPublic, listForAdmin, getForAdmin, upsert, createFaq, updateFaq, deleteFaq };
export { getPublic, listForAdmin, getForAdmin, upsert, createFaq, updateFaq, deleteFaq };
