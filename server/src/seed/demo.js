import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * One door onto the additive demo seeds, in an order that works.
 *
 * ## The problem this solves
 *
 * There are sixteen `seed:*` scripts. Two of them depend on another having run
 * first - `sales-demo` reads the service catalogue, `invoice-history` reads
 * the manual statuses - and both fail softly with a line of output if it has
 * not, which is easy to miss in a terminal already sixteen commands deep.
 * Nothing recorded that order anywhere except those two skip messages, so
 * filling a fresh business meant knowing the graph or discovering it by
 * re-running things.
 *
 * `npm run seed:demo` runs the additive ones in dependency order.
 * `npm run seed:demo -- --list` prints what it would run without running it.
 *
 * ## What is deliberately NOT in here
 *
 * - **`seed`** wipes and regenerates the catalogue. A destructive script does
 *   not belong behind the same word as a set of additive ones.
 * - **`the one-off picture prune (removed 2026-10-06)`** deletes products.
 * - **`seed:reviews`** writes ~1,150 delivered orders and their invoices, so
 *   revenue and order counts move. It is genuinely useful and genuinely large,
 *   and something that changes the numbers on the dashboard should be asked for
 *   by name.
 * - **`seed:articles`** writes an SEO article on all 773 products.
 *
 * Each remains its own npm script, unchanged. This adds a way to run the safe
 * majority in the right order; it takes nothing away.
 *
 * ## Why child processes rather than importing the functions
 *
 * Every seed script owns its own connection lifecycle and calls
 * `process.exit()` when it finishes - reasonable for a CLI, fatal for a caller
 * that wanted to run six of them. Spawning keeps each one exactly as it is,
 * and a failure stops the run with the script's own message rather than a
 * stack trace from here.
 */
const STEPS = [
  {
    name: 'expense-categories',
    script: 'expense-categories.js',
    label: 'expense categories',
    why: 'The starter categories every expense is filed under.',
  },
  {
    name: 'invoice-labels',
    script: 'invoice-labels.js',
    label: 'invoice statuses',
    why: 'The manual statuses an admin sets. Service businesses only.',
  },
  {
    name: 'service-business',
    script: 'service-business.js',
    label: 'devices, services and parts',
    why: 'A repair shop\'s three lists. Service businesses only.',
  },
  {
    name: 'templates',
    script: 'templates.js',
    label: 'notification messages',
    why: 'What the shop says at each status, per channel.',
  },
  {
    name: 'content',
    script: 'content.js',
    label: 'blog, FAQ and offers',
    why: 'Storefront content. Safe on a database with real accounts.',
  },
  {
    name: 'storefront',
    script: 'storefront-pages.js',
    label: 'clearance and deals',
    why: 'Flags clearance products and upserts the exclusive deal.',
  },
  {
    name: 'phones',
    script: 'phones.js',
    label: 'pre-owned phones',
    why: 'One listed phone per photo in its own R2 library (businesses/<code>/library/phones). Skips photos already listed.',
  },
  {
    name: 'website',
    script: 'website-sections.js',
    label: 'website page sections',
    why: 'An article on each page, Google reviews and the rating. Never overwrites.',
  },
  {
    name: 'agreements',
    script: 'agreements.js',
    label: 'supplier agreements',
    why: 'The master agreement template and one demo signature.',
  },
  {
    name: 'web-quotes',
    script: 'quotes.js',
    label: 'web quotes',
    why: 'Seven demo web quotes across every status.',
  },
  {
    // After service-business: quotes, tickets and invoices are built from that
    // shop's own services, devices and parts, through the create-form services.
    name: 'sales',
    script: 'sales-demo.js',
    label: 'repair quotes, tickets and invoices',
    why: 'Built the way the create forms build them, so it runs after the service catalogue.',
  },
  {
    // After service-business too: it needs products to put on an order.
    name: 'bids',
    script: 'purchase-bids.js',
    label: 'purchase orders and bids',
    why: 'Needs suppliers and stock, so it runs after the parts shelf exists.',
  },
  {
    // After invoice-labels: it applies one of those statuses to each invoice.
    name: 'invoice-history',
    script: 'invoice-history.js',
    label: 'invoice history',
    why: 'Applies a manual status and one refund, so it runs after the statuses.',
  },
];

function list() {
  console.log('\n  seed:demo - the additive demo seeds, in dependency order.\n');
  console.log('  Usage:');
  console.log('    npm run seed:demo                   run them all, in order');
  console.log('    npm run seed:demo -- <name> [args]  run one, passing it its own flags');
  console.log('                                        (e.g. sales --reset, sales --dry-run)');
  console.log('    npm run seed:demo -- --list         this list, without running anything\n');

  const width = Math.max(...STEPS.map((step) => step.name.length));
  STEPS.forEach((step, index) => {
    console.log(`    ${String(index + 1).padStart(2)}. ${step.name.padEnd(width)}  ${step.why}`);
  });

  console.log('\n  Not included, and still their own scripts:');
  console.log('    seed            wipes and regenerates the catalogue');
  console.log('    seed:reviews    writes ~1,150 delivered orders; revenue moves');
  console.log('    seed:articles   an SEO article on every product');
  console.log('    backfill        the one-off migrations\n');
}

/** Run one step's script, handing it the flags meant for it. */
function run(step, args = []) {
  const result = spawnSync(process.execPath, [path.join(here, step.script), ...args], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\n  Stopped at ${step.name}. Nothing after it has run.\n`);
    process.exit(result.status ?? 1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('demo.js')) {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');

  if (args.includes('--list')) {
    list();
    process.exit(0);
  }

  /**
   * One step by name. This is what replaced a separate `seed:<thing>` npm
   * script per seed (2026-10-06): sixteen near-identical entries in two
   * package.json files was a list nobody could read, and each one only ever
   * ran a file this list already names.
   */
  if (args.length && !args[0].startsWith('-')) {
    const step = STEPS.find((entry) => entry.name === args[0]);
    if (!step) {
      console.error(`\n  Unknown demo seed: ${args[0]}\n`);
      list();
      process.exit(1);
    }
    console.log(`\n  ── ${step.label} ──`);
    run(step, args.slice(1));
    process.exit(0);
  }

  console.log(`\n  Running ${STEPS.length} demo seeds in order.\n`);
  for (const [index, step] of STEPS.entries()) {
    console.log(`\n  ── ${index + 1}/${STEPS.length}  ${step.label} ──`);
    run(step);
  }

  console.log('\n  Done. Every demo seed has run.\n');
  process.exit(0);
}

export { STEPS };
export default STEPS;
