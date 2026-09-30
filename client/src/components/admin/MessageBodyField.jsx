import { useId, useMemo, useState } from 'react';
import { Code2, Eye } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import Textarea from '@/components/ui/Textarea';
import { useDensity, labelSize } from '@/components/ui/density';
import { looksLikeHtml, textToHtml, htmlToText } from '@shared/messageHtml.js';

/**
 * The body of a message, written as plain text or HTML, with a Code and a View
 * tab (2026-10-01, client request).
 *
 * Every template box in Settings › Communications uses this one field - the
 * status grid, the scheduled invoice messages and the manual statuses - so the
 * three cannot drift into three editors that preview differently.
 *
 * ## Why the preview is an iframe
 *
 * The body is admin-authored markup, and the rule here is that no such markup
 * is ever injected into the app's own document (`dangerouslySetInnerHTML` is
 * banned outright). A `sandbox` iframe with no permissions is a separate
 * document that cannot run a script, submit a form, navigate the app or read
 * its cookies, which makes it the one safe place to draw somebody's HTML. The
 * server sanitises the same body again before it is sent, so this is a
 * preview of the shape, not the gate.
 *
 * ## What View shows per channel
 *
 * Email is shown as the HTML it is. An SMS or a WhatsApp message cannot carry
 * markup, so on those channels View shows the text the tags flatten to, which
 * is what the customer's phone will actually display.
 */

// Only inside the preview document: it stands in for a mail client, not for
// the app, so it deliberately takes none of the app's tokens.
const PREVIEW_STYLE =
  'html,body{margin:0}body{padding:12px 14px;font:14px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#0A0A0B;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}';

function previewDocument(body, channel) {
  const value = String(body ?? '');
  const html =
    channel === 'email'
      ? looksLikeHtml(value)
        ? value
        : textToHtml(value)
      : textToHtml(looksLikeHtml(value) ? htmlToText(value) : value);

  return `<!doctype html><html><head><meta charset="utf-8"><style>${PREVIEW_STYLE}</style></head><body>${html}</body></html>`;
}

const TABS = [
  { key: 'code', label: 'Code', icon: Code2 },
  { key: 'view', label: 'View', icon: Eye },
];

export function MessageBodyField({
  label = 'Message',
  value,
  onChange,
  channel = 'email',
  rows = 7,
  counter,
  required,
  placeholder,
  hint,
  error,
}) {
  const density = useDensity();
  const id = useId();
  const [tab, setTab] = useState('code');

  const isHtml = looksLikeHtml(value);
  const srcDoc = useMemo(() => previewDocument(value, channel), [value, channel]);
  const empty = !String(value ?? '').trim();

  // Roughly the height the textarea takes at the same row count, so switching
  // tabs does not make the form jump.
  const previewHeight = `${Math.max(rows, 5) * 1.625 + 1.5}rem`;

  const viewHint =
    channel === 'email'
      ? isHtml
        ? 'Shown as the email will draw it. Scripts and forms are removed before sending.'
        : 'Plain text. Blank lines become paragraphs.'
      : 'SMS and WhatsApp carry text only, so any HTML is sent as the words it contains.';

  return (
    <div className="w-full">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor={id}
          className={cn(labelSize(density).replace(/^mb-[\d.]+ /, ''), 'block font-medium text-ink-700')}
        >
          {label}
          {required && (
            <span className="ml-0.5 text-danger" aria-hidden="true">
              *
            </span>
          )}
        </label>

        <div className="flex items-center gap-3">
          {counter ? (
            <span className="tnum text-xs text-ink-300">
              {String(value ?? '').length} / {counter}
            </span>
          ) : null}

          {/* A two-way switch between views of the same text, so it is drawn
              as one small segmented control rather than a tab row, which on
              this screen already means "a different section". */}
          <div role="tablist" aria-label={`${label} view`} className="inline-flex rounded-md bg-surface-2 p-0.5">
            {TABS.map((item) => {
              const Icon = item.icon;
              const active = tab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(item.key)}
                  className={cn(
                    pressable,
                    'inline-flex h-7 items-center gap-1 rounded-sm px-2.5 text-xs font-medium',
                    active ? 'bg-surface text-ink-900' : 'text-ink-500 hover:text-ink-900',
                  )}
                >
                  <Icon className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {tab === 'code' ? (
        <Textarea
          id={id}
          rows={rows}
          required={required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          // Monospace once it is markup: reading tags in a proportional face
          // is how a missing closing bracket goes unnoticed.
          className={isHtml ? 'font-mono text-sm sm:text-xs' : undefined}
          spellCheck={!isHtml}
          hint={hint ?? 'Plain text or HTML.'}
          error={error}
        />
      ) : (
        <>
          {empty ? (
            <div
              className="flex items-center justify-center rounded-md border border-dashed border-line bg-surface-2 text-sm text-ink-400"
              style={{ height: previewHeight }}
            >
              Nothing written yet.
            </div>
          ) : (
            <iframe
              title={`${label} preview`}
              // No permissions at all: no scripts, no forms, no same-origin
              // access, no navigation of the app.
              sandbox=""
              srcDoc={srcDoc}
              className="block w-full rounded-md border border-line bg-surface"
              style={{ height: previewHeight }}
            />
          )}
          {error ? (
            <p className="mt-1.5 text-sm text-danger">{error}</p>
          ) : (
            <p className="mt-1.5 text-sm text-ink-400">{viewHint}</p>
          )}
        </>
      )}
    </div>
  );
}

export default MessageBodyField;
