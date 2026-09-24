import bcrypt from 'bcryptjs';

import { connectDb, disconnectDb } from '../config/db.js';
import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/Supplier.js';
import '../models/Product.js';
import '../models/PurchaseOrder.js';
import * as purchaseBidService from '../services/purchaseBidService.js';
import { backfillSupplierAccounts } from '../services/supplierPortalService.js';
import { SUPPLIER_COMPONENT_TYPES, buildBidOrders } from './purchase-bids.data.js';

/**
 * Demo data for supplier bidding (§6.8a) - tags, portal logins and a set of
 * purchase orders across every state.
 *
 * Was `seed:rfqs` until 2026-09-11, when requests for quote folded into the
 * purchase order.
 *
 * **Additive, like `seed:quotes` and `seed:content` - it never wipes.**
 * `npm run seed` rebuilds the whole database, which is the wrong tool for
 * "give me some orders to look at" on an instance that already holds suppliers
 * and purchase orders somebody is using. This tags what is there and adds rows.
 *
 * Three things it does, in order, and each is separately re-runnable:
 *
 *   1. **Tags suppliers with component types.** Without this the supplier
 *      picker is empty and the feature reads as broken rather than unused. Only
 *      suppliers with **no tags at all** are touched - one somebody has already
 *      tagged by hand keeps their answer.
 *   2. **Gives each active supplier portal credentials**, so the portal can
 *      actually be signed into. The password is the shared demo one, and this
 *      is the one place in the codebase that writes a known password to a
 *      supplier - see the note on `DEMO_PASSWORD` below.
 *   3. **Adds purchase orders with bids**, numbering on from whatever is
 *      already there so a second run cannot collide on `poNumber`'s unique
 *      index.
 *
 * The confirmed order is confirmed **through `purchaseBidService.confirmSupplier`**,
 * not by writing a `confirmed` document directly. That is the whole point: the
 * priced order is then produced by the same code path a staff member's click goes
 * through, and it cannot drift from what the running system would have created.
 */

/**
 * The same password as the demo buyer and admin accounts (`seed/run.js`).
 *
 * **This is demo data, and the password is public in the repo.** That is
 * acceptable here for exactly the reason it is acceptable for
 * `buyer@cellvix.ca` - every one of these suppliers is fictional, their
 * addresses are `.example`, and the whole database is dummy data. It must never
 * become the way a real supplier is onboarded: that path is the admin's
 * **Send portal link** button, which mints a random password through
 * `supplierPortalService.invitePortal` and emails it.
 */
const DEMO_PASSWORD = 'Cellvix123!';

