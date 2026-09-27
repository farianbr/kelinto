import { useCallback, useState } from 'react';
import api from '@/lib/api';
import { toast } from '@/store/toastStore';

/**
 * Open the active business's website in a new tab, signed in as this staff
 * member (`POST /auth/website-handoff`).
 *
 * The ERP and the website are different hosts with different cookies, so the
 * ERP asks the server for a single-use link that the website spends to open its
 * own session. That session ends when this ERP session signs out.
 *
 * The tab is opened BEFORE the request, on the click itself, and pointed at the
 * link once it arrives: a tab opened after an `await` is no longer a response to
 * a click, and every popup blocker refuses it.
 */
export function useOpenWebsite() {
  const [opening, setOpening] = useState(false);

  const open = useCallback(async (to = '/') => {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    setOpening(true);
    try {
      const { url } = await api.post('/auth/website-handoff', { to });
      if (tab) tab.location.replace(url);
      else window.location.assign(url);
    } catch (error) {
      tab?.close();
      toast.error('Could not open the website', error.message);
    } finally {
      setOpening(false);
    }
  }, []);

  return { open, opening };
}

export default useOpenWebsite;
