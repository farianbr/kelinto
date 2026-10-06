import { useCallback, useRef, useState } from 'react';
import api from '@/lib/api';
import { toast } from '@/store/toastStore';

/**
 * A minted link is good for 60 seconds on the server and spends once. Used
 * only while comfortably inside that, so a click never lands on a link that
 * expires on the way.
 */
const FRESH_MS = 40 * 1000;

/**
 * Open the active business's website in a new tab, signed in as this staff
 * member (`POST /auth/website-handoff`).
 *
 * The ERP and the website are different hosts with different cookies, so the
 * ERP asks the server for a single-use link that the website spends to open its
 * own session. That session ends when this ERP session signs out.
 *
 * ## Fast path (2026-10-06, client: "the website button takes a long time")
 *
 * The link is minted **before the click**: `prepare()` runs on hover and on
 * keyboard focus, asks for the link and tells the browser to open a connection
 * to the website's host (`preconnect`) while the pointer is still travelling.
 * The click then opens the finished link straight away. It used to open a
 * blank tab, wait on the ERP host for the link, and only then start the
 * website's own connection - three waits in a row, with a white tab on screen.
 *
 * ## Slow path
 *
 * No fresh link (a click with no hover, on a touch screen, or after 40s): the
 * tab is opened BEFORE the request, on the click itself, and pointed at the
 * link once it arrives. A tab opened after an `await` is no longer a response
 * to a click, and every popup blocker refuses it.
 */
export function useOpenWebsite() {
  const [opening, setOpening] = useState(false);
  // { to, url, at } once minted; `pending` while the request is out.
  const ready = useRef(null);
  const pending = useRef(null);

  const mint = useCallback((to) => {
    if (pending.current?.to === to) return pending.current.promise;
    const promise = api
      .post('/auth/website-handoff', { to })
      .then(({ url }) => {
        ready.current = { to, url, at: Date.now() };
        preconnect(url);
        return url;
      })
      .finally(() => {
        if (pending.current?.promise === promise) pending.current = null;
      });
    pending.current = { to, promise };
    return promise;
  }, []);

  /** Mint the link ahead of the click. Silent: a failure here is retried by `open`. */
  const prepare = useCallback(
    (to = '/') => {
      const link = ready.current;
      if (link && link.to === to && Date.now() - link.at < FRESH_MS) return;
      mint(to).catch(() => {});
    },
    [mint],
  );

  const open = useCallback(
    async (to = '/') => {
      const link = ready.current;
      // Single-use either way: whatever happens next, this link is spent.
      ready.current = null;
      if (link && link.to === to && Date.now() - link.at < FRESH_MS) {
        // Not the 'noopener' feature: with it `window.open` always returns
        // null, and a blocked popup could not be told from an opened one.
        const tab = window.open(link.url, '_blank');
        if (!tab) {
          window.location.assign(link.url);
          return;
        }
        try {
          tab.opener = null;
        } catch {
          // Already on the website's origin; the website never reads its opener.
        }
        return;
      }

      const tab = window.open('', '_blank');
      if (tab) tab.opener = null;
      setOpening(true);
      try {
        const url = await mint(to);
        ready.current = null;
        if (tab) tab.location.replace(url);
        else window.location.assign(url);
      } catch (error) {
        tab?.close();
        toast.error('Could not open the website', error.message);
      } finally {
        setOpening(false);
      }
    },
    [mint],
  );

  return { open, prepare, opening };
}

/** Start DNS, TCP and TLS to the website's host while the pointer is still moving. */
function preconnect(url) {
  let origin;
  try {
    origin = new URL(url, window.location.href).origin;
  } catch {
    return;
  }
  if (origin === window.location.origin) return;
  if (document.head.querySelector(`link[rel="preconnect"][href="${origin}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = origin;
  document.head.appendChild(link);
}

export default useOpenWebsite;
