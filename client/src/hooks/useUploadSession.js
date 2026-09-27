import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl } from '@/lib/api';

/**
 * The files a form has uploaded but not yet saved.
 *
 * A file goes to storage the moment it is chosen, so it can be previewed. Until
 * the form is saved it belongs to nothing, and a form that is cancelled or left
 * would leave it in the bucket. This keeps the list, so the form can:
 *
 * - **warn** before the person leaves with unsaved uploads (`hasPending`),
 * - **delete** them when the form is discarded, cancelled, closed or left
 *   (`discardAll`, and automatically on unmount and when the tab closes),
 * - **keep** them once the save goes through (`settle`).
 *
 * The server only ever deletes files that are still pending, so a discard that
 * arrives late, or twice, cannot delete anything a saved record uses; and
 * anything this misses (a crash, a dead network) is swept after a few hours.
 *
 * @param discardPath `/admin/assets/discard` for the ERP,
 *   `/superadmin/assets/discard` for the console.
 */
export function useUploadSession({ discardPath = '/admin/assets/discard' } = {}) {
  const pending = useRef(new Set());
  const [count, setCount] = useState(0);
  const sync = () => setCount(pending.current.size);

  /**
   * `keepalive` so the request survives the page closing, which is exactly
   * when the last of these is sent. The URL goes through `apiUrl`, so the
   * ERP's selected business rides along as it does on every admin call.
   */
  const send = useCallback(
    (urls) => {
      if (!urls.length) return;
      fetch(apiUrl(discardPath), {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      }).catch(() => {});
    },
    [discardPath],
  );

  const track = useCallback((url) => {
    if (!url) return;
    pending.current.add(url);
    sync();
  }, []);

  /** This one upload is no longer wanted: delete it if it was never saved. */
  const drop = useCallback(
    (url) => {
      if (!url || !pending.current.has(url)) return;
      pending.current.delete(url);
      sync();
      send([url]);
    },
    [send],
  );

  const discardAll = useCallback(() => {
    const urls = [...pending.current];
    pending.current.clear();
    sync();
    send(urls);
  }, [send]);

  /** Saved: the record uses them now, so they are not ours to delete. */
  const settle = useCallback(() => {
    pending.current.clear();
    sync();
  }, []);

  // Leaving the form (a route change, a modal closing) or closing the tab.
  useEffect(() => {
    const onPageHide = () => {
      if (pending.current.size) send([...pending.current]);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      if (pending.current.size) send([...pending.current]);
    };
  }, [send]);

  return useMemo(
    () => ({ track, drop, discardAll, settle, hasPending: count > 0, count }),
    [track, drop, discardAll, settle, count],
  );
}

export default useUploadSession;
