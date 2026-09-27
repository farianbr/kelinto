import { useState } from 'react';
import { AlertCircle, Check, FileSignature, ShieldCheck } from 'lucide-react';
import cn from '@/lib/cn';
import { date, dateTime } from '@/lib/format';
import Panel, { PanelEmpty } from '@/components/ui/Panel';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import RichText from '@/lib/richText.jsx';
import SignaturePad from '@/components/ui/SignaturePad';
import AgreementDocument from '@/components/supplier/AgreementDocument';
import { toast } from '@/store/toastStore';
import { pressable } from '@/lib/motion';
import { useSupplierAgreement, useSupplierPortalMutations } from '@/hooks/useSupplierPortal';

/**
 * The supplier's agreements: read them, qualify them, sign them.
 *
 * **A roster, not one document** (re-ruled 2026-09-13). A supplier commonly
 * carries several - a master supply agreement, an NDA, a quality annex - and
 * each is signed separately. The page lists what they hold with each one's
 * state, and opening one is what starts the signing.
 *
 * **Every clause takes an exception box and its own initials**, because that is
 * how the paper form this replaces is actually negotiated: eight clauses
 * accepted and one qualified with "MOQ is 500, not 300". A single tick at the
 * foot of a wall of text would have thrown that away and made the document
 * take-it-or-leave-it.
 *
 * Initials are typed; the signature at the foot is drawn or uploaded. Asking
 * somebody to draw nine sets of initials on a phone is how a signing flow gets
 * abandoned half-way.
 */
