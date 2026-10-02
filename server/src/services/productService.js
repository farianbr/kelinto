import { urlOf } from './storageService.js';
import { db } from '../db/models.js';
import '../models/Product.js';
import '../models/Taxonomy.js';
import { canSeePricing } from '../middleware/auth.js';
import { listForProduct as listFaqsForProduct } from './faqService.js';
import { getPublishedForProduct } from './productArticleService.js';
import { listForProduct as listReviewsForProduct } from './reviewService.js';
import { likeRegex } from '../utils/regex.js';
/**
 * A product is listable only if it can show a picture: either it carries its
 * own `image`, or its brand-and-component-type pair has a stock photo.
 *
 * Applied in `buildQuery`, which is the ONE place the catalogue's shape is
 * decided - the listing, the facet counts and the price bounds all build off
 * it, so a product hidden from the grid is also absent from every count beside
 * it. `taxonomyService` applies the same clause for the same reason. Admin
 * queries do not go through here and still see everything.
 */
import { HAS_PICTURE } from '../../../shared/partPhotos.js';
import { categoryAttributes, categoryFilter } from './catalogService.js';
import { ATTRIBUTE_KEY_PATTERN, formatAttribute } from '../../../shared/catalog.js';

/**
 * Feature filters off the query string (2026-10-02): `a.colour=Black,Blue`.
 * Only a key shaped like a feature key is read, and every value is a string,
 * so nothing from the URL reaches Mongo as an operator.
 */
function attributeFilters(params = {}) {
  const out = {};
  for (const [name, value] of Object.entries(params)) {
    if (!name.startsWith('a.')) continue;
    const key = name.slice(2);
    if (!ATTRIBUTE_KEY_PATTERN.test(key)) continue;
    const values = (Array.isArray(value) ? value : String(value ?? '').split(','))
      .map((entry) => String(entry).trim())
      .filter(Boolean);
    if (values.length) out[key] = values;
  }
  return out;
}

const PAGE_SIZE = 24;

const SORTS = {
  relevance: { stock: -1, _id: 1 },
  'name-asc': { name: 1 },
  'price-asc': { price: 1 },
  'price-desc': { price: -1 },
  'stock-desc': { stock: -1 },
  newest: { createdAt: -1 },
};

/**
 * What one unit of this product costs today, integer cents.
 *
 * The ONE place that question is answered. A cleared part sells at
 * `clearancePrice`, and `serialize`, the cart and the order total all have to
 * agree about that or the card shows one number and the invoice carries
 * another - so none of them reads `product.price` directly any more.
 *
 * `clearancePrice` of 0 means "cleared, at the ordinary price": a part can go
 * on the clearance page to shift it without being discounted.
 */
function effectivePrice(doc) {
  if (doc.isClearance && doc.clearancePrice > 0) return doc.clearancePrice;
  return doc.price;
}

/**
 * Shapes a product for the wire.
 *
 * THE PRICE GATE LIVES HERE. For anyone who is not an approved buyer, `price` is
 * omitted from the payload entirely - not blurred, not zeroed. The client's blur
 * is cosmetic; this is the actual control (PROJECT_INSTRUCTIONS.md §5.3).
 *
 * Availability leaves as a BOOLEAN and nothing else. The storefront states in
 * stock or out of stock; the on-hand count is a wholesale-operations number that
 * belongs to the admin payload, and shipping it here invited a buyer to plan
 * around a figure that moves between page loads.
 */
