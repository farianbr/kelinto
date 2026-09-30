import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';

import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { newId } from './mediaProcessor.js';
import { ownerPrefix, sniff } from './storageService.js';

/**
 * Personal files: a private R2 bucket nobody can read by URL.
 *
 * ## Why a second bucket rather than a folder
 *
 * `storageService` writes to a bucket with public access switched on, which is
 * right for logos and product pictures and wrong for a customer's face. Public
 * access in R2 is per bucket: a "private" folder inside a public bucket is a
 * folder whose URLs nobody has guessed yet. So personal files go to
 * `R2_PRIVATE_BUCKET`, which has no public address at all, and come back out
 * only through the server (`read`), behind a staff permission and an audit row.
 *
 * ## What it keeps
 *
 * The photo a seller takes at the kiosk, re-encoded once on the way in: EXIF
 * stripped (a phone photo carries GPS), rotated upright, 800px on the long
 * side, WebP. Enough to recognise a face at the counter and no more.
 *
 * Keys follow the public bucket's layout, `businesses/<code>/identity-photo/<id>.webp`,
 * so whose file it is can be read off the key alone.
 */

const KIND = 'identity-photo';
const MAX_BYTES = 8 * 1024 * 1024;

function isConfigured() {
  return Boolean(
    env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_PRIVATE_BUCKET,
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

/**
 * A `data:image/...;base64,` string, as the kiosk's camera produces it, to bytes.
 *
 * The kiosk sends the photo inside the sale itself rather than uploading it
 * first, so a customer who walks away halfway leaves no orphaned face in a
 * bucket: nothing is stored until the sale is.
 */
function bytesOfDataUrl(value) {
  const match = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(value ?? ''));
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

/** Store a seller's photo. Returns the private key the record keeps. */
async function storeIdentityPhoto({ owner, dataUrl }) {
  if (!isConfigured()) {
    throw new ApiError(
      503,
      'PRIVATE_STORAGE_NOT_CONFIGURED',
      'Photos cannot be taken on this kiosk yet. Please ask a member of staff.',
    );
  }

  const buffer = bytesOfDataUrl(dataUrl);
  if (!buffer?.length) throw ApiError.badRequest('Take a photo to continue.', 'PHOTO_REQUIRED');
  if (buffer.length > MAX_BYTES) throw ApiError.badRequest('That photo is too large.', 'PHOTO_TOO_LARGE');

  const found = sniff(buffer);
  if (found?.family !== 'image') throw ApiError.badRequest('That photo could not be read.', 'PHOTO_TYPE');

  let webp;
  try {
    webp = await sharp(buffer)
      .rotate()
      .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw ApiError.badRequest('That photo could not be read. Please take it again.', 'PHOTO_UNREADABLE');
  }

  const key = `${ownerPrefix(owner)}/${KIND}/${newId()}.webp`;
  await s3().send(
    new PutObjectCommand({
      Bucket: env.R2_PRIVATE_BUCKET,
      Key: key,
      Body: webp,
      ContentType: 'image/webp',
      CacheControl: 'private, no-store',
    }),
  );
  return key;
}

/** The bytes of a private file, for the ERP route that streams it to staff. */
async function read(key) {
  if (!isConfigured() || !key) return null;
  try {
    const result = await s3().send(new GetObjectCommand({ Bucket: env.R2_PRIVATE_BUCKET, Key: key }));
    const bytes = Buffer.from(await result.Body.transformToByteArray());
    return { bytes, contentType: result.ContentType ?? 'image/webp' };
  } catch (error) {
    console.error(`  Could not read private file ${key} - ${error.message}`);
    return null;
  }
}

export { isConfigured, storeIdentityPhoto, read };
export default { isConfigured, storeIdentityPhoto, read };
