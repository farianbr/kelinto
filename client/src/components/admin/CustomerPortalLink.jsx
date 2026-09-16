import { useState } from 'react';
import { Copy, ExternalLink, Link2, RefreshCw, Check } from 'lucide-react';

import cn from '@/lib/cn';
import { toast } from '@/store/toastStore';
import Panel from '@/components/ui/Panel';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useCustomerPortalLink } from '@/hooks/useAdmin';
import { pressable } from '@/lib/motion';

/**
 * The customer's read-only portal link (§6.13a).
 *
 * **A service business has no storefront**, so its customers have nowhere to
 * look themselves up: somebody who left a phone at a counter has no account, was
 * never asked to make one, and should not be asked to make one now to find out
 * whether the phone is ready. This is the link they get instead - one URL, no
 * password, read-only.
 *
 * ## Why it is not shown until it is asked for
 *
 * **The URL is the credential.** Rendering it on page load would print a working
 * key to one customer's record every time anybody opened their profile, and
 * would write an audit row for a look nobody took - which makes the trail
 * useless for the one question it exists to answer. So the link is fetched on a
 * click, and that click is what the audit records.
 *
 * The panel says what the link is before it hands one over, because a staff member
 * who does not know the URL is the password will text it to the wrong number
 * once and never know.
 */

export default function CustomerPortalLink({ id }) {
  const [link, setLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const portalLink = useCustomerPortalLink(id);

  function reveal(rotate = false) {
    portalLink.mutate(
      { rotate },
      {
        onSuccess: (result) => {
          setLink(result.url);
          setCopied(false);
          if (rotate)
            toast.ok('New portal link issued', 'The previous one no longer works.');
        },
        onError: (error) => toast.error(error.message),
      },
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.ok('Portal link copied');
      // Back to the idle label, so the tick reads as "that copy worked" rather
      // than as a permanent state of the button.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A clipboard write can be refused outright (an insecure origin, a
      // permission the browser never granted). The link is on screen and
      // selectable, so saying so is more use than a failure the staff member
      // cannot act on.
      toast.error('Could not copy. Select the link and copy it by hand.');
    }
  }

  return (
    <Panel
      title="Customer portal"
      description="A read-only page where this customer can follow their own tickets, invoices and quotes."
    >
      {!link ? (
        <div className="space-y-3">
          <p className="text-sm leading-snug text-ink-500">
            The link needs no password, so <strong className="font-semibold text-ink-700">the
            link itself is the credential</strong>: anybody holding it can read this customer's
            record. Send it to them, not to a group.
          </p>
          <Button
            size="sm"
            variant="outline"
            icon={Link2}
            loading={portalLink.isPending}
            onClick={() => reveal(false)}
          >
            Show portal link
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Selectable and wrapping, not truncated: a staff member reading it down
              a phone line needs every character of it. */}
          <p className="break-all rounded-md bg-surface-2 px-3 py-2.5 font-mono text-xs text-ink-700">
            {link}
          </p>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={copied ? Check : Copy} onClick={copy}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                pressable,
                'inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm font-semibold text-ink-700 hover:bg-surface-2',
              )}
            >
              <ExternalLink className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              Open
            </a>
            <Button
              size="sm"
              variant="ghost"
              icon={RefreshCw}
              onClick={() => setConfirmingRotate(true)}
            >
              Issue new link
            </Button>
          </div>

          <p className="text-xs leading-snug text-ink-400">
            Issuing a new link stops the old one working. Do that if it reached somebody it
            should not have.
          </p>
        </div>
      )}

      {/**
       * Rotating breaks a link the customer may be relying on, and it cannot be
       * undone - the previous token is not recoverable. That is the definition
       * of a critical write (§3.0.1), so it confirms rather than firing off one
       * click.
       */}
      <ConfirmDialog
        open={confirmingRotate}
        onClose={() => setConfirmingRotate(false)}
        onConfirm={() => {
          setConfirmingRotate(false);
          reveal(true);
        }}
        title="Issue a new portal link?"
        body="The current link stops working the moment this is done, and the old one cannot be restored."
        confirmPhrase="NEW LINK"
        confirmLabel="Issue new link"
      />
    </Panel>
  );
}
