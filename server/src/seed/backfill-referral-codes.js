import { connectDb, disconnectDb } from '../config/db.js';
import { controlModels, db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/User.js';
import { ensureReferralCode } from '../services/referralService.js';

/**
 * Mints referral codes for approved customers that never got one.
 *
 * ## What went wrong
 *
 * A code is minted on approval - `approveUser` and `setUserStatus` both call
 * `ensureReferralCode`, and the Cellvix seed loop does the same for accounts it
 * creates already approved. The CellShoppe loop did not, so all eight of its
 * customers read "Not issued" on a panel whose entire subject is the code.
 *
 * The seed is fixed, but re-seeding wipes the database and nobody should have to
 * do that to repair a missing field. This walks every business and fills the gap
 * in place.
 *
 * ## Safety
 *
 * **Approved accounts only, and never an existing code.** `ensureReferralCode`
 * returns early when one is already set, so a second run is a no-op; and a
 * pending account is skipped deliberately, because an account that cannot order
 * cannot refer - minting one here would be inventing a rule the product does not
 * have.
 */

async function backfillReferralCodes({ quiet = false, dryRun = false } = {}) {
  const log = (...args) => {
    if (!quiet) console.log(...args);
  };

  const businesses = await controlModels().Business.find({ deletedAt: null }).select('code name').lean();
  if (businesses.length === 0) {
    log('No businesses exist - nothing to do.');
    return { minted: 0 };
  }

  let minted = 0;

  for (const business of businesses) {
    await runInBusiness(
      { businessId: business._id, code: business.code, connection: dbFor(business.code) },
      async () => {
        const pending = await db().User.find({
          role: 'buyer',
          status: 'approved',
          $or: [{ referralCode: null }, { referralCode: '' }, { referralCode: { $exists: false } }],
        });

        if (pending.length === 0) {
          log(`  ${business.code} ${business.name}: nothing to do`);
          return;
        }

        log(`  ${business.code} ${business.name}: ${pending.length} without a code`);

        for (const user of pending) {
          if (dryRun) {
            log(`    ${user.contactName ?? user.email}: would mint`);
            minted += 1;
            continue;
          }

          // Sequential, not parallel: `ensureReferralCode` checks the code it
          // built is not taken, and two of these running at once against the
          // same name pair could both pass that check and then collide on the
          // unique index.
          // eslint-disable-next-line no-await-in-loop
          const code = await ensureReferralCode(user);
          // eslint-disable-next-line no-await-in-loop
          await user.save();
          log(`    ${user.contactName ?? user.email}: ${code}`);
          minted += 1;
        }
      },
    );
  }

  log(`\n${dryRun ? 'Would mint' : 'Minted'} ${minted} referral code(s).`);
  return { minted };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await connectDb();
  try {
    await backfillReferralCodes({ dryRun });
  } finally {
    await disconnectDb();
  }
}

// Run only when invoked directly, so the function can also be imported.
if (process.argv[1]?.endsWith('backfill-referral-codes.js')) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { backfillReferralCodes };
export default backfillReferralCodes;
