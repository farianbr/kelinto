import mongoose from 'mongoose';

/**
 * The single category tree. One self-referencing collection feeds all three
 * filter systems - sidebar, mega menu and tab wizard - so they cannot drift.
 *
 *   deviceType (Phone) -> brand (Samsung) -> series (S-Series) -> model (S23 Ultra)
 */
const taxonomySchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      // Two deeper levels for product types that need them (2026-10-02).
      // `partType` is a type's first level (Component Type, Repair Type): a
      // root entry whose value items store as `path.partType` (2026-10-02).
      enum: ['partType', 'deviceType', 'brand', 'series', 'model', 'level5', 'level6'],
      required: true,
      index: true,
    },
    /**
     * Which catalogue category's tree this node belongs to (2026-10-01,
     * `shared/catalog.js`). Absent on every node written before categories
     * existed, and absent means Parts: `taxonomyService.categoryFilter` reads
     * it that way, so the Parts tree needed no migration.
     */
    category: { type: String, trim: true, index: true },
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Taxonomy', default: null, index: true },

    // Denormalised ancestor slugs so a product query never needs a graph lookup.
    path: {
      partType: String,
      deviceType: String,
      brand: String,
      series: String,
      model: String,
      level5: String,
      level6: String,
    },

    /**
     * The first-level values this entry is a row for (2026-10-02): `battery` on
     * iPhone 15 Pro means the category tree has a Battery › … › iPhone 15 Pro
     * row. Written when an entry is added under a first-level entry and when an
     * item is filed there, so every product line is one row of the tree table.
     */
    lines: { type: [String], default: undefined },

    icon: String, // lucide icon name, used by the wizard's option cards
    image: String,
    order: { type: Number, default: 0 },
    productCount: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false }, // surfaces in the mega menu

    /**
     * What else this node is called (ERP rework §6.15, phase 11d).
     *
     * **The valuable part of the taxonomy screen.** A business buyer types `15 PM`
     * or `iphone15pm`, not "iPhone 15 Pro Max", and a wholesale search box that
     * only matches the catalogue name is a search box that returns nothing for
     * the way its users actually type.
     *
     * Deliberately on the **model**, not on the product: one alias here covers
     * every SKU for that phone, where `Product.searchTerms` has to be repeated
     * on each of the forty parts that fit it - and drift on one of them is a
     * part that quietly stops being findable.
     *
     * Stored lowercase and trimmed by `normaliseAliases` in the service, so
     * matching never has to case-fold at query time.
     */
    aliases: { type: [String], default: [] },

    /**
     * Inactive hides a node from the storefront's filters without deleting it.
     *
     * Deleting a model orphans every product pointing at it; a discontinued
     * device needs to stop appearing in a picker while its parts stay
     * orderable. Defaults true so every existing node is active without a
     * migration.
     */
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

taxonomySchema.index({ kind: 1, parent: 1, order: 1 });
// Alias lookup drives the search box, so it is indexed rather than scanned.
taxonomySchema.index({ aliases: 1 });

const Taxonomy = mongoose.model('Taxonomy', taxonomySchema);

export { Taxonomy };
export default Taxonomy;
