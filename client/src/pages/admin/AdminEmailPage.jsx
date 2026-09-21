import { useState } from 'react';
import useAdminForm from '@/hooks/useAdminForm';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  CheckCircle2,
  Mail,
  MailX,
  Pencil,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  Undo2,
  Users,
} from 'lucide-react';

import {
  campaignSchema,
  CAMPAIGN_AUDIENCES,
  CAMPAIGN_AUDIENCE_LABELS,
} from '@shared/schemas/admin';
import Panel, { PanelEmpty, StatTile } from '@/components/ui/Panel';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import SelectField from '@/components/ui/SelectField';
import PageHeader from '@/components/admin/PageHeader';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Pagination from '@/components/ui/Pagination';
import useTablePage from '@/hooks/useTablePage';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import {
  useMarketingCampaign,
  useMarketingCampaigns,
  useMarketingSummary,
  useMarketingUnsubscribes,
  useAdminMutations,
} from '@/hooks/useAdmin';
import { dateTime } from '@/lib/format';
import cn from '@/lib/cn';

/**
 * Email campaigns (§6.13).
 *
 * **The one marketing channel that genuinely sends**, whenever `SMTP_URL` is
 * configured - so this is not on the §6b register waiting for a provider.
 * Without a transport nothing is delivered and nothing is kept: the result
 * panel reports the failures rather than implying a delivery.
 *
 * **CASL is enforced on the server and explained here.** The audience picker
 * chooses a population; consent then removes from it, at send time, and there
 * is no control on this screen that can switch that off. That is why the send
 * dialog shows two numbers - who matched, and who will actually receive it.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/marketing/email'], icon: adminIcon('Mail') };

const STATUS_TONE = {
  draft: 'neutral',
  scheduled: 'info',
  sending: 'info',
  sent: 'ok',
  failed: 'danger',
};

function CampaignForm({ campaign, onSubmit, onCancel, isPending, error }) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useAdminForm({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      name: campaign?.name ?? '',
      subject: campaign?.subject ?? '',
      body: campaign?.body ?? '',
      audience: { filter: campaign?.audience?.filter ?? 'approved' },
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <Input
        label="Campaign name"
        hint="Internal only - recipients never see this."
        placeholder="Spring restock announcement"
        error={errors.name?.message}
        {...register('name')}
      />

      <Input
        label="Subject line"
        placeholder="New OLED stock landed this week"
        error={errors.subject?.message}
        {...register('subject')}
      />

      <SelectField
        control={control}
        name="audience.filter"
        label="Audience"
        hint="Accounts that have not consented, or have unsubscribed, are removed from this at send time."
        options={CAMPAIGN_AUDIENCES.map((value) => ({
          value,
          label: CAMPAIGN_AUDIENCE_LABELS[value],
        }))}
        error={errors.audience?.filter?.message}
      />

      <Textarea
        label="Message"
        rows={10}
        counter={20000}
        hint="{{businessName}} and {{contactName}} are filled in per recipient. Sender details and an unsubscribe link are added automatically - CASL requires both."
        placeholder={'Hi {{contactName}},\n\nWe have just restocked…'}
        error={errors.body?.message}
        {...register('body')}
      />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          {campaign ? 'Save campaign' : 'Create campaign'}
        </Button>
      </div>
    </form>
  );
}

/** The Unsubscribes screen, in a modal - it is a register, not a workflow. */
function UnsubscribesModal({ open, onClose }) {
  const [error, setError] = useState(null);
  const { data, isLoading } = useMarketingUnsubscribes({ limit: 100 });
  const { resubscribe } = useAdminMutations();

  async function handleResubscribe(row) {
    setError(null);
    try {
      await resubscribe.mutateAsync(row.id);
    } catch (err) {
      setError(err.message);
    }
  }

  const rows = data?.unsubscribes ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Unsubscribes" size="lg">
      <div className="flex flex-col gap-4">
        <p className="rounded-md bg-surface-2 px-3 py-2.5 text-sm leading-relaxed text-ink-600">
          Canadian anti-spam law requires a working unsubscribe on every commercial email, and this
          is the register of who has used it. These accounts are excluded from every campaign
          automatically - there is no setting that overrides it.
        </p>

        {error && (
          <p className="rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">{error}</p>
        )}

        {isLoading ? (
          <p className="text-sm text-ink-500">Loading…</p>
        ) : rows.length === 0 ? (
          <PanelEmpty
            icon={ShieldCheck}
            title="Nobody has unsubscribed"
            body={`${data?.consenting ?? 0} accounts currently consent to marketing email.`}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-md font-medium text-ink-900">
                    {row.displayName ?? row.businessName}
                  </p>
                  <p className="truncate text-xs text-ink-400">{row.email}</p>
                  <p className="mt-0.5 text-xs text-ink-400">
                    Unsubscribed {dateTime(row.unsubscribedAt)}
                  </p>
                </div>

                {/* Putting somebody back on the list records a NEW consent
                    dated today, rather than erasing their refusal - the
                    staff member is told that before they click. */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleResubscribe(row)}
                  loading={resubscribe.isPending}
                >
                  <Undo2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  Re-subscribe
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/**
 * The send dialog.
 *
 * Two numbers, always: how many the audience matched and how many will actually
 * be written to. When they differ, consent is the reason, and saying so here
 * stops "I sent to 40 and only 12 got it" from reading as a bug.
 */
function SendDialog({ campaign, audience, open, onClose, onSent }) {
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const { sendCampaign } = useAdminMutations();

  async function handleSend() {
    setError(null);
    try {
      const payload = await sendCampaign.mutateAsync(campaign.id);
      setResult(payload.result);
      onSent?.();
    } catch (err) {
      setError(err.message);
    }
  }

  function handleClose() {
    setResult(null);
    setError(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title={`Send "${campaign?.name ?? ''}"`} size="md">
      {result ? (
        <div className="flex flex-col gap-4">
          <p className="flex items-start gap-2 rounded-md bg-ok-50 px-3 py-2.5 text-sm text-ok">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            The run finished. Every message is in the history, whatever happened to it.
          </p>

          {/* Three numbers rather than one, because three different things can
              happen to a message and reporting only "sent" would hide two. */}
          <dl className="grid grid-cols-3 gap-2">
            {[
              { label: 'Sent', value: result.sent, tone: 'ok' },
              { label: 'Failed', value: result.failed, tone: 'danger' },
              { label: 'Skipped', value: result.skipped, tone: 'neutral' },
            ].map((row) => (
              <div key={row.label} className="rounded-md border border-line p-3">
                <dt className="eyebrow text-ink-400">{row.label}</dt>
                <dd
                  className={cn(
                    'tnum mt-1 font-display text-xl font-bold leading-none',
                    row.tone === 'ok' && 'text-ok',
                    row.tone === 'warn' && 'text-warn',
                    row.tone === 'danger' && 'text-danger',
                    row.tone === 'neutral' && 'text-ink-900',
                  )}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>

          {result.failed > 0 && (
            <p className="rounded-md bg-danger-50 px-3 py-2.5 text-sm leading-relaxed text-ink-700">
              {result.failed} {result.failed === 1 ? 'message' : 'messages'} could not be delivered
              and {result.failed === 1 ? 'was' : 'were'} not sent. Check that an SMTP transport is
              connected under Settings, then send again - nothing is retried automatically.
            </p>
          )}
          {result.skipped > 0 && (
            <p className="text-sm leading-relaxed text-ink-500">
              {result.skipped} {result.skipped === 1 ? 'account' : 'accounts'} matched the audience
              but had not consented or had unsubscribed, so {result.skipped === 1 ? 'it' : 'they'}{' '}
              received nothing.
            </p>
          )}

          <div className="flex justify-end">
            <Button onClick={handleClose}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {error && (
            <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
              <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              {error}
            </p>
          )}

          <dl className="flex flex-col gap-2 rounded-md border border-line p-3.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Audience</dt>
              <dd className="text-ink-900">
                {CAMPAIGN_AUDIENCE_LABELS[campaign?.audience?.filter] ?? '-'}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Will receive it</dt>
              <dd className="tnum font-medium text-ink-900">{audience?.eligible ?? 0}</dd>
            </div>
            {(audience?.skipped ?? 0) > 0 && (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Excluded - no consent or unsubscribed</dt>
                <dd className="tnum text-ink-500">{audience.skipped}</dd>
              </div>
            )}
          </dl>

          <p className="text-sm leading-relaxed text-ink-500">
            The recipient list is resolved now, not when this campaign was written, so anybody who
            unsubscribed in between is already excluded. A sent campaign cannot be edited afterwards.
          </p>

          {/* An audience of nobody is explained before the button is reached,
              rather than being left to the server to refuse. Offering an
              enabled "Send to 0" that can only fail is a button that exists to
              waste a click. */}
          {(audience?.eligible ?? 0) === 0 && (
            <p className="flex items-start gap-2 rounded-md bg-warn-50 px-3 py-2.5 text-sm leading-relaxed text-ink-700">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2} aria-hidden="true" />
              Nobody in this audience has consented to marketing email, so there is nobody to send
              to. Widen the audience, or record consent on the accounts you mean to reach.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              loading={sendCampaign.isPending}
              disabled={(audience?.eligible ?? 0) === 0}
              data-autofocus
            >
              <Send className="size-4" strokeWidth={2} aria-hidden="true" />
              {(audience?.eligible ?? 0) === 0 ? 'Nobody to send to' : `Send to ${audience.eligible}`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function AdminEmailPage() {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sending, setSending] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [showUnsubscribes, setShowUnsubscribes] = useState(false);
  const [error, setError] = useState(null);

  const { data, isLoading } = useMarketingCampaigns({ limit: 50 });
  const { data: summary } = useMarketingSummary();
  const { createCampaign, updateCampaign, deleteCampaign } = useAdminMutations();

  const campaigns = data?.campaigns ?? [];

  // A page of rows for the table; counts and tiles still read the full set.
  const { pageRows: pageCampaigns, page, totalPages, from, setPage } = useTablePage(campaigns);

  async function handleCreate(values) {
    setError(null);
    try {
      await createCampaign.mutateAsync(values);
      setCreating(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUpdate(values) {
    setError(null);
    try {
      await updateCampaign.mutateAsync({ id: editing.id, ...values });
      setEditing(null);
    } catch (err) {
      setError(err.message);
    }
  }

  async function confirmDelete() {
    setError(null);
    try {
      await deleteCampaign.mutateAsync(deleting.id);
      setDeleting(null);
    } catch (err) {
      setError(err.message);
    }
  }

  const columns = [
    {
      key: 'name',
      header: 'Campaign',
      priority: 1,
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink-900">{row.name}</p>
          <p className="truncate text-xs text-ink-400">{row.subject}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      priority: 1,
      render: (row) => (
        <Badge tone={STATUS_TONE[row.status] ?? 'neutral'} size="sm">
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'audience',
      header: 'Audience',
      priority: 2,
      render: (row) => (
        <span className="text-ink-600">
          {CAMPAIGN_AUDIENCE_LABELS[row.audience.filter] ?? row.audience.filter}
        </span>
      ),
    },
    {
      key: 'sent',
      header: 'Sent',
      align: 'right',
      priority: 2,
      // Open and click tracking would need a tracking pixel and rewritten
      // links, neither of which exists - so those columns are absent rather
      // than showing an invented engagement rate.
      //
      // Undelivered messages are named here rather than left to be inferred: a
      // campaign reading a bare "0" gives no hint whether it reached nobody or
      // failed, and the staff member should not have to reopen the send dialog to
      // find that out. Older campaigns can still carry a `queued` count from
      // when unsent email was held locally, so both are shown.
      render: (row) => (
        <span className="tnum">
          {row.stats.sent}
          {row.stats.bounced > 0 && (
            <span className="ml-1.5 text-xs font-normal text-danger">
              +{row.stats.bounced} failed
            </span>
          )}
          {row.stats.queued > 0 && (
            <span className="ml-1.5 text-xs font-normal text-warn">
              +{row.stats.queued} not sent
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'sentAt',
      header: 'Sent at',
      priority: 3,
      render: (row) => (
        <span className="text-ink-500">{row.sentAt ? dateTime(row.sentAt) : '-'}</span>
      ),
    },
  ];

  const rowMenu = [
    {
      key: 'send',
      label: 'Send now',
      icon: Send,
      hidden: (row) => row.status === 'sent' || row.status === 'sending',
      onSelect: (row) => setSending(row),
    },
    {
      key: 'edit',
      label: 'Edit',
      icon: Pencil,
      hidden: (row) => row.status === 'sent' || row.status === 'sending',
      onSelect: (row) => setEditing(row),
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: Trash2,
      tone: 'danger',
      // A sent campaign is a record of what went out and stays on file - the
      // server refuses it too, so this is a courtesy, not the control.
      hidden: (row) => row.status === 'sent',
      onSelect: (row) => setDeleting(row),
    },
  ];

  return (
    <>
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowUnsubscribes(true)}>
              <MailX className="size-4" strokeWidth={2} aria-hidden="true" />
              Unsubscribes
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
              New campaign
            </Button>
          </div>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Campaigns"
            value={summary?.campaigns ?? 0}
            icon={Mail}
            hint="Drafts and sent"
          />
          <StatTile
            label="Consenting accounts"
            value={summary?.consenting ?? 0}
            icon={Users}
            tone="ok"
            hint="Eligible to receive marketing email"
          />
          <StatTile
            label="Unsubscribed"
            value={summary?.unsubscribed ?? 0}
            icon={MailX}
            tone={summary?.unsubscribed ? 'warn' : 'neutral'}
            hint="Excluded from every campaign"
          />
        </div>

        <Panel flush>
          {isLoading ? (
            <p className="p-4 text-sm text-ink-500">Loading campaigns…</p>
          ) : campaigns.length === 0 ? (
            <PanelEmpty
              icon={Mail}
              title="No campaigns yet"
              body="Write one and it goes to the accounts that have consented to marketing email."
              action={
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
                  New campaign
                </Button>
              }
            />
          ) : (
            <>
              <div className="border-b border-line px-3 py-2 sm:px-4">
                <CountLine
                  total={campaigns.length}
                  shown={pageCampaigns.length}
                  from={from}
                  noun={campaigns.length === 1 ? 'campaign' : 'campaigns'}
                />
              </div>

              <DataTable rows={pageCampaigns} columns={columns} rowMenu={rowMenu} />

              <Pagination
                page={page}
                pages={totalPages}
                onChange={setPage}
                hideWhenSingle
                className="border-t border-line px-3 py-3 sm:px-4"
              />
            </>
          )}
        </Panel>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New campaign" size="lg">
        <CampaignForm
          onSubmit={handleCreate}
          onCancel={() => setCreating(false)}
          isPending={createCampaign.isPending}
          error={error}
        />
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.name ?? 'campaign'}`}
        size="lg"
      >
        {editing && (
          <CampaignForm
            campaign={editing}
            onSubmit={handleUpdate}
            onCancel={() => setEditing(null)}
            isPending={updateCampaign.isPending}
            error={error}
          />
        )}
      </Modal>

      {sending && (
        <SendCampaignDialog campaign={sending} onClose={() => setSending(null)} />
      )}

      <UnsubscribesModal open={showUnsubscribes} onClose={() => setShowUnsubscribes(false)} />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => {
          setDeleting(null);
          setError(null);
        }}
        onConfirm={confirmDelete}
        title={`Delete ${deleting?.name ?? 'campaign'}?`}
        body="It has not been sent, so nothing has gone out."
        confirmLabel="Delete campaign"
        loading={deleteCampaign.isPending}
        error={error}
      />
    </>
  );
}

/**
 * Fetches the campaign's live audience before offering to send it.
 *
 * Split out so the count is read at the moment the staff member opens the dialog
 * rather than whenever the list was last fetched - the number they are about to
 * act on has to be the current one.
 */
function SendCampaignDialog({ campaign, onClose }) {
  const { data } = useMarketingCampaign(campaign.id);

  return (
    <SendDialog
      campaign={data?.campaign ?? campaign}
      audience={data?.audience}
      open
      onClose={onClose}
    />
  );
}

export default AdminEmailPage;
