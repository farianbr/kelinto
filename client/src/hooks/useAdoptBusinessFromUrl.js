import { useState } from 'react';
import { getBusiness, setBusiness } from '@/store/businessStore';

/**
 * Adopt `?business=<id>` from the URL as the selected business.
 *
 * ## Why a new tab loses the business
 *
 * The selection lives in `sessionStorage`, which is per-tab and starts EMPTY in
 * a new one. So opening any admin page in a new tab - middle-click, "open in
 * new tab", a pasted link - arrived with nothing selected, and the panel fell
 * back to the default business. On this installation that is Cellvix, which is
 * why a CellShoppe staff member opening an invoice in a new tab watched the
 * whole panel become Cellvix.
 *
 * Nothing was wrong with the record or the request. The tab simply did not know
 * which business it was for, and the one place that knew was the tab it came
 * from.
 *
 * `?business=` is already rule 3 of the server's `resolveBusiness`, and
 * `lib/api.js` already puts it on every call - it just had nothing to send.
 * `businessUrl()` puts it on a link; this adopts it at the other end.
 *
 * ## In an initialiser, not an effect
 *
 * An effect runs AFTER the first render, and the first render is where the
 * page's queries fire. They would go out unscoped, resolve to the default
 * business, and the corrected ones would only arrive on a refetch - so the
 * wrong business would still be fetched, and briefly shown. Running in a
 * `useState` initialiser puts the id in the store before anything reads it.
 *
 * In production the host names the business and the parameter is redundant.
 */
export function useAdoptBusinessFromUrl() {
  useState(() => {
    try {
      const wanted = new URLSearchParams(window.location.search).get('business');
      // Written only when it differs, so a panel left open all day is not
      // storing the same id on every remount.
      if (wanted && wanted !== getBusiness()) setBusiness(wanted);
    } catch {
      // A malformed URL is not a reason to refuse the panel: with nothing
      // adopted it falls back to whatever the host resolves, which is the
      // behaviour this replaces rather than a new failure.
    }
  });
}

export default useAdoptBusinessFromUrl;
