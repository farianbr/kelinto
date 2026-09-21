import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Activity,
  AlertCircle,
  Gauge,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Save,
  SquarePen,
} from 'lucide-react';

import cn from '@/lib/cn';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import TabRow from '@/components/ui/TabRow';
import SelectMenu from '@/components/ui/SelectMenu';
import PageHeader from '@/components/admin/PageHeader';
import DataTable from '@/components/admin/DataTable';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import {
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  SERVICE_QUOTE_STATUSES,
  SERVICE_QUOTE_STATUS_LABELS,
  ORDER_STATUS_FLOW,
} from '@shared/schemas/admin';
import {
  useMarketingTemplates,
  useMarketingSummary,
  useMarketingLimits,
  useMarketingMessages,
  useAdminMutations,
} from '@/hooks/useAdmin';
import { dateTime } from '@/lib/format';
import { pressable } from '@/lib/motion';

/**
 * Notifications - the message a customer gets at each status, the caps on how
 * many go out, and what actually went.
 *
 * ## Why this is a grid rather than a list
 *
 * This screen was a flat list of free-form templates: a name, a channel, a
 * body, and no connection to anything that happens. That is not how a shop
 * thinks about it. A shop has one thing it says when a ticket reaches
 * Diagnosis and a different thing when it reaches Ready to Pickup, and the
 * question it asks of this screen is "what do we send at this point, and have
 * we written it yet". A list of names cannot answer that - you have to open
 * each one to find out which status it was for, and nothing tells you which
 * statuses have no message at all.
 *
 * So: pick a channel, pick a document, pick a status, write the one message
 * that belongs there. The status pills carry their own state, so the gaps are
 * visible without opening anything, which is the whole reason the grid beats
 * the list.
 *
 * ## The three tabs
 *
 * **Templates** is the grid above. **Limit** is the send caps - a safety rail,
 * not a quota, so a loop or a bad import cannot mail ten thousand people
 * before anybody notices. **Activity** is the last fifty attempts, which is
 * where "did that actually send" gets answered; until a provider is connected
 * every row reads as skipped, and that is the honest answer rather than a
 * silence.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/settings/templates'], icon: adminIcon('MessageSquare') };

const CHANNELS = [
  { key: 'call', label: 'Call', icon: Phone },
  { key: 'sms', label: 'SMS', icon: MessageSquare },
  { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { key: 'email', label: 'Email', icon: Mail },
];

const CHANNEL_LABELS = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label]));

/**
 * The statuses each document moves through.
 *
 * Read from the shared lists rather than typed again here, so a status added
 * to tickets appears on this screen without anybody remembering to. `none` is
 * the general case: a message tied to no status at all, which is what every
 * template written before this screen existed is.
 */
const DOCUMENTS = [
  { key: 'none', label: 'General', statuses: [] },
  {
    key: 'ticket',
    label: 'Ticket',
    statuses: TICKET_STATUSES.map((value) => ({ value, label: TICKET_STATUS_LABELS[value] ?? value })),
  },
  {
    key: 'invoice',
    label: 'Invoice',
    statuses: [
      { value: 'unpaid', label: 'Unpaid' },
      { value: 'partial', label: 'Part paid' },
      { value: 'paid', label: 'Paid' },
      { value: 'overdue', label: 'Overdue' },
    ],
  },
  {
    key: 'quote',
    label: 'Quote',
    statuses: SERVICE_QUOTE_STATUSES.map((value) => ({
      value,
      label: SERVICE_QUOTE_STATUS_LABELS[value] ?? value,
    })),
  },
  {
    key: 'order',
    label: 'Order',
    statuses: ORDER_STATUS_FLOW.map((value) => ({
      value,
      label: value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    })),
  },
  {
    key: 'rma',
    label: 'Return',
    statuses: ['approved', 'in_transit', 'received', 'inspecting', 'rejected'].map((value) => ({
      value,
      label: value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    })),
  },
];

/** The placeholders a body may carry, as the model fills them. */
const TOKENS = [
  '{{contactName}}',
  '{{ticketNumber}}',
  '{{invoiceNumber}}',
  '{{shopName}}',
  '{{status}}',
  '{{amount}}',
];

/** What a call template is: a script somebody reads, not a message that sends. */
const CALL_NOTE =
  'A call template is a script for whoever picks up the phone. Nothing is sent - the Calls screen logs that the call happened.';

