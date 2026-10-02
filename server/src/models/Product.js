import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    description: String,

    // Uploaded to R2 under this business's own prefix (`storageService`). A
    // product with no `image` falls back to the stock photo for its brand
    // and component type, then to a placeholder illustration.
    image: String,
    images: [String],
    // One short clip, shown on the product page under the pictures.
    video: String,
    // Its poster frame, made when the video was uploaded.
    videoPoster: String,

    partType: { type: String, required: true, index: true }, // screen | battery | charging-port | ...
    /**
     * The catalogue category (`shared/catalog.js`) a product is sold under,
     * and so which taxonomy tree its path slugs belong to. Absent means Parts,
     * which is every product written before categories existed.
     */
    category: { type: String, trim: true, index: true },
    partTypeLabel: String,
    // One of its type's grades (`CatalogCategory.grades`), checked on save by
    // `adminService`. A fixed enum until 2026-10-02, when grades became per type.
    // Blank on a type with no grades: no badge (2026-10-02).
    grade: { type: String, trim: true, maxlength: 24, default: '', index: true },

    // Integer cents. Never a float.
    price: { type: Number, required: true },
    compareAtPrice: Number,

    // Benchmark prices for the same part at named rival wholesalers, in integer
    // cents like every other money field. Placeholder data for now - seeded,
    // not scraped - but it leaves through the SAME price gate as `price` does:
    // a buyer who may not see our number may not see the market's either,
    // because the two together ARE the commercial position being gated.
    competitors: [
      {
        _id: false,
        name: { type: String, required: true },
        price: { type: Number, required: true },
      },
    ],

    // Operations data. Surfaced to admins; the storefront only ever learns
    // whether this is greater than zero (see productService.serialize).
    //
    // Everything in this block is admin-only. `productService.serialize` is an
    // allowlist rather than a blocklist, so a field added here cannot reach a
    // public payload by being forgotten - but the storefront rule is worth
    // restating where the fields live: in stock / out of stock, never a count,
    // never a reorder point, never a cost (ERP rework §6.10).
    stock: { type: Number, default: 0, index: true },

    // The reorder point the Inventory screen compares `stock` against. Zero
    // means "no point set", which reads as never low rather than always low.
    minStock: { type: Number, default: 0 },

    // What Cellvix pays for the part, integer cents. Distinct from `price`,
    // which is what a client pays. Margin in every report is the gap between
    // the two, and an order line snapshots this at order time (§9.4) so a later
    // cost change cannot rewrite the margin on a sale that already happened.
    cost: { type: Number, default: 0 },

    // Bin or shelf, free text - 'A-12-3'. One business today (§0.9).
    location: { type: String, trim: true, maxlength: 40 },

    // The default supplier for a reorder. A purchase-order line may still name
    // a different one; this is the suggestion, not a constraint.
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', index: true },

    barcode: { type: String, trim: true, maxlength: 60, index: true },

    // Denormalised taxonomy slugs: the filter query hits these directly.
    deviceTypeSlug: { type: String, index: true },
    brandSlug: { type: String, index: true },
    seriesSlug: { type: String, index: true },
    modelSlug: { type: String, index: true },
    // The two deeper finder levels a product type may add (2026-10-02).
    level5Slug: { type: String, index: true },
    level6Slug: { type: String, index: true },
    deviceTypeName: String,
    brandName: String,
    seriesName: String,
    modelName: String,
    level5Name: String,
    level6Name: String,

    specs: { type: Map, of: String, default: {} },
    /**
     * Its answers to its category's features (`CatalogCategory.attributes`),
     * keyed by feature key, every value a string (2026-10-02). Separate from
     * `specs`, which is free-form copy: these are defined, filterable facts.
     */
    attributes: { type: Map, of: String, default: undefined },
    searchTerms: [String],
    isActive: { type: Boolean, default: true, index: true },

    // --- clearance --------------------------------------------------------
    // Set by an admin, never derived from `stock`. Deriving it was the obvious
    // implementation and is the wrong one twice over: the storefront may not
    // learn a count or a reorder point (see the operations block above), so a
    // "low stock" page would have had to leak exactly what that rule forbids -
    // and a list that rebuilt itself every time the warehouse moved would put
    // parts in front of buyers that nobody decided to clear. This is a
    // decision, so it is stored as one.
    isClearance: { type: Boolean, default: false, index: true },

    // What it is being cleared at, integer cents. Optional: a part can be put
    // on the clearance page at its ordinary price to shift it. When set, this
    // is what `serialize` sends as the price and the ordinary price becomes
    // the strike-through - it never bypasses the price gate, which runs over
    // whatever value ends up in that field.
    clearancePrice: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// The clearance page's query, newest first.
productSchema.index({ isClearance: 1, isActive: 1, updatedAt: -1 });

// The exact shape of a filtered grid query.
productSchema.index({
  deviceTypeSlug: 1,
  brandSlug: 1,
  seriesSlug: 1,
  modelSlug: 1,
  partType: 1,
  grade: 1,
});

// Backs the header's live type-ahead.
productSchema.index({ name: 'text', sku: 'text', searchTerms: 'text' });

const Product = mongoose.model('Product', productSchema);

export { Product };
export default Product;
