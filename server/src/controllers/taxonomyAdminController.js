import { asyncHandler } from '../utils/ApiError.js';
import taxonomyAdminService from '../services/taxonomyAdminService.js';
import auditService from '../services/auditService.js';

/**
 * The taxonomy editor (§6.15 - CellShoppe's *Device & Models*, phase 11d).
 *
 * Edits and deactivations are audited: the taxonomy decides what the storefront
 * can be filtered by, so "why did this brand disappear from the mega menu" needs
 * an answer. Structure - `kind`, `slug`, `parent` - is deliberately not editable
 * at all, so there is nothing to log for it.
 */

const list = asyncHandler(async (req, res) => {
  res.json(await taxonomyAdminService.list(req.query));
});

const get = asyncHandler(async (req, res) => {
  res.json(await taxonomyAdminService.get(req.params.id));
});

/**
 * Adds a model, creating whatever part of its branch is missing.
 *
 * Audited like every other taxonomy write: this screen decides what the
 * storefront's filters and every product picker offer, so a node appearing
 * with nobody's name on it is a change nobody can account for. The log records
 * the whole branch, because "added iPhone 17" does not say that a `Google`
 * brand node was created alongside it.
 */
const create = asyncHandler(async (req, res) => {
  const result = await taxonomyAdminService.create(req.body);

  await auditService.recordChange({
    req,
    action: 'taxonomy.create',
    entity: { kind: 'taxonomy', id: result.node.id, label: result.node.name },
    before: null,
    after: {
      name: result.node.name,
      slug: result.node.slug,
      path: result.node.path,
      aliases: result.node.aliases,
    },
    description: `Added the device model ${result.node.name}.`,
  });

  res.status(201).json(result);
});

/**
 * Bulk import from CSV.
 *
 * The file is read in the browser and posted as text, rather than uploaded as
 * a multipart file: this codebase has no upload middleware, and a CSV of device
 * models is a few tens of kilobytes. `express.json` caps the body at 1mb, which
 * is the real limit the screen quotes.
 *
 * Audited as one event, not one per row. A hundred rows is one action a staff
 * member took, and a hundred log entries would bury every other change made
 * that day.
 */
const importCsv = asyncHandler(async (req, res) => {
  const result = await taxonomyAdminService.importCsv(req.body.text);

  await auditService.recordChange({
    req,
    action: 'taxonomy.import',
    entity: { kind: 'taxonomy', id: 'import', label: 'Device models' },
    before: null,
    after: { added: result.added, updated: result.updated, skipped: result.skipped },
    description: `Imported device models: ${result.added} added, ${result.updated} updated, ${result.skipped} skipped.`,
  });

  res.json(result);
});

const update = asyncHandler(async (req, res) => {
  const before = await taxonomyAdminService.get(req.params.id).catch(() => null);
  const result = await taxonomyAdminService.update(req.params.id, req.body);

  await auditService.recordChange({
    req,
    action: 'taxonomy.update',
    entity: { kind: 'taxonomy', id: req.params.id, label: result.node.name },
    before: before
      ? {
          name: before.node.name,
          aliases: before.node.aliases,
          isActive: before.node.isActive,
          isFeatured: before.node.isFeatured,
        }
      : null,
    after: {
      name: result.node.name,
      aliases: result.node.aliases,
      isActive: result.node.isActive,
      isFeatured: result.node.isFeatured,
    },
    description: `Updated the taxonomy entry ${result.node.name}.`,
  });

  res.json(result);
});

const remove = asyncHandler(async (req, res) => {
  const before = await taxonomyAdminService.get(req.params.id).catch(() => null);
  const result = await taxonomyAdminService.remove(req.params.id);

  await auditService.record({
    req,
    action: 'taxonomy.delete',
    entity: { kind: 'taxonomy', id: req.params.id, label: result.name },
    before: before ? { name: before.node.name, kind: before.node.kind } : null,
    description: `Deleted the taxonomy entry ${result.name}.`,
  });

  res.json(result);
});

export { list, get, create, importCsv, update, remove };
