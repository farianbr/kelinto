import { z } from 'zod';

/**
 * Catalogue categories (client ruling, 2026-10-01).
 *
 * A category is a section of what a business sells on its website, each with
 * its own taxonomy tree and its own shop page built like the Parts page:
 * the finder across the top, the filter rail, the grid. Three ship with every
 * business and cannot be removed; staff add more in ERP › Settings › Taxonomy
 * (an "Accessories" category, say), then set up its finder tree from there.
 *
 * ## `kind` decides what an item IS, not what it is called
 *
 * The three kinds sell through three different records, because the things
 * themselves behave differently and the codebase already models each one:
 *
 * - `part`: a `Product`, with stock, a grade and a quantity (Parts, and any
 *   category a business adds).
 * - `phone`: a `PreownedDevice`, one handset sold once.
 * - `service`: a `Service`, labour priced from the business's own list.
 *
 * A new category is always `part`: it is more products, filed under their own
 * tree. Phones and services already have their category.
 *
 * ## Taxonomy per category
 *
 * Every category's tree uses the same levels (device type, brand, series,
 * model, up to six), each relabelled to suit: a service is filtered by the device it is
 * done to, a phone by what it is. Nodes carry `Taxonomy.category`; the Parts
 * tree is every node from before categories existed, so a node with no
 * category is a Parts node and nothing had to be migrated. Other categories'
 * node slugs are prefixed with the category's slug, because node slugs are
 * unique across the whole collection and "apple" already names Parts' Apple.
 */

/**
 * `phone` is retired (2026-10-02): Phones are products with stock now, like
 * any type a business adds ("phones also have stocks"). The value stays in
 * the model's enum only so an older record still reads.
 */
export const CATEGORY_KINDS = [
  { value: 'part', label: 'Products with stock' },
  { value: 'service', label: 'Repair services' },
];

/**
 * Every tree level a category can have, in order (2026-10-02). The first four
 * are the ones Parts has always used; `level5` and `level6` let a product
 * type go deeper. A product files under each as `<key>Slug` / `<key>Name`,
 * and the website filters on each as `?<key>=`, exactly like the first four.
 *
 * A type's FIRST level may also be `partType` (Component Type on Parts,
 * Repair Type on Services): a level like the others in the ERP, its entries
 * tree entries of kind `partType`, stored on an item as `Product.partType` /
 * `Service.category`. It is held on the type as `facetLabel` +
 * `facetRequired` beside `levels`, which is what the website's filters have
 * always read; the ERP shows the two as one list (`categoryLevels`).
 *
 * Services stay at four tree levels: its tree is copied from the serviced
 * items list (`DeviceCatalog`), which has four.
 */
export const FIRST_LEVEL_KEY = 'partType';
export const TREE_LEVEL_KEYS = ['deviceType', 'brand', 'series', 'model', 'level5', 'level6'];
export const MAX_LEVELS = TREE_LEVEL_KEYS.length;
/** The deepest a Services tree goes. */
export const SYSTEM_MAX_LEVELS = 4;

/** What a level is called before a business names it. */
export const DEFAULT_LEVEL_LABELS = {
  deviceType: 'Device Type',
  brand: 'Brand',
  series: 'Series',
  model: 'Model',
  level5: 'Variant',
  level6: 'Option',
};

const levels = (deviceType = 'Device Type', required = true) => [
  { key: 'deviceType', label: deviceType, required },
  { key: 'brand', label: 'Brand', required },
  { key: 'series', label: 'Series', required },
  { key: 'model', label: 'Model', required },
];

/**
 * A type's levels as the ERP shows them: its first level (when it has one)
 * then its tree levels, every one `{ key, label, required }`. One list, so
 * the type form, the tree table, the add form and the product and service
 * forms treat every level alike.
 */
export function categoryLevels(category) {
  const tree = (category?.levels?.length ? category.levels : levels()).map((level) => ({
    key: level.key,
    label: level.label,
    required: level.required !== false,
  }));
  return category?.facetLabel
    ? [{ key: FIRST_LEVEL_KEY, label: category.facetLabel, required: category.facetRequired !== false }, ...tree]
    : tree;
}