function serialize(product, user) {
  const showPricing = canSeePricing(user);
  const doc = product.toObject ? product.toObject() : product;

  const base = {
    id: doc._id.toString(),
    sku: doc.sku,
    name: doc.name,
    slug: doc.slug,
    image: urlOf(doc.image) ?? null,
    partType: doc.partType,
    partTypeLabel: doc.partTypeLabel,
    grade: doc.grade,
    inStock: doc.stock > 0,
    deviceTypeSlug: doc.deviceTypeSlug,
    deviceTypeName: doc.deviceTypeName,
    brandSlug: doc.brandSlug,
    brandName: doc.brandName,
    seriesSlug: doc.seriesSlug,
    seriesName: doc.seriesName,
    modelSlug: doc.modelSlug,
    modelName: doc.modelName,
    level5Slug: doc.level5Slug ?? null,
    level5Name: doc.level5Name ?? null,
    level6Slug: doc.level6Slug ?? null,
    level6Name: doc.level6Name ?? null,
    priceVisible: showPricing,

    // Clearance status is not pricing, so it sits above the gate: a pending
    // account may see THAT a part is being cleared, the same way it sees that a
    // part is in stock. What it may not see is the number, which is below the
    // gate with every other price.
    isClearance: Boolean(doc.isClearance),
  };

  if (!showPricing) return base;

  // A cleared part prices at `clearancePrice` when one is set, and its ordinary
  // price becomes the strike-through. Resolved HERE rather than on the client
  // for the same reason every other total is: two places deciding what a thing
  // costs is one place too many, and the card and the cart must not disagree.
  const onClearance = Boolean(doc.isClearance) && doc.clearancePrice > 0;

  return {
    ...base,
    price: effectivePrice(doc),
    compareAtPrice: onClearance ? doc.price : (doc.compareAtPrice ?? null),
    market: marketPosition(doc),
  };
}

/**
 * The competitor comparison, computed HERE and never on the client.
 *
 * The card shows one sentence - "save $8.80 vs market" - and that number is
 * arithmetic over prices. Handing the client an array and letting it do the
 * subtraction would put a second money calculation in the browser, which is the
 * thing the pricing rules exist to prevent; it would also let a rounding
 * difference put a different saving on the card than in the tooltip.
 *
 * Returns null when there is nothing honest to claim: no benchmarks, or we are
 * not actually the cheapest. An undercut competitor is not a saving, and
 * dressing one up as one is the kind of number a business buyer checks once and
 * then never trusts again.
 */
function marketPosition(doc) {
  // Against what this part ACTUALLY sells for today, not its list price - a
  // cleared part compared against its old number would understate the saving
  // on the one page where the saving is the point.
  const ours = effectivePrice(doc);

  const competitors = (doc.competitors ?? [])
    .filter((entry) => entry && Number.isFinite(entry.price) && entry.price > 0)
    // Only sellers we BEAT. A benchmark cheaper than us is a competitor doing
    // the undercutting, and listing it inside a panel headed "save X vs market"
    // hands a buyer the cheaper shop's name - the comparison exists to show we
    // are the better buy, so a row that says otherwise does not belong in it.
    //
    // Dropped BEFORE the average, so the figure the card claims is the average
    // of what is actually shown. Averaging over hidden rows and displaying the
    // rest is a total the reader cannot reproduce from the numbers in front of
    // them, which is exactly how a comparison stops being trusted.
    .filter((entry) => entry.price > ours)
    .map((entry) => ({ name: entry.name, price: entry.price }));

  if (!competitors.length) return null;

  const total = competitors.reduce((sum, entry) => sum + entry.price, 0);
  // Integer cents out, like every other money field on the wire.
  const average = Math.round(total / competitors.length);
  const lowest = Math.min(...competitors.map((entry) => entry.price));
  const savings = average - ours;

  if (savings <= 0) return null;

  return {
    competitors,
    average,
    lowest,
    savings,
    // Whole percent - a card has no room for a decimal, and "18%" is the claim
    // a buyer repeats back anyway.
    savingsPercent: Math.round((savings / average) * 100),
    // Always true now that dearer-than-us is the filter above: every row that
    // survives is a seller we beat, so we are the cheapest of what is shown.
    // Kept on the wire because the clients render on it, and because the day a
    // product legitimately shows an undercutting benchmark this is the flag
    // that has to go false rather than a new one that has to be invented.
    isLowest: ours < lowest,
  };
}

function serializeDetail(product, user) {
  const doc = product.toObject ? product.toObject() : product;
  return {
    ...serialize(product, user),
    // Which type it is sold under, so its page starts from that catalogue.
    category: doc.category || 'parts',
    description: doc.description,
    images: (doc.images ?? []).map(urlOf),
    video: urlOf(doc.video) || null,
    videoPoster: urlOf(doc.videoPoster) || null,
    specs: doc.specs instanceof Map ? Object.fromEntries(doc.specs) : (doc.specs ?? {}),
  };
}