function statusesFor(documentKey) {
  return DOCUMENTS.find((d) => d.key === documentKey)?.statuses ?? [];
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One message, for one status on one channel.
 *
 * Saves itself rather than handing a payload upward: each cell of the grid is
 * independent, and a single form over the whole grid would make "save" mean
 * "write forty-five messages", which is not a thing anybody means to do.
 */
function MessageEditor({ channel, document: documentKey, status, statusLabel, template }) {
  const { createTemplate, updateTemplate } = useAdminMutations();

  const [subject, setSubject] = useState(template?.subject ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  // Remount on a different cell rather than syncing state in an effect: the
  // key below is the cell's identity, so React does the reset for us.
  const isCall = channel === 'call';
  const isEmail = channel === 'email';
  const pending = createTemplate.isPending || updateTemplate.isPending;

  async function save(event) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    if (!body.trim()) {
      setError(isCall ? 'Write the script first.' : 'Write the message first.');
      return;
    }

    const payload = {
      // Named for where it sits, because the name is no longer how anybody
      // finds it - the document and status are.
      name: `${DOCUMENTS.find((d) => d.key === documentKey)?.label ?? documentKey} · ${statusLabel}`,
      channel,
      document: documentKey,
      status,
      subject: isEmail ? subject : '',
      body,
      isActive: true,
    };

    try {
      if (template?.id) await updateTemplate.mutateAsync({ id: template.id, ...payload });
      else await createTemplate.mutateAsync(payload);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          Message for {DOCUMENTS.find((d) => d.key === documentKey)?.label ?? documentKey} ·{' '}
          {statusLabel}
          <Badge tone={template?.id ? 'ok' : 'neutral'} size="sm">
            {template?.id ? 'Written' : 'Not set'}
          </Badge>
        </span>
      }
    >
      <form onSubmit={save} className="space-y-4">
        {isCall && <p className="text-sm leading-relaxed text-ink-500">{CALL_NOTE}</p>}

        {isEmail && (
          <Input
            label="Subject"
            placeholder={`Your ${DOCUMENTS.find((d) => d.key === documentKey)?.label?.toLowerCase() ?? 'update'} - {{status}}`}
            value={subject}
            onChange={(event) => {
              setSubject(event.target.value);
              setSaved(false);
            }}
          />
        )}

        <Textarea
          label={isCall ? 'Call script / reminder note' : 'Message'}
          rows={5}
          required
          value={body}
          counter={5000}
          onChange={(event) => {
            setBody(event.target.value);
            setSaved(false);
          }}
          placeholder={
            isCall
              ? 'Short script or reminder for staff to read when calling the customer at this status…'
              : `Hi {{contactName}}, your repair is now ${statusLabel.toLowerCase()}. - {{shopName}}`
          }
          error={error ?? undefined}
        />

        {/* The tokens are clickable rather than a list to copy from: the whole
            reason a body goes stale is somebody typing one from memory. */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-surface-2 px-3 py-2.5">
          <span className="text-xs text-ink-500">Placeholders:</span>
          {TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              onClick={() => {
                setBody((current) => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${token}`);
                setSaved(false);
              }}
              className={cn(
                pressable,
                'rounded-sm border border-line bg-surface px-1.5 py-0.5 font-mono text-2xs text-ink-600 hover:border-ink-300 hover:text-ink-900',
              )}
            >
              {token}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" icon={Save} loading={pending}>
            Save message
          </Button>
          {saved && <span className="text-sm text-ok">Saved.</span>}
        </div>
      </form>
    </Panel>
  );
}

function TemplatesTab({ channel, templates, counts }) {
  const [documentKey, setDocumentKey] = useState('ticket');
  const statuses = statusesFor(documentKey);
  const [status, setStatus] = useState(statuses[0]?.value ?? '');

  // A document with no statuses (General) holds one message, not a grid.
  const activeStatus = statuses.length ? status || statuses[0].value : '';
  const activeLabel =
    statuses.find((s) => s.value === activeStatus)?.label ?? 'Any status';

  const written = useMemo(
    () =>
      new Set(
        templates
          .filter((t) => t.channel === channel && (t.document ?? 'none') === documentKey)
          .map((t) => t.status || ''),
      ),
    [templates, channel, documentKey],
  );

  const template = templates.find(
    (t) =>
      t.channel === channel &&
      (t.document ?? 'none') === documentKey &&
      (t.status || '') === activeStatus,
  );

  return (
    <div className="space-y-4">
      <Panel
        title="Message templates"
        description="One message per status, per channel. Pick where it belongs, then write it."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectMenu
            label="Document"
            value={documentKey}
            onChange={(next) => {
              setDocumentKey(next);
              setStatus(statusesFor(next)[0]?.value ?? '');
            }}
            options={DOCUMENTS.map((d) => ({ value: d.key, label: d.label }))}
          />
          {statuses.length > 0 && (
            <SelectMenu
              label="Status"
              value={activeStatus}
              onChange={setStatus}
              options={statuses.map((s) => ({ value: s.value, label: s.label }))}
            />
          )}
        </div>

        {/* Every status at a glance, with the ones still unwritten visibly
            unwritten. This is the part a list could never show. */}
        {statuses.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-4">
            {statuses.map((s) => {
              const isSet = written.has(s.value);
              const isActive = s.value === activeStatus;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStatus(s.value)}
                  aria-pressed={isActive}
                  className={cn(
                    pressable,
                    'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium',
                    isActive
                      ? 'border-brand bg-brand-50 text-brand-700'
                      : 'border-line bg-surface text-ink-600 hover:border-line-strong hover:text-ink-900',
                  )}
                >
                  <span
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      isSet ? 'bg-ok' : 'bg-ink-300',
                    )}
                    aria-hidden="true"
                  />
                  {s.label}
                </button>
              );
            })}
          </div>
        )}
      </Panel>

      {/* Keyed on the cell, so moving to another status resets the editor
          rather than carrying the previous body across. */}
      <MessageEditor
        key={`${channel}:${documentKey}:${activeStatus}`}
        channel={channel}
        document={documentKey}
        status={activeStatus}
        statusLabel={activeLabel}
        template={template}
      />

      <p className="text-sm text-ink-400">
        {counts[channel] ?? 0} {CHANNEL_LABELS[channel]} message
        {(counts[channel] ?? 0) === 1 ? '' : 's'} written in total.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Limit                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * One channel's caps.
 *
 * Its own form and its own save, matching the route: the four channels are
 * edited separately and saving email should not rewrite the SMS numbers that
 * happened to be on screen.
 */
function LimitCard({ row }) {
  const { saveMessageLimit } = useAdminMutations();
  const channel = CHANNELS.find((c) => c.key === row.channel);
  const Icon = channel?.icon ?? MessageSquare;

  const [form, setForm] = useState({
    daily: String(row.daily ?? 0),
    monthly: String(row.monthly ?? 0),
    alertPercent: String(row.alertPercent ?? 80),
    alertEmail: row.alertEmail ?? '',
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const set = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setSaved(false);
  };

  const used = row.usedToday ?? 0;
  const cap = Number(form.daily) || 0;
  const pct = cap > 0 ? Math.min(Math.round((used / cap) * 100), 100) : 0;

  async function save(event) {
    event.preventDefault();
    setError(null);
    try {
      await saveMessageLimit.mutateAsync({
        channel: row.channel,
        daily: Number(form.daily) || 0,
        monthly: Number(form.monthly) || 0,
        alertPercent: Number(form.alertPercent) || 0,
        alertEmail: form.alertEmail,
      });
      setSaved(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Panel>
      <form onSubmit={save} className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 font-display text-md font-semibold text-ink-900">
            <Icon className="size-4 shrink-0 text-ink-400" strokeWidth={2} aria-hidden="true" />
            {channel?.label ?? row.channel}
          </span>
          <span className="tnum text-xs text-ink-500">
            {used} / {cap || '–'} today
          </span>
        </div>

        {/* The bar is the whole reason the usage number is here: a cap with no
            sense of how close it is cannot be acted on. */}
        <div className="h-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-slow',
              pct >= (Number(form.alertPercent) || 100) ? 'bg-warn' : 'bg-brand-gradient-compact',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Daily"
            type="number"
            min="0"
            required
            value={form.daily}
            onChange={(event) => set({ daily: event.target.value })}
          />
          <Input
            label="Monthly"
            type="number"
            min="0"
            required
            value={form.monthly}
            onChange={(event) => set({ monthly: event.target.value })}
          />
          <Input
            label="Alert %"
            type="number"
            min="0"
            max="100"
            required
            hint="Warn at this share of the daily cap."
            value={form.alertPercent}
            onChange={(event) => set({ alertPercent: event.target.value })}
          />
          <Input
            label="Alert email"
            type="email"
            placeholder="alerts@…"
            value={form.alertEmail}
            onChange={(event) => set({ alertEmail: event.target.value })}
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" icon={Save} loading={saveMessageLimit.isPending}>
            Save
          </Button>
          {saved && <span className="text-sm text-ok">Saved.</span>}
        </div>
      </form>
    </Panel>
  );
}

function LimitTab() {
  const { data, isLoading } = useMarketingLimits();
  const rows = data?.limits ?? [];

  if (isLoading) return <p className="text-sm text-ink-500">Loading limits…</p>;

  return (
    <div className="space-y-4">
      <Panel
        title="Limit"
        description="Daily and monthly send caps - a safety limit on how many messages can fire. The alert email gets a heads-up near the threshold."
      >
        <p className="text-sm leading-relaxed text-ink-500">
          A cap of 0 stops the channel sending entirely, which is how a business switches one off
          without deleting what it has written.
        </p>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((row) => (
          <LimitCard key={row.channel} row={row} />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Activity                                                                    */
/* -------------------------------------------------------------------------- */

const STATUS_TONE = {
  delivered: 'ok',
  sent: 'ok',
  logged: 'info',
  queued_unconfigured: 'warn',
  failed: 'danger',
};

const STATUS_LABELS = {
  delivered: 'Delivered',
  sent: 'Sent',
  logged: 'Logged',
  queued_unconfigured: 'Not sent',
  failed: 'Failed',
};

function ActivityTab() {
  const { data, isLoading } = useMarketingMessages({ limit: 50, page: 1 });
  const rows = data?.messages ?? data?.rows ?? [];

  return (
    <Panel
      flush
      title="Activity"
      description="The last 50 send attempts. “Not sent” means the provider is not connected yet - the message was written and logged, not delivered."
    >
      <DataTable
        rows={rows}
        loading={isLoading}
        rowKey={(row) => row.id ?? row._id}
        columns={[
          {
            key: 'createdAt',
            header: 'When',
            priority: 1,
            render: (row) => (
              <span className="whitespace-nowrap text-sm text-ink-500">
                {row.createdAt ? dateTime(row.createdAt) : '–'}
              </span>
            ),
          },
          {
            key: 'channel',
            header: 'Type',
            priority: 1,
            render: (row) => (
              <Badge tone="neutral" size="sm">
                {CHANNEL_LABELS[row.channel] ?? row.channel}
              </Badge>
            ),
          },
          {
            key: 'to',
            header: 'To',
            priority: 2,
            render: (row) => (
              <span className="font-mono text-sm text-ink-700">
                {row.to || row.businessName || '–'}
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Status',
            priority: 1,
            render: (row) => (
              <Badge tone={STATUS_TONE[row.status] ?? 'neutral'} size="sm">
                {STATUS_LABELS[row.status] ?? row.status}
              </Badge>
            ),
          },
          {
            key: 'detail',
            header: 'Detail',
            priority: 3,
            render: (row) => (
              <span className="text-sm text-ink-500">{row.unconfiguredReason || row.subject || '–'}</span>
            ),
          },
        ]}
        empty={
          <PanelEmpty
            icon={Activity}
            title="Nothing sent yet"
            body="Every message this business sends is logged here, including the ones a provider refused."
          />
        }
      />
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

export function AdminTemplatesPage() {
  const [tab, setTab] = useState('templates');
  const [channel, setChannel] = useState('email');

  const { data } = useMarketingTemplates();
  const { data: summary } = useMarketingSummary();

  const templates = data?.templates ?? [];
  const counts = useMemo(
    () =>
      templates.reduce(
        (out, template) => ({ ...out, [template.channel]: (out[template.channel] ?? 0) + 1 }),
        {},
      ),
    [templates],
  );

  const status = summary?.channels?.[channel];

  return (
    <div className="form-page">
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title="Notifications"
        description="Pick a notification type, then choose a status to view or write its message."
      />

      {/* Said once, at the top: nothing on this screen reaches a customer until
          a provider is connected, and a staff member writing messages should
          know that before they write twelve of them. */}
      {status && !status.delivers && channel !== 'call' && (
        <p className="mb-4 flex items-start gap-2.5 rounded-lg border border-warn/25 bg-warn-50 px-3.5 py-3 text-sm leading-relaxed text-ink-700">
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2} aria-hidden="true" />
          <span>
            Connect your provider on the{' '}
            <Link to="/admin/settings/api-keys" className="font-semibold text-brand underline">
              API Keys
            </Link>{' '}
            page. Until then messages are saved and previewed here, not sent live.
          </span>
        </p>
      )}

      <TabRow
        className="mb-4"
        tabs={[
          { key: 'templates', label: 'Templates', icon: SquarePen },
          { key: 'limit', label: 'Limit', icon: Gauge },
          { key: 'activity', label: 'Activity', icon: Activity },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'templates' && (
        <>
          {/* The channel picker belongs to this tab alone: a send cap is set
              per channel too, but the Limit tab shows all four at once. */}
          <TabRow
            className="mb-4"
            variant="pills"
            label="Channel"
            tabs={CHANNELS.map((c) => ({
              key: c.key,
              label: c.label,
              icon: c.icon,
              count: counts[c.key] ?? 0,
            }))}
            value={channel}
            onChange={setChannel}
          />
          <TemplatesTab channel={channel} templates={templates} counts={counts} />
        </>
      )}

      {tab === 'limit' && <LimitTab />}
      {tab === 'activity' && <ActivityTab />}
    </div>
  );
}

export default AdminTemplatesPage;
