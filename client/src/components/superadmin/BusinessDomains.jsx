import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Globe, Lock, ShieldAlert, X } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import { dateTime, relativeTime } from '@/lib/format';
import { toast } from '@/store/toastStore';
import { customDomainProblem, businessSlugProblem, normaliseDomain } from '@shared/hosts';
import { PlatformBadge, PlatformButton, PlatformPanel } from '@/components/superadmin/PlatformUI';
import {
  PlatformConfirm,
  PlatformError,
  PlatformInput,
  PlatformModal,
  PlatformNotice,
  PlatformTextarea,
} from '@/components/superadmin/PlatformForm';
import { SlugInput } from '@/components/superadmin/ConsoleForms';
import { addressOf, domainState } from '@/components/superadmin/platformData';
import { useSuperAdminMutations } from '@/hooks/useSuperAdmin';

/**
 * Where a business answers, and the only place that changes.
 *
 * **Its own page, and the most guarded one in the console.** An address is
 * printed on receipts, saved in customers' bookmarks and baked into every link
 * a business has ever emailed. Changing it is the one console act whose damage
 * lands on people who never see the console, so it is not a field in a dialog
 * any more: the page shows what is live and what is waiting, the exact DNS
 * records the business must add, and a save that takes **two confirmations**:
 * a review of every change with its consequence spelled out, then the
 * business's current address typed back.
 */

function StateBadge({ state, liveAt }) {
  if (state === 'live') {
    return (
      <PlatformBadge tone="ok" icon={Lock}>
        Live{liveAt ? ` since ${relativeTime(liveAt)}` : ''}
      </PlatformBadge>
    );
  }
  if (state === 'waiting') return <PlatformBadge tone="warn">Waiting for DNS</PlatformBadge>;
  return <PlatformBadge>Not set</PlatformBadge>;
}

function CopyValue({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error('Could not copy', 'Select the value and copy it by hand.');
        }
      }}
      aria-label={`Copy ${value}`}
      className={cn(pressable, 'inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-sm text-plat-text hover:bg-plat-text/5')}
    >
      <span className="break-all">{value}</span>
      {copied ? (
        <Check className="size-3.5 shrink-0 text-plat-ok" strokeWidth={2.25} aria-hidden="true" />
      ) : (
        <Copy className="size-3.5 shrink-0 text-plat-dim" strokeWidth={2} aria-hidden="true" />
      )}
    </button>
  );
}