/** Translates the shared filter state into a Mongo query. */
function buildQuery(params) {
  const { deviceType, brand, series, model, partType, grade, inStockOnly, q, category } = params;
  const query = { isActive: true };

  for (const [key, values] of Object.entries(attributeFilters(params))) {
    query[`attributes.${key}`] = { $in: values };
  }

  // `String()` on every equality value, belt to the `query parser` braces in
  // app.js: a filter value must never reach Mongo as an object, because an
  // object here IS a query staff member.
  const levelClauses = levelClause({ deviceType, brand, series, model, level5: params.level5, level6: params.level6 });

  const partTypes = toArray(partType);
  if (partTypes.length) query.partType = { $in: partTypes };

  const grades = toArray(grade);
  if (grades.length) query.grade = { $in: grades };

  if (inStockOnly) query.stock = { $gt: 0 };

  // Both the search terms and the picture rule are `$or`s, and a Mongo document
  // holds one `$or` key - the second would silently replace the first and widen
  // the search to the whole catalogue. `$and` keeps them as two independent
  // clauses that must both hold.
  // The catalogue category (2026-10-01): Parts unless the page names another,
  // so a business's Accessories never appear on the Parts page.
  const clauses = [HAS_PICTURE, categoryFilter(typeof category === 'string' && category ? category : 'parts')];

  if (q) {
    const rx = likeRegex(q);
    clauses.push({ $or: [{ name: rx }, { sku: rx }, { searchTerms: rx }, { modelName: rx }] });
  }
  clauses.push(...levelClauses);

  query.$and = clauses;

  return query;
}

/**
 * The category levels picked in the filters, one clause each.
 *
 * A product set to "Any" at a level (2026-10-03) is filed no deeper than the
 * level above, and fits every option from there down: a battery for every
 * Samsung shows under each Samsung series and model. So a level matches its
 * own entry, or a product that stops before it. Levels above still have to
 * match, which keeps that battery out from under Apple.
 */
const LEVEL_FILTERS = ['deviceType', 'brand', 'series', 'model', 'level5', 'level6'];
const EMPTY = { $in: [null, ''] };

function levelClause(picked) {
  const clauses = [];
  LEVEL_FILTERS.forEach((key, index) => {
    if (!picked[key]) return;
    const stopsHere = Object.fromEntries(LEVEL_FILTERS.slice(index).map((deeper) => [`${deeper}Slug`, EMPTY]));
    // `String()`: a filter value must never reach Mongo as an object.
    clauses.push({ $or: [{ [`${key}Slug`]: String(picked[key]) }, stopsHere] });
  });
  return clauses;
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value).split(',').filter(Boolean);
}

/**
 * Facet counts for the sidebar.
 *
 * Each facet is counted against the query WITHOUT its own constraint applied, so
 * ticking "PULL-A" does not collapse every other grade's count to zero. Price
 * bounds are always computed but only released to approved buyers.
 */
