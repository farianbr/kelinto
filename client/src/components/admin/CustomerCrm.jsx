import { useEffect, useState } from 'react';
import {
  MessageCircle,
  MessageSquare,
  Phone,
  Send,
  StickyNote,
  Trash2,
  Mail,
} from 'lucide-react';

import { Link } from 'react-router';

import { MEMBERSHIP_TIERS } from '@shared/schemas/admin';
import cn from '@/lib/cn';
import { money, dateTime, relativeTime } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Textarea from '@/components/ui/Textarea';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ConsentChannels, { CONSENT_CHANNELS } from '@/components/ui/ConsentChannels';
import SelectMenu from '@/components/ui/SelectMenu';


/**
 * The CRM half of a customer profile: consent, tier, conversations and notes.
 *
 * Kept in one file because all four are the same kind of thing - what we know
 * about a relationship rather than what the account has bought - and they share
 * the same column on the profile.
 */

// The channel list and the chip styling live in `ui/ConsentChannels` so this
// panel and the two create forms cannot drift apart on what "consented" means
// or looks like.
const CHANNELS = CONSENT_CHANNELS;

/** How a channel is written in prose, as opposed to on its chip. */
const CHANNEL_LABELS = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'email',
  call: 'phone call',
};

/**
 * What the customer agreed to be contacted on (CASL, §6.13).
 *
 * **The ticks are draft state until Save.** Consent is a record of an answer,
 * not a live switch - writing on every click would stamp a new consent
 * timestamp four times while somebody is still deciding what the customer
 * actually said.
 *
 * The panel distinguishes **never asked** from **declined**. An account that
 * predates the field has answered nothing, which is a prompt to go and ask; an
 * account that declined has given an answer to respect. Collapsing the two into
 * an unticked box would lose that, so the header says which it is.
 */

export function ConsentPanel({ consent, preferredContact, onSave, isPending }) {
  const [draft, setDraft] = useState(consent.channels);
  // Follow the server after a save, or after another screen changes it.
  useEffect(() => setDraft(consent.channels), [consent.channels]);
  const dirty = CHANNELS.some(({ key }) => draft[key] !== consent.channels[key]);
  const unsubscribed = Boolean(consent.unsubscribedAt);
  return (
    <Panel
      title="Communication consent"
      description={
        unsubscribed
          ? `Unsubscribed ${dateTime(consent.unsubscribedAt)} - this outranks everything below.`
          : consent.recorded
            ? `Recorded ${dateTime(consent.at)}${consent.source ? ` · by ${consent.source}` : ''}`
            : 'Nothing recorded yet - nobody has asked this customer.'
      }
    >
      {unsubscribed && (
        <p className="mb-3 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          This customer unsubscribed. That is their own act and an admin does not undo it here
          it is lifted from the Marketing screen, which records who lifted it.
        </p>
      )}
      <ConsentChannels value={draft} onChange={setDraft} />
      <p className="mt-3 text-xs leading-snug text-ink-400">
        A campaign or a one-to-one message on a channel requires consent for that channel. Granting
        any channel turns marketing consent on; clearing all four turns it off.
      </p>

      {/*
        The preferred channel, read-only here.

        It is **edited on the customer form**, not in this panel: it is a
        preference rather than a consent record, it carries no timestamp, and
        giving it a second write path would mean two screens racing to own one
        field. It is shown here because this is where somebody comes to ask
        "how do we reach this customer", and answering the consent half without
        the routing half sends them somewhere else to finish the question.

        The warning below is the case that actually bites: a channel chosen but
        not consented to is a channel every status update silently skips.
      */}
      <div className="mt-3 border-t border-line pt-3">
        <p className="text-xs text-ink-400">
          Repair updates are sent by{' '}
          {preferredContact ? (
            <strong className="text-ink-900">{CHANNEL_LABELS[preferredContact]}</strong>
          ) : (
            <span className="text-ink-500">no channel yet, nobody has asked</span>
          )}
          .
        </p>
        {preferredContact && !draft[preferredContact] && (
          <p className="mt-1.5 text-xs leading-snug text-warn">
            This customer has not consented to {CHANNEL_LABELS[preferredContact]}, so status updates
            will not be sent. Tick it above, or change the preference on their profile.
          </p>
        )}
      </div>
      {dirty && (
        <div className="mt-3 flex justify-end gap-2 border-t border-line pt-3">
          <Button size="sm" variant="ghost" onClick={() => setDraft(consent.channels)}>
            Reset
          </Button>
          <Button size="sm" loading={isPending} onClick={() => onSave(draft)}>
            Save consent
          </Button>
        </div>
      )}
    </Panel>
  );
}

