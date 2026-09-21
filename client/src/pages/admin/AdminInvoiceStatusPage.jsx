import { useState } from 'react';
import { Link } from 'react-router';
import { AlertCircle, CheckCircle2, Clock, Mail, Play, Save, Trash2 } from 'lucide-react';

import cn from '@/lib/cn';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Modal from '@/components/ui/Modal';
import DeleteWithPreview from '@/components/admin/DeleteWithPreview';
import { useAdminInvoiceRules, useAdminMutations } from '@/hooks/useAdmin';
import { dateTime } from '@/lib/format';
import { pressable } from '@/lib/motion';
import SelectMenu from '@/components/ui/SelectMenu';

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

/** "3 days before the invoice falls due" - the timing, in words. */
function timingText(rule, triggers) {
  const trigger = triggers.find((t) => t.value === rule.trigger);
  const label = trigger?.label ?? rule.trigger;
  const days = Math.abs(rule.delayDays ?? 0);

  if (!rule.delayDays) return `As soon as ${label}`;
  return `${days} ${days === 1 ? 'day' : 'days'} ${rule.delayDays < 0 ? 'before' : 'after'} ${label}`;
}

/**
 * One status, as an open form on the page.
 *
 * **It was a modal.** Each status carries a label, a delay, a trigger, a
 * channel, an email subject, a message with five placeholders and an active
 * switch - and a staff member setting these up is comparing them against each
 * other, which a dialog that shows one at a time actively prevents. Open on the
 * page they read as the list they are.
 *
 * The optional `onDone` callback fires after a save: the create form clears
 * itself, and an existing status stays where it is with a saved confirmation.
 */
// `tokens` and `triggers` default here rather than at each call site: this
// renders once per status plus once for the create form, and the placeholder
// list arrives a tick after the first paint.
function RuleCard({ rule, triggers = [], tokens = [], channels, onDone, onDelete, bare = false }) {
  const editing = Boolean(rule.id);
  const [form, setForm] = useState({ ...EMPTY_RULE, ...rule });
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const { createInvoiceRule, saveInvoiceRule } = useAdminMutations();

  const set = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setSaved(false);
  };
  const channelStatus = channels?.[form.channel];

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
            value={form.subject}
            onChange={(event) => set({ subject: event.target.value })}
          />
        )}

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-700">Message</span>
          <textarea
            rows={7}
            value={form.message}
            onChange={(event) => set({ message: event.target.value })}
            className="w-full rounded-md border border-line bg-surface px-3 py-2.5 text-md leading-relaxed text-ink-900 focus:border-ink-400 focus:ring-2 focus:ring-ink-900/15 focus:outline-none"
          />
        </label>

        <div className="rounded-md bg-surface-2 px-3 py-2.5">
          <p className="mb-1.5 text-sm font-medium text-ink-700">Placeholders</p>
          <div className="flex flex-wrap gap-1.5">
            {tokens.map((token) => (
              <button
                key={token.token}
                type="button"
                onClick={() => set({ message: `${form.message}${token.token}` })}
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

        <label className="flex items-start gap-2.5 rounded-md bg-surface-2 px-3 py-2.5">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => set({ isActive: event.target.checked })}
            className="mt-0.5 size-4 accent-[var(--color-brand)]"
          />
          <span className="text-sm leading-relaxed text-ink-700">
            <span className="font-medium">Active</span>
            <span className="mt-0.5 block text-sm text-ink-500">
              Included the next time the messages are run. Each invoice receives this once.
            </span>
          </span>
        </label>

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
            {editing ? 'Save' : 'Add status'}
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

  /*
    `bare` drops the Panel.

    The create form renders inside a Modal, which already draws a titled
    surface - a Panel in there is a bordered box inside a bordered box, which
    §2.4 rules out. An existing message keeps its Panel, because on the page
    the cards ARE the list.
  */
  if (bare) return body;

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          {rule.label}
          <Badge tone={form.channel === 'email' ? 'info' : 'warn'} size="sm">
            {form.channel}
          </Badge>
          {rule.isBuiltIn && <Badge tone="neutral" size="sm">Built-in</Badge>}
        </span>
      }
      description={timingText(rule, triggers)}
    >
      {body}
    </Panel>
  );
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
  const { saveInvoiceRule, deleteInvoiceRule, runInvoiceRules } = useAdminMutations();
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  // The trash icon used to delete on the click itself.
  const [deleting, setDeleting] = useState(null);

  const rules = data?.rules ?? [];
  const triggers = data?.triggers ?? [];

  async function toggle(rule) {
    setError(null);
    try {
      await saveInvoiceRule.mutateAsync({ ...rule, id: rule.id, isActive: !rule.isActive });
    } catch (err) {
      setError(err.message);
    }
  }

  async function run(dryRun) {
    setError(null);
    setResult(null);
    try {
      setResult(await runInvoiceRules.mutateAsync(dryRun));
    } catch (err) {
      setError(err.message);
    }
  }

  if (isLoading) return <p className="text-sm text-ink-500">Loading messages…</p>;

  const activeCount = rules.filter((rule) => rule.isActive).length;

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
        {/* One card per message, each editable in place. The create form used
            to sit at the BOTTOM of this list as an unlabelled extra card,
            which put "add a message" below everything else with nothing
            separating it - on a shop with eight messages it was off-screen and
            read as a ninth message somebody had failed to name. It is a modal
            off the page's one Add button now, the same way statuses work. */}
        {rules.map((rule) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            triggers={triggers}
            tokens={data?.tokens}
            channels={data?.channels}
            onDelete={setDeleting}
          />
        ))}

        {rules.length === 0 && (
          <PanelEmpty
            icon={Mail}
            title="No timed messages yet"
            body="A message goes out once per invoice, a set number of days after it is issued or falls overdue."
          />
        )}

        <Panel
          title="Run now"
          description="A dry run reports what would be sent and sends nothing. Try that first."
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => run(true)} loading={runInvoiceRules.isPending}>
              Dry run
            </Button>
            <Button onClick={() => run(false)} disabled={!activeCount || runInvoiceRules.isPending}>
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
            bare
            onDone={() => onAddingChange?.(false)}
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
    </>
  );
}

export default InvoiceMessagesBody;
