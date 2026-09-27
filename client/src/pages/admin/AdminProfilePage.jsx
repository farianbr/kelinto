import { Link } from 'react-router';
import { CircleUser, LogOut, ShieldCheck, Store, UsersRound } from 'lucide-react';

import cn from '@/lib/cn';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminProfile } from '@/hooks/useAdmin';
import { useSignOut } from '@/hooks/useAuth';
import { date, dateTime } from '@/lib/format';
import { pressable } from '@/lib/motion';

/**
 * My Profile (§6.15, phase 12) - the screen behind the top bar's user chip.
 *
 * **Read-only.** §6.15 lists an `Edit` button; editing a staff account already
 * lives on Settings → Users behind an admin-only route, and a second edit path
 * here would be a way around the self-demotion and last-admin rules
 * `accessService` enforces there. So this links to that screen rather than
 * duplicating it - and only for somebody who can actually open it.
 *
 * The permission grid is the part worth having: "what can I actually reach"
 * is otherwise something a staff member works out by clicking around and
 * hitting 403s.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/profile'], icon: adminIcon('CircleUser') };

const AREA_LABELS = {
  clients: 'Clients',
  sales: 'Sales',
  purchase: 'Purchase',
  reports: 'Reports',
  marketing: 'Marketing',
  business: 'Business',
  settings: 'Settings',
};

const LEVEL_TONE = { full: 'ok', view: 'info', none: 'neutral' };
const LEVEL_LABEL = { full: 'Full', view: 'Read only', none: 'No access' };

function initials(name) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

export function AdminProfilePage() {
  const { data, isLoading } = useAdminProfile();
  // The confirmed sign-out every other button uses (`SignOutConfirm`, §3.0.1).
  const signOut = useSignOut();

  if (isLoading) return <p className="text-sm text-ink-500">Loading profile…</p>;

  const profile = data?.profile;
  if (!profile) return null;

  const isAdmin = profile.accountType === 'admin';

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
      />

      <div className="grid max-w-record gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
          <Panel>
            <div className="flex items-start gap-3.5">
              <span
                aria-hidden="true"
                className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-50 font-display text-lg font-bold text-brand"
              >
                {initials(profile.name)}
              </span>

              <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-lg font-bold text-ink-900">
                  {profile.name}
                </h2>
                <p className="mt-0.5 truncate text-sm text-ink-500">{profile.email}</p>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone={isAdmin ? 'brand' : 'info'}>
                    {profile.roleName ?? 'No role assigned'}
                  </Badge>
                  {profile.locked && <Badge tone="danger">Locked</Badge>}
                </div>
              </div>
            </div>

            <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
              {profile.phone && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Phone</dt>
                  <dd className="text-ink-900">{profile.phone}</dd>
                </div>
              )}
              {profile.business && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">Business</dt>
                  <dd className="flex items-center gap-1.5 text-ink-900">
                    <Store className="size-3.5 text-ink-400" strokeWidth={2.25} aria-hidden="true" />
                    {profile.business.name}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Member since</dt>
                <dd className="tnum text-ink-900">{date(profile.memberSince)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Last sign-in</dt>
                <dd className="tnum text-ink-900">
                  {profile.lastLoginAt ? dateTime(profile.lastLoginAt) : '-'}
                </dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              {/* Only shown to somebody who can actually open it - a link that
                  403s is worse than no link. */}
              {isAdmin && (
                <Link
                  to="/admin/settings/users"
                  className={cn(pressable, 'inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
                >
                  <UsersRound className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  Manage users
                </Link>
              )}

              <button
                type="button"
                onClick={() => signOut()}
                className={cn(pressable, 'inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink-600 hover:border-danger hover:bg-danger-50 hover:text-danger')}
              >
                <LogOut className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                Sign out
              </button>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-ink-400">
              Your name, email and role are changed on Settings → Users by an administrator - the one
              place the self-demotion and last-admin rules are enforced.
            </p>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel
            title="What you can reach"
            description="Enforced on every request, not only in the navigation."
          >
            <ul className="divide-y divide-line">
              {Object.entries(AREA_LABELS).map(([area, label]) => {
                const level = profile.areas?.[area] ?? 'none';
                return (
                  <li key={area} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                    <span
                      className={cn(
                        'text-md',
                        level === 'none' ? 'text-ink-400' : 'text-ink-900',
                      )}
                    >
                      {label}
                    </span>
                    <Badge tone={LEVEL_TONE[level]}>{LEVEL_LABEL[level]}</Badge>
                  </li>
                );
              })}
            </ul>

            {isAdmin && (
              <p className="mt-3 flex items-start gap-2 border-t border-line pt-3 text-sm leading-relaxed text-ink-500">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand" strokeWidth={2.25} aria-hidden="true" />
                An administrator bypasses the role system entirely - this grid is what that means in
                practice, not a role that could be edited.
              </p>
            )}
          </Panel>

          <Panel
            title="Your recent activity"
            description="The last ten things you changed, from the activity log."
          >
            {(data?.activity ?? []).length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-ink-500">
                <CircleUser className="size-4 text-ink-300" strokeWidth={2} aria-hidden="true" />
                Nothing recorded yet.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {data.activity.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2.5 first:pt-0">
                    <span className="min-w-0 flex-1 text-sm text-ink-700">
                      {row.description || row.action}
                    </span>
                    <span className="tnum shrink-0 text-xs text-ink-400">
                      {dateTime(row.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

export default AdminProfilePage;
