import { asyncHandler } from '../utils/ApiError.js';
import buybackService from '../services/buybackService.js';

/**
 * Phones bought from customers and sold on (Sales § Sell your phone).
 *
 * Thin, like every controller here: the rules (ID once, a fresh photo every
 * sale, store credit through the ledger, prices gated server-side) live in
 * `buybackService`.
 */

/** The kiosk's "Sell your phone". Behind the tablet's session. */
const sell = asyncHandler(async (req, res) => {
  res.status(201).json(await buybackService.sell(req.body, req));
});

const list = asyncHandler(async (req, res) => {
  res.json(await buybackService.listBuybacks({ status: req.query.status, q: req.query.q }));
});

const detail = asyncHandler(async (req, res) => {
  res.json(await buybackService.getBuyback(req.params.id));
});

const revealId = asyncHandler(async (req, res) => {
  res.json(await buybackService.revealId(req.params.id, req));
});

/**
 * The seller's photo. Streamed rather than redirected to a signed URL, so the
 * private bucket has no address that ever reaches a browser, and marked
 * `no-store` so it is not left in a shared computer's cache.
 */
const photo = asyncHandler(async (req, res) => {
  const file = await buybackService.photo(req.params.id, req);
  res.set('Content-Type', file.contentType);
  res.set('Cache-Control', 'private, no-store');
  res.send(file.bytes);
});

const accept = asyncHandler(async (req, res) => {
  res.json(await buybackService.acceptBuyback(req.params.id, req.body, req));
});

const decline = asyncHandler(async (req, res) => {
  res.json(await buybackService.declineBuyback(req.params.id, req.body, req));
});

const listStock = asyncHandler(async (req, res) => {
  res.json(await buybackService.listPreowned({ status: req.query.status, q: req.query.q }));
});

const updateStock = asyncHandler(async (req, res) => {
  res.json(await buybackService.updatePreowned(req.params.id, req.body, req));
});

/** The website's pre-owned page. Public; prices only for approved accounts. */
const publicList = asyncHandler(async (req, res) => {
  res.json(await buybackService.publicList(req.user));
});

/** "Phones you sold us", on the customer's account. */
const mine = asyncHandler(async (req, res) => {
  res.json(await buybackService.accountList(req.user._id));
});

export { sell, list, detail, revealId, photo, accept, decline, listStock, updateStock, publicList, mine };
export default { sell, list, detail, revealId, photo, accept, decline, listStock, updateStock, publicList, mine };
