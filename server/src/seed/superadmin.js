import bcrypt from 'bcryptjs';

import { connectDb, disconnectDb } from '../config/db.js';
import SuperAdmin from '../models/SuperAdmin.js';
import Tenant from '../models/Tenant.js';
import Plan from '../models/Plan.js';
import Business from '../models/Business.js';

/**
 * The control plane's starting state (SAAS_PLATFORM §6).
 *
 * **Additive - it never wipes.** `npm run seed` rebuilds the businesses, and
 * running this after it assigns them to tenant #1 rather than replacing
 * anything. Re-running is a no-op: every step below either finds what it needs
 * or creates it.
 *
 * Three plans, one tenant, one super admin, and the two existing businesses
 * assigned - enough for the console to demonstrate slots, plans and the feature
 * grid rather than render four empty states.
 */

const DEMO_PASSWORD = 'Cellvix123!';

const PLANS = [
  {
    name: 'Starter',
    slug: 'starter',
    description: 'One business, the essentials.',
    priceCents: 4900,
    includedSlots: 1,
  },
  {
    name: 'Growth',
    slug: 'growth',
    description: 'Up to three businesses, with marketing and reporting.',
    priceCents: 14900,
    includedSlots: 3,
  },
  {
    name: 'Platform',
    slug: 'platform',
    description: 'Unlimited businesses and every feature switched on.',
    priceCents: 39900,
    includedSlots: 25,
  },
];

async function seedSuperAdmin({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  // ---- plans ---------------------------------------------------------------

  let plansAdded = 0;
  for (const plan of PLANS) {
    const existing = await Plan.findOne({ slug: plan.slug });
    if (existing) continue;
    await Plan.create(plan);
    plansAdded += 1;
  }
  const growth = await Plan.findOne({ slug: 'growth' });
  log(`  plans: ${await Plan.countDocuments({})} (${plansAdded} added)`);

  // ---- the super admin -----------------------------------------------------

  /**
   * The password is public in this repo, exactly as the demo buyer's is, and
   * for the same reason: this is dummy data on a development database. It must
   * never become how a real staff member is onboarded - that path is a super admin
   * creating another from the console.
   */
  /**
   * **The super admin belongs to the platform, so it is a Kelinto address.**
   * Cellvix is a tenant's business, and platform staff are not staff of one of
   * their customers - `super@cellvix.ca` read as though the wholesaler operated
   * the console the wholesaler is administered from.
   *
   * The old address is still looked up, and that is not tidiness: an existing
   * installation already has that account, with its own password and its own
   * audit history. Seeding only the new address would create a SECOND super
   * admin rather than rename the first, leaving two live logins to the platform
   * console - the last thing this particular account should quietly acquire.
   */
  const SUPER_ADMIN_EMAIL = 'super@kelinto.com';
  const LEGACY_SUPER_ADMIN_EMAIL = 'super@cellvix.ca';

  let admin = await SuperAdmin.findOne({
    email: { $in: [SUPER_ADMIN_EMAIL, LEGACY_SUPER_ADMIN_EMAIL] },
  });

  if (!admin) {
    admin = await SuperAdmin.create({
      name: 'Platform Staff member',
      email: SUPER_ADMIN_EMAIL,
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      isActive: true,
    });
    log(`  super admin: ${admin.email} (created)`);
  } else {
    log(
      `  super admin: ${admin.email} (already there${
        admin.email === LEGACY_SUPER_ADMIN_EMAIL
          ? ` - sign in with this; rename it to ${SUPER_ADMIN_EMAIL} from the console when convenient`
          : ''
      })`,
    );
  }

  // ---- tenant #1, and the businesses it owns -------------------------------

  let tenant = await Tenant.findOne({ slug: 'cellvix-group' });
  if (!tenant) {
    tenant = await Tenant.create({
      name: 'Cellvix Group',
      slug: 'cellvix-group',
      status: 'active',
      contactName: 'Cellvix Admin',
      contactEmail: 'admin@cellvix.ca',
      phone: '+1 (416) 555-0100',
      // Three: the two businesses that exist plus one free, so the console can
      // demonstrate creating one without first having to grant a slot.
      slots: 3,
      plan: growth?._id,
    });
    log(`  tenant: ${tenant.name} (created, ${tenant.slots} slots)`);
  } else {
    log(`  tenant: ${tenant.name} (already there)`);
  }

  // Existing businesses predate tenants entirely, so they are assigned rather
  // than created. `business.tenant` unset is what the console lists as
  // unassigned, and leaving them there would make the slot arithmetic disagree
  // with the database.
  const assigned = await Business.updateMany(
    { $or: [{ tenant: null }, { tenant: { $exists: false } }] },
    { $set: { tenant: tenant._id, plan: growth?._id } },
  );
  log(`  businesses assigned to ${tenant.name}: ${assigned.modifiedCount}`);

  return {
    plans: await Plan.countDocuments({}),
    tenant: tenant.name,
    assigned: assigned.modifiedCount,
    email: admin.email,
  };
}

async function run() {
  await connectDb();

  console.log('Seeding the control plane…');
  const result = await seedSuperAdmin();

  console.log('');
  console.log('  Console at http://localhost:5173/superadmin');
  console.log(`    ${result.email} - ${DEMO_PASSWORD}`);

  await disconnectDb();
}

// Only when invoked directly, so `run.js` can import the function without the
// CLI wrapper firing - the pattern `purchase-bids.js` uses.
if (process.argv[1] && process.argv[1].endsWith('superadmin.js')) {
  run().catch(async (error) => {
    console.error(`Seeding the control plane failed: ${error.message}`);
    await disconnectDb().catch(() => {});
    process.exit(1);
  });
}

export { seedSuperAdmin, DEMO_PASSWORD };
