import '../models/Business.js';
import '../models/LoginEntry.js';
import '../models/User.js';
import { controlModels, db } from '../db/models.js';
import { dbFor } from '../db/connections.js';
import { currentBusinessId, runInBusiness } from '../db/context.js';

/**
 * The login directory: which business database holds each panel account
 * (`models/LoginEntry.js`).
 *
 * ## Never the reason a write fails
 *
 * Every sync below logs and carries on rather than throwing. The account write
 * it follows has already happened, so a throw here would report a failure for a
 * staff member who was in fact created - and leave the caller no way to tell.
 * A missing entry is recoverable: that person cannot use the shared login until
 * `npm run backfill -- login-directory` runs, which is loud, specific and
 * harmless. A stale entry pointing at a deleted account is harmless too: login
 * opens that database, finds nobody, and moves on.
 */

/** The account types that sign in to the panel rather than the storefront. */
const PANEL_ROLES = ['staff', 'admin'];

function isPanelAccount(user) {
  return PANEL_ROLES.includes(user?.role);
}

/**
 * Record, update or drop one account's entry after it was written.
 *
 * `businessId` defaults to the request's own database, which is where every
 * route that creates or edits staff saved the account. Pass it explicitly from
 * a script, where there is no request.
 */
async function recordAccount(user, businessId = currentBusinessId()) {
  if (!user?._id) return;
  if (!businessId) {
    console.warn(`  Login directory: no business in context for ${user.email}, entry not written.`);
    return;
  }

  try {
    const { LoginEntry } = controlModels();
    if (isPanelAccount(user)) {
      await LoginEntry.updateOne(
        { business: businessId, user: user._id },
        { $set: { email: String(user.email).toLowerCase() } },
        { upsert: true },
      );
    } else {
      // Demoted to a customer account: it no longer signs in to the panel.
      await LoginEntry.deleteOne({ business: businessId, user: user._id });
    }
  } catch (error) {
    console.error(`  Login directory: could not record ${user.email} - ${error.message}`);
  }
}

/** Drop one account's entry after the account itself was deleted. */
async function forgetAccount(user, businessId = currentBusinessId()) {
  if (!user?._id || !businessId) return;
  try {
    await controlModels().LoginEntry.deleteOne({ business: businessId, user: user._id });
  } catch (error) {
    console.error(`  Login directory: could not forget ${user.email} - ${error.message}`);
  }
}

/**
 * Every live business an address has a panel account in.
 *
 * Deleted and missing businesses are dropped here, so login never opens a
 * database for a business the platform has retired. The order is stable -
 * by name - so a person who works at two businesses is offered them the same
 * way every time.
 */
async function businessesFor(email) {
  const { LoginEntry, Business } = controlModels();
  const entries = await LoginEntry.find({ email: String(email).toLowerCase() })
    .select('business')
    .lean();
  if (!entries.length) return [];

  return Business.find({
    _id: { $in: entries.map((entry) => entry.business) },
    deletedAt: null,
  })
    .select('name code')
    .sort({ name: 1 })
    .lean();
}

/**
 * Run `fn` with one business's database as the request's own.
 *
 * What a login found through the directory needs for the writes that follow it
 * - the session audit row, the last-login stamp - to land in the business the
 * account belongs to rather than the one the host happened to resolve.
 */
function inBusinessDb(business, fn) {
  return runInBusiness(
    { businessId: String(business._id), code: business.code, connection: dbFor(business.code) },
    fn,
  );
}

/**
 * Rebuild the directory from every business database.
 *
 * Idempotent: an entry is upserted for every panel account, and an entry whose
 * account no longer exists (or is no longer a panel account) is removed. Run it
 * once after deploying the shared login, and again any time the directory is
 * suspected of drifting.
 *
 *   npm run backfill -- login-directory
 */
async function backfillLoginDirectory({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const { LoginEntry, Business } = controlModels();

  const businesses = await Business.find({ deletedAt: null }).select('name code').lean();
  let recorded = 0;
  let removed = 0;

  for (const business of businesses) {
    await inBusinessDb(business, async () => {
      const accounts = await db()
        .User.find({ role: { $in: PANEL_ROLES } })
        .select('email role')
        .lean();

      for (const account of accounts) {
        await LoginEntry.updateOne(
          { business: business._id, user: account._id },
          { $set: { email: String(account.email).toLowerCase() } },
          { upsert: true },
        );
      }

      const keep = accounts.map((account) => account._id);
      const { deletedCount } = await LoginEntry.deleteMany({
        business: business._id,
        user: { $nin: keep },
      });

      recorded += accounts.length;
      removed += deletedCount ?? 0;
      log(`    ${business.name} (${business.code}): ${accounts.length} panel account(s)`);
    });
  }

  log(`    ${recorded} recorded, ${removed} stale entr${removed === 1 ? 'y' : 'ies'} removed.`);
  return { recorded, removed };
}

export {
  PANEL_ROLES,
  backfillLoginDirectory,
  businessesFor,
  forgetAccount,
  inBusinessDb,
  isPanelAccount,
  recordAccount,
};
