import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { db } from '../db/models.js';
import '../models/ExpenseCategory.js';

/**
 * The Canadian starter set of expense categories (ERP rework §6.9).
 *
 * **Upsert, never wipe.** Every expense points at a category by id, so
 * deleting and re-inserting this list would re-key the whole collection and
 * silently re-bucket the P&L. Existing rows are left exactly as the staff member
 * edited them - a category they renamed or deactivated stays that way - and
 * only genuinely missing slugs are added. That makes this safe to run on a
 * database with real expenses in it, and safe to run twice.
 *
 * `inventory-purchases` is the one entry the code knows by name: it is where
 * `purchaseService.recordPurchasePayment` files a PO payment when the staff member
 * did not pick a category.
 *
 * All of them are editable and deletable from `/admin/settings/expense-categories`
 * - this is a starting point, not a fixed vocabulary.
 */
const EXPENSE_CATEGORIES = [
  { name: 'Inventory Purchases', slug: 'inventory-purchases', colorToken: 'brand', gstApplicable: true, order: 10 },
  { name: 'Rent', slug: 'rent', colorToken: 'ink', gstApplicable: false, order: 20 },
  { name: 'Utilities', slug: 'utilities', colorToken: 'info', gstApplicable: true, order: 30 },
  { name: 'Salaries', slug: 'salaries', colorToken: 'ink', gstApplicable: false, order: 40 },
  { name: 'Shipping', slug: 'shipping', colorToken: 'info', gstApplicable: true, order: 50 },
  { name: 'Software', slug: 'software', colorToken: 'ok', gstApplicable: true, order: 60 },
  { name: 'Insurance', slug: 'insurance', colorToken: 'warn', gstApplicable: false, order: 70 },
  { name: 'Professional Fees', slug: 'professional-fees', colorToken: 'ink', gstApplicable: true, order: 80 },
  { name: 'Bank Charges', slug: 'bank-charges', colorToken: 'danger', gstApplicable: false, order: 90 },
  { name: 'Marketing', slug: 'marketing', colorToken: 'brand', gstApplicable: true, order: 100 },
  { name: 'Supplies', slug: 'supplies', colorToken: 'ok', gstApplicable: true, order: 110 },
];

async function seedExpenseCategories({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  const existing = await db().ExpenseCategory.find({}).select('slug').lean();
  const have = new Set(existing.map((category) => category.slug));

  const missing = EXPENSE_CATEGORIES.filter((category) => !have.has(category.slug));
  if (missing.length) await db().ExpenseCategory.insertMany(missing);

  log(`  expense categories: ${missing.length} added, ${have.size} already present`);
  return { added: missing.length, existing: have.size };
}

// CLI entry: `npm run seed:demo -- expense-categories`
if (process.argv[1] && process.argv[1].endsWith('expense-categories.js')) {
  (async () => {
    console.log('\n  Seeding Cellvix expense categories…\n');
    await connectDb();
    const result = await seedExpenseCategories();
    console.log('\n  Done.', result, '\n');
    await disconnectDb();
    await mongoose.connection.close();
    process.exit(0);
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { EXPENSE_CATEGORIES, seedExpenseCategories };
