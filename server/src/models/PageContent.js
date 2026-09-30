import mongoose from 'mongoose';

import { authorModelShape } from '../../../shared/author.js';
import { PAGE_KEYS } from '../../../shared/websitePages.js';

/**
 * What one website PAGE carries beyond its own content: the article written for
 * it and which of the standard sections it shows (`shared/websitePages.js`).
 *
 * The page's FAQ is not here. It lives in `Faq` with `scope: 'page'`, beside the
 * general and product ones, so there is one question-and-answer model and one
 * editor vocabulary rather than a second list embedded on this record.
 *
 * ONE PER PAGE, by the unique index on `page`. There is no create path: the ERP
 * opens a page from the registry and saving upserts, the same shape as
 * `ProductArticle`, whose editor this one shares.
 *
 * NO `business` field, for the same reason `ProductArticle` has none: the record
 * lives in its business's own database.
 */
const pageContentSchema = new mongoose.Schema(
  {
    page: { type: String, enum: PAGE_KEYS, required: true, unique: true, index: true },

    // The article. Both empty means the page has none, which is the normal state
    // for a page nobody has written for yet; the section then simply does not
    // render. Plain text in `lib/richText.jsx`'s vocabulary, never HTML.
    heading: { type: String, trim: true, maxlength: 140, default: '' },
    body: { type: String, default: '' },
    author: { ...authorModelShape(), name: { type: String, trim: true, maxlength: 80 } },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    publishedAt: { type: Date },
    readMinutes: { type: Number, default: 1 },

    /**
     * Sections the owner switched OFF on this page. A list of what is hidden
     * rather than of what is shown, so a section added to the registry later
     * appears on every page by default instead of on none of them.
     */
    hiddenSections: { type: [String], default: () => [] },
  },
  { timestamps: true },
);

const PageContent = mongoose.model('PageContent', pageContentSchema);

export { PageContent };
export default PageContent;
