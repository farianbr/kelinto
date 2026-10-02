import { db } from '../db/models.js';
import { currentBusinessId } from '../db/context.js';
import '../models/Product.js';
import { resolvePhone, invalidateCatalog } from './catalogService.js';
import { invalidateTree } from './taxonomyService.js';

/**
 * Phones as products with stock (client ruling, 2026-10-02: "phones also have
 * stocks"; "stock per variant").
 *
 * A phone is a `Product` in the Phones type: one product per model, storage,
 * colour and grade (iPhone 15 Pro Max · 256 GB · Black Titanium · Good), with a
 * stock count like any part. Storage and colour are the type's features
 * (`Product.attributes`), the grade is one of the type's grades. A phone bought
 * at the kiosk adds one to its product (`buybackService.acceptBuyback`), and a
 * product is made for a variant the first time one arrives.
 *
 * This file is the one place a phone variant is found or made, so the kiosk,
 * the phones seed and the move off `PreownedDevice` agree on what counts as
 * "the same phone".
 */

const words = (value) => String(value ?? '').toUpperCase().match(/[A-Z]+|\d+/g) ?? [];

/**
 * A short SKU from the variant, readable and under the form's 40 characters:
 * iPhone 15 Pro Max · 256 GB · Black Titanium · Good is `PH-I15PM-256-BLATIT-GOO`.
 */
function phoneSku({ model, storage, colour, grade }) {
  const modelPart = words(model)
    .map((word) => (/^\d+$/.test(word) ? word : word[0]))
    .join('');
  const storagePart = words(storage)
    .map((word) => (word === 'TB' ? 'T' : word === 'GB' ? '' : word))
    .join('');
  const colourPart = words(colour)
    .map((word) => word.slice(0, 3))
    .join('');
  return ['PH', modelPart, storagePart, colourPart, String(grade).slice(0, 3)].filter(Boolean).join('-').slice(0, 36);
}

const slugify = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/** "iPhone 15 Pro Max 256 GB Black Titanium": what a buyer reads; the grade has its own badge. */
export const phoneName = ({ model, storage, colour }) => [model, storage, colour].filter(Boolean).join(' ');

/**
 * The product for a phone variant, made if this is the first of it.
 *
 * `phone` names the model the way staff and the kiosk write it (category,
 * brand, series, model) plus `storage`, `colour` and `grade`; the model's place
 * in the Phones tree is found or created (`resolvePhone`). A new product takes
 * `priceCents`, `costCents`, the pictures and the description given; an
 * existing one keeps its own, because its price is a decision already made.
 * Made with no stock: the caller adds what arrived, through the ledger.
 */
export async function phoneProductFor(phone, { placed = null } = {}) {
  const names = {
    category: phone.category || 'Phone',
    brand: phone.brand || 'Other',
    series: phone.series || '',
    model: phone.model,
  };
  const slugs = placed ?? (await resolvePhone(names));
  const attributes = { storage: phone.storage || '', colour: phone.colour || '' };

  const existing = await db().Product.findOne({
    category: 'phones',
    modelSlug: slugs.modelSlug,
    grade: phone.grade,
    'attributes.storage': attributes.storage,
    'attributes.colour': attributes.colour,
  });
  if (existing) return { product: existing, created: false, placed: slugs };

  let sku = phoneSku({ model: names.model, storage: attributes.storage, colour: attributes.colour, grade: phone.grade });
  for (let n = 2; await db().Product.exists({ sku }); n += 1) sku = `${sku.slice(0, 33)}-${n}`;
  const base = slugify(`${names.model}-${attributes.storage}-${attributes.colour}-${phone.grade}`);
  let slug = base;
  for (let n = 2; await db().Product.exists({ slug }); n += 1) slug = `${base}-${n}`;

  const [image, ...images] = phone.images ?? [];
  const product = await db().Product.create({
    sku,
    name: phoneName({ model: names.model, ...attributes }),
    slug,
    description: phone.description || undefined,
    image: image || undefined,
    images,
    category: 'phones',
    partType: 'phones',
    partTypeLabel: 'Phone',
    grade: phone.grade,
    price: phone.priceCents ?? 0,
    cost: phone.costCents ?? 0,
    stock: 0,
    deviceTypeSlug: slugs.deviceTypeSlug || undefined,
    brandSlug: slugs.brandSlug || undefined,
    seriesSlug: slugs.seriesSlug || undefined,
    modelSlug: slugs.modelSlug || undefined,
    deviceTypeName: names.category,
    brandName: names.brand,
    seriesName: names.series || undefined,
    modelName: names.model,
    attributes,
    searchTerms: [names.model, names.brand, attributes.storage, attributes.colour, phone.grade].filter(Boolean),
    isActive: phone.isActive !== false,
  });
  invalidateTree();
  invalidateCatalog();
  return { product, created: true, placed: slugs };
}

/** Where a business's phone stock movements are filed. */
export const businessOfMovement = () => currentBusinessId() ?? undefined;

export default { phoneProductFor, phoneName };