/**
 * A type's condition grades (2026-10-02, "grade per type"): what `Product.grade`
 * may hold for its products. `value` is stored and kept through renames;
 * `label` is what a buyer reads. Parts keep the five they always had.
 */
export const PART_GRADES = [
  { value: 'NEW', label: 'New' },
  { value: 'OEM', label: 'OEM' },
  { value: 'PULL-A', label: 'Pull Grade A' },
  { value: 'PULL-B', label: 'Pull Grade B' },
  { value: 'AFTERMARKET', label: 'Aftermarket' },
];

export const PHONE_GRADES = [
  { value: 'EXCELLENT', label: 'Excellent' },
  { value: 'GOOD', label: 'Good' },
  { value: 'FAIR', label: 'Fair' },
];

export const GRADE_VALUE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,23}$/;

export const gradeValueOf = (label) =>
  String(label ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 24);

/** A grade as a reader sees it, from the type's list, else the value tidied. */
export function gradeLabelOf(grades, value) {
  const found = (grades ?? []).find((grade) => grade.value === value);
  if (found) return found.label;
  const text = String(value ?? '').replace(/[-_]+/g, ' ').toLowerCase();
  return text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/**
 * What a phone is told apart by, before a business edits it: the Phones
 * type's starting features. Storage and colour are the type's own
 * definitions in Settings › Taxonomy, like any feature a business adds for
 * its own types (Mileage, Year on a Cars type).
 */
export const PHONE_FEATURES = [
  {
    key: 'storage',
    label: 'Storage',
    type: 'select',
    options: ['64 GB', '128 GB', '256 GB', '512 GB', '1 TB'],
    unit: '',
    required: true,
    inventory: true,
    filter: true,
    product: true,
  },
  {
    key: 'colour',
    label: 'Colour',
    type: 'select',
    options: [
      'Black',
      'White',
      'Blue',
      'Midnight',
      'Purple',
      'Red',
      'Yellow',
      'Gold',
      'Green',
      'Pink',
      'Teal',
      'Ultramarine',
      'Black Titanium',
      'Blue Titanium',
      'Natural Titanium',
      'White Titanium',
      'Desert Titanium',
    ],
    unit: '',
    required: true,
    inventory: true,
    filter: true,
    product: true,
  },
];

/**
 * The Services finder's first step before a business edits it: the repair
 * types every service was filed under while they were a fixed list. Their
 * values are the ones stored on `Service.category`, so nothing moves.
 */
export const DEFAULT_REPAIR_TYPES = [
  { value: 'screen', label: 'Screen' },
  { value: 'battery', label: 'Battery' },
  { value: 'charging_port', label: 'Charging port' },
  { value: 'camera', label: 'Camera' },
  { value: 'audio', label: 'Audio' },
  { value: 'water_damage', label: 'Water damage' },
  { value: 'software', label: 'Software' },
  { value: 'data', label: 'Data' },
  { value: 'diagnostic', label: 'Diagnostic' },
  { value: 'other', label: 'Other' },
];

/** The three every business has. `path` is the website page each one is. */
export const SYSTEM_CATEGORIES = [
  {
    slug: 'parts',
    name: 'Parts',
    kind: 'part',
    path: '/catalogue/parts',
    facetLabel: 'Component Type',
    facetRequired: true,
    description: 'Replacement parts, by component, device and model.',
    levels: levels(),
    grades: PART_GRADES,
    attributes: [],
    order: 0,
  },
  {
    // Products with stock since 2026-10-02 (was `phone`, one record per handset).
    slug: 'phones',
    name: 'Phones',
    kind: 'part',
    path: '/catalogue/phones',
    facetLabel: '',
    facetRequired: false,
    description: 'Pre-owned phones, tested and graded.',
    // A model can hang off its brand with no series between.
    levels: levels().map((level) => (level.key === 'series' ? { ...level, required: false } : level)),
    grades: PHONE_GRADES,
    attributes: PHONE_FEATURES,
    order: 1,
  },
  {
    slug: 'services',
    name: 'Services',
    kind: 'service',
    path: '/catalogue/services',
    facetLabel: 'Repair Type',
    facetRequired: true,
    description: 'Repairs, and what they cost.',
    // A service is for every device until narrowed, so no device level is required.
    levels: levels('Device', false),
    grades: [],
    attributes: [],
    order: 2,
  },
];

export const SYSTEM_SLUGS = SYSTEM_CATEGORIES.map((category) => category.slug);

/** The keys a type's finder keeps, in order: its first N levels. */
export const levelKeysOf = (category) =>
  (category?.levels?.length ? category.levels : levels()).map((level) => level.key);

/** The website page a category is: the system three have their own; the rest share one. */
/**
 * A type's page on the website (client ruling 2026-10-03: "all of these should
 * be under /catalogue, so that it is clear that these are sellable items").
 * Every type, Parts, Phones and Services included, lives at
 * `/catalogue/<address>`, and the address is the type's to edit. It is kept
 * apart from `slug`, the type's identifier, which products and the tree are
 * filed under and which never changes; so moving a page moves nothing else.
 * The old addresses (`/shop`, `/pre-owned`, `/services`, `/catalog/<slug>`)
 * redirect.
 */
export const CATALOGUE_PREFIX = '/catalogue';
export const categoryPath = (category) => `${CATALOGUE_PREFIX}/${category?.address || category?.slug || 'parts'}`;

/** The page a type used to live at, for the redirects and old links. */
export const LEGACY_PATHS = { parts: '/shop', phones: '/pre-owned', services: '/services' };

/**
 * A taxonomy slug in a category's own namespace. Parts keeps the bare slugs it
 * has always had, which is what every product, order line and shared link
 * already points at.
 */
export const taxonomySlug = (category, base) =>
  !category || category === 'parts' ? base : `${category}-${base}`;

/**
 * A product type's FEATURES (client ruling, 2026-10-02; taxonomy phase 1).
 *
 * Colour, storage, condition, connector: the facts that tell two products of
 * one type apart, defined once per category and then asked for by the
 * inventory form, shown as inventory columns, offered as website filters and
 * listed on the product page, each by its own switch. A product stores its
 * answers in `Product.attributes`, keyed by the feature's `key`, which is
 * derived from the name once and never changes (renaming "Colour" to "Color"
 * must not orphan every product's answer).
 *
 * Every value is stored as a string: a list pick as its option, a number as
 * its digits, a yes or no as `yes` / `no`. One type in the map keeps the
 * website filter a plain `$in`.
 */
export const ATTRIBUTE_TYPES = [
  { value: 'select', label: 'Pick from a list' },
  { value: 'text', label: 'Free text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes or no' },
];

export const ATTRIBUTE_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const attributeKeyOf = (label) =>
  String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);

