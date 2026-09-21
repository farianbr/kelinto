import { useMemo, useState } from 'react';
import useAdminForm from '@/hooks/useAdminForm';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Inbox,
  Send,
} from 'lucide-react';

import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import SelectMenu from '@/components/ui/SelectMenu';
import SelectField from '@/components/ui/SelectField';
import PageHeader from '@/components/admin/PageHeader';
import { ChannelNotice, ChannelHint } from './ChannelNotice';
import {
  useAdminUsers,
  useMarketingMessages,
  useMarketingSummary,
  useMarketingTemplates,
  useAdminMutations,
} from '@/hooks/useAdmin';
import { dateTime } from '@/lib/format';
import cn from '@/lib/cn';

/**
 * The two-column channel screen - compose on the left, history on the right
 * (§6.13). SMS, WhatsApp and Calls are the same screen with a different channel
 * and a different verb, so it is built once.
 *
 * **What makes this honest rather than a stub.** Composing on an unconfigured
 * channel is not blocked: the message is written to contact history, which is
 * the thing the staff member actually needs from day one. What is refused is
 * *pretending* - the notice above the form says sending is off, and after a
 * save the screen reports what the server said happened rather than a
 * confirmation of its own (§6b rules 1 and 4).
 *
 * The status vocabulary is deliberately four words wide, because the four
 * outcomes are genuinely different things: `logged` (a call that happened),
 * `queued_unconfigured` (saved, nobody to send it), `sent` (a provider took
 * it), `failed` (a provider refused it).
 */

const STATUS_META = {
  logged: { label: 'Logged', tone: 'neutral', icon: CheckCircle2 },
  queued_unconfigured: { label: 'Not sent', tone: 'warn', icon: Clock },
  sent: { label: 'Sent', tone: 'ok', icon: CheckCircle2 },
  delivered: { label: 'Delivered', tone: 'ok', icon: CheckCircle2 },
  failed: { label: 'Failed', tone: 'danger', icon: AlertCircle },
};

