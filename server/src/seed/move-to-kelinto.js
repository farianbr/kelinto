import mongoose from 'mongoose';
import { CopyObjectCommand, DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import { connectDb, disconnectDb } from '../config/db.js';
import env from '../config/env.js';
import { hasKey, isConfigured, listKeys } from '../services/storageService.js';

/**
 * Move the installation off the Cellvix names (client, 2026-10-06: "cellshoppe
 * should be business 1 not 2, and we will also have to update naming in
 * Atlas"). Cellvix was purged the same day, so CellShoppe, the one business,
 * takes code #000001, and the databases take the platform's prefix:
 *
 *   cellvix               (control)    ->  kelinto_control
 *   cellvix_biz_000002    (CellShoppe) ->  kelinto_biz_000001
 *   R2 businesses/000002/              ->  businesses/000001/
 *
 * MongoDB cannot rename a database, so this is the copy-verify-switch that
 * CLAUDE.md asks for. Three steps, each its own run:
 *
 *   1. COPY (this script, old .env, API stopped)
 *        npm run move:kelinto -- --dry-run
 *        npm run move:kelinto
 *      Copies every R2 object under the old folder to the new one, then copies
 *      every collection (documents and indexes) into the new databases,
 *      rewriting the business code and every stored R2 key on the way, and
 *      checks each collection's count. The old databases and folder are left
 *      exactly as they were, so step 2 can be undone by putting .env back.
 *   2. SWITCH (by hand): in .env, MONGODB_URI's database becomes
 *      `kelinto_control` and DB_PREFIX becomes `kelinto`; start the API.
 *   3. CLEANUP (new .env, once the site is seen working)
 *        npm run move:kelinto -- --cleanup --dry-run
 *        npm run move:kelinto -- --cleanup
 *      Checks the new databases still hold at least what the old ones did,
 *      then drops the old databases and deletes the old R2 folder.
 *
 * The API must be STOPPED for step 1 (VPS and any local `npm run dev`, which
 * read the same Atlas cluster): anything written to the old databases after
 * the copy is lost at the switch.
 */

const FROM_CONTROL = 'cellvix';
const FROM_PREFIX = 'cellvix';
const TO_CONTROL = 'kelinto_control';
const TO_PREFIX = 'kelinto';
const RENUMBER = { '#000002': '#000001' };

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const cleanup = args.includes('--cleanup');

const folderOf = (code) => String(code).replace(/^#/, '');
const bizDb = (prefix, code) => `${prefix}_biz_${folderOf(code)}`;

/** The R2 folder swaps, `businesses/000002/` -> `businesses/000001/`. */
const FOLDER_SWAPS = Object.entries(RENUMBER).map(([from, to]) => [
  `businesses/${folderOf(from)}/`,
  `businesses/${folderOf(to)}/`,
]);

/** Rewrite every stored R2 key (and any URL that carries one) in a document. */
function rewrite(value) {
  if (typeof value === 'string') {
    let out = value;
    for (const [from, to] of FOLDER_SWAPS) if (out.includes(from)) out = out.split(from).join(to);
    return out;
  }
  if (Array.isArray(value)) return value.map(rewrite);
  if (value && typeof value === 'object' && !value._bsontype && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const out = {};
    for (const key of Object.keys(value)) out[key] = rewrite(value[key]);
    return out;
  }
  return value;
}

/** Copy one database into another, collection by collection, indexes included. */
async function copyDatabase(client, fromName, toName, { transform = (doc) => doc, log }) {
  const from = client.db(fromName);
  const to = client.db(toName);
  const collections = (await from.listCollections().toArray()).filter(
    (c) => c.type !== 'view' && !c.name.startsWith('system.'),
  );
  let docs = 0;
  for (const { name } of collections) {
    const source = from.collection(name);
    const target = to.collection(name);
    const count = await source.countDocuments();
    // Created even when empty, so the target carries every collection and index.
    await to.createCollection(name).catch((error) => {
      if (error.codeName !== 'NamespaceExists') throw error;
    });
    let batch = [];
    for await (const doc of source.find({})) {
      batch.push(transform(rewrite(doc), name));
      if (batch.length === 500) {
        await target.insertMany(batch, { ordered: false });
        batch = [];
      }
    }
    if (batch.length) await target.insertMany(batch, { ordered: false });

    for (const index of await source.indexes()) {
      if (index.name === '_id_') continue;
      const { key, name: indexName, v, ns, ...options } = index;
      // A text index is listed by its internal keys ({ _fts, _ftsx }); it is
      // created from its fields, which are the keys of `weights`.
      const spec = key._fts === 'text'
        ? {
            ...Object.fromEntries(Object.entries(key).filter(([field]) => field !== '_fts' && field !== '_ftsx')),
            ...Object.fromEntries(Object.keys(options.weights ?? {}).map((field) => [field, 'text'])),
          }
        : key;
      await target.createIndex(spec, { ...options, name: indexName });
    }

    const copied = await target.countDocuments();
    if (copied !== count) throw new Error(`${fromName}.${name}: ${count} documents, ${copied} copied.`);
    docs += count;
  }
  log(`    ${fromName} -> ${toName}: ${collections.length} collections, ${docs} documents, counts match`);
}

/** A target database must not exist yet; a near-empty leftover shell is dropped. */
async function clearTarget(client, name, log) {
  const db = client.db(name);
  const collections = await db.listCollections().toArray();
  if (!collections.length) return;
  let total = 0;
  for (const c of collections) total += await db.collection(c.name).countDocuments();
  // The two `kelinto_biz_*` found on 2026-10-06 held one settings row and one
  // audit row between them: shells from a run with the default prefix.
  if (total > 5) throw new Error(`${name} already holds ${total} documents. Refusing to overwrite it.`);
  log(`    dropping leftover ${name} (${total} documents)`);
  if (!dryRun) await db.dropDatabase();
}

async function copyR2(log) {
  if (!isConfigured()) throw new Error('R2 is not configured: set the R2_ values in .env first.');
  for (const [from, to] of FOLDER_SWAPS) {
    const keys = await listKeys(from);
    log(`    R2 ${from} -> ${to}: ${keys.length} files`);
    if (dryRun) continue;
    let copied = 0;
    // Eight at a time: 600 sequential copies is minutes, all at once is a 429.
    for (let i = 0; i < keys.length; i += 8) {
      await Promise.all(
        keys.slice(i, i + 8).map(async (key) => {
          const target = to + key.slice(from.length);
          if (await hasKey(target)) return;
          await s3().send(
            new CopyObjectCommand({
              Bucket: env.R2_BUCKET,
              CopySource: `${env.R2_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`,
              Key: target,
              MetadataDirective: 'COPY',
            }),
          );
          copied += 1;
        }),
      );
    }
    const landed = (await listKeys(to)).length;
    if (landed < keys.length) throw new Error(`R2 ${to}: ${landed} of ${keys.length} files present after copying.`);
    log(`      ${copied} copied, ${landed} present`);
  }
}

let client = null;
function s3() {
  client ??= new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  return client;
}

async function countAll(mongo, name) {
  const db = mongo.db(name);
  const counts = {};
  for (const c of await db.listCollections().toArray()) {
    if (c.type === 'view' || c.name.startsWith('system.')) continue;
    counts[c.name] = await db.collection(c.name).countDocuments();
  }
  return counts;
}

async function copyPhase(log) {
  const mongo = mongoose.connection.client;
  const current = mongoose.connection.db.databaseName;
  if (current !== FROM_CONTROL || env.DB_PREFIX !== FROM_PREFIX) {
    throw new Error(
      `Run the copy with the OLD .env: it reads database "${current}" with DB_PREFIX "${env.DB_PREFIX}", expected "${FROM_CONTROL}" and "${FROM_PREFIX}".`,
    );
  }

  const businesses = await mongo.db(FROM_CONTROL).collection('businesses').find({}).toArray();
  log(`\n  Businesses: ${businesses.map((b) => `${b.name} ${b.code} -> ${RENUMBER[b.code] ?? b.code}`).join(', ')}`);
  for (const business of businesses) {
    const buybacks = await mongo.db(bizDb(FROM_PREFIX, business.code)).collection('buybacks').countDocuments();
    if (buybacks) throw new Error(`${business.name} has ${buybacks} buybacks: their photos in the private bucket would need moving too.`);
  }
  const taken = await mongo.db(FROM_CONTROL).collection('businesses').countDocuments({ code: { $in: Object.values(RENUMBER) } });
  if (taken) throw new Error(`A business already holds ${Object.values(RENUMBER).join(', ')}.`);

  log('\n  Targets');
  await clearTarget(mongo, TO_CONTROL, log);
  for (const business of businesses) {
    await clearTarget(mongo, bizDb(TO_PREFIX, RENUMBER[business.code] ?? business.code), log);
  }
  // The other leftover from the same run, in nobody's way but named like ours.
  for (const stray of ['kelinto_biz_000002']) {
    if (!businesses.some((b) => bizDb(TO_PREFIX, RENUMBER[b.code] ?? b.code) === stray)) await clearTarget(mongo, stray, log);
  }

  log('\n  Files');
  await copyR2(log);

  log('\n  Databases');
  if (dryRun) {
    log(`    ${FROM_CONTROL} -> ${TO_CONTROL}`);
    for (const b of businesses) log(`    ${bizDb(FROM_PREFIX, b.code)} -> ${bizDb(TO_PREFIX, RENUMBER[b.code] ?? b.code)}`);
    log('\n  Dry run: nothing copied.\n');
    return;
  }
  await copyDatabase(mongo, FROM_CONTROL, TO_CONTROL, {
    log,
    transform: (doc, collection) =>
      collection === 'businesses' && RENUMBER[doc.code] ? { ...doc, code: RENUMBER[doc.code] } : doc,
  });
  for (const business of businesses) {
    await copyDatabase(mongo, bizDb(FROM_PREFIX, business.code), bizDb(TO_PREFIX, RENUMBER[business.code] ?? business.code), { log });
  }

  log('\n  Copied. Nothing old was touched. Next: in .env set');
  log(`    MONGODB_URI  ...mongodb.net/${TO_CONTROL}?...   (the database name in the path)`);
  log(`    DB_PREFIX=${TO_PREFIX}`);
  log('  then start the API. Undo before cleanup = put the two lines back.\n');
}

async function cleanupPhase(log) {
  const mongo = mongoose.connection.client;
  const current = mongoose.connection.db.databaseName;
  if (current !== TO_CONTROL || env.DB_PREFIX !== TO_PREFIX) {
    throw new Error(`Run cleanup with the NEW .env (database "${TO_CONTROL}", DB_PREFIX "${TO_PREFIX}"); it reads "${current}" / "${env.DB_PREFIX}".`);
  }
  const pairs = [[FROM_CONTROL, TO_CONTROL]];
  for (const [from, to] of Object.entries(RENUMBER)) pairs.push([bizDb(FROM_PREFIX, from), bizDb(TO_PREFIX, to)]);

  log('\n  Checking the new databases hold at least what the old ones did');
  for (const [from, to] of pairs) {
    const [old, now] = await Promise.all([countAll(mongo, from), countAll(mongo, to)]);
    if (!Object.keys(old).length) {
      log(`    ${from}: already gone`);
      continue;
    }
    const short = Object.entries(old).filter(([name, n]) => (now[name] ?? 0) < n);
    if (short.length) throw new Error(`${to} is missing documents: ${short.map(([n]) => n).join(', ')}. Not cleaning up.`);
    log(`    ${to} ok (${Object.keys(old).length} collections)`);
  }
  for (const [from, to] of FOLDER_SWAPS) {
    const [old, now] = await Promise.all([listKeys(from), listKeys(to)]);
    if (now.length < old.length) throw new Error(`R2 ${to} holds ${now.length} of ${old.length} files. Not cleaning up.`);
    log(`    R2 ${to} ok (${now.length} files; ${old.length} old to delete)`);
  }
  if (dryRun) {
    log('\n  Dry run: nothing deleted.\n');
    return;
  }

  for (const [from] of pairs) await mongo.db(from).dropDatabase();
  for (const [from] of FOLDER_SWAPS) {
    const keys = await listKeys(from);
    for (let i = 0; i < keys.length; i += 1000) {
      await s3().send(
        new DeleteObjectsCommand({
          Bucket: env.R2_BUCKET,
          Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }
  log(`\n  Old databases dropped (${pairs.map(([from]) => from).join(', ')}) and old R2 folder deleted.\n`);
}

if (process.argv[1] && process.argv[1].endsWith('move-to-kelinto.js')) {
  (async () => {
    await connectDb();
    await (cleanup ? cleanupPhase(console.log) : copyPhase(console.log));
    await disconnectDb();
    await mongoose.connection.close();
    process.exit(0);
  })().catch((error) => {
    console.error(`\n  Move failed: ${error.message}\n`);
    process.exit(1);
  });
}

export { copyDatabase, rewrite };
