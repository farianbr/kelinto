import { asyncHandler } from '../utils/ApiError.js';
import * as blogService from '../services/blogService.js';
import * as faqService from '../services/faqService.js';
import * as offerService from '../services/offerService.js';
import * as productArticleService from '../services/productArticleService.js';
import * as pageContentService from '../services/pageContentService.js';
import * as googleReviewService from '../services/googleReviewService.js';

/**
 * Blog, FAQ and offers.
 *
 * Three small domains that share one shape - public read, admin write - so they
 * share a controller rather than three near-identical files. The services stay
 * separate; the business logic is where the domains actually differ.
 */

// ---- blog -------------------------------------------------------------------

const listPosts = asyncHandler(async (req, res) => {
  res.json(await blogService.listPublished(req.query));
});

const getPost = asyncHandler(async (req, res) => {
  res.json(await blogService.getBySlug(req.params.slug));
});

const adminListPosts = asyncHandler(async (req, res) => {
  res.json(await blogService.listAll(req.query));
});

const adminGetPost = asyncHandler(async (req, res) => {
  res.json({ post: await blogService.getById(req.params.id) });
});

const adminCreatePost = asyncHandler(async (req, res) => {
  res.status(201).json({ post: await blogService.createPost(req.body) });
});

const adminUpdatePost = asyncHandler(async (req, res) => {
  res.json({ post: await blogService.updatePost(req.params.id, req.body) });
});

const adminDeletePost = asyncHandler(async (req, res) => {
  res.json({ post: await blogService.deletePost(req.params.id) });
});

// ---- faq --------------------------------------------------------------------

const listFaqs = asyncHandler(async (req, res) => {
  res.json(await faqService.listGeneral(req.query));
});

const adminListFaqs = asyncHandler(async (req, res) => {
  res.json(await faqService.listAll(req.query));
});

const adminCreateFaq = asyncHandler(async (req, res) => {
  res.status(201).json({ faq: await faqService.createFaq(req.body) });
});

const adminUpdateFaq = asyncHandler(async (req, res) => {
  res.json({ faq: await faqService.updateFaq(req.params.id, req.body) });
});

const adminDeleteFaq = asyncHandler(async (req, res) => {
  res.json({ faq: await faqService.deleteFaq(req.params.id) });
});

// ---- offers -----------------------------------------------------------------

const listOffers = asyncHandler(async (req, res) => {
  // `req.user` may be null - the price gate inside decides what a guest sees.
  res.json(await offerService.listLive(req.user));
});

const getOffer = asyncHandler(async (req, res) => {
  res.json(await offerService.getBySlug(req.params.slug, req.user));
});

const adminListOffers = asyncHandler(async (req, res) => {
  res.json(await offerService.listAll(req.query));
});

const adminCreateOffer = asyncHandler(async (req, res) => {
  res.status(201).json({ offer: await offerService.createOffer(req.body) });
});

const adminUpdateOffer = asyncHandler(async (req, res) => {
  res.json({ offer: await offerService.updateOffer(req.params.id, req.body) });
});

const adminDeleteOffer = asyncHandler(async (req, res) => {
  res.json({ offer: await offerService.deleteOffer(req.params.id) });
});


// ---- product articles -------------------------------------------------------
//
// Authored under SEO beside the blog and the FAQ, and rendered on ONE product
// page. The list is driven from products rather than from articles, because the
// staff member question is "which parts still need one".

const adminListArticles = asyncHandler(async (req, res) => {
  res.json(await productArticleService.listForAdmin(req.query));
});

const adminGetArticle = asyncHandler(async (req, res) => {
  res.json(await productArticleService.getForAdmin(req.params.productId));
});

// One handler for create and update. The editor opens against a PRODUCT
// whether or not an article exists yet, so the client should not have to know
// which of the two it is doing - the service upserts.
const adminSaveArticle = asyncHandler(async (req, res) => {
  res.json({ article: await productArticleService.upsert(req.params.productId, req.body) });
});

const adminDeleteArticle = asyncHandler(async (req, res) => {
  res.json(await productArticleService.remove(req.params.productId));
});

// ---- website page sections --------------------------------------------------
//
// The article, questions and section switches at the foot of each website page
// (`shared/websitePages.js`), and the business's Google reviews shown there.
// Public reads are cached a minute at the edge, like `/business-info`: they
// change when somebody edits them, and every page of every visit asks.

const getPage = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(await pageContentService.getPublic(req.params.page));
});

const listGoogleReviews = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(await googleReviewService.listPublic());
});

const adminListPages = asyncHandler(async (req, res) => {
  res.json(await pageContentService.listForAdmin());
});

const adminGetPage = asyncHandler(async (req, res) => {
  res.json(await pageContentService.getForAdmin(req.params.page));
});

const adminSavePage = asyncHandler(async (req, res) => {
  res.json(await pageContentService.upsert(req.params.page, req.body));
});

const adminCreatePageFaq = asyncHandler(async (req, res) => {
  res.status(201).json({ faq: await pageContentService.createFaq(req.params.page, req.body) });
});

const adminUpdatePageFaq = asyncHandler(async (req, res) => {
  res.json({ faq: await pageContentService.updateFaq(req.params.page, req.params.id, req.body) });
});

const adminDeletePageFaq = asyncHandler(async (req, res) => {
  res.json({ faq: await pageContentService.deleteFaq(req.params.page, req.params.id) });
});

const adminListGoogleReviews = asyncHandler(async (req, res) => {
  res.json(await googleReviewService.listForAdmin());
});

const adminCreateGoogleReview = asyncHandler(async (req, res) => {
  res.status(201).json({ review: await googleReviewService.create(req.body) });
});

const adminUpdateGoogleReview = asyncHandler(async (req, res) => {
  res.json({ review: await googleReviewService.update(req.params.id, req.body) });
});

const adminDeleteGoogleReview = asyncHandler(async (req, res) => {
  res.json({ review: await googleReviewService.remove(req.params.id) });
});

const adminSaveGoogleSummary = asyncHandler(async (req, res) => {
  res.json({ summary: await googleReviewService.updateSummary(req.body) });
});

export { listPosts, getPost, adminListPosts, adminGetPost, adminCreatePost, adminUpdatePost, adminDeletePost, listFaqs, adminListFaqs, adminCreateFaq, adminUpdateFaq, adminDeleteFaq, listOffers, getOffer, adminListOffers, adminCreateOffer, adminUpdateOffer, adminDeleteOffer, adminListArticles, adminGetArticle, adminSaveArticle, adminDeleteArticle, getPage, listGoogleReviews, adminListPages, adminGetPage, adminSavePage, adminCreatePageFaq, adminUpdatePageFaq, adminDeletePageFaq, adminListGoogleReviews, adminCreateGoogleReview, adminUpdateGoogleReview, adminDeleteGoogleReview, adminSaveGoogleSummary };
