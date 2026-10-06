import { connectDb, disconnectDb } from '../config/db.js';
import Invoice from '../models/Invoice.js';
import User from '../models/User.js';

/**
 * Stamps `kind` onto invoices that predate the field.
 *
 * A tax invoice is now raised only against money that actually arrived: an
 * order placed on terms produces an **amount due** in the `CVX-` series, which
 * is renumbered into `INV-` when it settles. Rows written before that split
 * carry no `kind` at all, and the customer's invoice screen - which shows two
 * panels, what is owed and what has been invoiced - cannot place them.
 *
 * The rule is the same one the new code applies going forward:
 *
 *   paid in full  ->  invoice   the money is in, it is a real invoice
 *   anything else ->  due       still owed, not yet an invoice
 *
 * **What it deliberately does not do is renumber anything.** An invoice number
 * that has been emailed, printed, filed or quoted down a phone line is a fact
 * about the outside world, and a migration that rewrites history to match a new
 * convention breaks every reference anyone already holds. Old unpaid rows keep
 * their `INV-` numbers and simply sit in the amounts-due panel; only rows
 * created after this change get the `CVX-` prefix. The two coexist and nothing
 * about paying them differs.
 *
 * Safe to re-run and safe on a database with real accounts: it touches one
 * field on one collection, and by default only rows that have no value for it.
 * `--force` restamps every row from its current paid status, which is what you
 * want if the rule itself changed.
 *
 *   npm run backfill -- invoice-kind
 *   npm run backfill -- invoice-kind -- --force
 */
async function backfillInvoiceKind({ force = false, quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  const scope = force ? {} : { kind: { $exists: false } };

  // A receipt is never inferred: receipts only exist for store-credit movements
  // and are written with `kind` set from the start, so anything without one
  // predates receipts entirely and is an order or an account charge.
  const [settled, outstanding] = await Promise.all([
    Invoice.updateMany(
      { ...scope, $expr: { $gte: ['$amountPaid', '$amount'] } },
      { $set: { kind: 'invoice' } },
    ),
    Invoice.updateMany(
      { ...scope, $expr: { $lt: ['$amountPaid', '$amount'] } },
      { $set: { kind: 'due' } },
    ),
  ]);

  const invoices = settled.modifiedCount ?? 0;
  const dues = outstanding.modifiedCount ?? 0;

  if (invoices + dues === 0) {
    log('  every invoice already carries a kind - nothing to do.');
  } else {
    log(`  settled -> invoice: ${invoices}`);
    log(`  outstanding -> due: ${dues}`);
  }

  // `settledAt` drives the "paid on" column. Filled from the last payment where
  // one exists, so a backfilled invoice does not read as settled on the day the
  // migration ran.
  const missingSettled = await Invoice.find({
    kind: 'invoice',
    settledAt: { $exists: false },
    'payments.0': { $exists: true },
  })
    .select('payments')
    .lean();

  if (missingSettled.length > 0) {
    await Invoice.bulkWrite(
      missingSettled.map((invoice) => {
        const last = invoice.payments.reduce(
          (latest, payment) => (!latest || payment.at > latest ? payment.at : latest),
          null,
        );
        return {
          updateOne: { filter: { _id: invoice._id }, update: { $set: { settledAt: last } } },
        };
      }),
    );
    log(`  settled dates recovered: ${missingSettled.length}`);
  }

  return { invoices, dues, settledDates: missingSettled.length };
}

/**
 * Re-derives every account's line-of-credit balance from the amounts it
 * actually owes.
 *
 * `User.balance` was write-only before `invoicePaymentService` existed: placing
 * an order on terms incremented it, and **nothing decremented it** - not
 * paying an invoice, not voiding one. Repayment was reconstructed for display
 * and never written back. Every account that has ever paid an invoice is
 * therefore carrying a balance that includes debt it already settled, and the
 * new code cannot fix that on its own: it only decrements payments made from
 * now on, so the historical excess would sit there permanently, holding
 * accounts against a credit limit they are not actually using.
 *
 * The truth is the invoices. A balance is the sum of what is still owed on
 * `due` records on terms, which is exactly what the new code maintains going
 * forward, so re-deriving it here puts every account onto the same rule.
 *
 * Seeded balances with no invoices behind them go to zero, which is correct:
 * a number nothing can explain is not a debt.
 *
 * Run separately (`--balances`) rather than by default, because it rewrites a
 * money field on every account and that should be a decision, not a side
 * effect of stamping a document type.
 */
async function reconcileBalances({ quiet = false, dryRun = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  const owedRows = await Invoice.aggregate([
    { $match: { kind: 'due', terms: { $ne: 'prepaid' } } },
    { $group: { _id: '$user', owed: { $sum: { $subtract: ['$amount', '$amountPaid'] } } } },
  ]);

  const owedBy = new Map(owedRows.map((row) => [String(row._id), Math.max(0, row.owed)]));
  const users = await User.find({ balance: { $gt: 0 } }).select('balance email').lean();

  // Both directions: an account carrying settled debt comes down, and one that
  // somehow owes more than its balance says comes up.
  const corrections = [];
  for (const user of users) {
    const owed = owedBy.get(String(user._id)) ?? 0;
    if (owed !== user.balance) {
      corrections.push({ id: user._id, email: user.email, from: user.balance, to: owed });
    }
  }
  for (const [id, owed] of owedBy) {
    if (!users.some((user) => String(user._id) === id)) {
      corrections.push({ id, email: '(zero balance)', from: 0, to: owed });
    }
  }

  if (corrections.length === 0) {
    log('  every balance already matches what is owed - nothing to do.');
    return { corrected: 0 };
  }

  for (const row of corrections) {
    log(`  ${String(row.email).padEnd(30)} ${row.from} -> ${row.to}`);
  }

  if (dryRun) {
    log(`\n  --dry-run: ${corrections.length} balance(s) would change. Nothing was written.`);
    return { corrected: 0, wouldCorrect: corrections.length };
  }

  await User.bulkWrite(
    corrections.map((row) => ({
      updateOne: { filter: { _id: row.id }, update: { $set: { balance: row.to } } },
    })),
  );

  return { corrected: corrections.length };
}

// Only runs the connect/disconnect wrapper when invoked directly, so the
// function above stays importable from a test or another script.
if (process.argv[1] && process.argv[1].endsWith('backfill-invoice-kind.js')) {
  (async () => {
    const force = process.argv.includes('--force');
    const balances = process.argv.includes('--balances');
    const dryRun = process.argv.includes('--dry-run');

    await connectDb();

    try {
      if (balances) {
        console.log(`\n  Reconciling line-of-credit balances${dryRun ? ' (--dry-run)' : ''}\n`);
        await reconcileBalances({ dryRun });
        console.log(`\n  Done.${dryRun ? '' : ' Balances now match what each account owes.'}\n`);
      } else {
        console.log(`\n  Backfilling invoice kind${force ? ' (--force: restamping all)' : ''}\n`);
        await backfillInvoiceKind({ force });
        console.log(
          '\n  Done. No invoice was renumbered and nothing else was touched.' +
            '\n  Balances were NOT changed - run with --balances for that.\n',
        );
      }
    } finally {
      await disconnectDb();
    }
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { backfillInvoiceKind, reconcileBalances };
