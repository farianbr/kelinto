import { useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { surface } from '@/lib/surface';
import { businessUrl } from '@/store/businessStore';

/**
 * Build a link from the admin panel to a page of the active business's
 * storefront: a product page, a blog post, the kiosk.
 *
 * **On the panel host these pages do not exist.** `app.<platform>` serves the
 * panel and a sign-in page, and every other path is sent to that sign-in page,
 * so a relative `/product/…` from the panel landed a staff member on "Sign in"
 * instead of the product. The storefront lives on the business's own address,
 * which only the server knows (`storefrontOrigin` on `/auth/me`), so on the
 * panel host the link goes there.
 *
 * Everywhere else - no split configured, or a business host still serving its
 * own panel - the path stays on this host with the selected business pinned,
 * which is what `businessUrl` always did.
 *
 * A hook rather than a plain function because the origin follows the business
 * switcher: switching businesses refetches `/auth/me`, and every link built
 * from this re-renders with the new address.
 */
export function useStorefrontUrl() {
  const { storefrontOrigin } = useAuth();

  return useCallback(
    (path) => (surface === 'panel' && storefrontOrigin ? `${storefrontOrigin}${path}` : businessUrl(path)),
    [storefrontOrigin],
  );
}

export default useStorefrontUrl;