/** One address and what state it is in. */
function AddressRow({ label, purpose, host, state, liveAt, note }) {
  return (
    <li className="grid gap-2 px-5 py-4 sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
      <div>
        <p className="text-md font-medium text-plat-text">{label}</p>
        <p className="text-xs text-plat-dim">{purpose}</p>
      </div>
      <div className="min-w-0">
        {host ? (
          <a
            href={`https://${host}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1.5 font-mono text-sm text-plat-text hover:underline"
          >
            <span className="truncate">{host}</span>
            <ExternalLink className="size-3.5 shrink-0 text-plat-dim" aria-hidden="true" />
          </a>
        ) : (
          <span className="text-sm text-plat-dim">None</span>
        )}
        {note && <p className="mt-0.5 text-xs text-plat-muted">{note}</p>}
      </div>
      <div>
        <StateBadge state={state} liveAt={liveAt} />
      </div>
    </li>
  );
}

/**
 * The consequences of an address change, in the order they land.
 * Each line names the address it is about, so none of them reads as boilerplate.
 */
function consequencesOf(business, next, storefrontDomain) {
  const lines = [];
  const oldSlug = addressOf(business.slug, storefrontDomain);
  const newSlug = addressOf(next.slug, storefrontDomain);

  if (business.slug && next.slug !== business.slug) {
    lines.push(
      `${oldSlug} stops working the moment this is saved. Links already shared, bookmarks and anything printed with it, receipts included, will no longer reach the website. ${newSlug} starts answering at once.`,
    );
  }
  if ((business.domain ?? '') !== next.domain) {
    if (business.domain) {
      lines.push(
        `${business.domain} stops serving this business immediately and answers "not connected" instead. Browsers that followed its redirect recently may keep trying it for up to a day.`,
      );
    }
    if (next.domain) {
      lines.push(
        `${next.domain} does nothing until the business points its DNS here. After the first secure visit it becomes the website's main address and ${newSlug} forwards to it.`,
      );
    }
  }
  if ((business.panelDomain ?? '') !== next.panelDomain) {
    if (business.panelDomain) {
      lines.push(`Staff stop being sent to ${business.panelDomain} and sign in on the shared ERP address again.`);
    }
    if (next.panelDomain) {
      lines.push(
        `Once ${next.panelDomain} is live, this business's staff are sent there to sign in, and only its own accounts can sign in there.`,
      );
    }
  }
  return lines;
}

/**
 * The two-step save.
 *
 * Step one is the review: every change as before and after, and every
 * consequence as a sentence. Step two asks for the business's CURRENT address
 * typed back, the one about to change or be joined, which cannot be done
 * without reading it.
 */
function SaveAddressDialog({ open, onClose, business, next, storefrontDomain, onSaved }) {
  const { setBusinessAddress } = useSuperAdminMutations();
  const [step, setStep] = useState(1);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) {
      setStep(1);
      setTyped('');
      setBusinessAddress.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const phrase = business.slug || business.code;
  const phraseOk = typed.trim().toLowerCase() === String(phrase).toLowerCase();
  const changes = [
    next.slug !== (business.slug ?? '') && {
      label: 'Web address',
      from: addressOf(business.slug, storefrontDomain),
      to: addressOf(next.slug, storefrontDomain),
    },
    next.domain !== (business.domain ?? '') && { label: 'Website domain', from: business.domain, to: next.domain },
    next.panelDomain !== (business.panelDomain ?? '') && {
      label: 'ERP domain',
      from: business.panelDomain,
      to: next.panelDomain,
    },
  ].filter(Boolean);
  const consequences = consequencesOf(business, next, storefrontDomain);

  const save = () =>
    setBusinessAddress.mutate(
      { id: business.id, ...next },
      {
        onSuccess: (result) => {
          const saved = result.business;
          toast.ok(
            'Addresses saved',
            [addressOf(saved.slug, storefrontDomain), saved.domain, saved.panelDomain && `${saved.panelDomain} (ERP)`]
              .filter(Boolean)
              .join(' · '),
          );
          onSaved();
          onClose();
        },
      },
    );

  return (
    <PlatformModal
      open={open}
      onClose={onClose}
      align="top"
      size="md"
      title={step === 1 ? `Review address changes for ${business.name}` : 'Confirm the change'}
      description={`Step ${step} of 2`}
      footer={
        step === 1 ? (
          <>
            <PlatformButton variant="ghost" onClick={onClose}>
              Cancel
            </PlatformButton>
            <PlatformButton variant="primary" onClick={() => setStep(2)}>
              I understand, continue
            </PlatformButton>
          </>
        ) : (
          <>
            <PlatformButton variant="ghost" onClick={() => setStep(1)}>
              Back
            </PlatformButton>
            <PlatformButton variant="danger-solid" disabled={!phraseOk} loading={setBusinessAddress.isPending} onClick={save}>
              Save addresses
            </PlatformButton>
          </>
        )
      }
    >
      {step === 1 ? (
        <>
          <dl className="divide-y divide-plat-line-soft rounded-lg border border-plat-line-soft">
            {changes.map((change) => (
              <div key={change.label} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[9rem_1fr]">
                <dt className="text-xs text-plat-dim sm:pt-0.5">{change.label}</dt>
                <dd className="min-w-0 text-sm">
                  <span className="block break-all font-mono text-plat-dim line-through">{change.from || 'None'}</span>
                  <span className="block break-all font-mono text-plat-text">{change.to || 'None'}</span>
                </dd>
              </div>
            ))}
          </dl>
          <h3 className="mb-2 mt-5 text-sm font-semibold text-plat-text">What happens when you save</h3>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-plat-muted marker:text-plat-dim">
            {consequences.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </>
      ) : (
        <>
          <PlatformError>{setBusinessAddress.error?.message}</PlatformError>
          <PlatformNotice icon={ShieldAlert} tone="danger">
            This changes where {business.name}&apos;s customers and staff reach it, for everybody, immediately.
          </PlatformNotice>
          <PlatformInput
            label={
              <>
                Type <span className="font-mono text-plat-text">{phrase}</span> to save
              </>
            }
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            hint="The business's current web address, as it is today."
          />
        </>
      )}
    </PlatformModal>
  );
}

/** A tenant's requested address: approve (goes live at once) or reject with a reason. */
export function AddressRequestPanel({ business, storefrontDomain }) {
  const { approveAddressRequest, rejectAddressRequest } = useSuperAdminMutations();
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const request = business.addressRequest;
  if (request?.status !== 'pending') return null;
  const wanted = addressOf(request.slug, storefrontDomain);

  return (
    <PlatformPanel
      title="Address request"
      description={`Asked for by ${request.requestedBy || 'the tenant'} ${request.requestedAt ? relativeTime(request.requestedAt) : ''}.`}
      footer={
        <>
          <PlatformButton variant="ghost" icon={X} onClick={() => setRejecting(true)}>
            Reject
          </PlatformButton>
          <PlatformButton variant="primary" icon={Check} onClick={() => setApproving(true)}>
            Approve
          </PlatformButton>
        </>
      }
    >
      <p className="font-mono text-xl text-plat-text">{wanted}</p>
      {business.slug && (
        <p className="mt-1 text-sm text-plat-muted">
          Replaces <span className="font-mono">{addressOf(business.slug, storefrontDomain)}</span>
        </p>
      )}

      <PlatformConfirm
        open={approving}
        onClose={() => setApproving(false)}
        tone="danger"
        title={`Approve ${wanted}?`}
        confirmLabel="Approve and go live"
        confirmPhrase={request.slug}
        changes={[{ label: 'Web address', from: addressOf(business.slug, storefrontDomain), to: wanted }]}
        isPending={approveAddressRequest.isPending}
        error={approveAddressRequest.error?.message}
        onConfirm={() =>
          approveAddressRequest.mutate(
            { id: business.id },
            {
              onSuccess: (result) => {
                toast.ok(
                  'Address approved',
                  result.liveUrl ? `${business.name} is live at ${result.liveUrl.replace(/^https?:\/\//, '')}.` : `${business.name} has its address.`,
                );
                setApproving(false);
              },
            },
          )
        }
      >
        <p>
          {wanted} starts opening {business.name}&apos;s website as soon as this is approved.
          {business.slug && ` ${addressOf(business.slug, storefrontDomain)} stops working at the same moment, and anything printed with it stops reaching the website.`}
        </p>
      </PlatformConfirm>

      <PlatformModal
        open={rejecting}
        onClose={() => setRejecting(false)}
        title={`Reject ${wanted}`}
        size="md"
        align="top"
        footer={
          <>
            <PlatformButton variant="ghost" onClick={() => setRejecting(false)}>
              Cancel
            </PlatformButton>
            <PlatformButton
              variant="danger"
              disabled={!note.trim()}
              loading={rejectAddressRequest.isPending}
              onClick={() =>
                rejectAddressRequest.mutate(
                  { id: business.id, note },
                  {
                    onSuccess: () => {
                      toast.ok('Request rejected', `${business.name} can see why.`);
                      setRejecting(false);
                      setNote('');
                    },
                  },
                )
              }
            >
              Reject request
            </PlatformButton>
          </>
        }
      >
        <PlatformError>{rejectAddressRequest.error?.message}</PlatformError>
        <PlatformTextarea
          label="Reason"
          required
          rows={3}
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
          hint={`Shown to ${business.name}, so they can ask for something else.`}
        />
      </PlatformModal>
    </PlatformPanel>
  );
}

export function BusinessDomains({ business, storefrontDomain, platformDomains }) {
  const [slug, setSlug] = useState(business.slug ?? '');
  const [domain, setDomain] = useState(business.domain ?? '');
  const [panelDomain, setPanelDomain] = useState(business.panelDomain ?? '');
  const [reviewing, setReviewing] = useState(false);
  const [tried, setTried] = useState(false);

  const reset = () => {
    setSlug(business.slug ?? '');
    setDomain(business.domain ?? '');
    setPanelDomain(business.panelDomain ?? '');
    setTried(false);
  };

  const next = { slug, domain: normaliseDomain(domain), panelDomain: normaliseDomain(panelDomain) };
  const slugProblem = businessSlugProblem(slug);
  const domainProblem = customDomainProblem(domain, platformDomains);
  const panelProblem =
    customDomainProblem(panelDomain, platformDomains) ??
    (next.panelDomain && next.panelDomain === next.domain ? 'One address cannot be both the website and the ERP.' : null);
  const unchanged =
    next.slug === (business.slug ?? '') &&
    next.domain === (business.domain ?? '') &&
    next.panelDomain === (business.panelDomain ?? '');

  const platformAddress = addressOf(business.slug, storefrontDomain);
  const storefrontState = domainState(business.domain, business.domainLiveAt);
  const panelState = domainState(business.panelDomain, business.panelDomainLiveAt);
  const needsDns = [
    storefrontState === 'waiting' && business.domain,
    panelState === 'waiting' && business.panelDomain,
  ].filter(Boolean);

  if (business.deletedAt) {
    return (
      <PlatformPanel>
        <p className="text-md text-plat-muted">
          A deleted business answers on no address. Restore it from the Overview tab to manage its domains again.
        </p>
      </PlatformPanel>
    );
  }

  return (
    <div className="space-y-6">
      <AddressRequestPanel business={business} storefrontDomain={storefrontDomain} />

      <PlatformPanel title="Where it answers" description="Checked by real traffic: a domain turns live on its first secure visit." flush>
        <ul className="divide-y divide-plat-line-soft border-t border-plat-line-soft">
          <AddressRow
            label="Web address"
            purpose="On Kelinto"
            host={platformAddress}
            state={platformAddress ? 'live' : 'none'}
            note={storefrontState === 'live' ? `Forwards to ${business.domain}` : null}
          />
          <AddressRow
            label="Website domain"
            purpose="Where customers shop"
            host={business.domain}
            state={storefrontState}
            liveAt={business.domainLiveAt}
            note={storefrontState === 'live' ? 'The website’s main address' : null}
          />
          <AddressRow
            label="ERP domain"
            purpose="Where staff sign in"
            host={business.panelDomain}
            state={panelState}
            liveAt={business.panelDomainLiveAt}
            note={panelState === 'live' ? 'Only this business’s accounts sign in here' : null}
          />
        </ul>
      </PlatformPanel>

      {needsDns.length > 0 && storefrontDomain && (
        <PlatformPanel
          title="DNS the business needs to add"
          description="At whoever hosts their domain's DNS. Nothing needs changing on the server."
        >
          <div className="overflow-hidden rounded-lg border border-plat-line-soft">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-plat-line-soft bg-plat-raised/50 text-xs text-plat-dim">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Type</th>
                  <th scope="col" className="px-3 py-2 font-medium">Name</th>
                  <th scope="col" className="px-3 py-2 font-medium">Points to</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-plat-line-soft">
                {needsDns.map((host) => (
                  <tr key={host}>
                    <td className="px-3 py-2.5 font-mono text-plat-muted">CNAME</td>
                    <td className="px-1.5 py-2.5"><CopyValue value={host} /></td>
                    <td className="px-1.5 py-2.5"><CopyValue value={storefrontDomain} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-4 space-y-1.5 text-sm text-plat-muted">
            <li>If the domain is on Cloudflare, set the record to <strong className="font-medium text-plat-text">DNS only</strong> (grey cloud) until it shows live here.</li>
            <li>The certificate is issued automatically on the first visit after the record exists. That visit also turns the domain live.</li>
          </ul>
        </PlatformPanel>
      )}

      <PlatformPanel
        title="Change addresses"
        description="Nothing is saved from this form directly. You review every change and confirm it twice."
        footer={
          <>
            {!unchanged && (
              <PlatformButton variant="ghost" onClick={reset}>
                Discard
              </PlatformButton>
            )}
            <PlatformButton
              variant="primary"
              icon={Globe}
              disabled={unchanged}
              onClick={() => {
                setTried(true);
                if (!slugProblem && !domainProblem && !panelProblem) setReviewing(true);
              }}
            >
              Review changes
            </PlatformButton>
          </>
        }
      >
        {/* Measured: a hostname is at most a few dozen characters, and a field
            a thousand pixels wide says "type a paragraph here". */}
        <div className="grid max-w-3xl gap-5">
          <SlugInput value={slug} onChange={setSlug} storefrontDomain={storefrontDomain} showError={tried || slug !== (business.slug ?? '')} />
          <div className="grid gap-5 md:grid-cols-2">
            <PlatformInput
              label="Website domain"
              placeholder="shop.example.com"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              error={tried || domain ? domainProblem : null}
              hint="Optional. A domain the business owns, for its customers. Empty removes it."
            />
            <PlatformInput
              label="ERP domain"
              placeholder="app.example.com"
              value={panelDomain}
              onChange={(event) => setPanelDomain(event.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              error={tried || panelDomain ? panelProblem : null}
              hint="Optional. Where its staff sign in to the ERP. Empty removes it."
            />
          </div>
        </div>
        {business.domainLiveAt && (
          <p className="mt-4 text-xs text-plat-dim">Website domain live since {dateTime(business.domainLiveAt)}.</p>
        )}
      </PlatformPanel>

      <SaveAddressDialog
        open={reviewing}
        onClose={() => setReviewing(false)}
        business={business}
        next={next}
        storefrontDomain={storefrontDomain}
        onSaved={() => setTried(false)}
      />
    </div>
  );
}

export default BusinessDomains;
