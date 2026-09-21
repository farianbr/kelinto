import { AlertCircle, CalendarDays, Contact, ExternalLink } from 'lucide-react';

import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminCredentials } from '@/hooks/useAdmin';

/**
 * Third-Party Apps (§6.15 category 7 - **UI only, §6b U7**).
 *
 * Ready-made OAuth connections. The round-trip needs a Google Cloud client id
 * and secret that Cellvix does not have yet, so this ships as interface and
 * setup guidance rather than a `Connect` button that opens a broken consent
 * screen.
 *
 * **§6b rule 2: a persistent notice naming what is inactive and what unblocks
 * it** - not a tooltip, not a disabled button with a title attribute. And §6b
 * rule 4: nothing here reports a connection that does not exist, so `Connect`
 * is rendered as a disabled control with the blocker stated beside it rather
 * than as a live button that fails.
 *
 * The Google Maps key on the API Keys screen is a **different credential** and
 * is deliberately not conflated with this: it is a server-side API key for
 * address autocomplete, while these are per-account OAuth grants.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/settings/third-party'], icon: adminIcon('Plug') };

const CONNECTIONS = [
  {
    key: 'google-contacts',
    label: 'Google Contacts',
    icon: Contact,
    description:
      'Import client contact details, and keep a business account in step with the address book it came from.',
    needs: 'A Google Cloud OAuth client id and secret, plus the People API enabled on that project.',
  },
  {
    key: 'google-calendar',
    label: 'Google Calendar',
    icon: CalendarDays,
    description:
      'Two-way sync for the scheduling board - pickups, deliveries and RMA drop-offs on a calendar staff already watch.',
    // Named plainly: this one is blocked twice over, and saying only "needs
    // OAuth" would imply connecting Google is enough to make it work.
    needs:
      'The same OAuth credentials, and a decision on what the calendar actually schedules (§6b U1) - the board itself is not wired yet.',
  },
];

export function AdminThirdPartyPage() {
  // Read only to show whether the Google API key is set - a different
  // credential from these OAuth grants, and worth distinguishing on screen so
  // a staff member who has set one does not think they have set the other.
  const { data } = useAdminCredentials();
  const googleKey = data?.providers?.find((provider) => provider.provider === 'google');

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
      />

      {/* The measure wraps the notice as well as the panels.

          It sat outside the capped container, so a full-bleed banner ran the
          shell's whole width above content that stopped at the form measure
          the page disagreed with itself about where its own edge was, and the
          notice read as belonging to the shell rather than to this screen. */}
      {/* `.form-page`, not `max-w-form`: the latter caps the width but sets no
          margin, so this screen sat hard against the sidebar with a third of
          the window empty beside it while every other settings form centred
          itself. Same measure, same rule as the rest of /admin. */}
      <div className="form-page">
      <p className="mb-5 flex items-start gap-2.5 rounded-lg border border-warn/25 bg-warn-50 px-3.5 py-3 text-sm leading-relaxed text-ink-700">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2} aria-hidden="true" />
        <span>
          <strong className="font-semibold">Not connected yet.</strong> These connections need Google
          Cloud OAuth credentials, which are not configured yet. The screen below shows what each one
          will do and what it is waiting on - nothing here connects anything today.
        </span>
      </p>

      <div className=" space-y-4">
        {CONNECTIONS.map((connection) => {
          const Icon = connection.icon;

          return (
            <Panel
              key={connection.key}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <Icon className="size-4 text-ink-400" strokeWidth={2} aria-hidden="true" />
                  {connection.label}
                  <Badge tone="neutral">Not connected</Badge>
                </span>
              }
              description={connection.description}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink-600">
                  <span className="font-semibold text-ink-700">Needs: </span>
                  {connection.needs}
                </p>

                {/* Disabled rather than absent: the control is what the screen
                    is describing, and hiding it would leave the reader unsure
                    whether connecting is even planned. */}
                <button
                  type="button"
                  disabled
                  className="inline-flex h-9 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-md border border-line bg-surface-2 px-3.5 text-sm font-medium text-ink-400"
                >
                  Connect
                  <ExternalLink className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                </button>
              </div>
            </Panel>
          );
        })}

        <Panel
          title="Setting these up"
          description="What somebody with access to the Google Cloud console needs to do."
        >
          <ol className="ml-4 list-decimal space-y-1.5 text-sm leading-relaxed text-ink-600">
            <li>Create a project in the Google Cloud console, or pick an existing one.</li>
            <li>Enable the People API for Contacts, and the Calendar API for Calendar.</li>
            <li>
              Configure the OAuth consent screen as an <strong>internal</strong> app if Cellvix uses
              Google Workspace - that avoids a verification review.
            </li>
            <li>
              Create an OAuth client id of type <em>Web application</em>, with this panel’s origin as
              an authorised redirect URI.
            </li>
            <li>Give the client id and secret to whoever deploys the server.</li>
          </ol>

          <p className="mt-4 border-t border-line pt-3 text-sm leading-relaxed text-ink-500">
            The <strong className="font-semibold text-ink-700">Google Maps &amp; Places</strong> key
            on the API Keys screen is a different credential - a server-side key for address
            autocomplete, not an OAuth grant. It is currently{' '}
            {googleKey?.configured ? 'set' : 'not set'}, and setting it does not connect either app
            above.
          </p>
        </Panel>
      </div>
      </div>
    </>
  );
}

export default AdminThirdPartyPage;
