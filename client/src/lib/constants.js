/**
 * Shared display constants.
 *
 * BUSINESS_INFO now lives in shared/business.js - the server renders it onto
 * the invoice it emails, so client and server have to read one object. It is
 * re-exported here because every client surface already imports it from this
 * module.
 */

export { BUSINESS_INFO } from '@shared/business';

/** Condition grades, in the order they should ever be listed. */
export const GRADES = {
  NEW: { label: 'New', short: 'NEW', tone: 'ok' },
  OEM: { label: 'OEM', short: 'OEM', tone: 'info' },
  'PULL-A': { label: 'Pull Grade A', short: 'PULL A', tone: 'brand' },
  'PULL-B': { label: 'Pull Grade B', short: 'PULL B', tone: 'warn' },
  // `short` is split on spaces into the badge's lines. Two short lines read in a
  // circle; one long one does not - "AFTMKT" on a single line was wider than the
  // badge it sat in.
  AFTERMARKET: { label: 'Aftermarket', short: 'AFT MKT', tone: 'neutral' },
};

export const GRADE_ORDER = ['NEW', 'OEM', 'PULL-A', 'PULL-B', 'AFTERMARKET'];

/**
 * Scroll depth at which the phone/tablet layout hands search over.
 *
 * Above it, the mobile header carries the search bar. Below it, that row folds
 * away - it is a full row of chrome sitting over a grid the buyer is scrolling
 * and the bottom bar rises with the search button that unfolds it again. One
 * number so the handoff has no gap: the bar cannot leave before the button that
 * replaces it has arrived.
 */
export const BOTTOM_NAV_REVEAL_AT = 160;

/**
 * The fallback reorder point, for a business that has not set one.
 *
 * **Not the threshold itself - that lives in Settings** (`operations.lowStockThreshold`,
 * edited on Inventory Settings) and the server classifies every product by it.
 * This is only what a screen prints before that value has loaded, and it
 * matches the schema default so the two agree in the meantime.
 *
 * ADMIN ONLY - it labels the inventory column in the admin product list. The
 * storefront states in stock or out of stock and never sees a count at all; the
 * API does not send one (productService.serialize).
 */
export const LOW_STOCK_THRESHOLD = 50;

/**
 * Labels are kept short on purpose: the sort control is a native <select> that
 * has to survive half a 375px row, and "Stock: most available" clipped under the
 * chevron there. Values are the API contract and must not change.
 */
export const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'name-asc', label: 'Name: A–Z' },
  { value: 'price-asc', label: 'Price: low–high' },
  { value: 'price-desc', label: 'Price: high–low' },
  { value: 'stock-desc', label: 'In stock first' },
  { value: 'newest', label: 'Newest' },
];

/** The four levels of the shared filter hierarchy, in cascade order. */
/**
 * The taxonomy path, in the order the wizard walks it.
 *
 * `componentType` leads: a business buyer knows they need a screen long before
 * they care whose screen, and asking the part first lets every level below it
 * be pruned to what actually stocks that component (see the server's
 * getTreeForPartType) - so the wizard cannot offer a combination that returns
 * nothing.
 *
 * It is NOT a node in the taxonomy tree - a battery exists for phones, laptops
 * and watches alike - so it is stored as a facet and read back through the
 * store's componentType helpers. Everything below it IS a tree level.
 */
export const FILTER_LEVELS = [
  { key: 'componentType', label: 'Component Type', short: 'Component' },
  { key: 'deviceType', label: 'Device Type', short: 'Device' },
  { key: 'brand', label: 'Brand', short: 'Brand' },
  { key: 'series', label: 'Series', short: 'Series' },
  { key: 'model', label: 'Model', short: 'Model' },
];

/** The levels that are real nodes in the taxonomy tree. */
export const TREE_LEVELS = FILTER_LEVELS.filter((l) => l.key !== 'componentType');

/** Order lifecycle, in the order the tracking stepper renders it. */
export const ORDER_STATUSES = [
  { value: 'placed', label: 'Order Placed' },
  { value: 'processing', label: 'Processing' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'out_for_delivery', label: 'Out for Delivery' },
  { value: 'delivered', label: 'Delivered' },
];

export const PAGE_SIZE = 24;
