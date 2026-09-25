import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { businessSlugProblem } from '@shared/hosts';
import Input from '@/components/ui/Input';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { relativeTime } from '@/lib/format';
import { toast } from '@/store/toastStore';
import { Building2, Mail, MapPin, Pencil, Phone, Star, UserRound } from 'lucide-react';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminBusiness, useAdminMutations } from '@/hooks/useAdmin';
import { useAuth } from '@/hooks/useAuth';
import { canEdit } from '@/lib/permissions';
import { useSetRecordLabel } from '@/components/admin/shell/recordLabel';
import { pressable } from '@/lib/motion';
import cn from '@/lib/cn';

/** One store: its details and the staff standing in it (§6.14). */
const STATUS_TONE = { active: 'ok', inactive: 'neutral', maintenance: 'warn' };
const STATUS_LABEL = { active: 'Active', inactive: 'Inactive', maintenance: 'Maintenance' };

const DAY_LABEL = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export function AdminBusinessDetailPage() {
  const { id } = useParams();
  const { data: business, isLoading } = useAdminBusiness(id);
  const { setDefaultBusiness } = useAdminMutations();
  const { permissions } = useAuth();
  const editable = canEdit(permissions, 'business');

  // The breadcrumb is a sibling of this page, not a child, so the record name
  // is published rather than passed down.
  useSetRecordLabel(business?.name);

  if (isLoading) return <p className="text-sm text-ink-500">Loading business…</p>;
  if (!business) return <PanelEmpty icon={Building2} title="Business not found" body="It may have been deleted." />;

  const address = [business.address?.street, business.address?.line2, business.address?.city, business.address?.region, business.address?.postal, business.address?.country]
    .filter(Boolean)
    .join(', ');

  return (
    // The record measure, centred - one record is a reading screen, and a
    // list is what earns the shell's full width. The `.record-page` class carries
    // the whole treatment; see the container tokens in index.css.
    <div className="record-page">
      <PageHeader
        icon={adminIcon('Store')}
        title={business.name}
        description={business.code}
        badge={
          <div className="flex gap-1.5">
            <Badge tone={STATUS_TONE[business.status] ?? 'neutral'} size="sm">
              {STATUS_LABEL[business.status] ?? business.status}
            </Badge>
            {business.isDefault && (
              <Badge tone="brand" size="sm">
                Default
              </Badge>
            )}
          </div>
        }
        action={
          editable && (
            <div className="flex gap-2">
              {!business.isDefault && business.status === 'active' && (
                <Button variant="outline" size="sm" onClick={() => setDefaultBusiness.mutate(business.id)}>
                  <Star className="size-4" strokeWidth={2} aria-hidden="true" />
                  Make default
                </Button>
              )}
              <Link
                to={`/admin/businesses/${business.id}/edit`}
                className={cn(pressable, 'inline-flex h-9 items-center gap-1.5 rounded-md bg-ink-900 px-3.5 text-sm font-medium text-white hover:bg-ink-800')}
              >
                <Pencil className="size-4" strokeWidth={2} aria-hidden="true" />
                Edit
              </Link>
            </div>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="flex flex-col gap-4">
          <Panel title="Contact & location">
            <dl className="flex flex-col gap-3 text-md">
              <div className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 size-4 shrink-0 text-ink-400" strokeWidth={2} aria-hidden="true" />
                <div>
                  <dt className="text-xs text-ink-400">Address</dt>
                  <dd className="text-ink-900">{address || 'Not set'}</dd>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Phone className="mt-0.5 size-4 shrink-0 text-ink-400" strokeWidth={2} aria-hidden="true" />
                <div>
                  <dt className="text-xs text-ink-400">Phone</dt>
                  <dd className="text-ink-900">{business.phone || 'Not set'}</dd>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <Mail className="mt-0.5 size-4 shrink-0 text-ink-400" strokeWidth={2} aria-hidden="true" />
                <div>
                  <dt className="text-xs text-ink-400">Email</dt>
                  <dd className="text-ink-900">{business.email || 'Not set'}</dd>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <UserRound className="mt-0.5 size-4 shrink-0 text-ink-400" strokeWidth={2} aria-hidden="true" />
                <div>
                  <dt className="text-xs text-ink-400">Manager</dt>
                  <dd className="text-ink-900">{business.manager || 'Not set'}</dd>
                </div>
              </div>
            </dl>
          </Panel>

          {business.hours?.length > 0 && (
            <Panel title="Hours">
              <dl className="flex flex-col gap-1.5 text-sm">
                {business.hours.map((row) => (
                  <div key={row.day} className="flex justify-between border-b border-line py-1.5 last:border-0">
                    <dt className="text-ink-600">{DAY_LABEL[row.day] ?? row.day}</dt>
                    <dd className={row.closed ? 'text-ink-400' : 'text-ink-900'}>
                      {row.closed ? 'Closed' : `${row.open ?? '-'} – ${row.close ?? '-'}`}
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>
          )}

          {business.notes && (
            <Panel title="Notes">
              <p className="text-md leading-relaxed text-ink-600">{business.notes}</p>
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <StorefrontAddress business={business} editable={editable} />

          <Panel
            title="Staff"
            description="Assigned from the Users screen."
          >
            {business.staff?.length ? (
              <ul className="flex flex-col gap-2">
                {business.staff.map((member) => (
                  <li
                    key={member._id ?? member.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-md text-ink-900">{member.contactName}</p>
                      <p className="truncate text-xs text-ink-400">{member.email}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {member.lockedAt && (
                        <Badge tone="danger" size="sm">
                          Locked
                        </Badge>
                      )}
                      <Badge tone="neutral" size="sm">
                        {member.staffRole?.name ?? 'No role'}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-500">Nobody is assigned to this business yet.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/**
 * Where customers reach this business's storefront, and asking for it.
 *
 * **The tenant asks; the platform approves.** An address decides which
 * catalogue a stranger's browser opens and is printed on receipts, so it is
 * granted in the platform console, never set here. This card is the request
 * and its answer: the live address when there is one, what is waiting, and why
 * a request was turned down - in that order, because the live address is what
 * somebody opening this card is usually checking.
 */
function StorefrontAddress({ business, editable }) {
  const { requestAddress, cancelAddressRequest } = useAdminMutations();
  const [slug, setSlug] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);

  const domain = business.storefrontDomain;
  const full = (label) => (domain ? `${label}.${domain}` : label);
  const request = business.addressRequest;
  const pending = request?.status === 'pending';
  const problem = slug ? businessSlugProblem(slug) : null;

  return (
    <Panel title="Website address">
      {business.slug ? (
        <div>
          <p className="text-xs text-ink-400">Live</p>
          {domain ? (
            <a
              href={`https://${full(business.slug)}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-md break-all text-ink-900 underline decoration-ink-300 underline-offset-2"
            >
              {full(business.slug)}
            </a>
          ) : (
            <p className="font-mono text-md text-ink-900">{business.slug}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-500">
          No address yet. Customers cannot reach a website for this business until one is
          approved.
        </p>
      )}

      {pending && (
        <div className="mt-3 rounded-md border border-line px-3 py-2.5">
          <p className="text-sm text-ink-900">
            Requested <span className="font-mono">{full(request.slug)}</span>
          </p>
          <p className="mt-0.5 text-xs text-ink-400">
            Waiting for approval · {relativeTime(request.requestedAt)}
          </p>
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 -ml-2"
              onClick={() => setWithdrawing(true)}
            >
              Withdraw request
            </Button>
          )}
        </div>
      )}

      {request?.status === 'rejected' && (
        <div className="mt-3 rounded-md border border-line px-3 py-2.5">
          <p className="text-sm text-ink-900">
            <span className="font-mono">{full(request.slug)}</span> was not approved
          </p>
          {request.note && <p className="mt-0.5 text-sm text-ink-600">{request.note}</p>}
        </div>
      )}

      {editable && !pending && (
        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!slug || problem) return;
            requestAddress.mutate(
              { id: business.id, slug },
              {
                onSuccess: () => {
                  setSlug('');
                  toast.ok('Request sent', `${full(slug)} goes live once Kelinto approves it.`);
                },
              },
            );
          }}
        >
          <Input
            label={business.slug ? 'Ask for a different address' : 'Ask for an address'}
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase().trim())}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            error={problem || requestAddress.error?.message}
            hint={
              slug && !problem
                ? `Would open at ${full(slug)}.${business.slug ? ' The current address stops working once it is approved.' : ''}`
                : 'Lowercase letters, digits and hyphens.'
            }
          />
          <Button
            type="submit"
            size="sm"
            className="mt-2"
            disabled={!slug || Boolean(problem)}
            loading={requestAddress.isPending}
          >
            Send request
          </Button>
        </form>
      )}

      <ConfirmDialog
        open={withdrawing}
        onClose={() => setWithdrawing(false)}
        onConfirm={() =>
          cancelAddressRequest.mutate(business.id, {
            onSuccess: () => setWithdrawing(false),
          })
        }
        tone="warn"
        title={`Withdraw the request for ${full(request?.slug ?? '')}?`}
        body="Kelinto will no longer see it, and the address is free for anybody else to ask for. The live address, if there is one, does not change."
        confirmLabel="Withdraw request"
        loading={cancelAddressRequest.isPending}
        error={cancelAddressRequest.error?.message}
      />
    </Panel>
  );
}

export default AdminBusinessDetailPage;
