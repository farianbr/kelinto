import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoose from 'mongoose';

import { connectDb, disconnectDb } from '../config/db.js';
import { CONTROL_MODELS, controlModels, modelsFor } from '../db/models.js';
import { dbFor } from '../db/connections.js';
import { backfillLoginDirectory } from '../services/loginDirectory.js';

/**
 * Move every Cellvix record into CellShoppe, and retire Cellvix (2026-09-24).
 *
 * Client ruling: one business, CellShoppe, running both the parts storefront and
 * the repair shop. Cellvix's catalogue, orders, invoices, customers, suppliers
 * and everything else move into CellShoppe's database; CellShoppe becomes the
 * default business and a `both` business; Cellvix is SOFT-deleted, its database
 * left in place.
 *
 * ## Dry run by default
 *
 *   node server/src/seed/merge-into-cellshoppe.js            report only
 *   node server/src/seed/merge-into-cellshoppe.js --apply    do it
 *
 * ## Safe to re-run
 *
 * Written for a connection that drops: every record keeps its `_id`, and a
 * record already in CellShoppe is skipped. Run it again after a failure and it
 * carries on from where it stopped. A write that reached the server before the
 * connection died answers "duplicate _id" on the retry, which is read as done.
 *
 * ## How clashes are settled
 *
 * - **Same thing twice** (the same seed content in both databases): CellShoppe's
 *   copy is kept, Cellvix's is dropped, and every Cellvix record pointing at the
 *   dropped one is re-pointed at CellShoppe's. Roles, suppliers (by email),
 *   FAQs, agreement templates, message templates, expense categories, offers,
 *   blog posts, invoice labels.
 * - **A document number already taken** (`QT-2026-00003` in both): Cellvix's
 *   record takes the next free number in the same series. Records link to each
 *   other by id, not number, so nothing breaks.
 * - **A customer referral code already taken**: cleared, and minted again by
 *   the referral backfill.
 * - **Settings** (one per database): CellShoppe's identity, kiosk and messaging
 *   stay; Cellvix's inventory and operations come across; financial settings
 *   CellShoppe never filled in are taken from Cellvix.
 *
 * Every Cellvix id that was merged away - and Cellvix's business id itself - is
 * rewritten wherever it appears inside a moved record, at any depth.
 */

const APPLY = process.argv.includes('--apply');
const BATCH = 200;

// ---- helpers ------------------------------------------------------------------

const isOid = (value) => value && typeof value === 'object' && value._bsontype === 'ObjectId';