async function seedPurchaseBids({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  const [suppliers, products] = await Promise.all([
    db().Supplier.find({}).select('_id code name email isActive componentTypes passwordHash').lean(),
    db().Product.find({ isActive: true }).select('_id sku name price grade partType').lean(),
  ]);

  if (!suppliers.length) {
    throw new Error(
      'No suppliers to tag. A purchase order is put TO somebody - run `npm run seed` first.',
    );
  }
  if (!products.length) {
    throw new Error('No active products to order. Seed the catalogue first.');
  }

  // ---- 1. component-type tags ----------------------------------------------

  let tagged = 0;
  for (const supplier of suppliers) {
    const tags = SUPPLIER_COMPONENT_TYPES[supplier.code];
    if (!tags) continue;
    // Already tagged - by hand or by an earlier run. Somebody's answer is not
    // ours to overwrite.
    if (supplier.componentTypes?.length) continue;

    await db().Supplier.updateOne({ _id: supplier._id }, { componentTypes: tags });
    tagged += 1;
  }
  log(`  tagged ${tagged} supplier(s) with component types`);

  // ---- 2. portal credentials ------------------------------------------------

  // Hashed once rather than per supplier: bcrypt at cost 10 is deliberately
  // slow, and five identical hashes is five times the wait for no benefit in
  // seed data whose password is public anyway.
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  let credentialed = 0;
  for (const supplier of suppliers) {
    // Inactive suppliers get no login, exactly as `invitePortal` refuses them:
    // deactivating a supplier is how the purchasing team ends a relationship,
    // and it has to close the door as well.
    if (!supplier.isActive || !supplier.email) continue;
    if (supplier.passwordHash) continue; // already has a login

    await db().Supplier.updateOne({ _id: supplier._id }, { passwordHash, portalInviteAt: new Date() });
    credentialed += 1;
  }
  log(`  gave ${credentialed} supplier(s) portal access (password: ${DEMO_PASSWORD})`);

  // ---- 3. the orders --------------------------------------------------------

  const fresh = await db().Supplier.find({}).select('_id code name email').lean();
  const suppliersByCode = new Map(fresh.filter((s) => s.code).map((s) => [s.code, s]));

  // Continue the sequence rather than restarting it, so a second run does not
  // collide on `poNumber`'s unique index - the rule `seed:quotes` follows.
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  const last = await db().PurchaseOrder.findOne({ poNumber: new RegExp(`^${prefix}`) })
    .sort({ poNumber: -1 })
    .select('poNumber')
    .lean();
  const startAt = last ? Number(last.poNumber.slice(prefix.length)) + 1 : 1;

  const built = buildBidOrders({ products, suppliersByCode, year, startAt });
  if (!built.length) {
    throw new Error(
      'No order could be built - the catalogue has none of the component types the plans cover.',
    );
  }

  const inserted = await db().PurchaseOrder.insertMany(built.map((row) => row.doc));
  log(
    `  added ${inserted.length} purchase orders (${inserted[0].poNumber} … ${inserted.at(-1).poNumber})`,
  );

  // ---- the confirmation, through the real service ---------------------------

  let confirmedNumber = null;
  const confirmPlan = built.find((row) => row.plan.confirmWith);
  if (confirmPlan) {
    const doc = inserted.find((row) => row.poNumber === confirmPlan.doc.poNumber);
    const winnerId = suppliersByCode.get(confirmPlan.plan.confirmWith)?._id;
    const winner = doc.bids.find((bid) => String(bid.supplier) === String(winnerId));

    if (winner) {
      /**
       * Confirmed by calling the service, not by writing `status: 'confirmed'`.
       *
       * This is what makes the demo honest: the priced order on
       * `/admin/purchase-orders` came out of the same function a staff member's
       * click calls, carrying the winner's quoted unit costs, with the losers
       * marked `lost` and the supplier's spend totals recomputed. A
       * hand-written confirmed document would look identical on screen and
       * prove nothing about the path.
       */
      const result = await purchaseBidService.confirmSupplier(doc._id, {
        supplierId: String(winner.supplier),
      });
      confirmedNumber = result.po.poNumber;
      log(`  confirmed ${doc.poNumber} with ${winner.supplierName}`);
    }
  }

  return {
    tagged,
    credentialed,
    orders: inserted.length,
    confirmed: confirmedNumber,
  };
}

/**
 * Seed each business inside its own database.
 *
 * **Without this the script wrote nowhere.** Under database-per-business a
 * model resolves through `currentConnection()`, which is null outside a
 * request - so `db().Supplier` read the control database, found no suppliers
 * and stopped with "run `npm run seed` first" on an instance that had six of
 * them. `run.js` already opens the context this way; a standalone seed has to
 * do the same, since there is no middleware to do it for them.
 */
async function run() {
  await connectDb();

  const businesses = await db().Business.find({ deletedAt: null }).select('name code').lean();
  if (!businesses.length) {
    throw new Error('No businesses found. Run `npm run seed` first.');
  }

  for (const business of businesses) {
    console.log(`\nSeeding supplier bidding demo data - ${business.name} (${business.code})`);

    await runInBusiness(
      {
        businessId: String(business._id),
        code: business.code,
        connection: dbFor(business.code),
      },
      async () => {
        // Suppliers and stock live per business, so a business without both is
        // skipped rather than failing the whole run - CellShoppe is a service
        // business with no parts catalogue and no parts suppliers of its own,
        // and an order for nothing, put to nobody, is not demo data worth
        // making.
        const [suppliers, products] = await Promise.all([
          db().Supplier.countDocuments({}),
          db().Product.countDocuments({ isActive: true }),
        ]);
        if (!suppliers || !products) {
          console.log(
            `  skipped - ${!suppliers ? 'no suppliers' : 'no products'} in this business`,
          );
          return;
        }

        await seedPurchaseBids();

        const counts = await db().PurchaseOrder.aggregate([
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]);
        console.log(`  by status: ${counts.map((row) => `${row._id} ${row.count}`).join(' · ')}`);
        console.log(`  purchase orders now: ${await db().PurchaseOrder.countDocuments({})}`);

        const withPi = await db().PurchaseOrder.countDocuments({
          'bids.proforma.number': { $exists: true },
        });
        console.log(`  orders carrying a proforma: ${withPi}`);

        const logins = await db()
          .Supplier.find({ isActive: true, passwordHash: { $exists: true } })
          .select('name email')
          .lean();
        for (const supplier of logins) {
          console.log(`    ${supplier.email} - ${supplier.name}`);
        }
      },
    );
  }

  /**
   * The logins above are written onto each business's `Supplier` record, where
   * they used to live. Sign-in now reads the platform-wide `SupplierAccount`,
   * so lift them into accounts here - otherwise a fresh seed hands out demo
   * logins that do not work until somebody remembers the backfill.
   */
  await backfillSupplierAccounts({ quiet: true });

  console.log(`\nSupplier portal: http://localhost:5173/supplier`);
  console.log(`  password for all of them: ${DEMO_PASSWORD}\n`);

  await disconnectDb();
}

// Only run when invoked directly, so `run.js` can import `seedPurchaseBids`
// without the CLI wrapper firing - the pattern `expense-categories.js` uses.
if (process.argv[1] && process.argv[1].endsWith('purchase-bids.js')) {
  run().catch(async (error) => {
    console.error(`Seeding supplier bids failed: ${error.message}`);
    await disconnectDb().catch(() => {});
    process.exit(1);
  });
}

export { seedPurchaseBids, DEMO_PASSWORD };
