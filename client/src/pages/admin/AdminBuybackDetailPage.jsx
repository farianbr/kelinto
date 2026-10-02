import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Camera, Eye, IdCard, Smartphone, User, XCircle } from 'lucide-react';

import { buybackAcceptSchema } from '@shared/schemas/admin';
import { CONDITION_PARTS, conditionAnswered, conditionProblems } from '@shared/deviceCondition';
import { apiUrl } from '@/lib/api';
import { date, dateTime, money } from '@/lib/format';
import useAdminForm from '@/hooks/useAdminForm';
import Panel from '@/components/ui/Panel';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Checkbox from '@/components/ui/Checkbox';
import SelectField from '@/components/ui/SelectField';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Skeleton from '@/components/ui/Skeleton';
import PageHeader from '@/components/admin/PageHeader';
import { PHONE_GRADES } from '@shared/catalog';
import { useAdminCatalogCategories } from '@/hooks/useAdmin';
import { useSetRecordLabel } from '@/components/admin/shell/recordLabel';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useBuybackRequest, usePreownedMutations } from '@/hooks/usePreowned';

/**
 * One phone a customer sold at the kiosk: Inventory › Pre-owned › Requests › BB-00001.
 *
 * ## What the screen is opened for
 *
 * **Pricing it.** The customer is usually standing at the counter while the
 * staff member checks the phone, agrees a price with them and pays them. So the
 * review form takes the right-hand column and the facts it depends on (the
 * phone, what the seller said about it, who they are) sit beside it, in the
 * order they are checked: the phone first, then the person.
 *
 * ## The seller's ID and photo
 *
 * Both are shown on request, not on load. Each look is a security-log row
 * naming who looked, and most people pricing a phone never need either: the ID
 * is for the day a phone turns out to be stolen. Masked by default, like every
 * credential in the ERP.
 */

const PAGE_ICON = adminIcon('Smartphone');
const TONES = { pending: 'warn', accepted: 'ok', declined: 'neutral' };
const LABELS = { pending: 'Waiting to be priced', accepted: 'Bought', declined: 'Declined' };
const gradeOptions = (part) => [{ value: '', label: 'Not checked' }, ...part.options];

function Fact({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-ink-500">{label}</dt>
      <dd className="min-w-0 text-right text-ink-900">{children}</dd>
    </div>
  );
}

function PhonePanel({ buyback }) {
  const { device, customerCondition } = buyback;
  const problems = conditionProblems(customerCondition);
  const answered = conditionAnswered(customerCondition);

  return (
    <Panel title="The phone" icon={Smartphone}>
      <p className="font-display text-lg font-bold text-ink-900">{device.title}</p>
      <dl className="mt-2 divide-y divide-line">
        <Fact label="IMEI">
          <span className="tnum font-mono">{device.imei}</span>
        </Fact>
        {device.category && <Fact label="Kind">{device.category}</Fact>}
        <Fact label="Passcode">
          {device.passcode ? <span className="font-mono">{device.passcode}</span> : 'None given'}
        </Fact>
      </dl>

      {/* A claim, not a test: labelled as whose it is. */}
      <p className="mt-3 border-l-2 border-line-strong pl-2.5 text-sm text-ink-600">
        <span className="font-medium text-ink-900">Seller says: </span>
        {!answered
          ? 'nothing about its condition'
          : problems || 'everything is good'}
      </p>
    </Panel>
  );
}

function SellerPanel({ buyback }) {
  const { revealId } = usePreownedMutations();
  const [showPhoto, setShowPhoto] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const revealed = revealId.data;

  return (
    <Panel
      title="The seller"
      icon={User}
      action={
        buyback.customer.id && (
          <Link to={`/admin/clients/${buyback.customer.id}`} className="text-sm font-semibold text-brand hover:text-brand-700">
            Profile
          </Link>
        )
      }
    >
      <p className="font-display text-md font-bold text-ink-900">{buyback.customer.name}</p>
      <dl className="mt-2 divide-y divide-line">
        {buyback.customer.phone && <Fact label="Phone">{buyback.customer.phone}</Fact>}
        {buyback.customer.email && <Fact label="Email">{buyback.customer.email}</Fact>}
        <Fact label={buyback.identity.idTypeLabel ?? 'Photo ID'}>
          <span className="tnum font-mono">{revealed?.number ?? buyback.identity.masked ?? 'None on file'}</span>
        </Fact>
        {buyback.declaredOwnerAt && <Fact label="Declared it is theirs">{dateTime(buyback.declaredOwnerAt)}</Fact>}
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        {buyback.identity.masked && !revealed && (
          <Button
            size="xs"
            variant="outline"
            icon={IdCard}
            loading={revealId.isPending}
            onClick={() => revealId.mutate(buyback.id)}
          >
            Show full ID number
          </Button>
        )}
        {buyback.identity.hasPhoto && !showPhoto && (
          <Button size="xs" variant="outline" icon={Camera} onClick={() => setShowPhoto(true)}>
            Show photo
          </Button>
        )}
      </div>
      {revealId.error && <p className="mt-2 text-sm text-danger">{revealId.error.message}</p>}
      <p className="mt-2 text-xs text-ink-400">Showing either is recorded in the security log.</p>

      {showPhoto &&
        (photoFailed ? (
          <p className="mt-3 text-sm text-ink-500">The photo could not be loaded.</p>
        ) : (
          <img
            src={apiUrl(`/admin/buybacks/${buyback.id}/photo`)}
            alt={`${buyback.customer.name}, taken at the kiosk`}
            width={320}
            height={320}
            onError={() => setPhotoFailed(true)}
            className="mt-3 aspect-square w-full max-w-xs rounded-md border border-line object-cover"
          />
        ))}
    </Panel>
  );
}

