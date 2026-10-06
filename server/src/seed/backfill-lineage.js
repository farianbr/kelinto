import { connectDb, disconnectDb } from '../config/db.js';
import Invoice from '../models/Invoice.js';
import Quote from '../models/Quote.js';
import Ticket from '../models/Ticket.js';

/**
 * Fills in the backwards half of the quote → ticket → invoice chain.
 *
 * Both edges were only ever stored pointing forwards: `Quote.convertedTicket`
 * knows which ticket it became, and `Ticket.invoice` knows which invoice it
 * became. Nothing pointed the other way, so a ticket could not name the quote
 * behind it and an invoice could not name the repair it was billing - it said
 * so only in its `reference` string, a sentence for a human rather than a link
 * a screen can follow.
 *
 * `Ticket.quote` and `Invoice.ticket` now exist and are written at conversion
 * time going forward. Every record converted **before** that leaves them null,
 * which the workflow lineage strip would draw as a chain that never happened
 * an invoice showing an empty Ticket station when the ticket is sitting right
 * there in the database.
 *
 * Both edges are derived rather than guessed: this reads the forward pointer
 * that already exists and writes its mirror. Nothing is inferred from a
 * `reference` string or a date, so a record with no forward pointer is left
 * alone rather than attached to whatever looked closest.
 *
 * Safe to re-run and safe on a database with real accounts: it writes one
 * reference field on rows that have none, and never overwrites an edge that is
 * already set unless asked. `--force` rewrites every mirror from its forward
 * pointer, which is what you want if a forward pointer was itself corrected.
 *
 *   npm run backfill -- lineage
 *   npm run backfill -- lineage -- --dry-run
 *   npm run backfill -- lineage -- --force
 */
async function backfillLineage({ force = false, dryRun = false, quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  // ---- quote -> ticket, mirrored onto the ticket ---------------------------
  const converted = await Quote.find({ convertedTicket: { $ne: null } })
    .select('quoteNumber convertedTicket')
    .lean();

  const ticketScope = force ? {} : { quote: null };
  const ticketIds = converted.map((quote) => quote.convertedTicket);
  const ticketsNeeding = await Ticket.find({ _id: { $in: ticketIds }, ...ticketScope })
    .select('_id')
    .lean();
  const needsQuote = new Set(ticketsNeeding.map((ticket) => String(ticket._id)));

  const quoteEdges = converted.filter((quote) => needsQuote.has(String(quote.convertedTicket)));

  // ---- ticket -> invoice, mirrored onto the invoice ------------------------
  const invoiced = await Ticket.find({ invoice: { $ne: null } })
    .select('ticketNumber invoice')
    .lean();

  const invoiceScope = force ? {} : { ticket: null };
  const invoiceIds = invoiced.map((ticket) => ticket.invoice);
  const invoicesNeeding = await Invoice.find({ _id: { $in: invoiceIds }, ...invoiceScope })
    .select('_id')
    .lean();
  const needsTicket = new Set(invoicesNeeding.map((invoice) => String(invoice._id)));

  const invoiceEdges = invoiced.filter((ticket) => needsTicket.has(String(ticket.invoice)));

  if (quoteEdges.length + invoiceEdges.length === 0) {
    log('  every chain already points both ways - nothing to do.');
    return { tickets: 0, invoices: 0 };
  }

  for (const quote of quoteEdges) log(`  ticket <- ${quote.quoteNumber}`);
  for (const ticket of invoiceEdges) log(`  invoice <- ${ticket.ticketNumber}`);

  if (dryRun) {
    log(
      `\n  --dry-run: ${quoteEdges.length} ticket(s) and ${invoiceEdges.length} invoice(s)` +
        ' would be linked. Nothing was written.',
    );
    return { tickets: 0, invoices: 0, wouldLink: quoteEdges.length + invoiceEdges.length };
  }

  if (quoteEdges.length > 0) {
    await Ticket.bulkWrite(
      quoteEdges.map((quote) => ({
        updateOne: {
          filter: { _id: quote.convertedTicket },
          update: { $set: { quote: quote._id } },
        },
      })),
    );
  }

  if (invoiceEdges.length > 0) {
    await Invoice.bulkWrite(
      invoiceEdges.map((ticket) => ({
        updateOne: {
          filter: { _id: ticket.invoice },
          update: { $set: { ticket: ticket._id } },
        },
      })),
    );
  }

  return { tickets: quoteEdges.length, invoices: invoiceEdges.length };
}

// Only runs the connect/disconnect wrapper when invoked directly, so the
// function above stays importable from a test or another script.
if (process.argv[1] && process.argv[1].endsWith('backfill-lineage.js')) {
  (async () => {
    const force = process.argv.includes('--force');
    const dryRun = process.argv.includes('--dry-run');

    await connectDb();

    try {
      console.log(
        `\n  Backfilling workflow lineage${force ? ' (--force: rewriting all)' : ''}` +
          `${dryRun ? ' (--dry-run)' : ''}\n`,
      );
      const result = await backfillLineage({ force, dryRun });
      console.log(
        `\n  Done. ${result.tickets} ticket(s) now name their quote,` +
          ` ${result.invoices} invoice(s) now name their ticket.` +
          '\n  No forward pointer was changed and nothing else was touched.\n',
      );
    } finally {
      await disconnectDb();
    }
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { backfillLineage };
