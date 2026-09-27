import mongoose from 'mongoose';

/**
 * Provider credentials, encrypted at rest (ERP rework §6.15, phase 11c).
 *
 * **Its own collection, deliberately not a field on `Settings`.** `Settings` is
 * read on ordinary paths - pricing reads it for shipping bands, invoices read
 * it for the tax rate - and every one of those reads would then be carrying
 * ciphertext around a codebase where a stray `res.json(settings)` is one typo
 * away from publishing it. Keeping secrets in a separate collection that
 * nothing else joins to means the only code holding a secret is the code that
 * asked for one.
 *
 * §6.15's rule is absolute: the API is **write-only** for these values. The
 * server stores `value` encrypted, returns `preview` and `configured`, and
 * never returns `value` to a client - not to an admin, not masked-then-revealed.
 * `toPublic()` below is the only serializer, and it cannot emit the ciphertext
 * because it never reads that field.
 */

/**
 * The credentials this system knows about, and what each one unblocks.
 *
 * A closed list rather than free-form keys: the API Keys screen renders cards
 * from it, `marketingService` reads it to decide whether a channel can send,
 * and an arbitrary key nobody reads would be a field that looks configured and
 * changes nothing.
 */
const PROVIDER_FIELDS = [
  {
    provider: 'twilio',
    label: 'SMS (Twilio)',
    description: 'Sends the SMS channel live. Until this is set, messages are saved to history and never sent.',
    unblocks: 'sms',
    fields: [
      { key: 'accountSid', label: 'Account SID', hint: 'Starts with AC.' },
      { key: 'authToken', label: 'Auth token', secret: true },
      { key: 'fromNumber', label: 'From number', hint: 'E.164 - +14165550100.' },
    ],
  },
  {
    provider: 'whatsapp',
    label: 'WhatsApp Business API',
    description: 'Sends the WhatsApp channel live. Until this is set, messages are saved to history and never sent.',
    unblocks: 'whatsapp',
    fields: [
      { key: 'token', label: 'Access token', secret: true },
      { key: 'phoneNumberId', label: 'Phone number ID' },
    ],
  },
  {
    provider: 'google',
    label: 'Google Maps & Places',
    description: 'Address autocomplete on client and business forms.',
    unblocks: null,
    fields: [{ key: 'apiKey', label: 'API key', secret: true }],
  },
  {
    provider: 'email',
    label: 'Email provider',
    description:
      'An SMTP transport. Nothing can be emailed without one - invoices, welcome mail and campaigns all record a failure instead of sending.',
    unblocks: null,
    fields: [
      { key: 'smtpUrl', label: 'SMTP URL', secret: true, hint: 'smtp://user:pass@host:587' },
      { key: 'fromAddress', label: 'From address' },
    ],
  },
  {
    provider: 'payment',
    label: 'Payment gateway',
    description:
      'Kelinto ships with a mock gateway that approves every charge unless a PO number starts with DECLINE. Real keys replace it.',
    unblocks: null,
    fields: [
      { key: 'publishableKey', label: 'Publishable key' },
      { key: 'secretKey', label: 'Secret key', secret: true },
    ],
  },
];

/** Quick lookup, so callers do not re-scan the array. */
const PROVIDER_BY_KEY = new Map(PROVIDER_FIELDS.map((entry) => [entry.provider, entry]));

const providerCredentialSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true, index: true },
    field: { type: String, required: true },

    /**
     * The encrypted value - `v1:iv:tag:ciphertext` from `utils/secrets.js`.
     *
     * `select: false`, so a query has to ask for it **by name**. Every ordinary
     * `find` comes back without it, which makes accidentally serializing a
     * secret take a deliberate `.select('+value')` rather than a forgotten
     * `delete` on a response object.
     */
    value: { type: String, required: true, select: false },

    /** `••••••••abcd` - safe to return, and enough to tell two keys apart. */
    preview: { type: String, default: '' },

    // Who set it and when. Never what they set - §6.15 is explicit that the
    // value is not audit-logged, only the fact of the write.
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// One row per provider field. The upsert in `accessService` keys on this, so a
// double-submit replaces rather than duplicating.
providerCredentialSchema.index({ provider: 1, field: 1 }, { unique: true });

/**
 * The only serializer. **Cannot leak the value, because it never reads it**
 * `value` is `select: false`, so on an ordinary query it is not even loaded.
 */
providerCredentialSchema.methods.toPublic = function toPublic() {
  return {
    provider: this.provider,
    field: this.field,
    preview: this.preview,
    configured: true,
    updatedAt: this.updatedAt,
  };
};

const ProviderCredential = mongoose.model('ProviderCredential', providerCredentialSchema);

export { PROVIDER_FIELDS, PROVIDER_BY_KEY, ProviderCredential };
export default ProviderCredential;
