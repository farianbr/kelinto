import { asyncHandler } from '../utils/ApiError.js';
import * as taxonomyService from '../services/taxonomyService.js';
import * as catalogService from '../services/catalogService.js';

/**
 * The category tree, optionally pruned to the selected component types.
 *
 * `?partType=battery` returns only the branches that stock a battery, counted
 * by batteries - what the wizard needs once the buyer has answered step 1.
 * Component type is MULTI-SELECT, so `?partType=battery,screen-assembly` prunes
 * to the branches stocking either and counts both. Without it the response is
 * the full tree.
 *
 * `String()` rather than a bare pass-through: `app.js` sets the query parser to
 * braces-off, but a repeated `?partType=a&partType=b` still arrives as an array
 * and anything reaching a `$in` must be a list of strings, never an object.
 */
const tree = asyncHandler(async (req, res) => {
  const raw = req.query.partType;
  const partType = Array.isArray(raw)
    ? raw.map((item) => String(item).trim()).filter(Boolean).join(',')
    : typeof raw === 'string'
      ? raw.trim()
      : '';

  /**
   * `?category=` picks the catalogue category's tree (2026-10-01): Parts by
   * default, so every existing caller is unchanged. Phones are products like
   * any type since 2026-10-02 and take the product tree; Services count the services that apply
   * to each device, and their first step is the repair type.
   */
  const slug = typeof req.query.category === 'string' && req.query.category.trim() ? req.query.category.trim() : 'parts';
  const category = slug === 'parts' ? { slug, kind: 'part' } : await catalogService.getCategory(slug, { activeOnly: true });

  if (category.kind === 'service') {
    const [treePayload, componentTypes] = await Promise.all([
      catalogService.serviceTree(partType ? partType.split(',') : []),
      catalogService.serviceTypes(),
    ]);
    res.json({ ...treePayload, componentTypes });
    return;
  }

  // Component types ride along on every response: they are step 1 of the wizard
  // and never change with the path, so fetching them separately would be a
  // second round trip for a list the first response could have carried.
  const [treePayload, components] = await Promise.all([
    partType
      ? taxonomyService.getTreeForPartType(partType, category.slug)
      : taxonomyService.getTree({ category: category.slug }),
    taxonomyService.getComponentTypes(category.slug),
  ]);

  res.json({ ...treePayload, ...components });
});

export { tree };
