/**
 * The empty business: every field a business's details carry, with nothing in
 * them.
 *
 * It used to be Cellvix's own details, and was read as the fallback wherever
 * no business was in context - which put one company's name, address and tax
 * number on other businesses' pages and paperwork. Every request now resolves a
 * business, and every real answer comes from that business's record and
 * Settings (`services/sendingBusiness.js`, `settingsService.publicProfile`).
 *
 * What is left is the SHAPE, for the one frame before the website's details
 * arrive and for code that must not crash on a missing field. Blank rather than
 * invented: a placeholder phone number or address is a thing somebody dials or
 * drives to. Every surface already omits a block whose fields are empty.
 */
const BUSINESS_INFO = {
  name: '',
  tagline: '',
  domain: '',
  phone: '',
  email: '',
  supportEmail: '',
  billingEmail: '',
  gstNumber: '',
  address: {
    line1: '',
    city: '',
    region: '',
    postal: '',
    country: 'Canada',
  },
  hours: [],
  whatsapp: '',
  mapUrl: '',
  social: {},
  handles: {},
};

export { BUSINESS_INFO };
export default BUSINESS_INFO;