/** A stored value as a reader sees it: "Yes", "128 GB", "Black". */
export function formatAttribute(def, value) {
  if (value === undefined || value === null || value === '') return '';
  if (def?.type === 'boolean') return value === 'yes' ? 'Yes' : 'No';
  if (def?.type === 'number' && def.unit) return `${value} ${def.unit}`;
  return String(value);
}

export const attributeSchema = z
  .object({
    key: z.string().trim().max(40).optional().or(z.literal('')),
    label: z.string().trim().min(1, 'Name the feature.').max(40, 'Keep the name to 40 characters.'),
    type: z.enum(ATTRIBUTE_TYPES.map((type) => type.value)).default('select'),
    options: z.array(z.string().trim().min(1).max(40)).max(60, 'Keep the list to 60 choices.').default([]),
    unit: z.string().trim().max(12).default(''),
    required: z.boolean().default(false),
    inventory: z.boolean().default(true),
    filter: z.boolean().default(false),
    product: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'select' && value.options.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'List the choices, separated by commas.' });
    }
  });

const levelSchema = z.object({
  key: z.enum(TREE_LEVEL_KEYS),
  label: z.string().trim().min(1, 'Name the level.').max(40),
  // Whether an item must be filed this deep (2026-10-02). Not required: an
  // item may stop above it, like a model hanging off its brand.
  required: z.boolean().default(true),
});

const gradeSchema = z.object({
  value: z.string().trim().max(24).optional().or(z.literal('')),
  label: z.string().trim().min(1, 'Name the grade.').max(30, 'Keep a grade to 30 characters.'),
});

