import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { superAdminUrl, panelUrl } from '@/lib/surface';
import RouteFallback from '@/components/layout/RouteFallback';

/**
 * A path that lives on another of the platform's hosts: the same path, there.
 *
 * `/admin` belongs to the panel host and `/superadmin` to the super admin host.
 * A full navigation rather than a route change, because the destination is a
 * different origin with its own session cookie - nothing on this origin could
 * be carried across, and nothing should be.
 *
 * `replace`, so Back returns to the page before the old link rather than
 * bouncing through this one. Only rendered when the destination host is
 * configured, so it can never send a browser back to where it already is.
 */
export function GoToHost({ to }) {
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    const build = to === 'superadmin' ? superAdminUrl : panelUrl;
    window.location.replace(build(`${pathname}${search}${hash}`));
  }, [to, pathname, search, hash]);

  return <RouteFallback />;
}

/** The panel host's paths. Kept as a name because it reads at the call site. */
export function GoToPanel() {
  return <GoToHost to="panel" />;
}

export default GoToPanel;
