import { useQuery } from '@tanstack/react-query';

import api from '@/lib/api';
import { BUSINESS_INFO } from '@/lib/constants';

/**
 * Who this storefront belongs to.
 *
 * ## Why this exists
 *
 * Every surface that names the business - the header wordmark, the footer, the
 * contact page, the account popup's contact tab - read `BUSINESS_INFO` from
 * `shared/business.js`, one hardcoded object holding Cellvix's name, address,
 * phone, hours and social handles. That was correct while Cellvix was the only
 * business. Under one codebase serving many, it meant CellShoppe's footer
 * printed the wholesaler's address and linked to `@cellvix`.
 *
 * `services/sendingBusiness.js` already fixed this for invoices and email. This
 * is the storefront half, and it is the more visible one: an invoice is read
 * once, a footer is on every page.
 *
 * ## Why it never returns undefined
 *
 * Fifteen components read fields straight off this object - `info.address.city`,
 * `info.phone.replace(...)` - and they render on the first paint, before any
 * request resolves. So the hook returns the hardcoded constant until the real
 * answer arrives, rather than `undefined` and fifteen optional chains. The
 * fallback is the same object those files used to import directly, so the
 * pre-load frame is exactly what shipped before.
 *
 * **That fallback is the house's details, not this business's**, which is the
 * one thing to keep in mind: it is right for a moment on Cellvix and wrong for
 * a moment everywhere else. It is a placeholder for one paint, not an answer -
 * `sendingBusiness` makes the same trade for the same reason, and says so.
 *
 * ## Shape
 *
 * `hours` and `social` are lists, and both are commonly empty - a business that
 * has not entered them has none, which is different from having some it did not
 * send. Every surface that renders them omits its whole block when the list is
 * empty rather than printing a placeholder row.
 */
/**
 * The hardcoded constant, in the shape the API answers in.
 *
 * `shared/business.js` stores socials as an object of URLs beside a parallel
 * map of handles; the API sends one row per network the business is actually
 * on. Rows are the better shape - a business on one network carries one row
 * rather than five keys with four of them empty - so the fallback is converted
 * here, once, instead of every consumer learning both.
 *
 * The placeholder entries in that object are `'#'`, which is not a link. They
 * are dropped rather than rendered as dead icons.
 */
const FALLBACK = {
  ...BUSINESS_INFO,
  // The constant IS the house's details, so the frame before the request
  // resolves is the house's frame - which is what shipped before this hook
  // existed. The real answer corrects it a moment later.
  isHouse: true,
  social: Object.entries(BUSINESS_INFO.social ?? {})
    .filter(([, url]) => url && url !== '#')
    .map(([network, url]) => ({
      network,
      url,
      handle: BUSINESS_INFO.handles?.[network] ?? '',
    })),
};

export function useBusinessInfo() {
  const { data } = useQuery({
    queryKey: ['business-info'],
    queryFn: () => api.get('/business-info'),
    // These change when an owner edits them, which is rarely. Ten minutes keeps
    // a navigation-heavy session down to one request without making an edit
    // take a reload to show up.
    staleTime: 10 * 60 * 1000,
  });

  return data ?? FALLBACK;
}

export default useBusinessInfo;