/**
 * The value a first-level entry gives the items filed under it (Component Type
 * on Parts, Repair Type on Services): what `Product.partType` and
 * `Service.category` store. Derived from the entry's name once and kept through
 * renames, like a feature's key, because every item filed under it carries it.
 */
export const FACET_VALUE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export const facetValueOf = (label) =>
  String(label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);

export const catalogCategorySchema = z.object({
  name: z.string().trim().min(2, 'Name the category.').max(40, 'Keep the name to 40 characters.'),
  description: z.string().trim().max(160).default(''),
  // Its web address, `/catalogue/<address>` (2026-10-03). Blank: taken from the name.
  address: z
    .string()
    .trim()
    .max(40, 'Keep the address to 40 characters.')
    .regex(/^[a-z0-9-]*$/, 'Lowercase letters, numbers and hyphens only.')
    .optional(),
  // The first level's name, when the type has one (Component Type). Its
  // entries are tree entries, edited in the category tree, not here.
  facetLabel: z.string().trim().max(40).default(''),
  facetRequired: z.boolean().default(true),
  // The type's condition grades, in the order a buyer reads them. Absent
  // leaves the stored list alone.
  grades: z
    .array(gradeSchema)
    .max(12, 'Keep a type to 12 grades.')
    .optional()
    .superRefine((list, ctx) => {
      const seen = new Set();
      (list ?? []).forEach((grade, index) => {
        const key = grade.label.toLowerCase();
        if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [index, 'label'], message: 'Two grades have this name.' });
        seen.add(key);
      });
    }),
  // One to four levels, always the first N of device type, brand, series,
  // model (finder depth per type, 2026-10-02): an Accessories type can stop at
  // Type › Brand. Products file under the deepest level the type keeps.
  levels: z
    .array(levelSchema)
    .min(1, 'Keep at least one level.')
    .max(MAX_LEVELS, `A finder has at most ${MAX_LEVELS} levels.`)
    .default(levels())
    .superRefine((list, ctx) => {
      list.forEach((level, index) => {
        if (level.key !== TREE_LEVEL_KEYS[index]) {
          ctx.addIssue({ code: 'custom', path: [index, 'key'], message: 'Levels keep their order.' });
        }
      });
    }),
  isActive: z.boolean().default(true),
  order: z.coerce.number().int().min(0).max(999).default(10),
  attributes: z
    .array(attributeSchema)
    .max(20, 'Keep a product type to 20 features.')
    .default([])
    .superRefine((list, ctx) => {
      const seen = new Set();
      list.forEach((attribute, index) => {
        const key = attribute.key || attributeKeyOf(attribute.label);
        if (seen.has(key)) {
          ctx.addIssue({ code: 'custom', path: [index, 'label'], message: 'Two features have this name.' });
        }
        seen.add(key);
      });
    }),
});

/**
 * Stock photos for services, keyed on the service's name.
 *
 * The client supplied a photo per repair (`client/public/service-photos`), so
 * the same reasoning as `partPhotos.js` applies: the mapping lives in one file,
 * a service that matches a title shows its picture with no record touched, and
 * adding one is dropping a file plus a line. Matched case-insensitively on the
 * service name; the first entry whose `names` contains it wins.
 *
 * `create` is the service the seed adds when a business has nothing matching
 * (`npm run seed:service-photos`): "if the service is not available, create
 * it". The prices are demo figures, like every other seeded price.
 */
