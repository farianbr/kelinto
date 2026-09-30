import { useState } from 'react';
import { Link } from 'react-router';
import { AlertCircle, CheckCircle2, Clock, Mail, Pencil, Play, Power, Save, Trash2 } from 'lucide-react';

import cn from '@/lib/cn';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import DataTable, { CountLine } from '@/components/admin/DataTable';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Modal from '@/components/ui/Modal';
import DeleteWithPreview from '@/components/admin/DeleteWithPreview';
import { useAdminInvoiceLabels, useAdminInvoiceRules, useAdminMutations } from '@/hooks/useAdmin';
import { dateTime } from '@/lib/format';
import { pressable } from '@/lib/motion';
import SelectMenu from '@/components/ui/SelectMenu';
import MessageBodyField from '@/components/admin/MessageBodyField';
import ActiveSwitch from '@/components/admin/ActiveSwitch';
import { MESSAGE_BODY_MAX } from '@shared/messageHtml.js';

/**
 * Time-lapse invoice messages (§6.15 category 2, phase 11d).
 *
 * "Send a reminder three days before an invoice is due." Each rule fires **once
 * per invoice** when its delay elapses.
 *
 * **Everything ships switched off**, matching CellShoppe and for the same
 * reason: anything that emails a customer should be turned on deliberately by
 * somebody who has read what it says, not by installing the software.
 *
 * **There is no scheduler yet**, and the screen says so rather than implying
 * these fire on their own. `Run now` is how they go out today, and a dry run
 * shows what *would* go out without sending anything - which is the first thing
 * anyone wants before switching a rule on against live invoices.
 */

const EMPTY_RULE = {
  label: '',
  trigger: 'invoice_due',
  delayDays: -3,
  channel: 'email',
  subject: '',
  message: '',
  isActive: false,
};

