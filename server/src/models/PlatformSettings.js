import mongoose from 'mongoose';

/**
 * Kelinto's own identity, set in the console (control plane, one document).
 *
 * The platform's logo and favicon are Kelinto's files, not any business's, so
 * they live beside tenants and plans rather than in a business database, and
 * their files sit under `platform/` in R2 (`storageService`). Empty means the
 * built-in wordmark and the bundled placeholder icon.
 */
const platformSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'singleton', unique: true },
    logoUrl: { type: String, default: '' },
    faviconUrl: { type: String, default: '' },
  },
  { timestamps: true },
);

platformSettingsSchema.statics.load = async function load() {
  return this.findOneAndUpdate(
    { key: 'singleton' },
    { $setOnInsert: { key: 'singleton' } },
    { upsert: true, new: true, lean: true },
  );
};

const PlatformSettings = mongoose.model('PlatformSettings', platformSettingsSchema);

export { PlatformSettings };
export default PlatformSettings;
