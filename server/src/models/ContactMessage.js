import mongoose from 'mongoose';

/**
 * Contact form submissions.
 *
 * These are stored rather than emailed because no mail provider is wired yet
 * (PROGRESS.md open question #7). Persisting them means a message sent today is
 * still there when the provider lands - a form that silently discards what
 * someone typed is worse than no form.
 */
const contactMessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    business: String,
    email: { type: String, required: true, lowercase: true, index: true },
    phone: String,
    topic: {
      type: String,
      // `quote` (2026-09-30): the "Get a quote" button on every website page.
      // `membership` (2026-10-01): "Subscribe" on the Membership page.
      enum: ['quote', 'account', 'order', 'stock', 'warranty', 'membership', 'other'],
      default: 'other',
      index: true,
    },
    orderNumber: String,
    message: { type: String, required: true },

    // Set when a signed-in user submits, so support can see the account context.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    status: { type: String, enum: ['new', 'read', 'closed'], default: 'new', index: true },
  },
  { timestamps: true },
);

contactMessageSchema.index({ createdAt: -1 });

const ContactMessage = mongoose.model('ContactMessage', contactMessageSchema);

export { ContactMessage };
export default ContactMessage;