const CHANNEL_NAMES = { email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' };

/** "3 days before the invoice falls due" - the timing, in words. */
function timingText(rule, triggers) {
  const trigger = triggers.find((t) => t.value === rule.trigger);
  const label = trigger?.label ?? rule.trigger;
  const days = Math.abs(rule.delayDays ?? 0);

  if (!rule.delayDays) return `As soon as ${label}`;
  return `${days} ${days === 1 ? 'day' : 'days'} ${rule.delayDays < 0 ? 'before' : 'after'} ${label}`;
}

/**
 * Channel, subject, body and placeholders: the part of a timed message that is
 * the message itself.
 *
 * Exported because a manual after sales status carries the same message
 * (2026-10-01) and its form must read exactly like this one; only the timing
 * differs. `form` holds `channel`, `subject` and `message`; `set` patches it.
 */
export function MessageFields({ form, set, tokens = [], channels, messageError }) {
  const channelStatus = channels?.[form.channel];

  return (
    <>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-ink-700">Channel</span>
        <SelectMenu
          srLabel="Channel"
          size="md"
          value={form.channel}
          onChange={(next) => set({ channel: next })}
          options={[
            { value: 'email', label: 'Email' },
            { value: 'sms', label: 'SMS' },
            { value: 'whatsapp', label: 'WhatsApp' },
          ]}
          containerClassName="w-full"
        />
        {/* Named at the point of choosing, not after saving: picking a channel
            that cannot send is a decision worth interrupting. */}
        {channelStatus && !channelStatus.delivers && (
          <span className="mt-1.5 flex items-start gap-1.5 text-sm text-warn">
            <AlertCircle className="mt-px size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            {channelStatus.reason}
          </span>
        )}
      </label>

      {form.channel === 'email' && (
        <Input
          label="Subject"
          value={form.subject ?? ''}
          onChange={(event) => set({ subject: event.target.value })}
        />
      )}

      <MessageBodyField
        channel={form.channel}
        value={form.message ?? ''}
        counter={MESSAGE_BODY_MAX}
        onChange={(next) => set({ message: next })}
        error={messageError}
      />

      <div className="rounded-md bg-surface-2 px-3 py-2.5">
        <p className="mb-1.5 text-sm font-medium text-ink-700">Placeholders</p>
        <div className="flex flex-wrap gap-1.5">
          {tokens.map((token) => (
            <button
              key={token.token}
              type="button"
              onClick={() => set({ message: `${form.message ?? ''}${token.token}` })}
              title={token.label}
              className={cn(pressable, 'rounded-sm bg-surface px-1.5 py-1 font-mono text-xs text-ink-600 hover:bg-brand-50 hover:text-brand')}
            >
              {token.token}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-400">
          An unrecognised placeholder is left as written rather than replaced with a blank, so a
          typo is visible instead of silently sending a sentence with a hole in it.
        </p>
      </div>
    </>
  );
}

/**
 * One message's form, drawn inside the add and edit modals.
 *
 * It was an open card per message on the page for a while, so they could be
 * compared side by side; the client asked for a list instead (2026-10-01), and
 * the list's columns now carry the comparison. The optional `onDone` callback
 * fires after a save, which closes the modal.
 */
// `tokens` and `triggers` default here rather than at each call site: the
// placeholder list arrives a tick after the first paint.
function RuleCard({ rule, triggers = [], tokens = [], channels, onDone, onDelete }) {
  const editing = Boolean(rule.id);
  const [form, setForm] = useState({ ...EMPTY_RULE, ...rule });
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const { createInvoiceRule, saveInvoiceRule } = useAdminMutations();

  const set = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setSaved(false);
  };

  async function save(event) {
    event.preventDefault();
    setError(null);
    try {
      const payload = {
        label: form.label,
        trigger: form.trigger,
        delayDays: Number(form.delayDays),
        channel: form.channel,
        subject: form.subject,
        message: form.message,
        isActive: form.isActive,
      };
      if (editing) await saveInvoiceRule.mutateAsync({ id: rule.id, ...payload });
      else await createInvoiceRule.mutateAsync(payload);
      setSaved(true);
      // The create form empties itself so the next status can be typed
      // straight in; an existing one keeps what was just saved on screen.
      if (!editing) setForm({ ...EMPTY_RULE });
      onDone?.();
    } catch (err) {
      setError(err.message);
    }
  }

  const body = <form onSubmit={save} className="space-y-4">
        <Input
          label="Name"
          hint="Only shown here - it is not sent to anybody."
          value={form.label}
          onChange={(event) => set({ label: event.target.value })}
        />

        <div className="grid gap-4 sm:grid-cols-[minmax(0,120px)_minmax(0,1fr)]">
          <Input
            type="number"
            min="-365"
            max="365"
            label="Days"
            suffix="days"
            hint="Negative is before."
            value={form.delayDays}
            onChange={(event) => set({ delayDays: event.target.value })}
          />

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink-700">Counting from</span>
            <SelectMenu
              srLabel="Trigger"
              size="md"
              value={form.trigger}
              onChange={(next) => set({ trigger: next })}
              options={triggers}
              containerClassName="w-full"
            />
            <span className="mt-1.5 block text-sm text-ink-400">
              {timingText({ ...form, delayDays: Number(form.delayDays) }, triggers)}.
            </span>
          </label>
        </div>

        <MessageFields form={form} set={set} tokens={tokens} channels={channels} />

        <ActiveSwitch
          checked={Boolean(form.isActive)}
          onChange={(next) => set({ isActive: next })}
          detail="Included the next time the messages are run. Each invoice receives this once."
        />

        {error && (
          <p role="alert" className="rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button
            type="submit"
            icon={Save}
            loading={createInvoiceRule.isPending || saveInvoiceRule.isPending}
          >
            {editing ? 'Save' : 'Add message'}
          </Button>

          {/* Delete sits with the status it deletes, at the opposite end of the
              row from Save - a destructive control next to the one pressed on
              every visit is how the wrong one gets pressed. Built-in statuses
              have none: they can be switched off, never removed. */}
          {editing && !rule.isBuiltIn && (
            <button
              type="button"
              onClick={() => onDelete?.(rule)}
              className={cn(
                pressable,
                'ml-auto inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3.5 text-sm font-medium text-ink-600 hover:border-danger hover:bg-danger-50 hover:text-danger',
              )}
            >
              <Trash2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              Delete
            </button>
          )}

          <p aria-live="polite" className="min-w-0">
            {saved && (
              <span className="flex items-center gap-1.5 text-sm text-ok">
                <CheckCircle2 className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                Saved.
              </span>
            )}
          </p>
        </div>
      </form>;

  // No Panel: the modal already draws a titled surface, and a bordered box
  // inside it is the box-in-a-box §2.4 rules out.
  return body;
}

/**
 * The timed-message half of Invoice statuses.
 *
 * Exported as a body rather than a page: it renders inside
 * `AdminInvoiceLabelsPage`'s tab row, which owns the header and the measure.
 * The two were separate screens with near-identical names - "Invoice Messages"
 * and "Invoice Statuses" - which meant reading the menu twice to work out which
 * one you wanted. They are two views of one subject, so they are two tabs.
 */
export function InvoiceMessagesBody({ adding = false, onAddingChange }) {
  const { data, isLoading } = useAdminInvoiceRules();
  const { data: labelData } = useAdminInvoiceLabels({ status: 'all' });
  const { saveInvoiceRule, deleteInvoiceRule, runInvoiceRules } = useAdminMutations();
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // The trash icon used to delete on the click itself.
  const [deleting, setDeleting] = useState(null);
  // The message open in the edit modal.
  const [editing, setEditing] = useState(null);
  // A real run mails customers, so it is typed back, not clicked (§3.0.1).
  // The dry run sends nothing and needs no dialog.
  const [confirmingRun, setConfirmingRun] = useState(false);

  const rules = data?.rules ?? [];
  const triggers = data?.triggers ?? [];

  async function run(dryRun) {
    setError(null);
    setResult(null);
    try {
      setResult(await runInvoiceRules.mutateAsync(dryRun));
      setConfirmingRun(false);
    } catch (err) {
      setError(err.message);
    }
  }

  if (isLoading) return <p className="text-sm text-ink-500">Loading messages…</p>;

  // Manual statuses with a message switched on go out in the same run, so they
  // count towards what Send now will send.
  const activeCount =
    rules.filter((rule) => rule.isActive).length +
    (labelData?.labels ?? []).filter((label) => label.messageActive && label.message?.trim()).length;

  return (
    <>
      {/* §6b rule 2 in spirit: state plainly what does not happen on its own.
          "Automatic" is the word on the tin, and nothing here is automatic yet. */}
      <p className="mb-5 flex items-start gap-2.5 rounded-lg border border-warn/25 bg-warn-50 px-3.5 py-3 text-sm leading-relaxed text-ink-700">
        <Clock className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2} aria-hidden="true" />
        <span>
          <strong className="font-semibold">These do not send on a schedule yet.</strong> There is no
          cron pass in this build, so active messages go out when somebody presses{' '}
          <em>Run now</em> below. Each invoice still receives each message only once, whenever the
          run happens.
        </span>
      </p>

      <div className="space-y-4">
        {/* A list, and a click opens the message in a modal (2026-10-01,
            client request). It was one open form per message, which made a
            shop with eight messages a page of eight forms to scroll through
            to find the one to change; the list reads the whole set at once,
            the way Manual Status does. */}
        <Panel flush>
          <div className="border-b border-line px-3 py-2 sm:px-4">
            <CountLine
              total={rules.length}
              shown={rules.length}
              from={0}
              noun={rules.length === 1 ? 'message' : 'messages'}
            />
          </div>

          <DataTable
            columns={[
              {
                key: 'label',
                header: 'Message',
                priority: 1,
                render: (rule) => (
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm text-ink-900">{rule.label}</span>
                      {rule.isBuiltIn && <Badge tone="neutral" size="sm">Built-in</Badge>}
                    </span>
                    <span className="truncate text-xs text-ink-500">{timingText(rule, triggers)}</span>
                  </span>
                ),
              },
              {
                key: 'channel',
                header: 'Channel',
                priority: 2,
                render: (rule) => (
                  <Badge tone={rule.channel === 'email' ? 'info' : 'warn'} size="sm">
                    {CHANNEL_NAMES[rule.channel] ?? rule.channel}
                  </Badge>
                ),
              },
              {
                key: 'isActive',
                header: 'Sending',
                priority: 1,
                render: (rule) => (
                  <Badge tone={rule.isActive ? 'ok' : 'neutral'} size="sm">
                    {rule.isActive ? 'on' : 'off'}
                  </Badge>
                ),
              },
            ]}
            rows={rules}
            rowKey={(rule) => rule.id}
            onRowClick={setEditing}
            rowMenu={[
              { key: 'edit', label: 'Edit message', icon: Pencil, onSelect: setEditing },
              {
                key: 'toggle',
                label: (rule) => (rule.isActive ? 'Switch off' : 'Switch on'),
                icon: Power,
                confirm: (rule) => ({
                  title: rule.isActive ? `Switch off ${rule.label}?` : `Switch on ${rule.label}?`,
                  body: rule.isActive
                    ? 'It stops going out. Invoices that already received it keep that record.'
                    : 'It goes to every invoice that is due one, the next time the messages are run.',
                  confirmLabel: rule.isActive ? 'Switch off' : 'Switch on',
                }),
                onSelect: (rule) =>
                  saveInvoiceRule.mutateAsync({ ...rule, id: rule.id, isActive: !rule.isActive }),
              },
              {
                key: 'delete',
                label: 'Delete message',
                icon: Trash2,
                tone: 'danger',
                // Built-in messages can be switched off, never removed.
                hidden: (rule) => rule.isBuiltIn,
                onSelect: setDeleting,
              },
            ]}
            empty={
              <PanelEmpty
                icon={Mail}
                title="No timed messages yet"
                body="A message goes out once per invoice, a set number of days after it is issued or falls overdue."
              />
            }
          />
        </Panel>

        <Panel
          title="Run now"
          description="A dry run reports what would be sent and sends nothing. Try that first."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => run(true)} loading={runInvoiceRules.isPending}>
              Dry run
            </Button>
            <Button onClick={() => setConfirmingRun(true)} disabled={!activeCount || runInvoiceRules.isPending}>
              <Play className="size-4" strokeWidth={2} aria-hidden="true" />
              {activeCount ? 'Send now' : 'Nothing switched on'}
            </Button>
          </div>

          {error && (
            <p role="alert" className="mt-3 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
              {error}
            </p>
          )}

          {result && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink-700">
                {result.dryRun ? (
                  <>
                    <Clock className="size-4 text-ink-400" strokeWidth={2} aria-hidden="true" />
                    Dry run - nothing was sent
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-4 text-ok" strokeWidth={2} aria-hidden="true" />
                    Run complete
                  </>
                )}
              </p>

              {/* The master switch on Email Settings refuses the whole run.
                  Distinguished from "nothing matched" because it has an obvious
                  fix and a link to where the fix lives. */}
              {result.disabled ? (
                <p className="flex items-start gap-2 rounded-md border border-warn/25 bg-warn-50 px-3 py-2.5 text-sm leading-relaxed text-ink-700">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2} aria-hidden="true" />
                  <span>
                    {result.reason}{' '}
                    <Link to="/admin/settings/email" className="font-semibold text-brand underline">
                      Open Email Settings
                    </Link>
                  </span>
                </p>
              ) : result.results.length === 0 ? (
                <p className="text-sm text-ink-500">No messages are switched on.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {result.results.map((row) => (
                    <li key={row.rule} className="rounded-md bg-surface-2 px-3 py-2.5">
                      <span className="font-medium text-ink-900">{row.rule}</span>
                      <span className="mt-0.5 block text-sm text-ink-600">
                        {row.matched} {row.matched === 1 ? 'invoice' : 'invoices'} matched ·{' '}
                        {result.dryRun ? 'would send' : 'sent'} {row.sent} · skipped {row.skipped}
                      </span>
                      {row.reasons.map((reason) => (
                        <span key={reason} className="mt-1 block text-xs text-warn">
                          {reason}
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Panel>
      </div>

      <Modal
        open={adding}
        onClose={() => onAddingChange?.(false)}
        title="Add a message"
        size="lg"
        align="top"
      >
        {adding && (
          <RuleCard
            rule={{ ...EMPTY_RULE }}
            triggers={triggers}
            tokens={data?.tokens}
            channels={data?.channels}
            onDone={() => onAddingChange?.(false)}
          />
        )}
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Edit message"
        size="lg"
        align="top"
      >
        {editing && (
          <RuleCard
            key={editing.id}
            rule={editing}
            triggers={triggers}
            tokens={data?.tokens}
            channels={data?.channels}
            onDone={() => setEditing(null)}
            onDelete={(rule) => {
              setEditing(null);
              setDeleting(rule);
            }}
          />
        )}
      </Modal>

      {/* Nothing blocks deleting a message, so the preview is a consequence
          rather than a refusal: how many invoices already received it, and the
          fact that those sends stand. */}
      <DeleteWithPreview
        type="invoice-rule"
        record={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          deleteInvoiceRule
            .mutateAsync(deleting.id)
            .then(() => setDeleting(null))
            .catch((e) => setError(e.message))
        }
        confirmLabel="Delete message"
        loading={deleteInvoiceRule.isPending}
      />
      <ConfirmDialog
        open={confirmingRun}
        onClose={() => setConfirmingRun(false)}
        onConfirm={() => run(false)}
        tone="warn"
        title={`Send the ${activeCount} switched-on ${activeCount === 1 ? 'message' : 'messages'} now?`}
        body="Every invoice that is due one is emailed to its customer now. Email cannot be recalled; a dry run shows who would receive what."
        confirmLabel="Send now"
        confirmPhrase="send"
        confirmPhraseLabel="the word send"
        loading={runInvoiceRules.isPending}
        error={error}
      />
    </>
  );
}

export default InvoiceMessagesBody;
