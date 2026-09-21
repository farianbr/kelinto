import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

/**
 * Stops a staff member walking away from edits they have not saved.
 *
 * ## Why this exists
 *
 * Every settings screen is a staged form: you type, and nothing reaches the
 * server until Save changes. That is the right model - one button commits the
 * whole screen - but it has one failure, and it is the one a person actually
 * hits: they add a payment method, get called away, come back, reload, and the
 * row is gone. Nothing told them it was never saved.
 *
 * The fix is not to write on every keystroke. It is to say so before the work
 * is lost.
 *
 * ## Two exits, two mechanisms
 *
 * A page can be left two ways, and neither knows about the other:
 *
 * - **The browser itself** - reload, back, closing the tab. Only
 *   `beforeunload` reaches this, and browsers deliberately ignore any message
 *   passed to it: the wording is the browser's own, and all this can do is ask
 *   for the prompt.
 * - **In-app navigation** - clicking a tab, the sidebar, a breadcrumb.
 *
 * ## Why the in-app half intercepts clicks rather than using `useBlocker`
 *
 * `useBlocker` is the obvious tool and **it throws here**: it needs a data
 * router (`createBrowserRouter`), and this app mounts `<BrowserRouter>` with a
 * JSX route tree. Converting the whole router to get a confirm dialog on seven
 * settings forms is a large change to the app's entry point for a small
 * feature, and it would rewrite how every route in the panel is declared.
 *
 * So this listens for clicks on links during the capture phase, before React
 * Router sees them. That covers every `<Link>` in the panel - the tab row, the
 * sidebar, the breadcrumbs - because they all render real anchors. It does not
 * cover a programmatic `navigate()` call, which is the honest limit of the
 * approach: those are form submissions and row clicks, not a staff member
 * wandering off mid-edit.
 */
export function useUnsavedGuard(when) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(null);

  // Read inside the listener rather than captured in its closure, so the
  // handler does not need re-binding on every keystroke that flips `when`.
  const armed = useRef(when);
  armed.current = when;

  useEffect(() => {
    if (!when) return undefined;

    const onBeforeUnload = (event) => {
      // `preventDefault` is the modern signal; `returnValue` is what older
      // browsers still read. Neither shows a message of our choosing.
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [when]);

  useEffect(() => {
    const onClick = (event) => {
      if (!armed.current) return;

      // Let the browser's own behaviours through untouched: a modified click
      // opens a new tab, which leaves this page exactly where it is.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const anchor = event.target.closest?.('a[href]');
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const url = new URL(anchor.href, window.location.href);
      // Another origin is a full page load, which `beforeunload` already
      // covers; the same path is not leaving at all.
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;

      event.preventDefault();
      event.stopPropagation();
      setPending(url.pathname + url.search);
    };

    // Capture, so this runs before React Router's own handler on the anchor.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  const leave = useCallback(() => {
    const to = pending;
    setPending(null);
    // Disarmed first: the navigation below would otherwise be caught by the
    // same listener that raised this.
    armed.current = false;
    if (to) navigate(to);
  }, [pending, navigate]);

  return {
    /** True while a navigation is being held for an answer. */
    blocked: pending !== null,
    /** Discard the edits and continue to where they were going. */
    leave,
    /** Stay on the page with the edits intact. */
    stay: useCallback(() => setPending(null), []),
  };
}

export default useUnsavedGuard;
