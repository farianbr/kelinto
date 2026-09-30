import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import ffmpegStatic from 'ffmpeg-static';

/**
 * Every uploaded file is optimised ONCE, on the server, before it is stored.
 *
 * ## Why at upload, and not when shown
 *
 * A file is uploaded once and viewed thousands of times. Resizing on every
 * view needs an image service in front of R2 (paid, and one more moving part)
 * or burns our own CPU per request; resizing in the browser before upload
 * trusts whatever the browser sends. Doing it here means R2 holds only the
 * small, finished file, every visitor downloads that, and it is cached forever
 * (`storageService` stores every key as immutable).
 *
 * ## What each kind becomes
 *
 * | kind | output | why |
 * |---|---|---|
 * | logo, footer-logo | PNG, palette-quantised, trimmed to the artwork, at most 1200 × 400 (footer 2800 × 600, it spans the footer) | flat colour and transparency compress best as a small palette; PNG is the one format every mail client shows, and the logo is embedded in invoices |
 * | favicon | PNG 192 × 192 (ICO kept as sent) | covers browser tabs, pinned tabs and home-screen icons at every density |
 * | product-image | WebP at most 1600 px, plus a 480 px WebP beside it (`-480`) | a card is ~300 px wide, so it loads the small one; the product page and zoom load the large one |
 * | review-photo | WebP 160 × 160, cropped square from the centre | drawn as a 64 px disc beside a Google review; 160 covers a 2.5x screen |
 * | product-video | H.264 MP4, at most 1280 px, CRF 28 (veryfast, so a 2-minute clip finishes inside a proxy timeout), fast-start, plus a WebP poster (`-poster`) | plays everywhere including Safari; fast-start begins playing before the whole file arrives; the poster is all a visitor downloads until they press play |
 *
 * Metadata (EXIF, GPS from a phone photo, colour profiles beyond sRGB) is
 * stripped by sharp's defaults, which both shrinks the file and stops a staff
 * member's phone location being published with a product picture.
 */

// A small VPS: one image at a time, and no in-memory cache of decoded images.
sharp.concurrency(1);
sharp.cache(false);

const LOGO_BOX = { width: 1200, height: 400 };
const REVIEW_PHOTO_SIZE = 160;
// The footer logo spans the whole footer panel (up to ~1400 px wide), so it
// keeps enough width to stay sharp on a 2x screen.
const FOOTER_BOX = { width: 2800, height: 600 };
const FAVICON_SIZE = 192;
const PRODUCT_MAX = 1600;
const PRODUCT_THUMB = 480;
const VIDEO_MAX = 1280;
const VIDEO_MAX_SECONDS = 120;
const VIDEO_TIMEOUT_MS = 4 * 60 * 1000;

/**
 * One output file. `suffix` is added to the key before the extension, so the
 * main file is `<id>.webp` and its thumbnail `<id>-480.webp`.
 */
function out(buffer, type, ext, suffix = '') {
  return { buffer, type, ext, suffix };
}

/**
 * Never make a file bigger. An upload that is already in the target format,
 * already within the size box, and smaller than what we produced was optimised
 * by whoever made it; keep it. Its metadata is removed all the same (a bare
 * re-save with no re-encode is not possible for every format, so the smaller
 * of the two re-encodes is kept only when the input carries none).
 */
async function smallest(buffer, produced, format, box) {
  const meta = await sharp(buffer).metadata();
  const fits = (meta.width ?? Infinity) <= box.width && (meta.height ?? Infinity) <= box.height;
  const clean = !meta.exif && !meta.xmp && !meta.iptc;
  return meta.format === format && fits && clean && buffer.length < produced.length ? buffer : produced;
}

/**
 * The artwork without the empty margin around it.
 *
 * Logos arrive on a canvas with transparent or white space on every side, and
 * the website draws a logo at a fixed HEIGHT (36 px in the header), so every
 * pixel of margin shrinks the mark itself: CellShoppe's footer wordmark filled
 * a third of its canvas and rendered as a speck. Trimmed to the ink, the
 * height is all mark - which is how the original artwork was prepared.
 * An image with nothing to trim (or nothing but margin) is used as it is.
 */
async function trimmed(buffer) {
  try {
    return await sharp(buffer, { animated: false }).rotate().trim({ threshold: 12 }).toBuffer();
  } catch {
    return buffer;
  }
}

async function logo(buffer, box = LOGO_BOX) {
  const source = await trimmed(buffer);
  const png = await sharp(source)
    .resize({ ...box, fit: 'inside', withoutEnlargement: true })
    .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
    .toBuffer();
  // Compared with the TRIMMED source, so keeping the smaller never brings the
  // margin back.
  return [out(await smallest(source, png, 'png', box), 'image/png', 'png')];
}

async function favicon(buffer, found) {
  // sharp cannot read ICO. An ICO is already a favicon at its own sizes, and
  // the 512 KB ceiling keeps it small.
  if (found.ext === 'ico') return [out(buffer, 'image/x-icon', 'ico')];
  const png = await sharp(buffer, { animated: false })
    .rotate()
    .resize(FAVICON_SIZE, FAVICON_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ palette: true, quality: 95, effort: 10, compressionLevel: 9 })
    .toBuffer();
  return [out(png, 'image/png', 'png')];
}