const TIER_TONE = {
  standard: 'neutral',
  silver: 'info',
  gold: 'warn',
  platinum: 'brand',
};

/**
 * Membership tier.
 *
 * The note is not decoration: a tier that looks like it should grant a discount
 * and does not is worse than no tier at all, so the panel says what it does.
 */

export function TierPanel({ tier, onChange, isPending, warrantyBonus = 0 }) {
  const label = MEMBERSHIP_TIERS.find((item) => item.value === tier)?.label ?? tier;

  return (
    <Panel
      title="Membership"
      description="What this tier changes, and what it deliberately does not."
      action={
        <Badge tone={TIER_TONE[tier] ?? 'neutral'} size="sm">
          {warrantyBonus > 0 ? `${label} · +${warrantyBonus}d warranty` : label}
        </Badge>
      }
    >
      <SelectMenu
        srLabel="Membership tier"
        value={tier}
        onChange={onChange}
        options={MEMBERSHIP_TIERS}
        disabled={isPending}
        align="left"
        className="w-full sm:w-[260px]"
      />

      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-500">Warranty bonus</dt>
          <dd className="text-right font-medium text-ink-900">
            {warrantyBonus > 0 ? (
              <>
                +{warrantyBonus} days{' '}
                <span className="font-normal text-ink-400">on the part&rsquo;s grade</span>
              </>
            ) : (
              <span className="font-normal text-ink-400">None - grade warranty only</span>
            )}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-500">Pricing</dt>
          <dd className="text-ink-400">Unaffected</dd>
        </div>
      </dl>

      <p className="mt-2.5 text-xs leading-snug text-ink-400">
        The bonus is set per tier in Sale Settings and lengthens cover - it never shortens it.
        Discounts are decided in one place, an offer, so a tier never quietly applies one; when a
        tier should affect price, it is set up as an offer restricted to that tier.
      </p>
    </Panel>
  );
}

/**
 * `note` sits with the channels rather than beside them.
 *
 * A conversation log that cannot hold "spoke to them at the counter, agreed to
 * replace the screen" has a hole in it, and the hole gets filled by an internal
 * note - which the next person reads as staff chatter rather than as part of
 * the conversation. A note is contact history whose transport happened to be a
 * person standing there, so it belongs in this list, ordered with the calls and
 * emails around it.
 *
 * It is **not** the same thing as the Internal notes panel below. That one is
 * staff-only and the customer never sees it; this one is what was said TO them,
 * and the customer portal shows it.
 */
const CHANNEL_META = {
  email: { label: 'Email', icon: Mail, tone: 'text-brand' },
  sms: { label: 'SMS', icon: MessageSquare, tone: 'text-info' },
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, tone: 'text-ok' },
  call: { label: 'Call', icon: Phone, tone: 'text-ink-500' },
  note: { label: 'Note', icon: StickyNote, tone: 'text-warn' },
};

const STATUS_TONE = {
  logged: 'neutral',
  queued_unconfigured: 'warn',
  sent: 'info',
  delivered: 'ok',
  failed: 'danger',
};

const STATUS_LABEL = {
  logged: 'Logged',
  queued_unconfigured: 'Not sent',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed',
};

/**
 * Contact history, and a box to add to it.
 *
 * Reads the existing `MessageLog` rather than a second store: the Marketing
 * screens already write every call, SMS, WhatsApp and email there, and a
 * separate per-profile log would be a second contact history that disagrees
 * with the first one within a week.
 *
 * **A call is logged, everything else is sent.** That distinction is the
 * collection's whole design (`logged` vs `queued_unconfigured`), so the button
 * says which it is about to do rather than a generic "Save".
 */

