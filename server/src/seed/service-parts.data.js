/**
 * The parts a repair shop keeps on the shelf.
 *
 * ## Why a service business has stock at all
 *
 * A repair shop is not a wholesaler, but it buys screens and batteries and it
 * puts them on tickets. `seed:service-business` deliberately seeds only the two
 * lists a shop looks things up in - the devices it takes across the counter and
 * the services it charges for - and said in its own docstring that parts were
 * somebody else's job. Nobody had that job, so CellShoppe had three suppliers,
 * zero products, and therefore an empty Inventory screen and a purchase-order
 * seeder that skipped it for having nothing to order.
 *
 * ## What these are, and are not
 *
 * A **short** shelf, not a catalogue. Cellvix carries 773 parts because
 * selling them is the business; a repair shop stocks the dozen lines that move
 * and orders the rest per job. Keeping this small is the point - an inventory
 * screen with 700 rows on a shop that fixes phones would misrepresent what the
 * business is, and every screen reading it would be testing the wrong shape.
 *
 * Priced as a shop prices: `cost` is what the shop pays its supplier and
 * `price` is what goes on the ticket line, with the margin a counter actually
 * runs. Both in integer cents, like every other amount in this system.
 *
 * Grades are the ones a repair shop genuinely buys in - `AFTERMARKET` and
 * `OEM` for screens, `NEW` for batteries and small parts. `PULL-A`/`PULL-B`
 * are a wholesaler's grading language and are left to Cellvix.
 */

/** Dollars to the integer cents everything downstream expects. */
const money = (dollars) => Math.round(dollars * 100);

/**
 * One row per part the shop actually keeps.
 *
 * `stock` and `minStock` are set so the Inventory screen has something to say:
 * two lines sit at or under their reorder point, which is what makes the low
 * stock filter and the reorder prompt real rather than theoretical.
 */
const SERVICE_PARTS = [
  // ---- screens: the line that moves ------------------------------------
  {
    sku: 'CS-SCR-IP15PM-AM',
    name: 'iPhone 15 Pro Max screen (aftermarket)',
    partType: 'screen',
    partTypeLabel: 'Screen',
    grade: 'AFTERMARKET',
    cost: money(148),
    price: money(289),
    stock: 4,
    minStock: 2,
    deviceLabel: 'iPhone 15 Pro Max',
  },
  {
    sku: 'CS-SCR-IP14-OEM',
    name: 'iPhone 14 screen (OEM)',
    partType: 'screen',
    partTypeLabel: 'Screen',
    grade: 'OEM',
    cost: money(119),
    price: money(239),
    stock: 6,
    minStock: 2,
    deviceLabel: 'iPhone 14',
  },
  {
    sku: 'CS-SCR-S24U-OEM',
    name: 'Galaxy S24 Ultra screen (OEM)',
    partType: 'screen',
    partTypeLabel: 'Screen',
    grade: 'OEM',
    cost: money(172),
    price: money(329),
    // At its reorder point on purpose - see the note above.
    stock: 2,
    minStock: 2,
    deviceLabel: 'Galaxy S24 Ultra',
  },
  {
    sku: 'CS-SCR-PIX8-AM',
    name: 'Pixel 8 screen (aftermarket)',
    partType: 'screen',
    partTypeLabel: 'Screen',
    grade: 'AFTERMARKET',
    cost: money(96),
    price: money(199),
    stock: 3,
    minStock: 1,
    deviceLabel: 'Pixel 8',
  },

  // ---- batteries: the other half of the counter -------------------------
  {
    sku: 'CS-BAT-IP15-NEW',
    name: 'iPhone 15 battery',
    partType: 'battery',
    partTypeLabel: 'Battery',
    grade: 'NEW',
    cost: money(34),
    price: money(89),
    stock: 12,
    minStock: 4,
    deviceLabel: 'iPhone 15',
  },
  {
    sku: 'CS-BAT-IP13-NEW',
    name: 'iPhone 13 battery',
    partType: 'battery',
    partTypeLabel: 'Battery',
    grade: 'NEW',
    cost: money(29),
    price: money(79),
    stock: 9,
    minStock: 4,
    deviceLabel: 'iPhone 13',
  },
  {
    sku: 'CS-BAT-S23-NEW',
    name: 'Galaxy S23 battery',
    partType: 'battery',
    partTypeLabel: 'Battery',
    grade: 'NEW',
    cost: money(31),
    price: money(85),
    // Below its reorder point: the Inventory screen needs a row that is
    // genuinely short, not just close.
    stock: 1,
    minStock: 3,
    deviceLabel: 'Galaxy S23',
  },

  // ---- small parts and consumables --------------------------------------
  {
    sku: 'CS-CHG-IP-NEW',
    name: 'iPhone charging port flex (Lightning)',
    partType: 'charging-port',
    partTypeLabel: 'Charging port',
    grade: 'NEW',
    cost: money(12),
    price: money(59),
    stock: 15,
    minStock: 5,
    deviceLabel: 'iPhone (Lightning)',
  },
  {
    sku: 'CS-CHG-USBC-NEW',
    name: 'USB-C charging port flex (universal Android)',
    partType: 'charging-port',
    partTypeLabel: 'Charging port',
    grade: 'NEW',
    cost: money(10),
    price: money(55),
    stock: 18,
    minStock: 5,
    deviceLabel: 'Android (USB-C)',
  },
  {
    sku: 'CS-CAM-IP14-NEW',
    name: 'iPhone 14 rear camera module',
    partType: 'camera',
    partTypeLabel: 'Camera',
    grade: 'NEW',
    cost: money(46),
    price: money(129),
    stock: 3,
    minStock: 1,
    deviceLabel: 'iPhone 14',
  },
  {
    sku: 'CS-GLS-UNI-NEW',
    name: 'Tempered glass protector (universal)',
    partType: 'accessory',
    partTypeLabel: 'Accessory',
    grade: 'NEW',
    cost: money(2.5),
    price: money(19),
    stock: 60,
    minStock: 20,
    deviceLabel: 'Any',
  },
  {
    sku: 'CS-ADH-UNI-NEW',
    name: 'Waterproof adhesive seal strip (pack of 10)',
    partType: 'accessory',
    partTypeLabel: 'Accessory',
    grade: 'NEW',
    cost: money(8),
    price: money(29),
    stock: 7,
    minStock: 3,
    deviceLabel: 'Any',
  },
];

export { SERVICE_PARTS, money };
export default SERVICE_PARTS;
