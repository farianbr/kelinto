import { useSyncExternalStore } from 'react';

import { getBusinessName, subscribeBusiness } from '@/store/businessStore';

/**
 * The name of the business being worked in, for admin copy that names it.
 *
 * ## Why this exists
 *
 * Settings screens described the shop in prose with the wholesaler's name typed
 * into the sentence - "Where Cellvix operates, and in what currency" sat above
 * the regional panel whatever business was selected, so a CellShoppe admin read
 * a question about a company that is not theirs. `useBusinessInfo` already
 * solves this for the storefront, but it answers `/business-info` for the
 * business serving the *request*, which is the wrong question inside `/admin`:
 * there the answer is whichever business the header switcher has selected.
 *
 * `AdminSidebar` had already built this out of `businessStore` for the rail's
 * wordmark. This is that reasoning extracted, so a screen naming the business
 * costs one import rather than a second copy of the subscribe dance.
 *
 * ## Why it never returns undefined
 *
 * Callers interpolate it straight into a sentence, and a sentence with a hole
 * in it is worse than a slightly generic one. Until the store knows the name -
 * a first visit, before any business has been selected - this answers
 * `fallback`, which is deliberately a common noun ("this business") rather than
 * any real company: naming the wrong shop is the bug being fixed here, so the
 * pre-load frame must not name one at all.
 */
export function useActiveBusinessName(fallback = 'this business') {
  const name = useSyncExternalStore(subscribeBusiness, getBusinessName, getBusinessName);
  return name || fallback;
}

export default useActiveBusinessName;
