import mongoose from 'mongoose';

/**
 * One collection serves both the general FAQ page and the per-product FAQ
 * section. `scope` splits them; for product-scoped entries an empty `partType`
 * and `deviceTypeSlug` mean "applies to every product", which is what lets every
 * product detail page carry an FAQ without authoring one per SKU.
 */
const faqSchema = new mongoose.Schema(
  {
    question: { type: String, required: true },
    answer: { type: String, required: true },
    category: { type: String, default: 'ordering', index: true },
    // `page` (2026-09-30): a question written for one website page, shown in
    // that page's FAQ section and edited beside its article (ERP › SEO ›
    // Articles). `page` below names which, from `shared/websitePages.js`.
    scope: { type: String, enum: ['general', 'product', 'page'], default: 'general', index: true },
    page: { type: String, default: '', index: true },

    partType: { type: String, default: '', index: true },
    deviceTypeSlug: { type: String, default: '', index: true },

    order: { type: Number, default: 0 },
    isPublished: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

faqSchema.index({ scope: 1, isPublished: 1, order: 1 });
faqSchema.index({ scope: 1, page: 1, order: 1 });

const Faq = mongoose.model('Faq', faqSchema);

export { Faq };
export default Faq;