export const SERVICE_PHOTOS = [
  {
    file: 'Screen-Replacement-Service-in-Edmonton.avif',
    title: 'Screen Replacement',
    names: ['screen replacement', 'screen replacement (laptop)', 'screen replacement (tablet)', 'digitiser only'],
  },
  {
    file: 'Battery-Replacement-in-Edmonton.avif',
    title: 'Battery Replacement',
    names: ['battery replacement', 'battery replacement (laptop)', 'battery replacement (tablet)', 'battery health check'],
  },
  {
    file: 'Cell-Phone-Backpart-Fix-in-Edmonton.avif',
    title: 'Back Glass Replacement',
    names: ['back glass replacement', 'housing replacement', 'cell phone backpart fix'],
  },
  {
    file: 'Charging-port-fix-in-Edmonton.avif',
    title: 'Charging Port Fix',
    names: ['charging port repair', 'charging port clean', 'charging port fix'],
  },
  {
    file: 'USB-Port-Fix-in-Edmonton.avif',
    title: 'USB Port Fix',
    names: ['usb port fix', 'charging port repair (laptop)'],
    create: { name: 'USB Port Fix', category: 'charging_port', price: 99, cost: 35, durationMinutes: 60, warrantyDays: 90, deviceTypes: ['laptop', 'console'] },
  },
  {
    file: 'HDMI-Port-Fix-in-Edmonton.avif',
    title: 'HDMI Port Fix',
    names: ['hdmi port repair', 'hdmi port fix'],
  },
  {
    file: 'Phone-Camera-Fix-in-Edmonton.avif',
    title: 'Phone Camera Fix',
    names: ['rear camera replacement', 'front camera replacement', 'camera lens replacement', 'phone camera fix'],
  },
  {
    file: 'Phone-Face-ID-issue-Fix-in-Edmonton.avif',
    title: 'Face ID Issue Fix',
    names: ['face id issue fix'],
    create: { name: 'Face ID Issue Fix', category: 'camera', price: 149, cost: 55, durationMinutes: 90, warrantyDays: 90, deviceTypes: ['phone'] },
  },
  {
    file: 'Phone-Water-Damage-Fix-in-Edmonton.avif',
    title: 'Water Damage Fix',
    names: ['liquid damage treatment', 'water damage fix'],
  },
  {
    file: 'IC-Rebaling-Service-in-Edmonton.avif',
    title: 'IC Reballing Service',
    names: ['ic reballing service', 'board-level repair'],
    create: { name: 'IC Reballing Service', category: 'water_damage', price: 199, cost: 70, durationMinutes: 180, warrantyDays: 30, deviceTypes: ['phone', 'laptop'] },
  },
  {
    file: 'Flex-Connector-Fix-in-Edmonton.avif',
    title: 'Flex Connector Fix',
    names: ['flex connector fix'],
    create: { name: 'Flex Connector Fix', category: 'other', price: 79, cost: 25, durationMinutes: 60, warrantyDays: 90, deviceTypes: ['phone', 'tablet'] },
  },
  {
    file: 'Device-Network-Issue-Fix-in-Edmonton.avif',
    title: 'Network Issue Fix',
    names: ['network issue fix'],
    create: { name: 'Network Issue Fix', category: 'software', price: 69, cost: 15, durationMinutes: 60, warrantyDays: 30, deviceTypes: ['phone', 'tablet'] },
  },
  {
    file: 'iPhone-Apple-Logo-Fix-in-Edmonton.avif',
    title: 'Apple Logo Fix',
    names: ['apple logo fix'],
    create: { name: 'Apple Logo Fix', category: 'software', price: 129, cost: 30, durationMinutes: 120, warrantyDays: 30, deviceTypes: ['phone'] },
  },
  {
    file: 'Device-Data-Recovery-in-Edmonton.avif',
    title: 'Data Recovery',
    names: ['data recovery', 'backup to customer drive'],
  },
  {
    file: 'Device-to-Device-Data-Transfer-in-Edmonton.avif',
    title: 'Data Transfer',
    names: ['data transfer', 'device to device data transfer'],
  },
  {
    file: 'Virus-Removal-Service-in-Edmonton.avif',
    title: 'Virus Removal',
    names: ['virus and malware removal', 'virus removal'],
  },
  {
    file: 'Genuine-Device-Windows-Installation-Service-in-Edmonton.avif',
    title: 'Windows Installation',
    names: ['operating system install', 'software restore', 'windows installation'],
  },
];

/** The site path of a service's stock photo, or null. */
export function servicePhotoFor(name) {
  const key = String(name ?? '').trim().toLowerCase();
  if (!key) return null;
  const match = SERVICE_PHOTOS.find((entry) => entry.names.includes(key));
  return match ? `/service-photos/${match.file}` : null;
}
