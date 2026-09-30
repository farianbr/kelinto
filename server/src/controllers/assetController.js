import multer from 'multer';
import ApiError, { asyncHandler } from '../utils/ApiError.js';
import { currentContext, runInBusiness } from '../db/context.js';
import { controlModels } from '../db/models.js';
import '../models/PlatformSettings.js';
import storage, { MAX_UPLOAD_BYTES } from '../services/storageService.js';
import auditService from '../services/auditService.js';
import { invalidatePlatformIdentity } from '../utils/pageIdentity.js';

/**
 * File uploads into R2 (`services/storageService.js`).
 *
 * One field (`file`), held in memory for as long as it takes to check its
 * bytes and send it on - nothing touches the server's disk. The parser's own
 * ceiling is the largest kind's; each kind is then held to its own.
 */
const parse = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0, parts: 1 },
}).single('file');

/**
 * The parser, with its failures turned into the API's own error shape.
 *
 * **The business context is carried across by hand.** multer finishes from a
 * stream event, and `AsyncLocalStorage` does not follow a callback fired from
 * there - so everything after the parser ran with no business: no code to name
 * the upload's folder ("No business to store this for.") and `db()` pointing
 * at the default connection. The context is captured before parsing and
 * re-entered when the parser hands back.
 */
function acceptFile(req, res, next) {
  const context = currentContext();
  parse(req, res, (error) => {
    const resume = (fn) => (context ? runInBusiness(context, fn) : fn());
    resume(() => {
      if (!error) return next();
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(ApiError.badRequest('That file is too large.', 'UPLOAD_TOO_LARGE'));
      }
      return next(ApiError.badRequest('Send one file, in a field named "file".', 'UPLOAD_MALFORMED'));
    });
  });
}

/**
 * Which upload slots a business may fill, and which ERP permission each needs.
 * The permission is checked by the route (`requirePermission`); this only
 * names which slot the request is for.
 */
const BUSINESS_KINDS = {
  identity: ['logo', 'footer-logo', 'favicon'],
  catalogue: ['product-image', 'product-video'],
  // A reviewer's picture beside a Google review (SEO › Reviews).
  marketing: ['review-photo'],
};

/** A business's own file. Stored under that business's code, never another's. */
function uploadForBusiness(group) {
  return asyncHandler(async (req, res) => {
    const kind = String(req.query.kind ?? '');
    if (!BUSINESS_KINDS[group].includes(kind)) throw ApiError.badRequest('Unknown upload kind.', 'UPLOAD_KIND');
    const code = currentContext()?.code;
    if (!code) throw ApiError.badRequest('No business is selected.', 'NO_BUSINESS');

    const stored = await storage.store({ owner: code, kind, buffer: req.file?.buffer });
    await auditService.record({
      req,
      kind: 'activity',
      action: 'asset.upload',
      entity: { kind: group === 'catalogue' ? 'product' : 'settings', id: stored.key, label: kind },
      description: `Uploaded a ${kind.replace('-', ' ')} (${Math.round(stored.originalBytes / 1024)} KB, stored as ${Math.round(stored.bytes / 1024)} KB).`,
    });
    res.status(201).json({ url: stored.url, poster: stored.poster });
  });
}

/**
 * A form was discarded or left without saving: delete what it uploaded.
 *
 * Only files still pending are touched (`storageService.discard`), so this
 * cannot delete anything a saved record uses. Answers 204 whatever it found,
 * because it is also sent from a page that is closing and nobody reads it.
 */
const discardForBusiness = asyncHandler(async (req, res) => {
  const code = currentContext()?.code;
  const urls = Array.isArray(req.body?.urls) ? req.body.urls.slice(0, 20).map(String) : [];
  if (code) await storage.discard(urls, code);
  res.status(204).end();
});

const discardPlatformAssets = asyncHandler(async (req, res) => {
  const urls = Array.isArray(req.body?.urls) ? req.body.urls.slice(0, 20).map(String) : [];
  await storage.discard(urls, storage.KELINTO);
  res.status(204).end();
});

/** Kelinto's own logo or favicon, from the console. */
const uploadPlatformAsset = asyncHandler(async (req, res) => {
  const kind = String(req.query.kind ?? '');
  if (!['logo', 'favicon'].includes(kind)) throw ApiError.badRequest('Unknown upload kind.', 'UPLOAD_KIND');
  const stored = await storage.store({ owner: storage.KELINTO, kind, buffer: req.file?.buffer });
  res.status(201).json({ url: stored.url, poster: stored.poster });
});

/** Kelinto's identity. Public: the landing page and the ERP sign-in draw it. */
const platformBrand = asyncHandler(async (_req, res) => {
  const settings = await controlModels().PlatformSettings.load();
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    logoUrl: storage.urlOf(settings.logoUrl ?? ''),
    faviconUrl: storage.urlOf(settings.faviconUrl ?? ''),
    uploads: storage.isConfigured(),
  });
});

/** Set Kelinto's logo and favicon. Either may be cleared back to the default. */
const updatePlatformBrand = asyncHandler(async (req, res) => {
  const { PlatformSettings } = controlModels();
  const before = await PlatformSettings.load();
  const next = {};
  for (const field of ['logoUrl', 'faviconUrl']) {
    if (req.body?.[field] === undefined) continue;
    const value = String(req.body[field] ?? '').trim();
    if (!storage.isAllowedUrl(value, storage.KELINTO)) {
      throw ApiError.badRequest('Upload the file here rather than linking to another site.', 'ASSET_NOT_OURS');
    }
    // Kept as a key, so a new public address needs no rewrite.
    next[field] = storage.toKey(value);
  }
  const after = await PlatformSettings.findOneAndUpdate({ key: 'singleton' }, { $set: next }, { new: true, lean: true });
  await storage.releaseReplaced([before.logoUrl, before.faviconUrl], [after.logoUrl, after.faviconUrl], storage.KELINTO);
  invalidatePlatformIdentity();
  res.json({
    logoUrl: storage.urlOf(after.logoUrl ?? ''),
    faviconUrl: storage.urlOf(after.faviconUrl ?? ''),
    uploads: storage.isConfigured(),
  });
});

export {
  acceptFile,
  uploadForBusiness,
  uploadPlatformAsset,
  discardForBusiness,
  discardPlatformAssets,
  platformBrand,
  updatePlatformBrand,
};
