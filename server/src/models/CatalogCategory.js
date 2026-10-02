import mongoose from 'mongoose';

/**
 * A section of what a business sells on its website (`shared/catalog.js`).
 *
 * Per-business, like `Taxonomy`: one shop's Accessories is nothing to another.
 * The three system categories (Parts, Phones, Services) are written on first
 * read by `catalogCategoryService.list`, so a business that never opened the
 * screen still has them and no migration was needed to introduce them.
 *
 * `kind` is fixed once created: it decides which record an item is (a product
 * or a service), and changing it would leave every item filed under the
 * category pointing at the wrong collection. The one exception was deliberate:
 * Phones moved from `phone` (one `PreownedDevice` per handset) to `part` on
 * 2026-10-02, with its phones copied into products (`catalogService`).
 */
const levelSchema = new mongoose.Schema(
  {
    key: { type: String, enum: ['deviceType', 'brand', 'series', 'model', 'level5', 'level6'], required: true },
    label: { type: String, trim: true, maxlength: 40, required: true },
    /** Whether an item must be filed this deep (2026-10-02). Absent reads as required. */
    required: { type: Boolean, default: true },
  },
  { _id: false },
);

/** One condition grade a type's products may carry (2026-10-02). */
const gradeSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true, maxlength: 24 },
    label: { type: String, required: true, trim: true, maxlength: 30 },
  },
  { _id: false },
);

/** One feature of a product type (`shared/catalog.js` ATTRIBUTE_TYPES). */
const attributeSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 40 },
    label: { type: String, required: true, trim: true, maxlength: 40 },
    type: { type: String, enum: ['select', 'text', 'number', 'boolean'], default: 'select' },
    options: { type: [String], default: [] },
    unit: { type: String, trim: true, maxlength: 12, default: '' },
    required: { type: Boolean, default: false },
    inventory: { type: Boolean, default: true },
    filter: { type: Boolean, default: false },
    product: { type: Boolean, default: true },
  },
  { _id: false },
);

const catalogCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    slug: { type: String, required: true, unique: true, index: true },
    /**
     * Its page on the website, `/catalogue/<address>` (2026-10-03). Editable;
     * `slug` is the identifier items are filed under and never changes.
     * Absent reads as the slug.
     */
    address: { type: String, trim: true, maxlength: 40, index: true },
    /** Addresses it had before, which forward to the current one. */
    formerAddresses: { type: [String], default: [] },
    kind: { type: String, enum: ['part', 'phone', 'service'], required: true, default: 'part' },
    description: { type: String, trim: true, maxlength: 160, default: '' },
    /** What the finder's first, cross-cutting step is called. Blank: no such step. */
    facetLabel: { type: String, trim: true, maxlength: 40, default: '' },
    /** Whether an item must name its first-level entry. */
    facetRequired: { type: Boolean, default: true },
    /**
     * The grades its products may carry (`Product.grade`), in reading order.
     * Written on first read for the system types (`catalogService`).
     */
    grades: { type: [gradeSchema], default: undefined },
    /**
     * RETIRED the day it was added (2026-10-02): the first level's entries
     * are tree entries of kind `partType` now, edited in the category tree.
     * Read once by `catalogService.ensureFirstLevel` to write those entries,
     * then ignored.
     */
    facetOptions: {
      type: [
        new mongoose.Schema(
          {
            value: { type: String, required: true, trim: true, maxlength: 40 },
            label: { type: String, required: true, trim: true, maxlength: 40 },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    levels: { type: [levelSchema], default: undefined },
    /** Its features, in the order the inventory form asks them (2026-10-02). */
    attributes: { type: [attributeSchema], default: [] },
    /** Parts, Phones and Services: renamable, never removed. */
    isSystem: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    order: { type: Number, default: 10 },
  },
  { timestamps: true },
);

catalogCategorySchema.index({ order: 1, name: 1 });

const CatalogCategory = mongoose.model('CatalogCategory', catalogCategorySchema);

export { CatalogCategory };
export default CatalogCategory;
