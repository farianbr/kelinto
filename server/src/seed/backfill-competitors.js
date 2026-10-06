import { connectDb, disconnectDb } from '../config/db.js';
import Product from '../models/Product.js';
import { buildCompetitors } from './generate.js';

/**
 * Backfills the `competitors` benchmark prices onto products that predate the
 * field (PROGRESS.md, Session 23).
 *
 * `npm run seed` would do it, but it wipes the whole database - the wrong tool
 * once there are real accounts, orders and carts in there. This touches ONE
 * field on ONE collection and nothing else, the same way `seed:demo -- content` is the
 * safe tool for the editorial collections.
 *
 * Safe to re-run: by default it skips products that already carry benchmarks,
 * so it only ever fills gaps. `--force` recomputes every product, which is what
 * you want after changing the generator itself.
 *
 * Deterministic: the benchmarks are seeded from the product's SKU, so the same
 * catalogue produces the same numbers on every run and a re-run does not
 * quietly reprice the store.
 *
 *   npm run backfill -- competitors
 *   npm run backfill -- competitors -- --force
 */
async function backfillCompetitors({ force = false, quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  const query = force ? {} : { $or: [{ competitors: { $size: 0 } }, { competitors: { $exists: false } }] };
  const products = await Product.find(query).select('_id sku price competitors').lean();

  if (products.length === 0) {
    log('  every product already carries benchmarks - nothing to do.');
    return { matched: 0, updated: 0 };
  }

  const operations = products
    // A product with no price cannot be benchmarked against one. Skipped rather
    // than given a zeroed row, which would render as a nonsense comparison.
    .filter((product) => Number.isFinite(product.price) && product.price > 0)
    .map((product) => ({
      updateOne: {
        filter: { _id: product._id },
        update: { $set: { competitors: buildCompetitors(product.price, product.sku) } },
      },
    }));

  if (operations.length === 0) {
    log(`  ${products.length} product(s) matched but none had a usable price.`);
    return { matched: products.length, updated: 0 };
  }

  const result = await Product.bulkWrite(operations);
  const updated = result.modifiedCount ?? operations.length;

  log(`  products matched: ${products.length}`);
  log(`  benchmarks written: ${updated}`);

  return { matched: products.length, updated };
}

// Only runs the connect/disconnect wrapper when invoked directly, so the
// function above stays importable from a test or another script.
if (process.argv[1] && process.argv[1].endsWith('backfill-competitors.js')) {
  (async () => {
    const force = process.argv.includes('--force');

    await connectDb();
    console.log(`\n  Backfilling competitor benchmarks${force ? ' (--force: recomputing all)' : ''}\n`);

    try {
      await backfillCompetitors({ force });
      console.log('\n  Done. Nothing else in the database was touched.\n');
    } finally {
      await disconnectDb();
    }
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { backfillCompetitors };
