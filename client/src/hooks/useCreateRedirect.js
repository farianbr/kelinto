import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

/**
 * Forward `?new=1` to a record type's full-page builder.
 *
 * ## Why this exists
 *
 * `+ Create` and every "New …" button on the customer profile navigate to a
 * list with `?new=1` and let the page open its own create modal
 * (`useCreateParam`). That works for the record types that are made in a
 * dialog. It silently does nothing for the ones that are not.
 *
 * Two screens are full pages rather than modals, because a repair carries
 * devices, services, parts and travel - more than a dialog holds without
 * scrolling past the thing it is asking about. On a service business the
 * quotes and invoices lists ARE those screens, and neither reads `?new=1`. So
 * `+ Create > Quote` landed on the quotes list with a flag nothing consumed,
 * and read to the staff member as a button that does nothing.
 *
 * Fixing it at the menu would mean the menu knowing which business type it is
 * in, and the customer profile knowing the same, and each new entry point
 * knowing it again. The list already knows - it is the screen the feature flag
 * picks. So the redirect lives here, and every caller keeps pointing at the
 * list.
 *
 * ## Use
 *
 * ```js
 * useCreateRedirect('/admin/quotes/create');
 * ```
 *
 * Companion params ride along: `?new=1&client=<id>` from the customer profile
 * arrives at the builder as `?client=<id>`, so the customer is still pre-picked.
 * `replace` keeps the flagged URL out of history, so Back does not bounce the
 * staff member through a redirect they cannot see.
 *
 * ## The return value
 *
 * `true` while a redirect is pending, so a page that ALSO has a create modal
 * can suppress it. This matters more than it looks: `useCreateParam` reads the
 * flag in its initialiser, so its `creating` is true on the first render,
 * before any effect runs. A page that opens the modal on that value and
 * redirects in an effect paints the dialog for one frame and then navigates
 * out from under it - which reads to the user as "the modal still opens".
 * `AdminInvoicesPage` is the one page with both, and gates on this.
 */
export function useCreateRedirect(to) {
  const navigate = useNavigate();

  /**
   * The flag and its companions, captured ONCE at mount.
   *
   * Not read live from `useSearchParams`, because `useCreateParam` strips
   * `?new=1` from the URL in its own mount effect - the two hooks sit on the
   * same page and race. Worse, `to` is often not known on the first render:
   * the invoices list only learns whether this business wants the page or the
   * modal when `/auth/me` resolves, so the redirect has to still be armed a
   * tick later, by which time the URL has been cleaned.
   *
   * Capturing in a `useState` initialiser means the answer survives both: the
   * flag is read before anything can strip it, and the effect below can wait
   * as long as it needs for `to`.
   */
  const [initial] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const creating = params.get('new') === '1';
      params.delete('new');
      return { creating, query: params.toString() };
    } catch {
      return { creating: false, query: '' };
    }
  });

  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!initial.creating || !to || done) return;

    // Once only. `to` can change identity across renders, and a second
    // navigate would push the builder over itself.
    setDone(true);
    navigate(initial.query ? `${to}?${initial.query}` : to, { replace: true });
  }, [initial, to, done, navigate]);

  /**
   * True while a redirect is still owed, so a page that ALSO has a create
   * modal keeps it shut rather than flashing it on the way out.
   *
   * `to` is part of the test on purpose. A caller that passes `null` - the
   * wholesale invoices list, which keeps its modal - is owed no redirect, and
   * returning true for it would hold that modal shut forever.
   */
  return Boolean(initial.creating && to && !done);
}

export default useCreateRedirect;
