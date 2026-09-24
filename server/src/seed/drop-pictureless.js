import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/Business.js';
import '../models/Product.js';
import '../models/Order.js';
import '../models/Offer.js';
import '../models/Cart.js';
import '../models/PurchaseOrder.js';
import '../models/StockMovement.js';
import '../models/Taxonomy.js';
import { HAS_PICTURE } from '../../../shared/partPhotos.js';

/**
 * Permanently deletes every product the catalogue cannot draw a picture for.
 *
 * **This is destructive and there is no undo.** Run `--dry-run` first; it is
 * the default posture of every example below for a reason.
 *
 * ## Why a product can be pictureless
 *
 * Cellvix has not shot the catalogue. What exists is one stock photo per
 * brand-and-component-type pair (`shared/partPhotos.js`), and a product is
 * listable only if it carries its own `image` or matches one of those pairs -
 * the clause is `HAS_PICTURE`, and `productService.buildQuery` has always
 * applied it. So these products were already invisible: absent from the grid,
 * from every facet count and from the taxonomy tree. This script makes the
 * database agree with what the storefront was already showing.
 *
 * ## What it does to the records that cite them
 *
 * Order and purchase-order lines **snapshot** `sku`, `name` and `unitPrice` at
 * the time they were written (see models/Order.js), and nothing populates
 * `items.product` on a read path. A past order therefore still renders exactly
 * as it did - the same part name, the same price, the same totals - and only
 * the dangling id stops resolving, which affects one thing: that product drops
 * out of the account dashboard's "buy again" row, where an inactive product
 * would have dropped out anyway.
 *
 * Carts and offers are different: a cart line or a combo member pointing at a
 * product that no longer exists is a thing somebody is about to try to BUY, so
 * those are cleaned up rather than left dangling.
 *
 * ## Taxonomy
 *
 * Nodes whose every product is deleted are removed too. A brand or model with
 * nothing under it is a filter that opens an empty grid, which is the dead end
 * the pruning in `taxonomyService` exists to prevent.
 */

/**
 * Dry run, from the flag OR the environment.
 *
 * `npm run drop:pictureless -- --dry-run` at the repo root does NOT deliver the
 * flag here: the root script delegates with `npm run ... --workspace server`,
 * and the inner npm swallows the argument rather than forwarding it. The first
 * run of this script was meant to be a dry run and deleted 304 products for
 * real because of exactly that.
 *
 * So the environment variable is the reliable switch and the flag is the
 * convenience one:
 *   DRY_RUN=1 npm run drop:pictureless
 *   node server/src/seed/drop-pictureless.js --dry-run
 */
const DRY_RUN =
  process.argv.includes('--dry-run') ||
  ['1', 'true', 'yes'].includes(String(process.env.DRY_RUN).toLowerCase());

async function dropPictureless({ dryRun = DRY_RUN } = {}) {
  const Product = db().Product;

  const doomed = await Product.find({ $nor: [HAS_PICTURE] })
    .select('_id sku deviceTypeSlug brandSlug seriesSlug modelSlug')
    .lean();

  if (doomed.length === 0) {
    console.log('  nothing to delete - every product has a picture');
    return { deleted: 0 };
  }

  const ids = doomed.map((product) => product._id);
  const skus = doomed.map((product) => product.sku);
  const kept = await Product.countDocuments({ $and: [HAS_PICTURE] });

  console.log(`  pictureless: ${doomed.length}   keeping: ${kept}`);

  if (dryRun) {
    const [orders, carts, offers, pos] = await Promise.all([
      db().Order.countDocuments({ 'items.product': { $in: ids } }),
      db().Cart.countDocuments({ 'items.product': { $in: ids } }),
      db().Offer.countDocuments({ 'items.sku': { $in: skus } }),
      db().PurchaseOrder.countDocuments({ 'items.product': { $in: ids } }),
    ]);
    console.log(
      `  would touch - orders: ${orders} (snapshots kept), carts: ${carts}, offers: ${offers}, purchase orders: ${pos} (snapshots kept)`,
    );
    console.log('  DRY RUN - nothing written');
    return { deleted: 0, wouldDelete: doomed.length };
  }

  // ---- carts: pull the lines, they are about to be bought ----------------
  const cartResult = await db().Cart.updateMany(
    { 'items.product': { $in: ids } },
    { $pull: { items: { product: { $in: ids } } } },
  );

  // ---- offers: a combo missing a member cannot be sold -------------------
  // Deactivated rather than deleted: an offer is editorial content somebody
  // wrote, and an admin should decide whether to rebuild it from parts that
  // still exist or drop it. `offerService` already refuses to sell a combo
  // whose members are gone, so this only stops it being advertised.
  const offerResult = await db().Offer.updateMany(
    { 'items.sku': { $in: skus } },
    { $set: { isActive: false, isFeatured: false } },
  );

  // ---- stock movements: ledger rows for stock that no longer exists ------
  const movementResult = await db().StockMovement.deleteMany({ product: { $in: ids } });

  // ---- the products -----------------------------------------------------
  const productResult = await Product.deleteMany({ _id: { $in: ids } });

  // ---- taxonomy: drop nodes nothing lives under any more -----------------
  const survivors = await Product.find({}).select('deviceTypeSlug brandSlug seriesSlug modelSlug').lean();
  const live = new Set();
  for (const product of survivors) {
    for (const slug of [
      product.deviceTypeSlug,
      product.brandSlug,
      product.seriesSlug,
      product.modelSlug,
    ]) {
      if (slug) live.add(slug);
    }
  }

  const taxonomyResult = await db().Taxonomy.deleteMany({ slug: { $nin: [...live] } });

  console.log(`  deleted products:        ${productResult.deletedCount}`);
  console.log(`  deleted stock movements: ${movementResult.deletedCount}`);
  console.log(`  deleted taxonomy nodes:  ${taxonomyResult.deletedCount}`);
  console.log(`  carts cleaned:           ${cartResult.modifiedCount}`);
  console.log(`  offers deactivated:      ${offerResult.modifiedCount}`);

  return { deleted: productResult.deletedCount };
}

// CLI: `npm run drop:pictureless [-- --dry-run]`
if (process.argv[1] && process.argv[1].endsWith('drop-pictureless.js')) {
  (async () => {
    console.log(
      `\n  Removing pictureless products${DRY_RUN ? ' (DRY RUN)' : ''}…\n`,
    );
    await connectDb();

    const businesses = await db().Business.find({ deletedAt: null }).select('name code').lean();
    if (!businesses.length) throw new Error('No businesses found.');

    for (const business of businesses) {
      console.log(`  ${business.name} (${business.code})`);
      await runInBusiness(
        {
          businessId: String(business._id),
          code: business.code,
          connection: dbFor(business.code),
        },
        () => dropPictureless(),
      );
    }

    console.log('\n  Done.\n');
    await disconnectDb();
    await mongoose.connection.close();
    process.exit(0);
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { dropPictureless };
