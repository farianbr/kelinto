import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { controlModels } from '../db/models.js';
import '../models/PendingUpload.js';
import { newId, processUpload, SIBLINGS } from './mediaProcessor.js';
import { decodeKey, encodeKey, isNamedKey } from '../utils/photoLibrary.js';

/**
 * Uploaded files, in Cloudflare R2.
 *
 * ## Where a file goes
 *
 * Every key starts with its owner, so no two businesses can ever share or
 * overwrite a file and one business's files can be listed or removed without
 * touching anybody else's:
 *
 *   businesses/<business code>/<kind>/<random>.<ext>   a business's own files
 *   businesses/<business code>/library/<set>/<name>     its named photo library
 *   kelinto/<kind>/<random>.<ext>                      Kelinto's own files
 *
 * Kelinto's folder was `platform/` until 2026-09-27. Keys under it still
 * resolve and still count as Kelinto's, so a record nobody has migrated keeps
 * rendering; `npm run backfill -- kelinto-naming` moves them across.
 *
 * The name is random, never the uploader's filename: a filename is typed by a
 * person and can carry anything, and a new name per upload means a replaced
 * logo is a new URL, so no browser or CDN keeps showing the old one.
 *
 * ## What is accepted, and what is stored
 *
 * Accepted is decided by the file's own first bytes, not by its extension or
 * the type the browser claimed, both of which the uploader controls. **SVG is
 * refused**: it is a document that can carry script. What is STORED is never
 * the upload itself but its optimised form (`mediaProcessor`): resized, re-encoded
 * and stripped of metadata, with a thumbnail or poster beside it where the kind
 * has one. The input ceilings below are therefore generous - a phone photo is
 * 4-8 MB and that is fine, because what lands in R2 is a few hundred KB.
 *
 * ## Nothing is kept that nothing uses
 *
 * Every upload is recorded as pending (`PendingUpload`) until the record using
 * it is saved (`claim`); a discarded form deletes it (`discard`), an abandoned
 * one is swept (`sweepAbandoned`), and a saved record that stops using a file
 * deletes it (`releaseReplaced`).
 */

/** The owner for Kelinto's own files (console › Brand), as opposed to a business code. */
const KELINTO = 'kelinto';
const LEGACY_KELINTO_FOLDER = 'platform';

/** What each upload slot accepts, and how large an INPUT may be. */
const KINDS = {
  logo: { families: ['image'], maxBytes: 10 * 1024 * 1024 },
  'footer-logo': { families: ['image'], maxBytes: 10 * 1024 * 1024 },
  favicon: { families: ['image', 'icon'], maxBytes: 2 * 1024 * 1024 },
  'product-image': { families: ['image'], maxBytes: 15 * 1024 * 1024 },
  'product-video': { families: ['video'], maxBytes: 100 * 1024 * 1024 },
  'review-photo': { families: ['image'], maxBytes: 10 * 1024 * 1024 },
};

/** The largest any kind allows, for the multipart parser's own ceiling. */
const MAX_UPLOAD_BYTES = Math.max(...Object.values(KINDS).map((kind) => kind.maxBytes));

/** How long an upload may sit unsaved before the sweeper deletes it. */
const ABANDONED_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Magic numbers, checked against the buffer. Order matters only in that each
 * test is exact, so none can shadow another.
 */
function sniff(buffer) {
  const b = buffer;
  const at = (offset, bytes) => bytes.every((byte, i) => b[offset + i] === byte);
  const ascii = (offset, text) => b.length >= offset + text.length && b.toString('ascii', offset, offset + text.length) === text;

  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { family: 'image', type: 'image/png', ext: 'png' };
  if (at(0, [0xff, 0xd8, 0xff])) return { family: 'image', type: 'image/jpeg', ext: 'jpg' };
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { family: 'image', type: 'image/webp', ext: 'webp' };
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return { family: 'image', type: 'image/gif', ext: 'gif' };
  if (ascii(4, 'ftypavif') || ascii(4, 'ftypavis')) return { family: 'image', type: 'image/avif', ext: 'avif' };
  if (at(0, [0x00, 0x00, 0x01, 0x00])) return { family: 'icon', type: 'image/x-icon', ext: 'ico' };
  // An iPhone's .mov: transcoded to MP4 like everything else, but never kept as it is.
  if (ascii(4, 'ftypqt')) return { family: 'video', type: 'video/quicktime', ext: 'mov' };
  if (ascii(4, 'ftyp')) return { family: 'video', type: 'video/mp4', ext: 'mp4' };
  if (at(0, [0x1a, 0x45, 0xdf, 0xa3])) return { family: 'video', type: 'video/webm', ext: 'webm' };
  return null;
}

/** 1.5, not 1.50 or 1.4999: a size a person reads. */
function megabytes(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(1));
}

