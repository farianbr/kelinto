import { asyncHandler } from '../utils/ApiError.js';
import * as cartService from '../services/cartService.js';

/** Every response is the whole serialized cart, so the client never guesses state. */
const respond = async (res, cart, user, status = 200) =>
  res.status(status).json({ cart: await cartService.serialize(cart, user) });

const get = asyncHandler(async (req, res) => {
  const cart = await cartService.getOrCreateCart(req.user._id);
  await respond(res, cart, req.user);
});

const addItem = asyncHandler(async (req, res) => {
  const cart = await cartService.addItem(req.user._id, req.body.productId, req.body.qty);
  await respond(res, cart, req.user, 201);
});

const setQty = asyncHandler(async (req, res) => {
  const cart = await cartService.setQty(req.user._id, req.params.productId, req.body.qty);
  await respond(res, cart, req.user);
});

const removeItem = asyncHandler(async (req, res) => {
  const cart = await cartService.removeItem(req.user._id, req.params.productId);
  await respond(res, cart, req.user);
});

const merge = asyncHandler(async (req, res) => {
  const cart = await cartService.mergeGuestCart(req.user._id, req.body.items);
  await respond(res, cart, req.user);
});

const save = asyncHandler(async (req, res) => {
  const cart = await cartService.saveForLater(req.user._id, req.body.name);
  await respond(res, cart, req.user);
});

const clear = asyncHandler(async (req, res) => {
  const cart = await cartService.clearCart(req.user._id);
  await respond(res, cart, req.user);
});

const listSaved = asyncHandler(async (req, res) => {
  res.json({ carts: await cartService.listSaved(req.user._id) });
});

const restoreSaved = asyncHandler(async (req, res) => {
  const cart = await cartService.restoreSaved(req.user._id, req.params.savedCartId);
  await respond(res, cart, req.user);
});

const deleteSaved = asyncHandler(async (req, res) => {
  await cartService.deleteSaved(req.user._id, req.params.savedCartId);
  res.status(204).end();
});

/** Quick order pad. Reports what could not be added rather than dropping it. */
const bulkAdd = asyncHandler(async (req, res) => {
  const { cart, added, notFound, outOfStock } = await cartService.bulkAdd(
    req.user._id,
    req.body.lines,
  );
  res.status(201).json({
    cart: await cartService.serialize(cart, req.user),
    added,
    notFound,
    outOfStock,
  });
});

// ---- combo bundles ----------------------------------------------------------

const addBundle = asyncHandler(async (req, res) => {
  const cart = await cartService.addBundle(req.user._id, req.body.offer, req.body.qty);
  await respond(res, cart, req.user, 201);
});

const setBundleQty = asyncHandler(async (req, res) => {
  const cart = await cartService.setBundleQty(req.user._id, req.params.offerId, req.body.qty);
  await respond(res, cart, req.user);
});

const removeBundle = asyncHandler(async (req, res) => {
  const cart = await cartService.removeBundle(req.user._id, req.params.offerId);
  await respond(res, cart, req.user);
});

// ---- pre-owned phones -------------------------------------------------------

const addPreowned = asyncHandler(async (req, res) => {
  const cart = await cartService.addPreowned(req.user._id, req.body.device);
  await respond(res, cart, req.user, 201);
});

const removePreowned = asyncHandler(async (req, res) => {
  const cart = await cartService.removePreowned(req.user._id, req.params.deviceId);
  await respond(res, cart, req.user);
});

// ---- promo code -------------------------------------------------------------

const applyPromo = asyncHandler(async (req, res) => {
  const cart = await cartService.applyPromoCode(req.user._id, req.body.code, req.user);
  await respond(res, cart, req.user);
});

const clearPromo = asyncHandler(async (req, res) => {
  const cart = await cartService.clearPromoCode(req.user._id);
  await respond(res, cart, req.user);
});

export { get, addItem, setQty, removeItem, merge, save, clear, listSaved, restoreSaved, deleteSaved, bulkAdd, addBundle, setBundleQty, removeBundle, addPreowned, removePreowned, applyPromo, clearPromo };