/** A reviewer's face, square, for the disc beside a Google review. */
async function reviewPhoto(buffer) {
  const webp = await sharp(buffer, { animated: false })
    .rotate()
    .resize(REVIEW_PHOTO_SIZE, REVIEW_PHOTO_SIZE, { fit: 'cover', position: 'centre' })
    .webp({ quality: 78, effort: 5 })
    .toBuffer();
  return [out(webp, 'image/webp', 'webp')];
}

async function productImage(buffer) {
  const base = sharp(buffer, { animated: false }).rotate();
  const [full, thumb] = await Promise.all([
    base
      .clone()
      .resize({ width: PRODUCT_MAX, height: PRODUCT_MAX, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80, effort: 5, smartSubsample: true })
      .toBuffer(),
    base
      .clone()
      .resize({ width: PRODUCT_THUMB, height: PRODUCT_THUMB, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75, effort: 5, smartSubsample: true })
      .toBuffer(),
  ]);
  const main = await smallest(buffer, full, 'webp', { width: PRODUCT_MAX, height: PRODUCT_MAX });
  return [out(main, 'image/webp', 'webp'), out(thumb, 'image/webp', 'webp', `-${PRODUCT_THUMB}`)];
}

// ---- video -------------------------------------------------------------------

/** `FFMPEG_PATH` wins, for a server with its own build; else the bundled one. */
const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || null;

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, args, { timeout: VIDEO_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

/**
 * One video at a time across the process. A transcode takes the whole CPU for
 * tens of seconds; two at once would only make both slower and starve the API.
 */
let queue = Promise.resolve();
function serially(task) {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

/** The longest side at most `VIDEO_MAX`, both sides even (H.264 requires it). */
const SCALE = `scale='if(gte(iw,ih),min(${VIDEO_MAX},iw),-2)':'if(gte(iw,ih),-2,min(${VIDEO_MAX},ih))'`;

async function productVideo(buffer, found) {
  if (!FFMPEG) {
    // No encoder on this server: keep the upload as it is. It still passed the
    // type and size checks; it is simply not made smaller.
    console.warn('  Video stored unprocessed: no ffmpeg available (set FFMPEG_PATH).');
    return [out(buffer, found.type, found.ext)];
  }

  return serially(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kelinto-video-'));
    const input = path.join(dir, `in.${found.ext}`);
    const video = path.join(dir, 'out.mp4');
    const poster = path.join(dir, 'poster.jpg');
    try {
      await fs.writeFile(input, buffer);
      await run([
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', input,
        '-t', String(VIDEO_MAX_SECONDS),
        '-vf', SCALE,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
        '-profile:v', 'high', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-ac', '2',
        '-movflags', '+faststart',
        '-map_metadata', '-1',
        video,
      ]);
      // The frame one second in: the first frame is often black.
      await run(['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', video, '-frames:v', '1', '-q:v', '3', poster])
        .catch(() => run(['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-frames:v', '1', '-q:v', '3', poster]));

      const [encoded, still] = await Promise.all([fs.readFile(video), fs.readFile(poster).catch(() => null)]);
      // A file that was already well encoded can come out larger. Keep the
      // original then, if the browser can play it (MP4); WebM becomes MP4
      // regardless, because Safari will not play it everywhere.
      const keepOriginal = found.ext === 'mp4' && encoded.length >= buffer.length;
      const files = [keepOriginal ? out(buffer, 'video/mp4', 'mp4') : out(encoded, 'video/mp4', 'mp4')];
      if (still) {
        const webp = await sharp(still).resize({ width: 960, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
        files.push(out(webp, 'image/webp', 'webp', '-poster'));
      }
      return files;
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

/**
 * Optimise one upload. Returns the files to store; the first is the one the
 * record points at, the rest are siblings named by suffix.
 *
 * Throws only for a file that cannot be decoded at all, which the caller turns
 * into "that file could not be read".
 */
async function processUpload(kind, buffer, found) {
  switch (kind) {
    case 'logo':
      return logo(buffer);
    case 'footer-logo':
      return logo(buffer, FOOTER_BOX);
    case 'favicon':
      return favicon(buffer, found);
    case 'product-image':
      return productImage(buffer);
    case 'review-photo':
      return reviewPhoto(buffer);
    case 'product-video':
      return productVideo(buffer, found);
    default:
      return [out(buffer, found.type, found.ext)];
  }
}

/** The sibling suffixes each kind writes, so deleting a file deletes them too. */
const SIBLINGS = {
  'product-image': [{ suffix: `-${PRODUCT_THUMB}`, ext: 'webp' }],
  'product-video': [{ suffix: '-poster', ext: 'webp' }],
};

/** A short random id for a key. */
function newId() {
  return crypto.randomUUID();
}

export { processUpload, SIBLINGS, PRODUCT_THUMB, newId };
export default { processUpload, SIBLINGS, PRODUCT_THUMB, newId };
