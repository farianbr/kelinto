import storage from '../services/storageService.js';
import { controlModels } from '../db/models.js';
// Registered here because this can run on its own: `controlModels()` binds a
// model from the schema its file registers, and outside the API nothing else
// has imported these.
import '../models/PlatformSettings.js';
import '../models/PendingUpload.js';
import '../models/SuperAdmin.js';
import '../models/Plan.js';

/**
 * Kelinto, not "platform", wherever somebody can read it (2026-09-27).
 *
 * The company is Kelinto, and three things still said "platform" to the people
 * looking at them:
 *
 * - **Kelinto's own files in R2** sat under `platform/`, visible to anybody
 *   browsing the bucket. They move to `kelinto/`, and the console's Brand
 *   settings are repointed at the new keys. `storageService` still reads a
 *   `platform/` key, so an installation that has not run this keeps working.
 * - **The seeded super admin** was named "Platform Operator" / "Platform Staff
 *   member", which is what the console's rail prints at its foot.
 * - **The top plan** was called "Platform". It is "Unlimited" now, which is
 *   what its description already said it was.
 *
 * Idempotent: each step matches only what still carries the old word, so a
 * second run finds nothing. A name or plan an operator has since changed by
 * hand is not "Platform" any more and is left alone.
 */
async function backfillKelintoNaming({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const { PlatformSettings, PendingUpload, SuperAdmin, Plan } = controlModels();

  // ---- R2: platform/ -> kelinto/ ---------------------------------------------

  const settings = await PlatformSettings.load();
  const next = {};
  for (const field of ['logoUrl', 'faviconUrl']) {
    const key = storage.keyOf(settings[field]);
    if (!key?.startsWith('platform/')) continue;
    if (!storage.isConfigured()) {
      log(`  ${field}: ${key} is under platform/, but R2 is not configured here - skipped`);
      continue;
    }
    next[field] = await storage.moveKey(key, `kelinto/${key.slice('platform/'.length)}`);
    log(`  ${field}: ${key} -> ${next[field]}`);
  }
  if (Object.keys(next).length) {
    await PlatformSettings.updateOne({ key: 'singleton' }, { $set: next });
  } else {
    log('  brand files: nothing under platform/');
  }

  // An upload still pending under the old owner is swept by key either way;
  // renaming the owner lets a discard from the console find it too.
  const pending = await PendingUpload.updateMany({ owner: 'platform' }, { $set: { owner: storage.KELINTO } });
  if (pending.modifiedCount) log(`  pending uploads: ${pending.modifiedCount} reassigned to kelinto`);

  // ---- names people read -----------------------------------------------------

  const admins = await SuperAdmin.find({ name: /^Platform\b/ }).select('name');
  for (const admin of admins) {
    const renamed = admin.name.replace(/^Platform\b/, 'Kelinto');
    log(`  super admin: "${admin.name}" -> "${renamed}"`);
    admin.name = renamed;
    await admin.save();
  }
  if (!admins.length) log('  super admins: none named "Platform ..."');

  const plan = await Plan.findOne({ slug: 'platform', name: 'Platform' });
  if (plan) {
    const clash = await Plan.exists({ slug: 'unlimited' });
    plan.name = 'Unlimited';
    if (!clash) plan.slug = 'unlimited';
    await plan.save();
    log(`  plan: "Platform" -> "Unlimited"`);
  } else {
    log('  plans: none named "Platform"');
  }
}

export { backfillKelintoNaming };
export default backfillKelintoNaming;
