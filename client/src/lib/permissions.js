import { PERMISSION_LEVELS } from '@shared/schemas/admin';
import { featureEnabled, featuresForNav } from '@shared/schemas/features';

/**
 * Client-side permission reads (ERP rework §7.6).
 *
 * **This is a courtesy, never the control.** Every one of these answers shapes
 * the UI - a hidden nav group, a disabled button - and none of them protects
 * anything. `requirePermission` on the server decides for real on every
 * request, so a viewer who edits this in their console gets a screen full of
 * 403s rather than access.
 */

/**
 * Does this session clear `level` on `area`?
 *
 * A missing map answers **no**: an admin arrives with every area at full, and
 * a staff member with no role has no map at all - which is exactly the account
 * that should be seeing nothing.
 */
export function can(permissions, area, level = 'view') {
  const held = permissions?.[area];
  if (!held) return false;
  return PERMISSION_LEVELS.indexOf(held) >= PERMISSION_LEVELS.indexOf(level);
}

/** Convenience for the common "may this session change things here" question. */
export function canEdit(permissions, area) {
  return can(permissions, area, 'full');
}

/**
 * Filters the sidebar tree to what this session may see.
 *
 * A group with no reachable area is dropped whole rather than rendered empty
 * an expandable section that opens onto nothing reads as a bug.
 *
 * **The dashboard is never filtered.** `home` is a nav area, not a permission
 * area - it is deliberately absent from `PERMISSION_AREAS`, because the
 * dashboard is the panel's front door and every staff account lands on it.
 * Treating it as a permission would have `can()` look up a key no role map ever
 * carries, answer "no" under the closed-by-default rule, and hide Home from
 * everyone including an administrator. The screen behind it is safe by
 * construction: `GET /admin/stats` returns counts, never records, which is why
 * it is the one staff route left unpermissioned on purpose.
 */
const UNFILTERED_AREAS = new Set(['home']);

/**
 * The nav a given role sees, with switched-off rows removed.
 *
 * **Two independent filters, and they answer different questions.**
 * `permissions` is what this ACCOUNT may do; `features` is what this BUSINESS
 * has at all (SAAS_PLATFORM §4.4). A row survives only if both say yes, and
 * neither is the control - `requirePermission` and `requireFeature` decide for
 * real on every request.
 *
 * `hidden` on a nav row is the older form of the same idea and still works: the
 * screen, its routes and its model stay exactly where they are, and one flag
 * decides whether this tenant is offered it (§5.5). A row can now be switched
 * off from either place, and `hidden` is what a row uses when no feature key
 * names it.
 *
 * **`features` being absent means everything is on.** A buyer's client never
 * receives a set, and a staff client renders once before `/auth/me` resolves
 * defaulting to "off" would blank the sidebar on every first paint and look
 * exactly like a permissions bug.
 *
 * Applied to children as well as groups, because a switched-off feature is
 * usually one row inside a section rather than a whole section.
 */
export function visibleNav(nav, permissions, features = null) {
  const allowed = (row) => {
    if (row.hidden) return false;
    if (!features) return true;
    // A row two features share (Purchase › Services) shows while either is on.
    const gates = featuresForNav(row.key);
    return gates.length === 0 || gates.some((feature) => featureEnabled(features, feature.key));
  };

  return nav
    .filter(allowed)
    .filter(
      (group) =>
        !group.area || UNFILTERED_AREAS.has(group.area) || can(permissions, group.area, 'view'),
    )
    .map((group) =>
      group.children ? { ...group, children: group.children.filter(allowed) } : group,
    )
    // A group whose every child was switched off is dropped whole rather than
    // rendered empty - an expandable section that opens onto nothing reads as a
    // bug, which is the same reasoning the permission filter above follows.
    .filter((group) => !group.children || group.children.length > 0);
}

export default can;
