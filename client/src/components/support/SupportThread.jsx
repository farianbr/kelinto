import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';

import cn from '@/lib/cn';
import Button from '@/components/ui/Button';
import { PlatformBadge, PlatformButton } from '@/components/superadmin/PlatformUI';
import Badge from '@/components/ui/Badge';
import { dateTime } from '@/lib/format';

/**
 * A support conversation, rendered from either side (SAAS_PLATFORM §4.5).
 *
 * **One component for both halves.** The console and the tenant's panel read
 * the same thread and differ only in which messages count as "mine" - so `side`
 * is a prop rather than a reason to write this twice. A forked version would be
 * two places to fix the next time a message gains a field.
 *
 * Messages from the other side are labelled with who wrote them. On the tenant's
 * screen that label is the point: a reply from us should read unmistakably as
 * the platform rather than as one of their own staff.
 */
export function SupportThread({
  thread,
  side,
  /**
   * Which application this is rendering in.
   *
   * The same conversation appears in the tenant panel and in the platform
   * console, and those wear different identities - a component hardcoded to
   * either one is wrong in the other half of the time. `platform` is the dark
   * console; the default is the tenant panel it was written for.
   */
  surface = 'tenant',
  onSend,
  isSending,
  error,
  placeholder = 'Write a message…',
  emptyBody,
}) {
  const [body, setBody] = useState('');
  const endRef = useRef(null);

  const dark = surface === 'platform';
  const tone = {
    muted: dark ? 'text-plat-dim' : 'text-ink-400',
    body: dark ? 'text-plat-text' : 'text-ink-900',
    mine: dark ? 'bg-plat-accent/20 text-plat-text' : 'bg-brand-50 text-ink-900',
    theirs: dark
      ? 'border border-plat-line bg-plat-raised text-plat-text'
      : 'border border-line bg-surface-1 text-ink-900',
    field: dark
      ? 'border-plat-line bg-plat-raised text-plat-text placeholder:text-plat-dim focus:border-plat-accent'
      : 'border-line bg-surface-1 text-ink-900 placeholder:text-ink-400 focus:border-brand',
  };

  const messages = thread?.messages ?? [];

  // A conversation opens at its newest message, not its oldest - the reason to
  // open it is almost always the thing that just arrived.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);

  const send = (event) => {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;

    onSend(text, {
      // Cleared optimistically: the text is in the request, and leaving it in
      // the box invites a second send of the same message.
      onSuccess: () => setBody(''),
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!messages.length ? (
          <p className={cn('py-8 text-center text-sm', tone.muted)}>
            {emptyBody ?? 'No messages yet.'}
          </p>
        ) : (
          <ul className="space-y-3 py-1">
            {messages.map((message) => {
              const mine = message.side === side;
              return (
                <li
                  key={message.id}
                  className={cn('flex', mine ? 'justify-end' : 'justify-start')}
                >
                  <div className="min-w-0 max-w-[85%] sm:max-w-[70%]">
                    <div
                      className={cn(
                        'rounded-lg px-3 py-2 text-sm',
                        mine
                          ? tone.mine
                          : tone.theirs,
                      )}
                    >
                      {/* `whitespace-pre-wrap`, because somebody typing a
                          support message uses line breaks and losing them turns
                          a list of steps into a paragraph. */}
                      <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    </div>

                    <p
                      className={cn(
                        'mt-0.5 flex flex-wrap items-center gap-1.5 text-xs',
                        tone.muted,
                        mine ? 'justify-end' : 'justify-start',
                      )}
                    >
                      {!mine && message.side === 'platform' && (
                        dark ? (
                          <PlatformBadge tone="warn">Kelinto</PlatformBadge>
                        ) : (
                          <Badge tone="warn" size="sm">
                            Kelinto
                          </Badge>
                        )
                      )}
                      {!mine && <span>{message.authorName || message.authorEmail}</span>}
                      <span>{dateTime(message.createdAt)}</span>
                      {message.businessName && <span>· {message.businessName}</span>}
                    </p>
                  </div>
                </li>
              );
            })}
            <li ref={endRef} aria-hidden="true" />
          </ul>
        )}
      </div>

      {error && (
        <p className={cn('mt-2 text-sm', dark ? 'text-plat-danger' : 'text-danger')}>{error}</p>
      )}

      <form onSubmit={send} className="mt-3 flex items-end gap-2">
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line - the convention every
            // chat the reader has used already follows.
            if (event.key === 'Enter' && !event.shiftKey) send(event);
          }}
          rows={2}
          placeholder={placeholder}
          aria-label="Message"
          className={cn(
            'min-w-0 flex-1 resize-none rounded-md border px-3 py-2 text-sm',
            tone.field,
            'focus:outline-none',
          )}
        />
        {dark ? (
          <PlatformButton
            variant="primary"
            type="submit"
            icon={Send}
            loading={isSending}
            disabled={!body.trim()}
          >
            Send
          </PlatformButton>
        ) : (
          <Button type="submit" icon={Send} loading={isSending} disabled={!body.trim()}>
            Send
          </Button>
        )}
      </form>
    </div>
  );
}

export default SupportThread;
