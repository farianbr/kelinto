import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { controlModels, dbFor } from '../db/models.js';
import '../models/Business.js';
import '../models/LoginEntry.js';
import '../models/PendingUpload.js';
import { isConfigured, listKeys, purgePrefix } from '../services/storageService.js';

/**
 * Delete a business for good: its database, its files in R2, and every
 * control-plane record that names it.
 *
 *   npm run purge:business -- '#000001' --dry-run     what would go
 *   npm run purge:business -- '#000001'               delete it
 *
 * A console "delete" is soft (30-day retention, restorable). This is the step
 * after it, for a business that will never be restored: written for Cellvix
 * (2026-10-06, client: "fully deleted, we will onboard it later fully fresh").
 * A fresh onboarding then gets a NEW code (`nextBusinessCode` counts up from
 * the highest code left), so nothing of the old one can ever be picked up.
 *
 * **Refused** for the default business and for one not already soft-deleted:
 * purging has to be the second of two deliberate acts.
 *
 * What goes:
 *   - the business database (`<prefix>_biz_<code>`), dropped whole;
 *   - R2 `businesses/<code>/`, uploads and photo library alike;
 *   - control plane: its `Business` row, its login directory entries, its
 *     pending uploads, and the pre-rename `outlets` row with its code.
 * What stays: the tenant (it owns other businesses), and the console's
 * impersonation grants, which are evidence about operators and are meant to
 * outlive the business they record.
 */

async function purgeBusiness(code, { dryRun = false, log = console.log } = {}) {
  const { Business, LoginEntry, PendingUpload } = controlModels();
  const business = await Business.findOne({ code }).lean();
  if (!business) throw new Error(`No business with code ${code}.`);
  if (business.isDefault) throw new Error(`${business.name} is the default business; it cannot be purged.`);
  if (!business.deletedAt) {
    throw new Error(`${business.name} is not deleted. Delete it in the console first; purging is the step after.`);
  }

  const folder = `businesses/${String(code).replace(/^#/, '')}/`;
  const connection = dbFor(code);
  const dbName = connection.db?.databaseName ?? connection.name;
  const outlets = mongoose.connection.db.collection('outlets');

  const [files, logins, pending, legacyOutlets, collections] = await Promise.all([
    isConfigured() ? listKeys(folder) : Promise.resolve(null),
    LoginEntry.countDocuments({ business: business._id }),
    PendingUpload.countDocuments({ owner: code }),
    outlets.countDocuments({ code }),
    connection.db ? connection.db.listCollections().toArray() : Promise.resolve([]),
  ]);

  log(`\n  ${business.name} (${code}), deleted ${business.deletedAt.toISOString().slice(0, 10)}`);
  log(`    database      ${dbName} (${collections.length} collections)`);
  log(`    R2            ${folder} (${files === null ? 'R2 not configured, skipped' : `${files.length} files`})`);
  log(`    control       1 business, ${logins} login entries, ${pending} pending uploads, ${legacyOutlets} outlet rows`);

  if (dryRun) {
    log('\n  Dry run: nothing deleted.\n');
    return;
  }

  // Files first: once the records are gone nothing names this folder, and a
  // failure here should leave the business findable for a second attempt.
  const removed = files === null ? 0 : await purgePrefix(folder);
  await connection.dropDatabase();
  await Promise.all([
    LoginEntry.deleteMany({ business: business._id }),
    PendingUpload.deleteMany({ owner: code }),
    outlets.deleteMany({ code }),
  ]);
  await Business.deleteOne({ _id: business._id });

  log(`\n  Purged: ${removed} files, database ${dbName}, control records. Restart the API so it forgets the host.\n`);
}

if (process.argv[1] && process.argv[1].endsWith('purge-business.js')) {
  (async () => {
    const args = process.argv.slice(2).filter((arg) => arg !== '--');
    const code = args.find((arg) => !arg.startsWith('--'));
    if (!code) {
      console.log("\n  Usage: npm run purge:business -- '#000001' [--dry-run]\n");
      process.exit(1);
    }
    await connectDb();
    await purgeBusiness(code.startsWith('#') ? code : `#${code}`, { dryRun: args.includes('--dry-run') });
    await disconnectDb();
    await mongoose.connection.close();
    process.exit(0);
  })().catch((error) => {
    console.error(`\n  Purge failed: ${error.message}\n`);
    process.exit(1);
  });
}

export { purgeBusiness };
export default purgeBusiness;