export function SupplierAgreementPage() {
  const { data, isLoading } = useSupplierAgreement();
  const [openId, setOpenId] = useState(null);

  if (isLoading) {
    return (
      <>
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-4 h-64 w-full" />
      </>
    );
  }

  const agreements = data?.agreements ?? [];

  if (!agreements.length) {
    return (
      <Panel>
        <PanelEmpty
          icon={ShieldCheck}
          title="No agreements to sign"
          body="Nothing has been sent to you. If you were expecting a document, ask your contact at the business."
        />
      </Panel>
    );
  }

  const open = agreements.find((row) => row.template.id === openId);

  // One open at a time: signing is a focused job, and a page of nine-clause
  // documents all expanded is one nobody reads.
  if (open) {
    return open.signed ? (
      <SignedView row={open} onBack={() => setOpenId(null)} />
    ) : (
      <SigningForm row={open} onBack={() => setOpenId(null)} />
    );
  }

  const outstanding = agreements.filter((row) => !row.signed).length;

  return (
    <>
      <div className="mb-4">
        <h1 className="font-display text-xl font-bold text-ink-900">Your agreements</h1>
        <p className="mt-1 text-sm text-ink-500">
          {outstanding
            ? `${outstanding} of ${agreements.length} still ${outstanding === 1 ? 'needs' : 'need'} your signature. You cannot send a price or a proforma invoice until every one is signed.`
            : 'Everything is signed. These stay here for your records.'}
        </p>
      </div>

      <ul className="space-y-2">
        {agreements.map((row) => (
          <li key={row.template.id}>
            <button
              type="button"
              onClick={() => setOpenId(row.template.id)}
              className={cn(
                pressable,
                'flex w-full items-start gap-3 rounded-lg border bg-surface p-4 text-left',
                row.signed ? 'border-line hover:border-line-strong' : 'border-warn/40 bg-warn-50',
              )}
            >
              <FileSignature
                className={cn('mt-0.5 size-5 shrink-0', row.signed ? 'text-ink-300' : 'text-warn')}
                strokeWidth={2}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-md font-semibold text-ink-900">
                    {row.template.name}
                  </span>
                  <Badge tone={row.signed ? 'ok' : 'warn'} size="sm">
                    {row.signed ? 'signed' : 'not signed'}
                  </Badge>
                  <Badge tone="neutral" size="sm">
                    v{row.template.version}
                  </Badge>
                </span>
                {row.template.description && (
                  <span className="mt-0.5 block text-sm text-ink-500">
                    {row.template.description}
                  </span>
                )}
                <span className="mt-1 block text-xs text-ink-400">
                  {row.template.clauses.length} clause
                  {row.template.clauses.length === 1 ? '' : 's'}
                  {row.signed && row.agreement?.signedAt && (
                    <> · signed {date(row.agreement.signedAt)}</>
                  )}
                </span>
              </span>
              <span className="shrink-0 self-center text-sm font-semibold text-brand">
                {row.signed ? 'View' : 'Read and sign'}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Read, qualify and execute one agreement.
 *
 * **Laid out as a document, not as a settings form.** The first cut wrapped
 * every clause in its own `Panel` with 14px labels and full-width textareas,
 * which made a nine-clause contract read like nine unrelated preference groups
 * and pushed the whole thing to five screens of scroll. A contract is one
 * continuous sheet: a single bordered page, clauses separated by rules rather
 * than by cards, body text at 13px the way printed terms actually look, and the
 * per-clause inputs small and inline because they are annotations on the text
 * rather than the point of the screen.
 *
 * The exception boxes and initials stay exactly where the paper form puts them,
 * under the clause they qualify.
 */
function SigningForm({ row, onBack }) {
  const template = row.template;
  const { signAgreement } = useSupplierPortalMutations();

  // Keyed by clause: `{ [key]: { initials, note } }`.
  const [answers, setAnswers] = useState({});
  const [signature, setSignature] = useState(null);
  const [signedName, setSignedName] = useState('');
  const [signedTitle, setSignedTitle] = useState('');
  // Every unmet requirement, not just the first, and only after a real attempt.
  const [problems, setProblems] = useState([]);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(null);

  function setAnswer(key, patch) {
    setAnswers((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  const needsInitials = template.clauses.filter((clause) => clause.requiresInitials);
  const missing = needsInitials.filter((clause) => !answers[clause.key]?.initials?.trim());
  const initialled = needsInitials.length - missing.length;

  /**
   * What is still missing, in the user's words.
   *
   * The old message read "Initial every clause - 9 still need yours", which on
   * an untouched form reported *everything* as a failure: it looked like the
   * form had rejected the supplier rather than told them what to do. It also
   * surfaced one problem at a time, so fixing the initials produced a second
   * red banner about the signature, and then a third about the name.
   *
   * So: all of them at once, phrased as steps rather than errors, and only
   * after they have actually tried to submit.
   */
  function check() {
    const found = [];
    if (missing.length) {
      found.push(
        missing.length === needsInitials.length
          ? `Add your initials to each of the ${needsInitials.length} clauses above.`
          : `Add your initials to ${missing.length} more clause${missing.length === 1 ? '' : 's'} (${missing
              .map((clause) => template.clauses.indexOf(clause) + 1)
              .join(', ')}).`,
      );
    }
    if (!signedName.trim()) found.push('Type your full name under Execution.');
    if (!signature?.image) found.push('Draw or upload your signature.');
    return found;
  }

  function submit(event) {
    event.preventDefault();
    setError(null);

    const found = check();
    setProblems(found);
    if (found.length) return;

    // Validated above, then confirmed. Executing a contract is the most
    // consequential thing a supplier does in this portal, so it takes a typed
    // phrase rather than a click (Instructions §3.0.1).
    setConfirming({
      template: template.id,
      clauses: template.clauses.map((clause) => ({
        key: clause.key,
        initials: answers[clause.key]?.initials?.trim() || undefined,
        note: answers[clause.key]?.note?.trim() || undefined,
      })),
      signature,
      signedName: signedName.trim(),
      signedTitle: signedTitle.trim() || undefined,
    });
  }

  function sign() {
    signAgreement.mutate(confirming, {
      onSuccess: () => {
        setConfirming(null);
        toast.ok('Agreement signed', 'You can price orders and issue proforma invoices now.');
      },
      onError: (err) => {
        setConfirming(null);
        setError(err.message);
      },
    });
  }

  const buyer = template.buyerSignatory;

  return (
    <form onSubmit={submit}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className={cn(pressable, 'text-sm font-semibold text-ink-500 hover:text-ink-900')}
        >
          All agreements
        </button>

        {/* Progress, not a score. It says how much is left rather than how much
            is wrong, which is the difference between a to-do and a failure. */}
        <p className="tnum rounded-md bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-600">
          {initialled} of {needsInitials.length} clauses initialled
        </p>
      </div>

      {/* One sheet. Everything below sits inside it, separated by rules. */}
      <article className="overflow-hidden rounded-lg border border-line bg-surface">
        <header className="border-b border-line px-5 py-4 text-center sm:px-8 sm:py-5">
          <h1 className="font-display text-sm font-bold uppercase tracking-wide text-ink-900 sm:text-md">
            {template.name}
          </h1>
          <p className="mt-1 text-2xs text-ink-400">Version {template.version}</p>
        </header>

        <dl className="grid gap-3 border-b border-line px-5 py-4 text-xs sm:grid-cols-2 sm:px-8">
          <div>
            <dt className="text-2xs uppercase tracking-wide text-ink-400">Buyer</dt>
            <dd className="mt-0.5 text-ink-900">{buyer?.company || 'CellVix INC'}</dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-wide text-ink-400">Supplier</dt>
            <dd className="mt-0.5 text-ink-900">{row.supplierName || 'Your company'}</dd>
          </div>
        </dl>

        {template.preamble && (
          <div className="border-b border-line px-5 py-4 text-xs leading-relaxed text-ink-600 sm:px-8">
            <RichText tone="document">{template.preamble}</RichText>
          </div>
        )}

        <ol className="divide-y divide-line">
          {template.clauses.map((clause, index) => {
            const answer = answers[clause.key] ?? {};
            const done = Boolean(answer.initials?.trim());

            return (
              <li key={clause.key} className="px-5 py-4 sm:px-8 sm:py-5">
                <h2 className="font-display text-sm font-semibold text-ink-900">
                  {index + 1}. {clause.title}
                </h2>

                {/* 13px, the size printed terms actually are. At 14px in a card
                    the document read as UI copy rather than as a contract. */}
                <div className="mt-1.5 text-xs leading-relaxed text-ink-600">
                  <RichText tone="document">{clause.body}</RichText>
                </div>

                {/**
                 * The annotation block, in the place the paper form puts it.
                 *
                 * **Sized to its text, not to a form field.** These were 56px
                 * boxes holding 11px labels and a 12px placeholder, which made
                 * the annotation louder than the clause it annotates - the
                 * whole reason the document read as a form. A single-line note
                 * field at 32px and a matching initials box is the ruled line
                 * the paper version actually has.
                 *
                 * The label sits INLINE with the field rather than above it,
                 * which is what removed the alignment problem entirely: there
                 * is no second label to line up with.
                 */}
                <div
                  className={cn(
                    'mt-2.5 rounded-md border px-2.5 py-2 transition-colors',
                    done ? 'border-ok/30 bg-ok-50/40' : 'border-line bg-surface-2',
                  )}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <label className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="shrink-0 text-2xs uppercase tracking-wide text-ink-400">
                        Notes
                      </span>
                      <input
                        value={answer.note ?? ''}
                        onChange={(event) => setAnswer(clause.key, { note: event.target.value })}
                        placeholder="Any exception to this clause"
                        className="h-8 w-full min-w-0 rounded-sm border border-line bg-surface px-2 text-xs text-ink-900 placeholder:text-ink-300 focus:border-brand focus:outline-none"
                      />
                    </label>

                    {clause.requiresInitials && (
                      <label className="flex shrink-0 items-center gap-2">
                        <span className="shrink-0 text-2xs uppercase tracking-wide text-ink-400">
                          Initials
                        </span>
                        <input
                          value={answer.initials ?? ''}
                          maxLength={6}
                          onChange={(event) =>
                            setAnswer(clause.key, { initials: event.target.value })
                          }
                          placeholder="AB"
                          className={cn(
                            'h-8 w-16 rounded-sm border bg-surface px-1.5 text-center font-mono text-xs uppercase tracking-wider text-ink-900 placeholder:tracking-normal placeholder:text-ink-300 focus:outline-none',
                            done ? 'border-ok/50 bg-ok-50/60' : 'border-line focus:border-brand',
                          )}
                        />
                      </label>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {/* Execution, both sides, as the paper form closes. */}
        <div className="border-t-2 border-line-strong px-5 py-5 sm:px-8">
          <p className="mb-4 text-2xs uppercase tracking-wide text-ink-400">
            Execution and formal signatures
          </p>

          <div className="grid gap-6 sm:grid-cols-2">
            {/* Ours, already executed. A contract signed by one party is a
                draft, and a supplier should see ours before adding theirs. */}
            <div>
              <p className="mb-2 text-2xs uppercase tracking-wide text-ink-400">Buyer</p>
              <div className="flex h-16 items-end border-b border-line-strong">
                {buyer?.signatureImage ? (
                  <img
                    src={buyer.signatureImage}
                    alt={`Signature of ${buyer.name}`}
                    className="max-h-15 w-auto"
                  />
                ) : (
                  <span className="pb-1 text-2xs text-ink-300">Signed on file</span>
                )}
              </div>
              <dl className="mt-2 space-y-0.5 text-2xs">
                <Row label="Name" value={buyer?.name} />
                <Row label="Title" value={buyer?.title} />
                <Row label="Company" value={buyer?.company} />
                <Row label="Date" value={buyer?.signedAt ? date(buyer.signedAt) : null} />
              </dl>
            </div>

            {/* Theirs, being executed now. */}
            <div>
              <p className="mb-2 text-2xs uppercase tracking-wide text-ink-400">Supplier</p>
              <SignaturePad
                value={signature}
                onChange={setSignature}
                disabled={signAgreement.isPending}
              />

              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <label>
                  <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-400">
                    Printed name
                  </span>
                  <input
                    value={signedName}
                    onChange={(event) => setSignedName(event.target.value)}
                    className="w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-900 focus:border-brand focus:outline-none"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-2xs uppercase tracking-wide text-ink-400">
                    Title
                  </span>
                  <input
                    value={signedTitle}
                    onChange={(event) => setSignedTitle(event.target.value)}
                    placeholder="Optional"
                    className="w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-xs text-ink-900 placeholder:text-ink-300 focus:border-brand focus:outline-none"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      </article>

      {/**
       * What is left to do, listed together and phrased as steps.
       *
       * Shown only after a submit attempt: a form that turns red before
       * anybody has touched it is one that has pre-judged them.
       */}
      {problems.length > 0 && (
        <div
          role="alert"
          className="mt-3 rounded-md border border-warn/40 bg-warn-50 px-3.5 py-3"
        >
          <p className="flex items-center gap-1.5 text-sm font-medium text-ink-900">
            <AlertCircle className="size-4 shrink-0 text-warn" strokeWidth={2} aria-hidden="true" />
            {problems.length === 1
              ? 'One thing left before you can sign'
              : `${problems.length} things left before you can sign`}
          </p>
          <ul className="mt-1.5 space-y-1 pl-5.5 text-sm text-ink-600">
            {problems.map((problem) => (
              <li key={problem} className="list-disc">
                {problem}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-md bg-danger-50 px-3.5 py-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="submit" icon={FileSignature} loading={signAgreement.isPending}>
          Sign the agreement
        </Button>
        <p className="text-2xs text-ink-400">
          We record the date, your name and the version of the document you signed.
        </p>
      </div>

      {/**
       * The most consequential act in this portal, so it takes a typed phrase.
       *
       * This executes a contract: it binds the supplier for a year, and it
       * cannot be undone from here - only superseded by a new version we
       * publish. One click is the wrong weight for that.
       */}
      <ConfirmDialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        onConfirm={sign}
        title={`Sign ${template.name}?`}
        body={`${template.clauses.length} clauses, initialled and signed as ${signedName.trim() || 'you'}.`}
        confirmPhrase="SIGN"
        confirmLabel="Sign the agreement"
        loading={signAgreement.isPending}
      />
    </form>
  );
}

/** One line of an execution block. */
function Row({ label, value }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-ink-400">{label}</dt>
      <dd className="min-w-0 text-ink-900">{value || '–'}</dd>
    </div>
  );
}

/** One signed agreement, rendered as the executed document. */
function SignedView({ row, onBack }) {
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className={cn(pressable, 'mb-4 text-sm font-semibold text-ink-500 hover:text-ink-900')}
      >
        All agreements
      </button>

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-sm text-ok">
        <Check className="size-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
        Signed {dateTime(row.agreement.signedAt)} by {row.agreement.signedName}
        {row.agreement.signedTitle && `, ${row.agreement.signedTitle}`}
      </p>

      <AgreementDocument agreement={row.agreement} buyer={row.template.buyerSignatory} />
    </>
  );
}

export default SupplierAgreementPage;