async function buildFacets(params) {
  const withoutGrade = buildQuery({ ...params, grade: null });
  const withoutPartType = buildQuery({ ...params, partType: null });
  const full = buildQuery(params);

  /**
   * One facet per feature the category offers as a website filter, each
   * counted without its own ticks (like grade), so ticking Black does not zero
   * Blue. A feature with no answers on this page's products is left out.
   */
  const withoutAttribute = (key) => {
    const next = { ...params };
    delete next[`a.${key}`];
    return buildQuery(next);
  };
  const filterDefs = (await categoryAttributes(typeof params.category === 'string' && params.category ? params.category : 'parts')).filter(
    (def) => def.filter,
  );
  const attributeCounts = await Promise.all(
    filterDefs.map((def) =>
      db().Product.aggregate([
        { $match: { ...withoutAttribute(def.key), [`attributes.${def.key}`]: { $exists: true, $ne: '' } } },
        { $group: { _id: `$attributes.${def.key}`, count: { $sum: 1 } } },
      ]),
    ),
  );
  const attributes = filterDefs
    .map((def, index) => {
      const counts = new Map(attributeCounts[index].map((row) => [row._id, row.count]));
      // A list feature keeps the order its choices were written in; the rest sort.
      const values = def.type === 'select' ? def.options.filter((option) => counts.has(option)) : [...counts.keys()].sort();
      return {
        key: def.key,
        label: def.label,
        options: values.map((value) => ({ value, label: formatAttribute(def, value), count: counts.get(value) })),
      };
    })
    .filter((facet) => facet.options.length > 0);

  const [grades, partTypes, availability, priceRange] = await Promise.all([
    db().Product.aggregate([
      { $match: withoutGrade },
      { $group: { _id: '$grade', count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    db().Product.aggregate([
      { $match: withoutPartType },
      {
        $group: {
          _id: '$partType',
          label: { $first: '$partTypeLabel' },
          count: { $sum: 1 },
        },
      },
      { $sort: { label: 1 } },
    ]),
    db().Product.aggregate([
      { $match: buildQuery({ ...params, inStockOnly: false }) },
      { $group: { _id: null, inStock: { $sum: { $cond: [{ $gt: ['$stock', 0] }, 1, 0] } }, total: { $sum: 1 } } },
    ]),
    db().Product.aggregate([
      { $match: full },
      { $group: { _id: null, min: { $min: '$price' }, max: { $max: '$price' } } },
    ]),
  ]);

  return {
    grade: grades.map((g) => ({ value: g._id, count: g.count })),
    partType: partTypes.map((p) => ({ value: p._id, label: p.label, count: p.count })),
    availability: {
      inStock: availability[0]?.inStock ?? 0,
      total: availability[0]?.total ?? 0,
    },
    price: priceRange[0] ? { min: priceRange[0].min, max: priceRange[0].max } : null,
    attributes,
  };
}

/** The grid query. One call returns products, facet counts and pagination. */
async function listProducts(params, user) {
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(96, Number(params.limit) || PAGE_SIZE);
  const query = buildQuery(params);

  // Price bounds only bite for users who can see prices at all.
  if (canSeePricing(user)) {
    const min = Number(params.priceMin);
    const max = Number(params.priceMax);
    if (Number.isFinite(min) || Number.isFinite(max)) {
      query.price = {};
      if (Number.isFinite(min)) query.price.$gte = min;
      if (Number.isFinite(max)) query.price.$lte = max;
    }
  }

  const sort = SORTS[params.sort] ?? SORTS.relevance;

  const [items, total, facets] = await Promise.all([
    db().Product.find(query)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    db().Product.countDocuments(query),
    buildFacets(params),
  ]);

  // Prices are stripped for non-approved users, so hide the price sorts too.
  const facetsOut = canSeePricing(user) ? facets : { ...facets, price: null };

  return {
    products: items.map((item) => serialize(item, user)),
    facets: facetsOut,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

async function getProductBySlug(slug, user) {
  const product = await db().Product.findOne({ slug, isActive: true }).lean();
  if (!product) return null;

  // Filed at the same place, every level alike: on a type without models, or
  // on a product set to "Any" below its brand (2026-10-03), `modelSlug` is
  // empty, and matching on it alone pulled in every other modelless product.
  const samePlace = Object.fromEntries(LEVEL_FILTERS.map((key) => [`${key}Slug`, product[`${key}Slug`] || null]));
  const category = categoryFilter(product.category || 'parts');

  // FAQs ride along with the product rather than in a second round trip: the
  // section is on every product page, so a separate request would only ever
  // arrive late and shift the layout under the reader.
  const [related, faqs, grades, article, reviews] = await Promise.all([
    /**
     * OTHER PARTS FOR THE SAME DEVICE.
     *
     * `partType` is EXCLUDED, not just the product itself. Matching on
     * `modelSlug` alone was correct while a part existed at one or two grades;
     * once every part carries its full ladder it returned this same screen at
     * NEW, Pull A, Pull B and aftermarket, which is precisely what the section
     * directly above it already shows. Two sections, same four cards.
     *
     * So this is "a battery, a charging port, a back camera for this phone" -
     * a different component - and the grade ladder is the other section's job.
     *
     * One card per component type, chosen in the aggregate below rather than
     * with a `.limit()`: four grades of one battery would otherwise fill the
     * row and the reader would learn we sell batteries, four times.
     */
    db().Product.aggregate([
      {
        $match: {
          _id: { $ne: product._id },
          ...samePlace,
          ...category,
          partType: { $ne: product.partType },
          isActive: true,
        },
      },
      // In-stock first, then the cheapest of that grade ladder: the card that
      // represents a component type should be one the buyer can actually act
      // on, and the entry price is the honest opening offer for it.
      { $sort: { stock: -1, price: 1 } },
      { $group: { _id: '$partType', doc: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$doc' } },
      { $sort: { partType: 1 } },
      { $limit: 8 },
    ]),
    listFaqsForProduct(product),

    /**
     * THE SAME PART AT ANOTHER GRADE.
     *
     * A grade is not a variant of a product here - it is a separate record with
     * its own SKU, price and stock, because that is what orders, purchase
     * orders, inventory and stock movements all key off. So "other grades" is a
     * sibling LOOKUP rather than a field: the same model and the same component
     * type, at a different grade.
     *
     * Matched on `modelSlug` AND `partType` together. `modelSlug` alone is what
     * `related` above uses and it means something different - every part for
     * this phone, which puts a battery next to a screen. Only the pair says
     * "this exact part".
     *
     * Out-of-stock siblings are INCLUDED. A buyer choosing between grades is
     * deciding what to order, and a grade that exists but is out today is a
     * different answer from a grade we do not carry - hiding it would make the
     * cheaper option look like it was never offered at all.
     */
    db().Product.find({
      _id: { $ne: product._id },
      ...samePlace,
      ...category,
      partType: product.partType,
      isActive: true,
    })
      .limit(6)
      .lean(),

    // Published only - a draft is written against a live product, so returning
    // drafts here would publish an article the moment somebody started it.
    getPublishedForProduct(product._id),

    // Customer reviews and their average, in the same round trip. The
    // rating sits at the top of the page beside the title, so fetching it
    // separately would paint the header twice.
    listReviewsForProduct(product._id),
  ]);

  return {
    product: {
      ...serializeDetail(product, user),
      // Its features, as the page lists them: only those marked for the
      // product page, in the category's order, each in words (2026-10-02).
      features: (await categoryAttributes(product.category || 'parts'))
        .filter((def) => def.product && product.attributes?.[def.key])
        .map((def) => ({ key: def.key, label: def.label, value: formatAttribute(def, product.attributes[def.key]) })),
    },
    related: related.map((item) => serialize(item, user)),
    faqs,
    // Sorted by price so the row reads as a ladder rather than in whatever
    // order Mongo happened to return. A gated user has no price to sort on -
    // the server omits it entirely - in which case the order is left alone.
    grades: grades
      .map((item) => serialize(item, user))
      .sort((a, b) => (a.price ?? 0) - (b.price ?? 0)),
    article,
    // { reviews, count, average } as one object, so the star rating beside the
    // title and the list further down read from the same payload.
    reviews,
  };
}

/**
 * Payload for the header's live type-ahead (brief §4.3): facet suggestions on
 * the left, live product results on the right, total for the "View All" CTA.
 */
async function searchProducts(term, user, { limit = 6 } = {}) {
  // `?q=a&q=b` arrives as an array; anything but a string would throw on `.trim`.
  const q = typeof term === 'string' ? term : '';
  if (q.trim().length < 2) {
    return { suggestions: [], models: [], pages: [], products: [], total: 0 };
  }

  const rx = likeRegex(q);

  /**
   * Models whose **alias** matches, resolved first (§6.15, phase 11d).
   *
   * A business buyer types `15 PM`, not "iPhone 15 Pro Max". Aliases live on the
   * taxonomy model rather than on each product, so one alias covers all forty
   * parts that fit that phone - which means the alias has to be turned into a
   * model slug here and then folded into the product query below. Without this
   * the alias editor would be managing a field nothing reads.
   *
   * Matched against the lowercased term because aliases are stored lowercase.
   */
  // Parts nodes only: the Phones and Services trees carry the same aliases
  // (they were copied from the device list) and no product points at them.
  const aliasMatches = await db().Taxonomy.find({
    kind: 'model',
    isActive: { $ne: false },
    aliases: q.trim().toLowerCase(),
    ...categoryFilter('parts'),
  })
    .select('slug name path productCount')
    .limit(6)
    .lean();

  const aliasSlugs = aliasMatches.map((node) => node.slug);

  const query = {
    isActive: true,
    $or: [
      { name: rx },
      { sku: rx },
      { searchTerms: rx },
      { modelName: rx },
      // An exact alias hit brings back every part for that model, which is the
      // whole point of typing `15pm` into a parts catalogue. `modelSlug` is the
      // flat field on `Product` - the nested `path` shape belongs to `Taxonomy`.
      ...(aliasSlugs.length ? [{ modelSlug: { $in: aliasSlugs } }] : []),
    ],
  };

  const [products, total, nameModels, partTypes] = await Promise.all([
    db().Product.find(query).sort({ stock: -1 }).limit(limit).lean(),
    db().Product.countDocuments(query),
    db().Taxonomy.find({ kind: 'model', name: rx, isActive: { $ne: false }, ...categoryFilter('parts') })
      .sort({ productCount: -1 })
      .limit(6)
      .lean(),
    db().Product.aggregate([
      { $match: query },
      { $group: { _id: '$partType', label: { $first: '$partTypeLabel' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
    ]),
  ]);

  // Alias hits first - somebody who typed `15pm` meant that model specifically,
  // so it should not sit below a fuzzy name match. Deduplicated by slug.
  const models = [...aliasMatches, ...nameModels].filter(
    (node, index, all) => all.findIndex((other) => other.slug === node.slug) === index,
  );

  return {
    // Left column of the dropdown.
    models: models.slice(0, 6).map((m) => ({
      slug: m.slug,
      name: m.name,
      count: m.productCount,
      path: m.path,
    })),
    suggestions: partTypes.map((p) => ({ value: p._id, label: p.label, count: p.count })),
    pages: staticPageMatches(q),
    // Right column.
    products: products.map((p) => serialize(p, user)),
    total,
  };
}

/**
 * The clearance list.
 *
 * Flagged by an admin, never derived from stock: the storefront may not learn a
 * count or a reorder point, so a list computed from `stock <= minStock` would
 * have had to publish exactly what that rule forbids. See `Product.isClearance`.
 *
 * Out-of-stock parts are excluded rather than shown greyed: a clearance page is
 * a page of things to buy now, and the flag usually outlives the last unit.
 */
async function listClearance({ page = 1, sort = 'newest' } = {}, user) {
  const Product = db().Product;
  // HAS_PICTURE, like every other listing query. A product the catalogue will
  // not show because it has no picture must not appear here either - the
  // clearance page is a view of the same catalogue, not a second one with
  // different rules.
  const query = {
    isActive: true,
    isClearance: true,
    stock: { $gt: 0 },
    $and: [HAS_PICTURE],
  };

  const sortSpec = SORTS[sort] ?? { updatedAt: -1 };
  const skip = (Math.max(1, Number(page) || 1) - 1) * PAGE_SIZE;

  const [products, total] = await Promise.all([
    Product.find(query).sort(sortSpec).skip(skip).limit(PAGE_SIZE).lean(),
    Product.countDocuments(query),
  ]);

  return {
    products: products.map((p) => serialize(p, user)),
    total,
    page: Math.max(1, Number(page) || 1),
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/**
 * Everything the homepage needs, in ONE round trip.
 *
 * A landing page that fired six requests would paint in six steps, and on a
 * slow connection the reader watches the layout assemble itself. One query per
 * section, run in parallel, answered as one payload.
 */
async function getHomeSections(user) {
  const Product = db().Product;
  // Same listability rule as the catalogue - see `buildQuery`. Without it the
  // homepage counted parts the shop will not list, so a brand tile promised 64
  // and its link delivered 44.
  const base = { isActive: true, $and: [HAS_PICTURE] };

  // The product ROWS want stock - a card a buyer cannot act on is not
  // merchandising. The COUNTS on the category and brand tiles must not, because
  // the catalogue lists out-of-stock parts too: counting only what is in stock
  // put 102 on a tile whose link then showed 116, and a number that disagrees
  // with the page behind it is worse than no number.
  const inStock = { ...base, stock: { $gt: 0 } };

  const [newestByType, clearance, topBrands, deviceTypes] = await Promise.all([
    /**
     * The newest row, spread across component types rather than down one.
     *
     * A plain `sort({ createdAt: -1 }).limit(8)` returned eight screens every
     * time, for two reasons that compound. The catalogue is genuinely
     * screen-heavy - `screen-assembly` is a third of it, because it is the one
     * part type with photography for every brand and it ships five grades where
     * a back glass ships two. And the seed inserts in taxonomy order in bulk,
     * so 773 products carry only 31 distinct `createdAt` values: the sort has
     * nothing to break ties with and simply returns the tail of the insert
     * order, which is the last brand in the tree. That brand has photos for
     * screens alone, so the row was 8/8 screens and the first 24 covered three
     * component types.
     *
     * Newest-first still decides WHICH part of each type is shown; what changes
     * is that the eight slots are shared out. `_id` breaks the `createdAt` ties
     * so the answer is at least stable between calls.
     */
    Product.aggregate([
      { $match: inStock },
      { $match: { partType: { $nin: [null, ''] } } },
      { $sort: { createdAt: -1, _id: -1 } },
      // Four deep per type is enough to fill eight slots however few types
      // survive the stock filter, without dragging the whole catalogue back.
      { $group: { _id: '$partType', items: { $push: '$$ROOT' } } },
      { $project: { items: { $slice: ['$items', 4] } } },
      // Deterministic order for the round-robin below.
      { $sort: { _id: 1 } },
    ]),
    Product.find({ ...inStock, isClearance: true }).sort({ updatedAt: -1 }).limit(8).lean(),
    // Brands by how much of the catalogue they carry - the row is "what we
    // stock deeply", which is the useful claim to a buyer, rather than a
    // hand-kept favourites list that goes stale.
    //
    // One row per brand NAME, but the row still links with a real slug and
    // counts only what that slug holds.
    //
    // The taxonomy scopes a brand to a device type - `apple-phone`,
    // `apple-tablet` and `apple-computer` are three separate nodes - and the
    // catalogue filter matches `brandSlug` exactly. So grouping by slug printed
    // "Apple" four times in one row, and summing the counts under one name
    // produced the opposite defect: a tile claiming 134 parts that linked to a
    // filter showing 44, because no single slug covers them all.
    //
    // The honest version is the biggest node per brand: the sort inside the
    // group runs descending, so `$first` takes the slug with the deepest
    // catalogue, and the count is that slug's own. The number on the tile is
    // then exactly what the link lands on.
    Product.aggregate([
      { $match: base },
      { $match: { brandName: { $nin: [null, ''] }, brandSlug: { $nin: [null, ''] } } },
      {
        $group: {
          _id: { name: '$brandName', slug: '$brandSlug' },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      {
        $group: {
          _id: '$_id.name',
          slug: { $first: '$_id.slug' },
          count: { $first: '$count' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    Product.aggregate([
      { $match: base },
      {
        $group: {
          _id: '$deviceTypeSlug',
          name: { $first: '$deviceTypeName' },
          count: { $sum: 1 },
        },
      },
      { $match: { _id: { $nin: [null, ''] } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
  ]);

  // One from each type, then a second from each, until the row is full. A type
  // with only one listable part contributes that one and drops out, so eight
  // slots are always filled while the catalogue holds eight parts.
  const newest = [];
  for (let round = 0; newest.length < 8 && round < 4; round += 1) {
    for (const group of newestByType) {
      const product = group.items[round];
      if (product) newest.push(product);
      if (newest.length >= 8) break;
    }
  }

  return {
    newest: newest.map((p) => serialize(p, user)),
    clearance: clearance.map((p) => serialize(p, user)),
    // `_id` is the brand NAME after the second grouping above; the slug to
    // link with is its own field.
    brands: topBrands.map((b) => ({ slug: b.slug, name: b._id, count: b.count })),
    deviceTypes: deviceTypes.map((d) => ({ slug: d._id, name: d.name, count: d.count })),
  };
}

const STATIC_PAGES = [
  { title: 'About Us', href: '/about' },
  { title: 'Shop All Parts', href: '/shop' },
  { title: 'Contact Us', href: '/contact' },
  { title: 'Offers & Combo Deals', href: '/offers' },
  { title: 'Stock Clearance', href: '/clearance' },
  { title: 'Blog', href: '/blog' },
  { title: 'FAQ', href: '/faq' },
  { title: 'My Account', href: '/account' },
  { title: 'Order History', href: '/account/orders' },
  { title: 'Invoices & Statements', href: '/account/invoices' },
  { title: 'Quick Order Pad', href: '/account/quick-order' },
];

function staticPageMatches(q) {
  const needle = q.trim().toLowerCase();
  return STATIC_PAGES.filter((page) => page.title.toLowerCase().includes(needle)).slice(0, 4);
}

export {
  serialize,
  serializeDetail,
  effectivePrice,
  listProducts,
  listClearance,
  getHomeSections,
  getProductBySlug,
  searchProducts,
};