/**
 * Price it, pay the seller, and put it in stock.
 *
 * Money moves (the seller is paid, maybe in store credit), so the form is
 * followed by one confirmation that states the amount and the method: the form
 * plus the dialog is the two steps a money-moving write takes (§3.0.1).
 */
function ReviewForm({ buyback, payoutMethods }) {
  const { accept } = usePreownedMutations();
  // The Phones type's grades (Settings › Taxonomy): the phone joins the
  // product for its grade, so the grade is one of the type's own.
  const { data: categories = [] } = useAdminCatalogCategories();
  const gradeOptions = (categories.find((entry) => entry.slug === 'phones')?.grades ?? PHONE_GRADES).map((grade) => ({
    value: grade.value,
    label: grade.label,
  }));
  const [pending, setPending] = useState(null);
  const [declining, setDeclining] = useState(false);

  const { register, control, handleSubmit, formState: { errors } } = useAdminForm({
    resolver: zodResolver(buybackAcceptSchema),
    defaultValues: {
      purchasePriceDollars: '',
      sellingPriceDollars: '',
      payoutMethod: '',
      payoutReference: '',
      grade: 'GOOD',
      condition: Object.fromEntries(
        CONDITION_PARTS.map((part) => [part.key, buyback.customerCondition[part.key] ?? '']),
      ),
      description: '',
      notes: '',
      list: false,
    },
  });

  const methodLabel = (code) => payoutMethods.find((method) => method.code === code)?.label ?? code;

  function confirmed() {
    const body = { ...pending };
    // An unchecked component is left out, not recorded as a grade.
    body.condition = Object.fromEntries(
      Object.entries(body.condition ?? {}).filter(([, grade]) => grade),
    );
    accept.mutate({ id: buyback.id, ...body }, { onSuccess: () => setPending(null), onError: () => {} });
  }

  return (
    <Panel title="Price and buy it" description="Agree the price with the seller, pay them, then record it here.">
      <form onSubmit={handleSubmit(setPending)} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="We paid"
            required
            inputMode="decimal"
            suffix="CAD"
            placeholder="180.00"
            error={errors.purchasePriceDollars?.message}
            {...register('purchasePriceDollars')}
          />
          <Input
            label="We will sell it for"
            required
            inputMode="decimal"
            suffix="CAD"
            placeholder="349.00"
            error={errors.sellingPriceDollars?.message}
            {...register('sellingPriceDollars')}
          />
          <SelectField
            control={control}
            name="payoutMethod"
            label="Paid by"
            required
            placeholder="Choose how"
            options={payoutMethods.map((method) => ({ value: method.code, label: method.label }))}
            error={errors.payoutMethod?.message}
          />
          <Input
            label="Reference"
            placeholder="e-Transfer ref, cheque no."
            hint="Optional."
            {...register('payoutReference')}
          />
        </div>

        <SelectField control={control} name="grade" label="Grade" options={gradeOptions} />

        <div>
          <p className="eyebrow mb-2 text-ink-400">Condition, as we tested it</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {CONDITION_PARTS.map((part) => (
              <SelectField
                key={part.key}
                control={control}
                name={`condition.${part.key}`}
                label={part.label}
                options={gradeOptions(part)}
              />
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-400">Starts from what the seller said. Change what you found.</p>
        </div>

        <Textarea
          rows={2}
          label="What the website says"
          placeholder="Light scratches on the back. Battery health 89%."
          {...register('description')}
        />
        <Textarea rows={2} label="Internal notes" placeholder="Anything the next person should know." {...register('notes')} />

        <Controller
          name="list"
          control={control}
          render={({ field }) => (
            <Checkbox
              label="Put it on the website now"
              checked={Boolean(field.value)}
              onChange={(event) => field.onChange(event.target.checked)}
            />
          )}
        />

        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
          <Button variant="outline" icon={XCircle} onClick={() => setDeclining(true)}>
            Decline
          </Button>
          <Button type="submit">Buy it</Button>
        </div>
      </form>

      <ConfirmDialog
        open={Boolean(pending)}
        onClose={accept.isPending ? () => {} : () => setPending(null)}
        onConfirm={confirmed}
        loading={accept.isPending}
        error={accept.error?.message}
        tone="warn"
        title={
          pending
            ? `Buy ${buyback.device.title} from ${buyback.customer.name} for ${money(Math.round(Number(pending.purchasePriceDollars) * 100))}?`
            : ''
        }
        body={
          pending
            ? pending.payoutMethod === 'store-credit'
              ? `${money(Math.round(Number(pending.purchasePriceDollars) * 100))} is added to ${buyback.customer.name}'s store credit now, and the phone goes into stock.`
              : `Recorded as paid by ${methodLabel(pending.payoutMethod)}. Hand the money over before confirming. The phone goes into stock${pending.list ? ' and on the website' : ''}.`
            : ''
        }
        confirmLabel="Buy it"
      />

      <DeclineModal buyback={buyback} open={declining} onClose={() => setDeclining(false)} />
    </Panel>
  );
}

function DeclineModal({ buyback, open, onClose }) {
  const { decline } = usePreownedMutations();
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setError(null);
    try {
      await decline.mutateAsync({ id: buyback.id, reason });
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal open={open} onClose={decline.isPending ? () => {} : onClose} title={`Decline ${buyback.number}`} size="sm">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-600">
          The phone goes back to {buyback.customer.name}. Nothing is paid and nothing goes into stock.
        </p>
        <Textarea
          label="Why"
          required
          rows={3}
          placeholder="Activation lock is on; the seller could not remove it."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={error}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Keep it waiting
          </Button>
          <Button type="submit" variant="danger" loading={decline.isPending} disabled={reason.trim().length < 3}>
            Decline
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function OutcomePanel({ buyback }) {
  const { review } = buyback;
  if (buyback.status === 'declined') {
    return (
      <Panel title="Declined" icon={XCircle}>
        <p className="text-sm text-ink-700">{review.declineReason}</p>
        <p className="mt-2 text-xs text-ink-400">
          {review.reviewedBy?.name ? `${review.reviewedBy.name} · ` : ''}
          {date(review.reviewedAt)}
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="Bought" icon={Eye}>
      <dl className="divide-y divide-line">
        <Fact label="We paid">
          <span className="tnum font-semibold">{money(review.purchasePriceCents)}</span>
        </Fact>
        <Fact label="Paid by">
          {review.payoutMethodLabel}
          {review.payoutReference ? ` · ${review.payoutReference}` : ''}
        </Fact>
        <Fact label="Selling for">
          <span className="tnum">{money(review.sellingPriceCents)}</span>
        </Fact>
        <Fact label="Priced by">
          {review.reviewedBy?.name ?? '–'} · {date(review.reviewedAt)}
        </Fact>
      </dl>
      {review.notes && <p className="mt-3 text-sm text-ink-600">{review.notes}</p>}
      {buyback.productId && (
        <Link to={`/admin/inventory/${buyback.productId}`} className="mt-3 inline-block text-sm font-semibold text-brand hover:text-brand-700">
          See its product in Inventory
        </Link>
      )}
    </Panel>
  );
}

export function AdminBuybackDetailPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useBuybackRequest(id);
  const buyback = data?.buyback;
  useSetRecordLabel(buyback?.number);

  if (isLoading) {
    return (
      <div className="record-page space-y-4">
        <Skeleton className="h-12 w-72" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (error || !buyback) {
    return <p className="text-sm text-ink-500">{error?.message ?? 'That request was not found.'}</p>;
  }

  return (
    <div className="record-page">
      <PageHeader
        icon={PAGE_ICON}
        title={buyback.number}
        description={`${buyback.device.title} · handed in ${date(buyback.createdAt)}`}
        badge={
          <Badge tone={TONES[buyback.status]} size="sm">
            {LABELS[buyback.status]}
          </Badge>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        <div className="space-y-4">
          <PhonePanel buyback={buyback} />
          <SellerPanel buyback={buyback} />
        </div>
        {buyback.status === 'pending' ? (
          <ReviewForm buyback={buyback} payoutMethods={data.payoutMethods} />
        ) : (
          <OutcomePanel buyback={buyback} />
        )}
      </div>
    </div>
  );
}

export default AdminBuybackDetailPage;