function MessageRow({ message }) {
  const meta = STATUS_META[message.status] ?? STATUS_META.logged;
  const Icon = meta.icon;
  const Direction = message.direction === 'inbound' ? ArrowDownLeft : ArrowUpRight;

  return (
    <li className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <Direction
            className={cn(
              'size-3.5 shrink-0',
              message.direction === 'inbound' ? 'text-info' : 'text-ink-400',
            )}
            strokeWidth={2.25}
            aria-label={message.direction === 'inbound' ? 'Inbound' : 'Outbound'}
          />
          <p className="truncate text-md font-medium text-ink-900">{message.businessName}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={meta.tone} size="sm" icon={Icon}>
            {meta.label}
          </Badge>
          <time className="tnum text-xs text-ink-400" dateTime={message.createdAt}>
            {dateTime(message.createdAt)}
          </time>
        </div>
      </div>

      {message.subject && (
        <p className="mt-1 truncate text-sm font-medium text-ink-700">{message.subject}</p>
      )}
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-600">
        {message.body}
      </p>

      {/* The row says why it was not sent, so the history is readable months
          later without anyone having to remember which providers were off. */}
      {message.unconfiguredReason && (
        <p className="mt-1.5 text-xs italic text-ink-400">{message.unconfiguredReason}</p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-400">
        {message.to && <span className="truncate">{message.to}</span>}
        {message.staffName && <span className="truncate">by {message.staffName}</span>}
        {message.recordingUrl && (
          <a
            href={message.recordingUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-brand underline underline-offset-2"
          >
            Recording
          </a>
        )}
      </div>
    </li>
  );
}

/**
 * @param {object} props
 * @param {'sms'|'whatsapp'|'call'} props.channel
 * @param {object} props.page          the `adminRoutes` entry, for the header
 * @param {object} props.schema        the Zod schema this channel's form validates against
 * @param {boolean} [props.showDirection]  calls can be inbound; messages we compose cannot
 * @param {boolean} [props.showRecording]  calls only
 * @param {string} props.submitLabel
 * @param {string} props.bodyLabel
 * @param {string} props.bodyPlaceholder
 * @param {string} [props.hint]        shown when the channel is working as designed
 */
export function ChannelScreen({
  channel,
  page,
  schema,
  showDirection = false,
  showRecording = false,
  submitLabel,
  bodyLabel,
  bodyPlaceholder,
  hint,
}) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [templateId, setTemplateId] = useState('');

  const { data: summary } = useMarketingSummary();
  const { data: history, isLoading } = useMarketingMessages({ channel, limit: 25 });
  const { data: templateData } = useMarketingTemplates(channel);
  const { data: userData } = useAdminUsers({ status: 'all' });
  const { sendMessage } = useAdminMutations();

  const status = summary?.channels?.[channel];
  const templates = templateData?.templates ?? [];

  const accountOptions = useMemo(
    () =>
      (userData?.users ?? []).map((user) => ({
        value: user.id,
        /**
         * `displayName`, per §0: an account is identified by the person.
         *
         * This built the label from `businessName` and fell back to it when
         * there was no contact name, so a walk-in repair customer - who has a
         * person and no company - rendered as "undefined - Marcus Idowu", and
         * every CellShoppe customer in the list read that way.
         *
         * `displayName` is the server's own answer to this question (person,
         * then company, then email) and is the only thing that should be shown
         * as an account's name. The company is appended when there is one,
         * because two people can share a first name and the picker has to be
         * unambiguous at a glance.
         */
        label: user.businessName
          ? `${user.displayName} · ${user.businessName}`
          : user.displayName,
      })),
    [userData],
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    formState: { errors },
  } = useAdminForm({
    resolver: zodResolver(schema),
    defaultValues: { userId: '', body: '', direction: 'outbound', recordingUrl: '' },
  });

  function applyTemplate(id) {
    setTemplateId(id);
    const template = templates.find((row) => row.id === id);
    // The raw body, tokens and all: substitution happens server-side against
    // the real account, and showing the filled version here would be a
    // preview of a different account than the one finally chosen.
    if (template) setValue('body', template.body, { shouldValidate: true });
  }

  async function onSubmit(values) {
    setError(null);
    setResult(null);
    try {
      const payload = await sendMessage.mutateAsync({ channel, ...values });
      setResult(payload);
      reset({ userId: '', body: '', direction: 'outbound', recordingUrl: '' });
      setTemplateId('');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <PageHeader icon={page.icon} title={page.title} description={page.description} />

      <div className="flex flex-col gap-4">
        <ChannelNotice status={status} />
        {/* The hint is the counterpart of the notice - one or the other, never
            both - so it keys on the same field. */}
        {(status?.delivers ?? status?.configured) && hint && <ChannelHint>{hint}</ChannelHint>}

        {/* Compose beside history on a laptop; stacked below that, compose
            first - the form is what the staff member came for. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <Panel title={submitLabel}>
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3.5">
              {error && (
                <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                  {error}
                </p>
              )}

              {/* What the server actually did, in its own words. A saved-but-
                  unsent message reads as `warn`, never as a success tick. */}
              {result && (
                <p
                  className={cn(
                    'flex items-start gap-2 rounded-md px-3 py-2.5 text-sm',
                    result.notice ? 'bg-warn-50 text-ink-700' : 'bg-ok-50 text-ok',
                  )}
                >
                  {result.notice ? (
                    <Clock className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                  )}
                  <span>
                    {result.notice ? (
                      <>
                        <strong className="font-medium">Saved to history.</strong> {result.notice}
                      </>
                    ) : (
                      STATUS_META[result.message.status]?.label === 'Logged'
                        ? 'Call logged.'
                        : 'Message sent.'
                    )}
                  </span>
                </p>
              )}

              <SelectField
                control={control}
                name="userId"
                label="Account"
                placeholder="Choose an account"
                searchable
                searchPlaceholder="Search customers…"
                options={accountOptions}
                error={errors.userId?.message}
              />

              {showDirection && (
                <SelectField
                  control={control}
                  name="direction"
                  label="Direction"
                  options={[
                    { value: 'outbound', label: 'We called them' },
                    { value: 'inbound', label: 'They called us' },
                  ]}
                  error={errors.direction?.message}
                />
              )}

              {templates.length > 0 && (
                <SelectMenu
                  label="Template"
                  placeholder="Start from a template (optional)"
                  value={templateId}
                  onChange={applyTemplate}
                  options={templates.map((row) => ({ value: row.id, label: row.name }))}
                  size="md"
                  align="left"
                />
              )}

              <Textarea
                label={bodyLabel}
                rows={6}
                counter={5000}
                placeholder={bodyPlaceholder}
                error={errors.body?.message}
                {...register('body')}
              />

              {showRecording && (
                <Input
                  label="Recording URL"
                  hint="Optional. A link to the recording - no audio is stored here."
                  placeholder="https://…"
                  error={errors.recordingUrl?.message}
                  {...register('recordingUrl')}
                />
              )}

              <Button type="submit" loading={sendMessage.isPending} className="self-start">
                <Send className="size-4" strokeWidth={2} aria-hidden="true" />
                {submitLabel}
              </Button>
            </form>
          </Panel>

          <Panel
            title="History"
            description={`${history?.total ?? 0} on this channel`}
            flush
            className="min-w-0"
          >
            {isLoading ? (
              <p className="p-4 text-sm text-ink-500">Loading history…</p>
            ) : (history?.messages?.length ?? 0) === 0 ? (
              <PanelEmpty
                icon={Inbox}
                title="Nothing here yet"
                body="Messages you compose appear here, whether or not the provider is connected."
              />
            ) : (
              <ul className="max-h-[720px] overflow-y-auto">
                {history.messages.map((message) => (
                  <MessageRow key={message.id} message={message} />
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

export default ChannelScreen;
