/**
 * CellShoppe's own population (SAAS_PLATFORM §1.1).
 *
 * **A service business needs its own everything.** Under database-per-business
 * CellShoppe holds its own customers, staff, suppliers and expenses - and it had
 * none of them: the seed wrote twelve repair tickets into its database whose
 * `customer` ids pointed at Cellvix's buyers, in a database CellShoppe cannot
 * read. Every one of those references dangled.
 *
 * These are walk-in consumers rather than wholesale accounts, which is the
 * difference between the two businesses in one line: Cellvix sells parts to
 * repair shops, CellShoppe *is* a repair shop and sells to whoever walks in. So
 * no credit limits, no payment terms, no `businessName` - a person bringing in a
 * cracked phone is not a company.
 */

/** Walk-in customers. `contactName` is the person; there is no company. */
const SHOPPE_CUSTOMERS = [
  {
    contactName: 'Amara Osei',
    email: 'amara.osei@example.ca',
    phone: '+1 (604) 555-0210',
    status: 'approved',
    role: 'buyer',
  },
  {
    contactName: 'Ryan Chu',
    email: 'ryan.chu@example.ca',
    phone: '+1 (604) 555-0233',
    status: 'approved',
    role: 'buyer',
  },
  {
    contactName: 'Fatima Haddad',
    email: 'fatima.haddad@example.ca',
    phone: '+1 (778) 555-0194',
    status: 'approved',
    role: 'buyer',
  },
  {
    contactName: 'Tom Bergeron',
    email: 'tom.bergeron@example.ca',
    phone: '+1 (604) 555-0256',
    status: 'approved',
    role: 'buyer',
  },
  {
    contactName: 'Priya Nair',
    email: 'priya.nair@example.ca',
    phone: '+1 (778) 555-0271',
    status: 'approved',
    role: 'buyer',
  },
  {
    contactName: 'Daniel Kowalski',
    email: 'daniel.kowalski@example.ca',
    phone: '+1 (604) 555-0288',
    status: 'approved',
    role: 'buyer',
  },
  {
    contactName: 'Grace Lim',
    email: 'grace.lim@example.ca',
    phone: '+1 (778) 555-0302',
    status: 'approved',
    role: 'buyer',
  },
  {
    contactName: 'Marcus Idowu',
    email: 'marcus.idowu@example.ca',
    phone: '+1 (604) 555-0317',
    status: 'approved',
    role: 'buyer',
  },
];

/**
 * CellShoppe's staff.
 *
 * A repair shop's roles are shaped differently from a wholesaler's - the workshop
 * technician is the job that does not exist at Cellvix at all - but they hold
 * the same built-in role slugs, because the permission areas are the same
 * question either way. Only the people differ.
 */
const SHOPPE_STAFF = [
  {
    businessName: 'CellShoppe Phone & Laptop Fix',
    contactName: 'Nadia Rahman',
    email: 'nadia@cellshoppe.ca',
    phone: '+1 (604) 555-0176',
    status: 'approved',
    role: 'staff',
    staffRoleSlug: 'front-desk',
  },
  {
    businessName: 'CellShoppe Phone & Laptop Fix',
    contactName: 'Eli Vasquez',
    email: 'eli@cellshoppe.ca',
    phone: '+1 (604) 555-0177',
    status: 'approved',
    role: 'staff',
    staffRoleSlug: 'account-manager',
  },
  {
    businessName: 'CellShoppe Phone & Laptop Fix',
    contactName: 'Jun Park',
    email: 'jun@cellshoppe.ca',
    phone: '+1 (604) 555-0178',
    status: 'approved',
    role: 'staff',
    staffRoleSlug: 'warehouse',
  },
];

/**
 * The repair counter's local distributors, beside the wholesale side's
 * suppliers.
 *
 * There used to be a "Cellvix Wholesale" row here, from when Cellvix and
 * CellShoppe were separate businesses and one supplied the other. They are one
 * business now (2026-09-24), and a business does not buy from itself.
 */