function isConfigured() {
  return Boolean(
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET && env.R2_PUBLIC_URL,
  );
}

let client = null;
function s3() {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    });
  }
  return client;
}

/** The public address of a stored key. A library file's human name is encoded. */
function publicUrl(key) {
  return `${env.R2_PUBLIC_URL}/${isNamedKey(key) ? encodeKey(key) : key}`;
}

/**
 * ## Records store KEYS, not URLs
 *
 * A saved logo or product picture holds `businesses/000002/logo/<uuid>.png`,
 * never `https://<public host>/businesses/...`. The public address is added
 * only when data leaves the server (`urlOf`), and a URL coming back from a
 * form is turned back into its key before it is saved (`toKey`). So moving
 * the bucket to another public address - r2.dev today, `assets.kelinto.com`
 * later - is an edit to `R2_PUBLIC_URL` and a restart, with nothing stored to
 * rewrite. Order and cart lines snapshot the key for the same reason.
 */
const KEY_PATTERN = /^(?:businesses\/[a-z0-9_-]+|kelinto|platform)\/[a-z-]+\/[0-9a-f-]{36}(?:-[a-z0-9]+)?\.[a-z0-9]+$/i;

/**
 * The key behind a stored key or one of OUR public URLs, or null for anything else.
 *
 * A business's photo library (`utils/photoLibrary.js`) is keys too, with human
 * file names rather than generated ids, so it has a pattern of its own and its
 * URLs carry the names encoded.
 */
function keyOf(value) {
  if (!value) return null;
  const text = String(value);
  if (KEY_PATTERN.test(text) || isNamedKey(text)) return text;
  if (!env.R2_PUBLIC_URL) return null;
  const prefix = `${env.R2_PUBLIC_URL}/`;
  if (!text.startsWith(prefix)) return null;
  const rest = text.slice(prefix.length);
  return KEY_PATTERN.test(rest) ? rest : decodeKey(rest);
}

/** What to store: the key for one of our files, anything else unchanged. */
function toKey(value) {
  return keyOf(value) ?? value;
}

/** What to send: the public URL for a stored key, anything else unchanged. */
function urlOf(value) {
  if (!value || !env.R2_PUBLIC_URL) return value;
  const text = String(value);
  return KEY_PATTERN.test(text) || isNamedKey(text) ? publicUrl(text) : value;
}

/**
 * Where an owner's files live: a business by its code, or Kelinto itself.
 *
 * Codes are stored with a leading `#` (`#000002`), which is not a character
 * to put in an object key or a URL, so the folder is the digits alone:
 * `businesses/000002/`.
 */
