import mongoose from 'mongoose';

import { connectDb, disconnectDb } from '../config/db.js';
import { backfillBusiness } from './backfill-business.js';
import { backfillInvoiceBusiness } from './backfill-invoice-business.js';
import { backfillInvoiceKind } from './backfill-invoice-kind.js';
import { backfillLineage } from './backfill-lineage.js';
import { backfillReferralCodes } from './backfill-referral-codes.js';
import { backfillCellvixFeatures } from './backfill-cellvix-features.js';
import { backfillCompetitors } from './backfill-competitors.js';
import { backfillLoginDirectory } from '../services/loginDirectory.js';
import { backfillSupplierLogins } from '../services/supplierPortalService.js';

/**
 * One door onto the seven one-off migrations.
 *
 * ## Why these are one command now
 *
 * Each of these fixes a specific schema change that has already shipped: a
 * field was added, and the rows written before it have to be filled in. They
 * are **not** seeds - a seed makes demo data and is run because you want more
 * of it, whereas these are run once because the code moved underneath the
 * data. Seven npm scripts that each run once, and that nobody can tell apart
 * from the eighteen `seed:*` entries beside them, is a list nobody reads: the
 * question "which of these do I need after a restore" had no answer short of
 * opening all seven files.
 *
 * So: `npm run backfill` reports what each one would do, and
 * `npm run backfill -- <name>` runs one. The individual scripts keep working
 * and keep their own docstrings, which are the real record of what each change
 * was and why - this only replaces the seven entry points, not the reasoning.
 *
 * ## Every one of these is idempotent
 *
 * They all match on "the field is missing" and write only those rows, so
 * running one twice is a no-op the second time. That is what makes a dispatcher
 * safe: `--all` cannot compound, and a half-finished run is resumed by running
 * it again rather than by working out where it stopped.
 */
const TASKS = [
  {
    name: 'business',
    run: backfillBusiness,
    summary: 'Stamp `business` onto orders, tickets, quotes and returns that predate per-business scoping.',
  },
  {
    name: 'invoice-business',
    run: backfillInvoiceBusiness,
    summary: 'Stamp `business` onto invoices written without one.',
  },
  {
    name: 'invoice-kind',
    run: backfillInvoiceKind,
    summary: 'Stamp `kind` onto invoices that predate the tax-invoice / amount-due split.',
  },
  {
    name: 'lineage',
    run: backfillLineage,
    summary: 'Fill the backwards half of the quote → ticket → invoice chain.',
  },
  {
    name: 'referral-codes',
    run: backfillReferralCodes,
    summary: 'Mint referral codes for approved customers that never got one.',
  },
  {
    name: 'cellvix-features',
    run: backfillCellvixFeatures,
    summary: "Write the registry's overrides onto Cellvix's own business record.",
  },
  {
    name: 'competitors',
    run: backfillCompetitors,
    summary: 'Add competitor benchmark prices to products that predate the field.',
  },
  {
    name: 'login-directory',
    run: backfillLoginDirectory,
    summary: 'Index every panel account by email so the shared admin login can find its business.',
  },
  {
    name: 'supplier-logins',
    run: backfillSupplierLogins,
    summary: 'Move supplier portal logins from the retired platform-wide accounts onto each business’s own supplier record.',
  },
];

function usage() {
  console.log('\n  Backfills - one-off migrations for schema changes already shipped.\n');
  console.log('  Usage:');
  console.log('    npm run backfill -- <name>     run one');
  console.log('    npm run backfill -- --all      run every one, in order');
  console.log('    npm run backfill               this list\n');
  console.log('  Each is idempotent: running it twice does nothing the second time.\n');

  const width = Math.max(...TASKS.map((task) => task.name.length));
  for (const task of TASKS) {
    console.log(`    ${task.name.padEnd(width)}  ${task.summary}`);
  }
  console.log('');
}

if (process.argv[1] && process.argv[1].endsWith('backfill.js')) {
  (async () => {
    const args = process.argv.slice(2).filter((arg) => arg !== '--');

    if (!args.length) {
      usage();
      process.exit(0);
    }

    const all = args.includes('--all');
    const chosen = all ? TASKS : TASKS.filter((task) => args.includes(task.name));

    if (!chosen.length) {
      console.error(`\n  Unknown backfill: ${args.join(' ')}\n`);
      usage();
      process.exit(1);
    }

    await connectDb();

    for (const task of chosen) {
      console.log(`\n  ${task.name}`);
      // Each reports its own counts; this only says which one is running, so a
      // combined run can be read back afterwards.
      await task.run();
    }

    console.log(`\n  Done. ${chosen.length} backfill(s) run.\n`);
    await disconnectDb();
    await mongoose.connection.close();
    process.exit(0);
  })().catch((error) => {
    console.error('\n  Backfill failed:', error.message, '\n');
    process.exit(1);
  });
}

export { TASKS };
export default TASKS;