/** Retry a database call through a flaky connection. */
async function retry(label, fn, attempts = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      const network = /timed out|ECONNRESET|socket|network|topology|ENOTFOUND|EAI_AGAIN/i.test(
        `${error.name} ${error.message}`,
      );
      if (!network || attempt >= attempts) throw error;
      const wait = attempt * 3000;
      console.log(`    ${label}: ${error.message.slice(0, 80)} - retrying in ${wait / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/** Rewrite every mapped ObjectId inside a document, at any depth. */
function remap(value, idMap) {
  if (isOid(value)) return idMap.get(String(value)) ?? value;
  if (Array.isArray(value)) return value.map((item) => remap(item, idMap));
  if (value && typeof value === 'object' && !(value instanceof Date) && !value._bsontype) {
    const out = {};
    for (const key of Object.keys(value)) out[key] = remap(value[key], idMap);
    return out;
  }
  return value;
}

/** `QT-2026-00007` -> { prefix: 'QT-2026-', n: 7, width: 5 }. */
function splitNumber(text) {
  const match = /^(.*?)(\d+)$/.exec(String(text ?? ''));
  return match ? { prefix: match[1], n: Number(match[2]), width: match[2].length } : null;
}

/** Same thing twice: the key a Cellvix record is matched to CellShoppe's by. */
const DEDUPE = {
  roles: (doc) => ({ slug: doc.slug }),
  suppliers: (doc) => (doc.email ? { email: doc.email } : doc.code ? { code: doc.code } : null),
  faqs: (doc) => ({ question: doc.question }),
  agreementtemplates: (doc) => ({ name: doc.name }),
  messagetemplates: (doc) => ({ channel: doc.channel, document: doc.document, status: doc.status }),
  expensecategories: (doc) => ({ slug: doc.slug }),
  offers: (doc) => ({ slug: doc.slug }),
  blogposts: (doc) => ({ slug: doc.slug }),
  invoicelabels: (doc) => ({ name: doc.name }),
  services: (doc) => ({ name: doc.name }),
};

/** Unique values that are cleared rather than kept or renumbered. */
const UNSET = { users: ['referralCode'] };

/** Handled on their own, never copied as documents. */
const SPECIAL = new Set(['settings']);

// ---- main -------------------------------------------------------------------

async function main() {
  console.log(`\n  Merge Cellvix into CellShoppe - ${APPLY ? 'APPLYING' : 'dry run (nothing is written)'}\n`);
  await retry('connect', () => connectDb());

  // Every model registered, so CellShoppe's collections get their indexes.
  const modelsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'models');
  for (const file of fs.readdirSync(modelsDir).filter((name) => name.endsWith('.js'))) {
    await import(pathToFileURL(path.join(modelsDir, file)).href);
  }

  const { Business } = controlModels();
  const businesses = await retry('businesses', () => Business.find({}).lean());
  const cellvix = businesses.find((business) => business.slug === 'cellvix');
  const shoppe = businesses.find((business) => business.slug === 'cellshoppe');
  if (!cellvix || !shoppe) throw new Error('Could not find both businesses by slug (cellvix, cellshoppe).');

  const S = dbFor(cellvix.code).db;
  const T = dbFor(shoppe.code).db;
  console.log(`  from ${cellvix.name} (${S.databaseName})  ->  ${shoppe.name} (${T.databaseName})\n`);

  const idMap = new Map([[String(cellvix._id), shoppe._id]]);
  const collections = (await retry('list', () => S.listCollections().toArray()))
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('system.') && !SPECIAL.has(name))
    .sort();

  // ---- pass 1: merged-away records, so every reference can be re-pointed ----
  for (const name of collections) {
    const key = DEDUPE[name];
    if (!key) continue;
    const docs = await retry(name, () => S.collection(name).find({}).toArray());
    for (const doc of docs) {
      const filter = key(doc);
      if (!filter) continue;
      const match = await retry(name, () => T.collection(name).findOne(filter, { projection: { _id: 1 } }));
      if (match && String(match._id) !== String(doc._id)) idMap.set(String(doc._id), match._id);
    }
  }

  // ---- pass 2: copy -----------------------------------------------------------
  const totals = { inserted: 0, merged: 0, already: 0, renumbered: 0, cleared: 0 };
  const notes = [];

  for (const name of collections) {
    const source = S.collection(name);
    const target = T.collection(name);

    // Single-field unique indexes on CellShoppe's side, and the values it holds.
    const targetIndexes = await retry(name, () => target.indexes().catch(() => []));
    const uniqueFields = targetIndexes
      .filter((index) => index.unique && Object.keys(index.key).length === 1 && !index.key._id)
      .map((index) => Object.keys(index.key)[0]);
    const taken = {};
    const series = {};
    for (const field of uniqueFields) {
      const values = await retry(name, () => target.distinct(field));
      taken[field] = new Set(values.filter((value) => value != null).map(String));

      /**
       * New numbers start after the highest in EITHER database. Counting only
       * CellShoppe's cascaded: its PO-2 made Cellvix's PO-1 into PO-3, which
       * then collided with Cellvix's own PO-3, and so on down the series -
       * every record renumbered when two needed to be. Starting past both
       * means only the records that actually clash move.
       */
      const sourceValues = await retry(name, () => source.distinct(field).catch(() => []));
      for (const value of [...taken[field], ...sourceValues.map(String)]) {
        const parts = splitNumber(value);
        if (parts) series[`${field}|${parts.prefix}`] = Math.max(series[`${field}|${parts.prefix}`] ?? 0, parts.n);
      }
    }

    const counts = { source: 0, inserted: 0, merged: 0, already: 0, renumbered: 0, cleared: 0 };
    const cursor = source.find({}).batchSize(BATCH);
    let batch = [];

    const flush = async () => {
      if (!batch.length) return;
      const ids = batch.map((doc) => doc._id);
      const present = new Set(
        (await retry(name, () => target.find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray())).map(
          (doc) => String(doc._id),
        ),
      );
      const fresh = batch.filter((doc) => !present.has(String(doc._id)));
      counts.already += batch.length - fresh.length;

      const ready = [];
      for (const original of fresh) {
        const doc = remap(original, idMap);
        for (const field of uniqueFields) {
          const value = doc[field];
          if (value == null || !taken[field].has(String(value))) continue;

          if (UNSET[name]?.includes(field)) {
            delete doc[field];
            counts.cleared += 1;
            continue;
          }
          const parts = /number$/i.test(field) ? splitNumber(value) : null;
          if (parts) {
            const key = `${field}|${parts.prefix}`;
            series[key] = (series[key] ?? 0) + 1;
            doc[field] = `${parts.prefix}${String(series[key]).padStart(parts.width, '0')}`;
            counts.renumbered += 1;
            if (notes.length < 40) notes.push(`${name}.${field}: ${value} -> ${doc[field]}`);
            continue;
          }
          // A unique clash no rule above covers. Reported, never guessed at.
          notes.push(`UNHANDLED ${name}.${field} = ${value} (record ${doc._id} left behind)`);
          doc.__skip = true;
        }
        if (doc.__skip) continue;
        for (const field of uniqueFields) if (doc[field] != null) taken[field].add(String(doc[field]));
        ready.push(doc);
      }

      if (APPLY && ready.length) {
        await retry(name, async () => {
          try {
            await target.insertMany(ready, { ordered: false });
          } catch (error) {
            // A retry after a write that did land: duplicate _id means done.
            const failures = error.writeErrors ?? [];
            const real = failures.filter((failure) => !(failure.code === 11000 && /_id_/.test(failure.errmsg ?? failure.err?.errmsg ?? '')));
            if (!failures.length || real.length) throw error;
          }
        });
      }
      counts.inserted += ready.length;
      batch = [];
    };

    for await (const doc of cursor) {
      counts.source += 1;
      if (idMap.has(String(doc._id))) {
        counts.merged += 1;
        continue;
      }
      batch.push(doc);
      if (batch.length >= BATCH) await flush();
    }
    await flush();

    for (const key of Object.keys(totals)) totals[key] += counts[key];
    console.log(
      `  ${name.padEnd(22)} ${String(counts.source).padStart(5)} in Cellvix  ->  ` +
        `${counts.inserted} ${APPLY ? 'copied' : 'to copy'}` +
        (counts.merged ? `, ${counts.merged} merged into existing` : '') +
        (counts.already ? `, ${counts.already} already there` : '') +
        (counts.renumbered ? `, ${counts.renumbered} renumbered` : '') +
        (counts.cleared ? `, ${counts.cleared} referral codes cleared` : ''),
    );
  }

  // ---- settings -----------------------------------------------------------------
  const sourceSettings = await retry('settings', () => S.collection('settings').findOne({ key: 'singleton' }));
  const targetSettings = await retry('settings', () => T.collection('settings').findOne({ key: 'singleton' }));
  if (sourceSettings && targetSettings) {
    const fillMissing = (into, from) => {
      const out = { ...(into ?? {}) };
      for (const [key, value] of Object.entries(from ?? {})) {
        const current = out[key];
        const empty = current == null || current === '' || (Array.isArray(current) && !current.length);
        if (empty) out[key] = value;
        else if (value && typeof value === 'object' && !Array.isArray(value) && !isOid(value) && !(value instanceof Date)) {
          out[key] = fillMissing(current, value);
        }
      }
      return out;
    };
    const update = {
      inventory: sourceSettings.inventory ?? targetSettings.inventory,
      operations: sourceSettings.operations ?? targetSettings.operations,
      financial: fillMissing(targetSettings.financial, sourceSettings.financial),
    };
    console.log(`\n  settings: inventory and operations from Cellvix; financial gaps filled from Cellvix; the rest stays CellShoppe's`);
    if (APPLY) {
      await retry('settings', () => T.collection('settings').updateOne({ _id: targetSettings._id }, { $set: update }));
    }
  }

  // ---- the control plane ----------------------------------------------------------
  const staff = [...new Set([...(shoppe.staff ?? []), ...(cellvix.staff ?? [])].map(String))].map(
    (id) => new mongoose.Types.ObjectId(id),
  );
  console.log(`\n  CellShoppe: type both, default business, ${staff.length} staff on its roster`);
  console.log(`  Cellvix:    soft-deleted (restorable for 30 days), no longer default; its database is left in place`);
  console.log(`  CellShoppe feature overrides now: ${JSON.stringify(shoppe.featureOverrides ?? {})}`);

  if (APPLY) {
    await retry('business', () =>
      Business.updateOne({ _id: shoppe._id }, { $set: { businessType: 'both', isDefault: true, staff } }),
    );
    await retry('business', () =>
      Business.updateOne(
        { _id: cellvix._id },
        {
          $set: {
            isDefault: false,
            deletedAt: new Date(),
            purgeAfter: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        },
      ),
    );

    // Indexes for collections CellShoppe did not have before (the catalogue,
    // reviews, carts...), so unique rules hold from the first new write.
    const bound = modelsFor(dbFor(shoppe.code));
    for (const modelName of mongoose.modelNames()) {
      if (CONTROL_MODELS.has(modelName)) continue;
      await retry(`indexes ${modelName}`, () => bound[modelName].createIndexes()).catch((error) =>
        notes.push(`index ${modelName}: ${error.message.slice(0, 120)}`),
      );
    }

    // Supplier logins live on each business's own `Supplier` record and were
    // copied with it; there is nothing platform-wide to re-index.
    console.log('\n  re-indexing logins...');
    await retry('login directory', () => backfillLoginDirectory({ quiet: true }));
  }

  console.log(
    `\n  total: ${totals.inserted} ${APPLY ? 'copied' : 'to copy'}, ${totals.merged} merged into existing, ` +
      `${totals.already} already there, ${totals.renumbered} renumbered, ${totals.cleared} referral codes cleared`,
  );
  if (notes.length) {
    console.log('\n  notes:');
    for (const note of notes) console.log(`    ${note}`);
  }
  if (!APPLY) console.log('\n  Nothing was written. Run again with --apply to do it.\n');
  else console.log('\n  Done. Restart the API (dev server and VPS) so the new default business is picked up.\n');

  await disconnectDb();
}

main()
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(`\n  Merge stopped: ${error.message}\n  It is safe to run again - finished records are skipped.\n`);
    await disconnectDb().catch(() => {});
    process.exit(1);
  });