function ownerPrefix(owner) {
  if (owner === KELINTO) return 'kelinto';
  const folder = String(owner ?? '').replace(/^#/, '');
  if (!/^[a-z0-9_-]+$/i.test(folder)) throw ApiError.badRequest('No business to store this for.', 'NO_BUSINESS');
  return `businesses/${folder}`;
}

/** Is this key one of `owner`'s? Never throws, for the cleanup paths. */
function ownsKey(key, owner) {
  try {
    if (!key) return false;
    // Kelinto's files written before the folder was renamed are still its own.
    if (owner === KELINTO && key.startsWith(`${LEGACY_KELINTO_FOLDER}/`)) return true;
    return key.startsWith(`${ownerPrefix(owner)}/`);
  } catch {
    return false;
  }
}

/**
 * Is this a URL a record may point at? One of this owner's own files (its
 * photo library included), a path on our own site (the bundled placeholders),
 * or nothing.
 * Anything else - a hotlink to somebody else's server - is refused, because
 * it is a file we neither hold nor vouch for, served into our pages.
 */
function isAllowedUrl(url, owner) {
  if (!url) return true;
  const value = String(url);
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  return ownsKey(keyOf(value), owner);
}

/** The main key plus every sibling a kind writes (thumbnail, poster). */
function keysWithSiblings(key) {
  const kind = key.split('/').at(-2);
  const dot = key.lastIndexOf('.');
  const base = key.slice(0, dot);
  return [key, ...(SIBLINGS[kind] ?? []).map((sibling) => `${base}${sibling.suffix}.${sibling.ext}`)];
}

async function deleteKeys(input) {
  // A library photo is shared by many of its business's records (every iPhone
  // screen shows the same one), so no single record's cleanup may delete it.
  const keys = input.filter((key) => !isNamedKey(key));
  if (!keys.length || !isConfigured()) return;
  try {
    await s3().send(
      new DeleteObjectsCommand({
        Bucket: env.R2_BUCKET,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  } catch (error) {
    console.error(`  Could not delete ${keys.join(', ')} - ${error.message}`);
  }
}

/**
 * Check, optimise and store one upload. Returns the public URL the record will
 * point at, plus `poster` for a video.
 *
 * @param owner `KELINTO`, or a business's `code`.
 * @param kind one of `KINDS`.
 * @param buffer the file's bytes.
 */
async function store({ owner, kind, buffer }) {
  if (!isConfigured()) {
    throw new ApiError(503, 'STORAGE_NOT_CONFIGURED', 'File uploads are not set up on this installation yet.');
  }
  const rule = KINDS[kind];
  if (!rule) throw ApiError.badRequest('Unknown upload kind.', 'UPLOAD_KIND');
  if (!buffer?.length) throw ApiError.badRequest('Choose a file to upload.', 'UPLOAD_EMPTY');

  const found = sniff(buffer);
  if (!found || !rule.families.includes(found.family)) {
    const allowed = rule.families.includes('video')
      ? 'an MP4, MOV or WebM video'
      : rule.families.includes('icon')
        ? 'a PNG, JPEG, WebP, GIF, AVIF or ICO image'
        : 'a PNG, JPEG, WebP, GIF or AVIF image';
    throw ApiError.badRequest(`That file is not ${allowed}.`, 'UPLOAD_TYPE');
  }
  if (buffer.length > rule.maxBytes) {
    throw ApiError.badRequest(
      `That file is ${megabytes(buffer.length)} MB; the limit here is ${megabytes(rule.maxBytes)} MB.`,
      'UPLOAD_TOO_LARGE',
    );
  }

  let files;
  try {
    files = await processUpload(kind, buffer, found);
  } catch (error) {
    console.error(`  Could not process a ${kind} upload - ${error.message}`);
    throw ApiError.badRequest('That file could not be read. Try saving it again from your device, or another file.', 'UPLOAD_UNREADABLE');
  }

  const base = `${ownerPrefix(owner)}/${kind}/${newId()}`;
  const stored = files.map((file) => ({ ...file, key: `${base}${file.suffix}.${file.ext}` }));

  await Promise.all(
    stored.map((file) =>
      s3().send(
        new PutObjectCommand({
          Bucket: env.R2_BUCKET,
          Key: file.key,
          Body: file.buffer,
          ContentType: file.type,
          // A key is never reused (a replacement is a new key), so it can be cached forever.
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      ),
    ),
  );

  const [main] = stored;
  await controlModels().PendingUpload.create({ _id: main.key, owner, kind });

  const poster = stored.find((file) => file.suffix === '-poster');
  return {
    url: publicUrl(main.key),
    key: main.key,
    poster: poster ? publicUrl(poster.key) : null,
    bytes: main.buffer.length + stored.slice(1).reduce((sum, file) => sum + file.buffer.length, 0),
    originalBytes: buffer.length,
  };
}

/**
 * The record using these URLs has been saved: they are no longer pending.
 * Called by every save that accepts an uploaded URL.
 */
async function claim(urls, owner) {
  const keys = (urls ?? []).map(keyOf).filter((key) => ownsKey(key, owner));
  if (!keys.length) return;
  await controlModels()
    .PendingUpload.deleteMany({ _id: { $in: keys } })
    .catch((error) => console.error(`  Could not claim uploads - ${error.message}`));
}

/**
 * The form was discarded: delete these uploads now. **Only files still
 * pending** - a URL a saved record already uses is not pending, so a stale or
 * forged discard can never delete a file that is live on a page.
 */
async function discard(urls, owner) {
  const keys = (urls ?? []).map(keyOf).filter((key) => ownsKey(key, owner));
  if (!keys.length) return 0;
  const { PendingUpload } = controlModels();
  const pending = await PendingUpload.find({ _id: { $in: keys }, owner }).select('_id').lean();
  const doomed = pending.map((row) => row._id);
  await deleteKeys(doomed.flatMap(keysWithSiblings));
  await PendingUpload.deleteMany({ _id: { $in: doomed } });
  return doomed.length;
}

/** Delete every upload left pending for longer than `ABANDONED_AFTER_MS`. */
async function sweepAbandoned() {
  if (!isConfigured()) return 0;
  const { PendingUpload } = controlModels();
  const stale = await PendingUpload.find({ createdAt: { $lt: new Date(Date.now() - ABANDONED_AFTER_MS) } })
    .limit(500)
    .lean();
  if (!stale.length) return 0;
  await deleteKeys(stale.flatMap((row) => keysWithSiblings(row._id)));
  await PendingUpload.deleteMany({ _id: { $in: stale.map((row) => row._id) } });
  return stale.length;
}

/**
 * Delete a file a record no longer points at, with its thumbnail or poster.
 * Only ever this owner's own: a URL outside their prefix is left alone,
 * whoever asks. Never throws - a file left behind costs storage, a failed save
 * costs the edit.
 */
async function release(url, owner) {
  const key = keyOf(url);
  if (!ownsKey(key, owner)) return;
  await deleteKeys(keysWithSiblings(key));
}

/**
 * One of our stored images as a `data:` URI, for a document that is emailed.
 *
 * A mail client will not fetch a remote image until the reader asks it to, and
 * plenty never ask - an invoice whose letterhead is a broken-image icon is worse
 * than no letterhead - so the masthead carries the bytes. Only our own URLs,
 * only images, at most 1 MB, cached for ten minutes. Null on any failure, and
 * the caller then sets the business name in type.
 */
const dataUriCache = new Map();
async function dataUriOf(url) {
  if (!keyOf(url)) return null;
  const hit = dataUriCache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.value;
  let value = null;
  try {
    const response = await fetch(publicUrl(keyOf(url)), { signal: AbortSignal.timeout(4000) });
    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const found = sniff(buffer);
      if (found?.family === 'image' && buffer.length <= 1024 * 1024) {
        value = `data:${found.type};base64,${buffer.toString('base64')}`;
      }
    }
  } catch {
    value = null;
  }
  dataUriCache.set(url, { at: Date.now(), value });
  return value;
}

/**
 * Move a stored file, with its thumbnail or poster, to a new key. For
 * migrations only: a live upload never moves, it is replaced by a new key.
 * Copies everything first and deletes only once every copy has landed, so a
 * failure part-way leaves the original intact. Returns the new key.
 */
async function moveKey(fromKey, toKey) {
  if (!isConfigured()) throw new Error('R2 is not configured');
  const from = keysWithSiblings(fromKey);
  const to = keysWithSiblings(toKey);
  for (let i = 0; i < from.length; i += 1) {
    try {
      await s3().send(
        new CopyObjectCommand({
          Bucket: env.R2_BUCKET,
          CopySource: `${env.R2_BUCKET}/${encodeURIComponent(from[i]).replace(/%2F/g, '/')}`,
          Key: to[i],
          // The default: content type and cache headers travel with the copy.
          MetadataDirective: 'COPY',
        }),
      );
    } catch (error) {
      // A sibling that was never written (an older upload) is not a failure.
      if (i === 0 || error.name !== 'NoSuchKey') throw error;
    }
  }
  await deleteKeys(from);
  return toKey;
}

/**
 * After a save: claim what the record now uses, and delete what it stopped
 * using. Every save that takes uploaded URLs calls this and nothing else.
 */
async function releaseReplaced(before, after, owner) {
  // Compared as keys: one side is usually stored keys and the other the
  // addresses a form sent, and comparing those as strings would read every
  // file still in use as "replaced" and delete it.
  const asKey = (value) => keyOf(value) ?? value;
  const kept = new Set((after ?? []).filter(Boolean).map(asKey));
  await claim([...kept], owner);
  await Promise.all(
    (before ?? [])
      .filter(Boolean)
      .map(asKey)
      .filter((key) => !kept.has(key))
      .map((key) => release(key, owner)),
  );
}

/**
 * Every key under a prefix (paged), for the seeds that read a business's photo
 * library rather than a folder on disk.
 */
async function listKeys(prefix) {
  if (!isConfigured()) return [];
  const keys = [];
  let token;
  do {
    const page = await s3().send(
      new ListObjectsV2Command({ Bucket: env.R2_BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const item of page.Contents ?? []) keys.push(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Is there an object at this key? For migrations that copy only what is missing. */
async function hasKey(key) {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

/**
 * Copy one object as it is, leaving the original. For migrations only (the
 * photo library's move under each business): a live upload goes through
 * `store`, which checks and optimises everything.
 */
async function copyKey(fromKey, toKey) {
  if (!isConfigured()) throw new Error('R2 is not configured');
  await s3().send(
    new CopyObjectCommand({
      Bucket: env.R2_BUCKET,
      CopySource: `${env.R2_BUCKET}/${encodeKey(fromKey)}`,
      Key: toKey,
      MetadataDirective: 'COPY',
    }),
  );
}

const storage = {
  KINDS,
  listKeys,
  hasKey,
  copyKey,
  MAX_UPLOAD_BYTES,
  isConfigured,
  isAllowedUrl,
  store,
  claim,
  discard,
  sweepAbandoned,
  release,
  releaseReplaced,
  publicUrl,
  keyOf,
  toKey,
  urlOf,
  dataUriOf,
  moveKey,
  KELINTO,
};

export {
  KINDS,
  listKeys,
  hasKey,
  copyKey,
  MAX_UPLOAD_BYTES,
  sniff,
  ownerPrefix,
  isConfigured,
  isAllowedUrl,
  store,
  claim,
  discard,
  sweepAbandoned,
  release,
  releaseReplaced,
  publicUrl,
  keyOf,
  toKey,
  urlOf,
  dataUriOf,
  moveKey,
  KELINTO,
};
export default storage;
