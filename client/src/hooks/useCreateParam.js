import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

/**
 * Opens a page's create modal from the URL (`?new=1`).
 *
 * The `+ Create` menu (§7.2) names a record type, and the staff member expects the
 * form for it - not the list it lives on with the create button somewhere on
 * screen for them to find. The menu cannot open a modal on a page that has not
 * mounted yet, so it navigates and leaves a flag, and the page reads it here.
 *
 * **The flag is consumed, not just read.** It is stripped from the URL on the
 * first render, with `replace` so it leaves no history entry, which settles
 * three things that otherwise go wrong: a refresh after the modal is closed
 * does not reopen it, the back button does not land on a URL that reopens it,
 * and closing the modal does not leave an address that no longer describes what
 * is on screen.
 *
 * `initial` covers the pages whose one state slot serves both create and edit
 * `AdminProductsPage` uses the sentinel `'new'` rather than `true`, and passes
 * `closed` as `null` to match what its edit modal already expects.
 *
 * ```js
 * const [creating, setCreating] = useCreateParam();
 * ```
 */
/**
 * `strip: false` holds the flag in the URL. A page that may instead FORWARD the
 * flag to a full-page builder (`useCreateRedirect`) passes false until it knows
 * which: both hooks navigate with `replace` in the same tick, the strip landed
 * second, and it sent the staff member back to the list the redirect had just
 * left. `AdminInvoicesPage` on a service business, reached by any in-app link.
 */
export function useCreateParam(initial = true, closed = false, companions = [], { strip = true } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Read during the initialiser rather than in the effect, so the modal is
  // already open on the first paint - arriving to a closed form that pops open
  // a frame later reads as a glitch.
  const [creating, setCreating] = useState(() =>
    searchParams.get('new') === '1' ? initial : closed,
  );

  /**
   * Values read once to seed the form, captured before the effect below strips
   * them from the URL. `?new=1&client=<id>` pre-picks a customer on the invoice
   * form; without this the seed would be gone by the time the modal rendered.
   */
  const [seed] = useState(() =>
    Object.fromEntries(companions.map((key) => [key, searchParams.get(key) ?? undefined])),
  );

  useEffect(() => {
    if (!strip || searchParams.get('new') !== '1') return;
    const params = new URLSearchParams(searchParams);
    params.delete('new');
    // Companions go with the flag. Left behind they would describe a form that
    // is no longer open, and survive into the next thing the staff member filters.
    for (const key of companions) params.delete(key);
    setSearchParams(params, { replace: true });
    // Filter params share this hook's `searchParams`; depending on the whole
    // object would re-run this on every filter change. The guard above makes a
    // second run harmless, but not running is cheaper and clearer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strip]);

  return [creating, setCreating, seed];
}

export default useCreateParam;