const SHOPPE_SUPPLIERS = [
  {
    name: 'Westcoast Screen Supply',
    contactName: 'Holly Tran',
    email: 'orders@westcoastscreen.example',
    phone: '+1 (604) 555-0341',
    paymentTerms: 'net15',
    isActive: true,
    address: { line1: '2240 Clark Dr', city: 'Vancouver', region: 'BC', postal: 'V5N 3G8', country: 'CA' },
  },
  {
    name: 'BatteryHaus',
    contactName: 'Otto Lang',
    email: 'sales@batteryhaus.example',
    phone: '+1 (778) 555-0366',
    paymentTerms: 'prepaid',
    isActive: true,
    address: { line1: '410 Industrial Ave', city: 'Vancouver', region: 'BC', postal: 'V6A 2P3', country: 'CA' },
  },
];

/** What a repair shop actually spends money on, month to month. */
const SHOPPE_EXPENSES = [
  { label: 'Shop rent - Kingsway', amount: 385_000, category: 'Rent', daysAgo: 8 },
  { label: 'Hydro and internet', amount: 41_200, category: 'Utilities', daysAgo: 12 },
  { label: 'Adhesive, screens, tools restock', amount: 68_400, category: 'Supplies', daysAgo: 5 },
  { label: 'Liability insurance - quarterly', amount: 122_000, category: 'Insurance', daysAgo: 21 },
  { label: 'Local ads - Kingsway corridor', amount: 30_000, category: 'Marketing', daysAgo: 17 },
  { label: 'Workshop tool replacement', amount: 54_900, category: 'Equipment', daysAgo: 34 },
  { label: 'Courier - inbound parts', amount: 4_250, category: 'Shipping', daysAgo: 3 },
];

/**
 * Booked slots.
 *
 * Scheduling is the feature that is on for a service business and off for a
 * product one (§1.1), so an empty calendar is the single most visible sign that
 * CellShoppe was never really populated - the screen exists precisely because
 * this business type needs it.
 */
const SHOPPE_APPOINTMENTS = [
  { customer: 0, service: 'Screen replacement - iPhone 13', inDays: 0, hour: 10, minutes: 45 },
  { customer: 1, service: 'Battery health check', inDays: 0, hour: 14, minutes: 30 },
  { customer: 2, service: 'Water damage assessment', inDays: 1, hour: 9, minutes: 60 },
  { customer: 3, service: 'Laptop keyboard swap', inDays: 1, hour: 13, minutes: 90 },
  { customer: 4, service: 'Charging port repair', inDays: 2, hour: 11, minutes: 45 },
  { customer: 5, service: 'Data recovery consult', inDays: 3, hour: 15, minutes: 30 },
  { customer: 6, service: 'Screen replacement - Pixel 7', inDays: 4, hour: 10, minutes: 45 },
];

/** Enquiries from the shop's contact form, before anybody has priced them. */
const SHOPPE_WEB_QUOTES = [
  {
    name: 'Hannah Weiss',
    email: 'hannah.weiss@example.ca',
    phone: '+1 (604) 555-0401',
    message: 'Cracked screen on an iPhone 14 Pro. How much and how long does it take?',
    daysAgo: 1,
  },
  {
    name: 'Omar Siddiqui',
    email: 'omar.siddiqui@example.ca',
    phone: '+1 (778) 555-0412',
    message: 'MacBook Air will not charge. Is that a port or a battery?',
    daysAgo: 2,
  },
  {
    name: 'Leila Tran',
    email: 'leila.tran@example.ca',
    phone: '+1 (604) 555-0428',
    message: 'Do you do same-day battery swaps for a Galaxy S22?',
    daysAgo: 4,
  },
  {
    name: 'Ben Okafor',
    email: 'ben.okafor@example.ca',
    phone: '+1 (778) 555-0433',
    message: 'Dropped my iPad in water. Worth repairing or not?',
    daysAgo: 6,
  },
  {
    name: 'Sofia Marchetti',
    email: 'sofia.marchetti@example.ca',
    phone: '+1 (604) 555-0447',
    message: 'Quote for replacing a laptop hinge, Lenovo ThinkPad.',
    daysAgo: 9,
  },
];

export {
  SHOPPE_APPOINTMENTS,
  SHOPPE_CUSTOMERS,
  SHOPPE_EXPENSES,
  SHOPPE_STAFF,
  SHOPPE_SUPPLIERS,
  SHOPPE_WEB_QUOTES,
};