export function ConversationsPanel({
  messages = [],
  isLoading,
  onLog,
  isPending,
  error,
  notice,
  onDismissNotice,
}) {
  const [channel, setChannel] = useState('call');
  const [direction, setDirection] = useState('outbound');
  const [body, setBody] = useState('');
  // Neither transmits: a call already happened down a line, a note already
  // happened across a counter. Both are logged, and the button has to say which
  // it is about to do rather than claiming a send (§6b rule 4).
  const isCall = channel === 'call';
  const isNote = channel === 'note';
  const logsOnly = isCall || isNote;
  function submit(event) {
    event.preventDefault();
    if (!body.trim()) return;
    onLog({ channel, direction, body: body.trim() }, () => setBody(''));
  }
  return (
    <Panel title="Conversations" description="Every call, message and email on this account.">
      <form onSubmit={submit} className="space-y-2.5">
        <div className="flex flex-wrap gap-2">
          <SelectMenu
            srLabel="Channel"
            value={channel}
            onChange={setChannel}
            options={Object.entries(CHANNEL_META).map(([value, meta]) => ({
              value,
              label: meta.label,
            }))}
            align="left"
            className="w-[150px]"
          />
          <SelectMenu
            srLabel="Direction"
            value={direction}
            onChange={setDirection}
            options={[
              { value: 'outbound', label: 'Outbound' },
              { value: 'inbound', label: 'Inbound' },
            ]}
            align="left"
            className="w-[150px]"
          />
        </div>
        <Textarea
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={
            isCall
              ? 'What was the call about?'
              : isNote
                ? 'What was said? The customer can see this on their portal.'
                : 'Write the message…'
          }
        />
        {error && (
          <p className="rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}
        {/* The server says whether a channel actually transmitted. It is
            rendered verbatim rather than being turned into a confirmation
            nothing here reports "sent" for something that was not sent. */}
        {notice && (
          <p className="flex items-start justify-between gap-2 rounded-md bg-warn-50 px-3 py-2.5 text-sm text-warn">
            <span>{notice}</span>
            <button
              type="button"
              onClick={onDismissNotice}
              className="shrink-0 underline hover:no-underline"
            >
              Dismiss
            </button>
          </p>
        )}
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            icon={logsOnly ? CHANNEL_META[channel].icon : Send}
            loading={isPending}
            disabled={!body.trim()}
          >
            {isCall ? 'Log call' : isNote ? 'Add note' : `Send ${CHANNEL_META[channel].label}`}
          </Button>
        </div>
      </form>
      <div className="mt-4 border-t border-line pt-3">
        {isLoading ? (
          <p className="py-6 text-center text-sm text-ink-400">Loading history…</p>
        ) : messages.length === 0 ? (
          <PanelEmpty
            icon={MessageCircle}
            title="Nothing logged yet"
            body="Calls and messages recorded here and on the Marketing screens both show up in this list."
          />
        ) : (
          <ul className="space-y-2.5">
            {messages.map((message) => {
              const meta = CHANNEL_META[message.channel] ?? CHANNEL_META.call;
              const Icon = meta.icon;
              return (
                <li key={message.id} className="flex gap-2.5">
                  <span
                    className={cn(
                      'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2',
                      meta.tone,
                    )}
                  >
                    <Icon className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold text-ink-900">
                        {meta.label}
                      </span>
                      <span className="text-xs text-ink-400">
                        {message.direction === 'inbound' ? 'in' : 'out'}
                      </span>
                      <Badge tone={STATUS_TONE[message.status] ?? 'neutral'} size="sm">
                        {STATUS_LABEL[message.status] ?? message.status}
                      </Badge>
                      <span className="text-xs text-ink-300">
                        {relativeTime(message.createdAt)}
                      </span>
                    </div>
                    {message.subject && (
                      <p className="text-sm font-medium text-ink-700">{message.subject}</p>
                    )}
                    <p className="whitespace-pre-wrap break-words text-sm text-ink-500">
                      {message.body}
                    </p>
                    {message.staffName && (
                      <p className="text-xs text-ink-300">by {message.staffName}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/**
 * Staff-only notes.
 *
 * Append-only by design (see the User model): the value of "always disputes the
 * freight line" depends on nobody being able to quietly rewrite what a
 * colleague recorded, so there is no edit - only add, and a delete that leaves
 * an audit row.
 */

export function NotesPanel({ notes = [], onAdd, onDelete, isPending, isDeleting }) {
  const [body, setBody] = useState('');
  // The delete control only appears on hover and sits a few pixels from the
  // note's own text, so it asks before removing what a colleague wrote.
  const [deleting, setDeleting] = useState(null);
  function submit(event) {
    event.preventDefault();
    if (!body.trim()) return;
    onAdd(body.trim(), () => setBody(''));
  }
  return (
    <Panel
      title="Internal notes"
      description="Staff only - the customer never sees these."
      action={
        <Badge tone="neutral" size="sm">
          Staff only
        </Badge>
      }
    >
      <form onSubmit={submit} className="space-y-2.5">
        <Textarea
          rows={2}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Add a note about this account…"
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            icon={StickyNote}
            loading={isPending}
            disabled={!body.trim()}
          >
            Add note
          </Button>
        </div>
      </form>
      <div className="mt-4 border-t border-line pt-3">
        {notes.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-400">No notes yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {notes.map((note) => (
              <li key={note.id} className="group rounded-md bg-surface-2 p-3">
                <p className="whitespace-pre-wrap break-words text-sm text-ink-700">
                  {note.body}
                </p>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <p className="text-xs text-ink-400">
                    {note.staffName} · {dateTime(note.createdAt)}
                  </p>
                  <button
                    type="button"
                    onClick={() => setDeleting(note)}
                    aria-label="Delete note"
                    className="text-ink-300 opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        // Open until the delete lands, so the button can say it is working.
        onConfirm={() => onDelete(deleting.id, () => setDeleting(null))}
        title="Delete this note?"
        body={
          deleting
            ? `Written by ${deleting.staffName}. Internal notes are not recoverable once removed.`
            : ''
        }
        confirmLabel="Delete note"
        confirmPhrase="delete"
        confirmPhraseLabel="the word delete"
        loading={isDeleting}
      />
    </Panel>
  );
}

/**
 * The referral scheme and the customer's own sign-in, side by side.
 *
 * **The code is the artefact, the link is the convenience.** A staff member reads
 * the code out over the phone; the link exists so it does not have to be spelled
 * letter by letter, and it carries `?ref=` which the registration form reads.
 *
 * **`referredBy` is read-only, everywhere.** Attribution is set once at
 * registration and never edited - a referral that could be reassigned later is
 * a commission that could be moved after it was earned, and the payout ledger
 * snapshots its rate precisely so that history cannot be rewritten.
 */
export function ReferralPanel({ user, percent }) {
  const [copied, setCopied] = useState(null);

  // The link only works once a code exists, and a code is minted on approval
  // a pending account has nothing to share yet, and the panel says so rather
  // than showing a link that resolves to nothing.
  const link = user.referralCode
    ? `${window.location.origin}/?ref=${encodeURIComponent(user.referralCode)}`
    : null;

  async function copy(value, which) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      // Clipboard access can be refused (an insecure origin, a locked-down
      // browser). The value is on screen and selectable either way, so this
      // fails quietly rather than throwing an error at something cosmetic.
    }
  }

  return (
    <Panel
      title="Referral & membership"
      description="What this account can share, and how it signs in."
    >
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="eyebrow mb-1 text-ink-400">Referral code</dt>
          <dd>
            {user.referralCode ? (
              <div className="flex items-center gap-2">
                <code className="tnum rounded-md bg-surface-2 px-2.5 py-1.5 font-mono text-sm font-semibold text-ink-900">
                  {user.referralCode}
                </code>
                <Button size="xs" variant="ghost" onClick={() => copy(user.referralCode, 'code')}>
                  {copied === 'code' ? 'Copied' : 'Copy'}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-ink-400">
                Minted when the account is approved - an account that cannot yet order cannot refer.
              </p>
            )}
          </dd>
        </div>

        {link && (
          <div>
            <dt className="eyebrow mb-1 text-ink-400">Referral link</dt>
            <dd className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate rounded-md bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-ink-700">
                {link}
              </span>
              <Button size="xs" variant="ghost" onClick={() => copy(link, 'link')}>
                {copied === 'link' ? 'Copied' : 'Copy'}
              </Button>
            </dd>
          </div>
        )}

        <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
          <dt className="text-ink-500">Commission rate</dt>
          <dd className="tnum font-medium text-ink-900">{percent}% of every payment</dd>
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-500">Referred by</dt>
          <dd className="text-ink-900">
            {user.referredBy ? (
              <Link
                to={`/admin/clients/${user.referredBy}`}
                className="font-medium text-brand hover:text-brand-700"
              >
                View referrer
              </Link>
            ) : (
              <span className="text-ink-400">Nobody - direct signup</span>
            )}
          </dd>
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink-500">Store credit earned</dt>
          <dd className="tnum font-medium text-ok">{money(user.storeCredit ?? 0)}</dd>
        </div>
      </dl>

      <p className="mt-3 border-t border-line pt-3 text-xs leading-snug text-ink-400">
        Commission is paid as store credit when a referred customer&rsquo;s invoice is{' '}
        <strong className="font-semibold text-ink-500">paid</strong>, not when it is raised, and each
        payout keeps the rate in force when it was earned - changing the rate is never retroactive.
        Attribution is set at registration and cannot be reassigned.
      </p>
    </Panel>
  );
}
