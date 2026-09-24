import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

import { connectDb, disconnectDb } from '../config/db.js';
import { db, dbFor } from '../db/models.js';
import { runInBusiness } from '../db/context.js';
import '../models/AgreementTemplate.js';
import '../models/SupplierAgreement.js';
import '../models/Supplier.js';
import '../models/Business.js';
import { AGREEMENT_TEMPLATE } from './agreement.data.js';

/** The shared demo password, as every other seeded login uses. */
const DEMO_PASSWORD = 'Cellvix123!';

/**
 * The supplier master agreement, and a demo signature against it.
 *
 * **Additive and idempotent**, like `seed:expense-categories`: it upserts the
 * template by name and attaches it to suppliers who have none, so it is safe on
 * a database with real suppliers and safe to run twice. It never deletes a
 * signature - that is evidence, and a seed script has no business destroying it.
 *
 * One supplier is signed and one is left pending on purpose, because both
 * states have their own screens: the portal's "sign before you can quote"
 * banner and the admin profile's signed-document view are each only reachable
 * with data in the right shape.
 */
async function seedAgreements({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);

  // Upserted by name, so re-running does not mint a second copy - and a
  // staff member's edits to the clauses survive, because only a missing template is
  // created.
  let template = await db().AgreementTemplate.findOne({ name: AGREEMENT_TEMPLATE.name }).lean();
  if (!template) {
    const created = await db().AgreementTemplate.create({ ...AGREEMENT_TEMPLATE, version: 1 });
    template = created.toObject();
    log(`  agreement: created "${template.name}" with ${template.clauses.length} clauses`);
  } else {
    log(`  agreement: "${template.name}" already present`);
  }

  // Attach to every active supplier that has none. A supplier already carrying
  // a different agreement keeps it.
  const attached = await db().Supplier.updateMany(
    { isActive: true, agreementTemplates: { $ne: template._id } },
    { $addToSet: { agreementTemplates: template._id } },
  );
  log(`  agreement: attached to ${attached.modifiedCount ?? 0} supplier(s)`);

  /**
   * One signature, so the signed state has a screen to render.
   *
   * A 1×1 transparent PNG stands in for a drawn signature - the point of the
   * demo row is the clause notes and initials, and shipping a picture of
   * somebody's actual handwriting in a seed file would be worse than a
   * placeholder that is obviously one.
   */
  const signer = await db()
    .Supplier.findOne({ isActive: true, email: /northbridge/i })
    .select('name agreementTemplates')
    .lean();

  let signed = 0;
  if (signer) {
    const already = await db().SupplierAgreement.countDocuments({
      supplier: signer._id,
      template: template._id,
      status: 'signed',
    });

    if (!already) {
      const now = new Date();
      await db().SupplierAgreement.create({
        supplier: signer._id,
        template: template._id,
        templateName: template.name,
        templateVersion: template.version ?? 1,
        preamble: template.preamble,
        clauses: (template.clauses ?? []).map((clause, index) => ({
          key: clause.key,
          title: clause.title,
          body: clause.body,
          // One exception, on the clause a supplier most often qualifies
          // so the admin view has something real to show rather than nine
          // blank note fields.
          note:
            clause.key === 'moq-protection'
              ? 'MOQ for the screen assemblies is 500 units, not 300, from January.'
              : undefined,
          initials: 'MD',
          initialledAt: new Date(now.getTime() - (9 - index) * 60_000),
        })),
        status: 'signed',
        signature: {
          kind: 'drawn',
          image:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        },
        signedName: 'Marc Deschamps',
        signedTitle: 'Director of Sales',
        signedCompany: signer.name,
        signedAt: now,
        signedIp: '203.0.113.24',
        signedUserAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      });
      signed = 1;
      log(`  agreement: signed by ${signer.name}`);
    } else {
      log(`  agreement: ${signer.name} has already signed`);
    }
  }

  /**
   * A supplier created fresh, with nothing signed.
   *
   * The seeded four are useful for the signed and mid-flow states, but testing
   * the signing form itself wants an account that has never been near it - one
   * where every clause is blank and the gate is genuinely closed. Upserted by
   * email, so re-running does not mint a second.
   */
  const FRESH = {
    name: 'Harbour Point Components',
    code: 'HPC',
    email: 'signup@harbourpoint.example',
    contactName: 'Priya Raman',
    phone: '+1 (604) 555-0188',
    paymentTerms: 'net30',
    componentTypes: ['battery', 'screen-assembly'],
    address: {
      line1: '2200 Commissioner Street',
      city: 'Vancouver',
      region: 'BC',
      postal: 'V5L 1A4',
      country: 'Canada',
    },
  };

  let fresh = await db().Supplier.findOne({ email: FRESH.email }).lean();
  if (!fresh) {
    const created = await db().Supplier.create({
      ...FRESH,
      isActive: true,
      // Every agreement on the books, so the multi-agreement gate has a
      // subject: this one has to sign all of them before it can quote.
      agreementTemplates: [template._id],
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      portalInviteAt: new Date(),
    });
    fresh = created.toObject();
    log(`  agreement: created ${FRESH.name} (${FRESH.email}) with nothing signed`);
  } else {
    // Keep it unsigned and holding the agreement, whatever an earlier run did.
    await db().Supplier.updateOne(
      { _id: fresh._id },
      { $addToSet: { agreementTemplates: template._id } },
    );
    await db().SupplierAgreement.deleteMany({ supplier: fresh._id });
    log(`  agreement: reset ${FRESH.name} to unsigned`);
  }

  return { template: template._id, attached: attached.modifiedCount ?? 0, signed };
}

/** Every business, each in its own database. */
async function run() {
  await connectDb();

  console.log('\n  Seeding supplier agreements…\n');

  const businesses = await db().Business.find({ deletedAt: null }).select('name code').lean();
  const targets = businesses.length ? businesses : [null];

  for (const business of targets) {
    if (business) console.log(`  ${business.name} (${business.code})`);
    const work = () => seedAgreements();
    if (business) {
      await runInBusiness(
        {
          businessId: String(business._id),
          code: business.code,
          connection: dbFor(business.code),
        },
        work,
      );
    } else {
      await work();
    }
  }

  console.log('\n  Done.\n');
  await disconnectDb();
  await mongoose.connection.close();
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith('agreements.js')) {
  run().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

export { seedAgreements };
