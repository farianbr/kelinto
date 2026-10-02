import ApiError, { asyncHandler } from '../utils/ApiError.js';
import * as catalogService from '../services/catalogService.js';
import auditService from '../services/auditService.js';

/**
 * Catalogue categories (ERP › Settings › Taxonomy; was Product categories, 2026-10-01).
 *
 * Writes are audited like a taxonomy edit: a category is a page on the
 * website and a tree behind it, so one appearing or going dark needs a name
 * against it.
 */

/** The website's own list: active categories, for the Shop menu. */
const publicList = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  const categories = await catalogService.listCategories({ includeInactive: false });
  res.json({
    categories: categories.map(({ slug, name, kind, description, facetLabel, levels, grades, address, path }) => ({
      slug,
      name,
      kind,
      description,
      facetLabel,
      levels,
      grades,
      address,
      path,
    })),
  });
});

/** One active category, for a category page to configure itself from. */
const publicGet = asyncHandler(async (req, res) => {
  const { slug, name, kind, description, facetLabel, levels, grades, address, path } = await catalogService.getCategory(
    req.params.slug,
    { activeOnly: true },
  );
  res.json({ category: { slug, name, kind, description, facetLabel, levels, grades, address, path } });
});

/** The type at a web address (`/catalogue/<address>`), or a 404 that says so. */
const publicAtAddress = asyncHandler(async (req, res) => {
  const category = await catalogService.categoryAtAddress(req.params.address);
  if (!category) throw ApiError.notFound('That section is not on sale.', 'CATEGORY_NOT_FOUND');
  const { slug, name, kind, description, facetLabel, levels, grades, address, path } = category;
  res.json({ category: { slug, name, kind, description, facetLabel, levels, grades, address, path } });
});

/** Whether a web address is free for a type, as it is typed. */
const slugCheck = asyncHandler(async (req, res) => {
  res.json(await catalogService.slugAvailability(String(req.query.slug ?? ''), req.query.except ? String(req.query.except) : null));
});

const list = asyncHandler(async (req, res) => {
  res.json({ categories: await catalogService.listCategories({ withCounts: true }) });
});

const create = asyncHandler(async (req, res) => {
  const category = await catalogService.createCategory(req.body);
  await auditService.recordChange({
    req,
    action: 'catalog-category.create',
    entity: { kind: 'catalog-category', id: category.slug, label: category.name },
    before: null,
    after: { name: category.name, slug: category.slug, levels: category.levels },
    description: `Added the product category ${category.name}.`,
  });
  res.status(201).json({ category });
});

const update = asyncHandler(async (req, res) => {
  const before = await catalogService.getCategory(req.params.slug);
  const category = await catalogService.updateCategory(req.params.slug, req.body);
  await auditService.recordChange({
    req,
    action: 'catalog-category.update',
    entity: { kind: 'catalog-category', id: category.slug, label: category.name },
    before,
    after: category,
    fields: ['name', 'description', 'facetLabel', 'facetRequired', 'levels', 'grades', 'isActive', 'order', 'attributes'],
    description: `Updated the product category ${category.name}.`,
  });
  res.json({ category });
});

export { publicList, publicGet, publicAtAddress, slugCheck, list, create, update };
