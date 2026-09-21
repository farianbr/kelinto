import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowLeft, Banknote, CreditCard, Lock, Package, ShieldCheck, Truck, WalletCards } from 'lucide-react';
import cn from '@/lib/cn';
import api from '@/lib/api';
import { money } from '@/lib/format';
import {
  CHECKOUT_STEPS,
  DELIVERY_METHODS,
  PROVINCES,
  TAX_RATE,
  checkoutSchema,
} from '@shared/schemas/checkout';
import Input from '@/components/ui/Input';
import PhoneField from '@/components/ui/PhoneField';
import SelectField from '@/components/ui/SelectField';
import Button from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import StepSection from '@/components/checkout/StepSection';
import { PartVisual } from '@/components/product/PartFrame';
import PromoCodeField from '@/components/cart/PromoCodeField';
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import { pressable } from '@/lib/motion';

const STEP_FIELDS = {
  contact: ['email'],
  shipping: [
    'shippingAddress.contactName',
    'shippingAddress.line1',
    'shippingAddress.city',
    'shippingAddress.region',
    'shippingAddress.postal',
    'shippingAddress.phone',
  ],
  delivery: ['deliveryMethod'],
  payment: ['paymentMethod'],
  review: [],
};

/** Builds the form's values from the signed-in account, tolerating a null user. */
function buildDefaults(user) {
  const address =
    user?.addresses?.find((entry) => entry.isDefaultShipping) ?? user?.addresses?.[0] ?? null;

  return {
    email: user?.email ?? '',
    shippingAddress: {
      contactName: address?.contactName ?? user?.contactName ?? '',
      company: address?.company ?? user?.businessName ?? '',
      line1: address?.line1 ?? '',
      line2: address?.line2 ?? '',
      city: address?.city ?? '',
      region: address?.region ?? 'ON',
      postal: address?.postal ?? '',
      country: 'Canada',
      phone: address?.phone ?? user?.phone ?? '',
    },
    billingSameAsShipping: true,
    deliveryMethod: 'ground',
    paymentMethod: user?.terms && user.terms !== 'prepaid' ? 'terms' : 'card',
    // Money the account already holds is spent before money it does not. A
    // buyer can turn it off, but making them opt IN to their own credit is a
    // dark pattern with a friendly face.
    useStoreCredit: true,
    // Smart field memory: last order's free-text values, offered back (brief §7).
    // `poNumber` is not among them any more - a PO is supplier paperwork, and
    // the customer checkout no longer collects one.
    deliveryNotes: user?.fieldMemory?.deliveryNotes ?? '',
  };
}

/**
 * Failures that end the checkout rather than being correctable in it.
 *
 * Every one of these happens after the form validated and before anything was
 * written - the charge runs first in `orderService.createOrder`, so the buyer's
 * cart is always intact when one of these lands.
 */
const ORDER_FAILURE_ROUTES = new Set([
  'PAYMENT_DECLINED',
  'INSUFFICIENT_STOCK',
  'NETWORK_ERROR',
]);

/**
 * Conversational single-page checkout (brief §7).
 *
 * One section expanded at a time; completed sections collapse to an editable
 * summary bar and NEVER lock - a buyer on Payment can reopen Contact, change it,
 * and land back on Payment. The whole thing is one form, so reopening a section
 * never discards what was typed further down.
 */
export function CheckoutPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, isApproved } = useAuth();
  const { items, bundles, count, subtotal, priceVisible, hasStockIssue, isReady } = useCart();

  const [activeStep, setActiveStep] = useState('contact');
  const [completed, setCompleted] = useState(new Set());
  const [submitError, setSubmitError] = useState(null);

  // Card fields. Deliberately NOT part of the react-hook-form values and never
  // put in the order payload: the gateway is a mock, the server takes no card
  // details, and the repo stores no PAN anywhere. They exist so the payment
  // step looks like a payment step - the notice at the foot of it says exactly
  // that, because a convincing form that is not real is only honest if it
  // admits it.
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [cardPostal, setCardPostal] = useState('');

  const form = useForm({
    resolver: zodResolver(checkoutSchema),
    /*
      Checked when the buyer presses Continue, not while they look around.

      Each step gates on an explicit `trigger(STEP_FIELDS[stepKey])` below, so
      nothing is skipped by waiting: the fields for the step are validated the
      moment the buyer tries to leave it. What waiting avoids is a form that
      calls a field wrong because the buyer clicked into it and back out while
      reading what it wanted. `reValidateMode` then clears each message as the
      field is fixed, rather than at the next press.
    */
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    defaultValues: buildDefaults(null),
  });

  const { register, watch, trigger, handleSubmit, formState, reset, setValue, control } = form;
  const values = watch();

  /**
   * Account-linked autofill (brief §7).
   *
   * This has to be a reset, not `defaultValues`: on a direct load of /checkout
   * the `/auth/me` request is still in flight during first render, so the
   * defaults would snapshot an empty user and the buyer would face a blank form.
   * Runs once, and only while the form is still pristine, so it can never
   * clobber something the buyer has typed.
   */
  const hydratedFromUser = useRef(false);
  useEffect(() => {
    if (!user || hydratedFromUser.current) return;
    if (formState.isDirty) return;
    hydratedFromUser.current = true;
    reset(buildDefaults(user));
  }, [user, reset, formState.isDirty]);

  // An approved buyer who lands here with an empty cart has nothing to do.
  // Wait for `isReady` - before the cart resolves, `items` is empty for a
  // reason that has nothing to do with the cart actually being empty.
  useEffect(() => {
    if (isReady && items.length === 0 && bundles.length === 0) navigate('/cart', { replace: true });
  }, [isReady, items.length, bundles.length, navigate]);

  /**
   * The binding price, from the server, re-fetched when the delivery method
   * changes.
   *
   * Recomputing it here would mean a second implementation of bundle pricing,
   * offer eligibility and the no-stacking rule - three things that must not be
   * allowed to disagree with what is actually charged. The quote is the price.
   */
  const { data: quoted } = useQuery({
    queryKey: ['orders', 'quote', values.deliveryMethod],
    queryFn: () => api.get('/orders/quote', { deliveryMethod: values.deliveryMethod }),
    enabled: isApproved && isReady && (items.length > 0 || bundles.length > 0),
    placeholderData: (previous) => previous,
    staleTime: 0,
  });

  /**
   * The delivery bands, priced by the server against this cart.
   *
   * Shipping rates are editable in Settings (§6.15), so `DELIVERY_METHODS` is
   * no longer where the money lives - it still defines which codes exist, and
   * stands in only for the first paint before the quote arrives. Rendering the
   * constant's costs after that would put a stale price beside a correct total.
   */
  const deliveryOptions =
    quoted?.deliveryOptions ??
    DELIVERY_METHODS.map((option) => ({
      ...option,
      cost: option.freeOver && subtotal >= option.freeOver ? 0 : option.cost,
    }));

  const method =
    deliveryOptions.find((m) => m.code === values.deliveryMethod) ?? deliveryOptions[0];

  const shipping = quoted?.shipping ?? method.cost;
  const discount = quoted?.discount ?? 0;
  const bundleDiscount = quoted?.bundleDiscount ?? 0;
  const promoDiscount = quoted?.promoDiscount ?? 0;
  const promo = quoted?.promo ?? null;
  const tax = quoted?.tax ?? (subtotal !== null ? Math.round((subtotal + shipping) * TAX_RATE) : 0);
  const total = quoted?.total ?? (subtotal !== null ? subtotal + shipping + tax : 0);

  // What the server says this account holds, and what it would put against this
  // total. The applied figure is a preview: `createOrder` recomputes it from
  // the live balance, so a top-up in another tab cannot double-spend.
  const storeCreditBalance = quoted?.storeCredit?.balance ?? 0;

  // Held credit is drawn on before the line of credit is: on account, it always
  // applies and the checkbox says so rather than pretending to be a choice. The
  // server enforces the same order - see orderService.createOrder.
  const creditLocked = values.paymentMethod === 'terms' && storeCreditBalance > 0;
  const storeCreditApplied =
    creditLocked || values.useStoreCredit ? (quoted?.storeCredit?.applicable ?? 0) : 0;
  const dueNow = Math.max(0, total - storeCreditApplied);

  // Keep the submitted flag honest while the box is locked, so a buyer who
  // unticked it against a card and then switched to terms still sends `true`.
  useEffect(() => {
    if (creditLocked && !values.useStoreCredit) setValue('useStoreCredit', true);
  }, [creditLocked, values.useStoreCredit, setValue]);

  async function advance(stepKey) {
    const valid = await trigger(STEP_FIELDS[stepKey]);
    if (!valid) return;

    setCompleted((previous) => new Set(previous).add(stepKey));

    const index = CHECKOUT_STEPS.findIndex((step) => step.key === stepKey);
    const next = CHECKOUT_STEPS.slice(index + 1).find((step) => !completed.has(step.key));
    // If everything below is already done, drop straight back to Review - that
    // is what makes an out-of-order edit feel like a detour, not a restart.
    setActiveStep(next?.key ?? 'review');
  }

  const placeOrder = useMutation({
    mutationFn: (payload) => api.post('/orders', payload),
    onSuccess: ({ order }) => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      // The order may have spent held credit.
      queryClient.invalidateQueries({ queryKey: ['store-credit'] });
      queryClient.invalidateQueries({ queryKey: ['account', 'summary'] });
      navigate(`/thank-you/${order.orderNumber}`, { replace: true });
    },
    onError: (error) => {
      // A refused charge, a stock move or an unreachable server are not things
      // this form can fix, and a red line under the Place Order button is the
      // wrong size of response to "your card was declined". Those get the
      // dedicated page; anything the buyer can correct here stays here.
      if (ORDER_FAILURE_ROUTES.has(error.code)) {
        // `replace` so the back button returns to the cart, not to a checkout
        // that would immediately re-submit.
        navigate('/payment-failed', {
          replace: true,
          state: { code: error.code, message: error.message },
        });
        return;
      }
      setSubmitError(error.message);
    },
  });

  function stepState(key) {
    if (activeStep === key) return 'active';
    if (completed.has(key)) return 'completed';
    return 'upcoming';
  }

  const summaries = {
    contact: values.email,
    shipping: [
      values.shippingAddress?.line1,
      values.shippingAddress?.city,
      values.shippingAddress?.region,
      values.shippingAddress?.postal,
    ]
      .filter(Boolean)
      .join(', '),
    delivery: `${method.label} - ${method.detail}${shipping === 0 ? ' · Free' : ` · ${money(shipping)}`}`,
    payment: (() => {
      const base =
        values.paymentMethod === 'terms'
          ? `On account - ${(user?.terms ?? 'net30').replace('net', 'Net ')}`
          : 'Card ending 4242';
      if (storeCreditApplied <= 0) return base;
      return dueNow === 0
        ? `Store credit - ${money(storeCreditApplied)}`
        : `${base} · ${money(storeCreditApplied)} store credit`;
    })(),
    review: null,
  };

  if (!isApproved) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-20 text-center">
        <span className="mb-5 flex size-14 items-center justify-center rounded-full bg-warn-50 text-warn">
          <Lock className="size-7" strokeWidth={1.5} />
        </span>
        <h1 className="text-2xl">Checkout is not open yet</h1>
        <p className="mt-3 text-md leading-relaxed text-ink-500">
          Ordering unlocks once our team has verified your business. Your cart is saved.
        </p>
        <Link
          to="/cart"
          className="mt-7 inline-flex items-center gap-2 text-md font-semibold text-brand hover:text-brand-700"
        >
          <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
          Back to cart
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] px-3 py-6 sm:px-4 lg:px-6 lg:py-8">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl sm:text-3xl">Checkout</h1>
        <Link
          to="/cart"
          className={cn(pressable, 'inline-flex items-center gap-1.5 text-md font-semibold text-brand hover:text-brand-700')}
        >
          <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
          Back to cart
        </Link>
      </div>

      <form onSubmit={handleSubmit((data) => placeOrder.mutate(data))}>
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_330px] lg:items-start lg:gap-6">
          <div className="min-w-0">
            {/* ---- 1. contact ------------------------------------------- */}
            <StepSection
              index={1}
              label="Contact"
              state={stepState('contact')}
              summary={summaries.contact}
              onEdit={() => setActiveStep('contact')}
            >
              <Input
                label="Order confirmation email"
                type="email"
                autoComplete="email"
                error={formState.errors.email?.message}
                hint="We send the order confirmation and tracking here."
                {...register('email')}
              />
              <Button className="mt-4" onClick={() => advance('contact')}>
                Continue to shipping
              </Button>
            </StepSection>

            {/* ---- 2. shipping ------------------------------------------ */}
            <StepSection
              index={2}
              label="Shipping address"
              state={stepState('shipping')}
              summary={summaries.shipping}
              onEdit={() => setActiveStep('shipping')}
            >
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Contact name"
                    autoComplete="name"
                    error={formState.errors.shippingAddress?.contactName?.message}
                    {...register('shippingAddress.contactName')}
                  />
                  <Input
                    label="Company"
                    autoComplete="organization"
                    {...register('shippingAddress.company')}
                  />
                </div>

                <Input
                  label="Street address"
                  autoComplete="address-line1"
                  error={formState.errors.shippingAddress?.line1?.message}
                  {...register('shippingAddress.line1')}
                />
                <Input
                  label="Unit / suite"
                  autoComplete="address-line2"
                  {...register('shippingAddress.line2')}
                />

                <div className="grid gap-4 sm:grid-cols-3">
                  <Input
                    label="City"
                    autoComplete="address-level2"
                    error={formState.errors.shippingAddress?.city?.message}
                    {...register('shippingAddress.city')}
                  />
                  <SelectField
                    control={control}
                    name="shippingAddress.region"
                    label="Province"
                    options={PROVINCES}
                  />
                  <Input
                    label="Postal code"
                    autoComplete="postal-code"
                    placeholder="M5V 2R7"
                    error={formState.errors.shippingAddress?.postal?.message}
                    {...register('shippingAddress.postal')}
                  />
                </div>

                <Controller
                  name="shippingAddress.phone"
                  control={control}
                  render={({ field }) => (
                    <PhoneField
                      label="Phone"
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      error={formState.errors.shippingAddress?.phone?.message}
                    />
                  )}
                />

                <Checkbox
                  label="Billing address is the same as shipping"
                  className="-ml-2"
                  {...register('billingSameAsShipping')}
                />
              </div>

              <Button className="mt-4" onClick={() => advance('shipping')}>
                Continue to delivery
              </Button>
            </StepSection>

            {/* ---- 3. delivery ------------------------------------------ */}
            <StepSection
              index={3}
              label="Delivery method"
              state={stepState('delivery')}
              summary={summaries.delivery}
              onEdit={() => setActiveStep('delivery')}
            >
              <fieldset className="space-y-2">
                <legend className="sr-only">Delivery method</legend>
                {deliveryOptions.map((option) => {
                  const cost = option.cost;
                  const isSelected = values.deliveryMethod === option.code;

                  return (
                    <label
                      key={option.code}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-md border p-3.5 transition-[border-color,background]',
                        isSelected
                          ? 'border-brand bg-brand-50'
                          : 'border-line hover:border-line-strong hover:bg-surface-2',
                      )}
                    >
                      <input
                        type="radio"
                        value={option.code}
                        className="size-4 accent-[var(--color-brand)]"
                        {...register('deliveryMethod')}
                      />
                      <Truck
                        className={cn('size-5 shrink-0', isSelected ? 'text-brand' : 'text-ink-400')}
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-display text-md font-semibold text-ink-900">
                          {option.label}
                        </span>
                        <span className="block text-sm text-ink-500">{option.detail}</span>
                      </span>
                      <span className="tnum shrink-0 font-display text-md font-bold text-ink-900">
                        {cost === 0 ? 'Free' : money(cost)}
                      </span>
                    </label>
                  );
                })}
              </fieldset>

              <Input
                label="Delivery notes"
                containerClassName="mt-4"
                hint={
                  user?.fieldMemory?.deliveryNotes
                    ? 'Pre-filled from your last order - edit or clear it.'
                    : 'Loading dock, buzzer code, receiving hours…'
                }
                {...register('deliveryNotes')}
              />

              <Button className="mt-4" onClick={() => advance('delivery')}>
                Continue to payment
              </Button>
            </StepSection>

            {/* ---- 4. payment ------------------------------------------- */}
            <StepSection
              index={4}
              label="Payment"
              state={stepState('payment')}
              summary={summaries.payment}
              onEdit={() => setActiveStep('payment')}
            >
              {/* Store credit sits above the methods because that is the order
                  the money moves in: held credit settles first, and what is
                  left over is what the method below is asked for. */}
              {storeCreditBalance > 0 && (
                <label
                  className={cn(
                    'mb-4 flex items-start gap-3 rounded-md border p-3.5 transition-[border-color,background]',
                    creditLocked || values.useStoreCredit
                      ? 'border-brand bg-brand-50'
                      : 'cursor-pointer border-line hover:border-line-strong hover:bg-surface-2',
                    creditLocked ? 'cursor-default' : 'cursor-pointer',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-[var(--color-brand)]"
                    disabled={creditLocked}
                    {...register('useStoreCredit')}
                  />
                  <WalletCards className="mt-0.5 size-5 shrink-0 text-ink-400" strokeWidth={1.5} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-md font-semibold text-ink-900">
                      Store credit{creditLocked ? ' - applied first' : ''}
                    </span>
                    <span className="tnum block text-sm text-ink-500">
                      {money(storeCreditBalance)} available
                      {storeCreditApplied > 0 ? ` · ${money(storeCreditApplied)} on this order` : ''}
                    </span>
                    {creditLocked && (
                      <span className="mt-1 block text-xs leading-relaxed text-ink-400">
                        Credit you already hold with us is used before your account terms are drawn
                        on. Only {money(dueNow)} goes on account.
                      </span>
                    )}
                  </span>
                </label>
              )}

              <fieldset className="space-y-2">
                <legend className="sr-only">
                  {storeCreditBalance > 0 ? 'How to settle the rest' : 'Payment method'}
                </legend>

                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-md border p-3.5 transition-[border-color,background]',
                    values.paymentMethod === 'card'
                      ? 'border-brand bg-brand-50'
                      : 'border-line hover:border-line-strong hover:bg-surface-2',
                  )}
                >
                  <input
                    type="radio"
                    value="card"
                    className="size-4 accent-[var(--color-brand)]"
                    {...register('paymentMethod')}
                  />
                  <CreditCard className="size-5 shrink-0 text-ink-400" strokeWidth={1.5} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-md font-semibold text-ink-900">
                      Pay by card
                    </span>
                    {/* Was "Visa ending 4242" - a specific card this account
                        does not have. The test card belongs in the notice at
                        the foot of the step, not on a row claiming to describe
                        the buyer's own saved payment method. */}
                    <span className="block text-sm text-ink-500">
                      Charged when you place the order
                    </span>
                  </span>
                </label>

                {/* The card fields appear under the option that needs them,
                    rather than in a dialog: checkout is already a stepped form
                    and a modal on top of step four is a second layer over a
                    flow that does not need one. Same facade as the payment
                    sheet everywhere else - nothing typed here is sent, and the
                    notice below says so. */}
                {values.paymentMethod === 'card' && dueNow > 0 && (
                  <div className="overflow-hidden rounded-md border border-line-strong bg-surface focus-within:border-brand">
                    <input
                      aria-label="Card number"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="4242 4242 4242 4242"
                      value={cardNumber}
                      onChange={(event) =>
                        setCardNumber(
                          event.target.value
                            .replace(/\D/g, '')
                            .slice(0, 16)
                            .replace(/(.{4})/g, '$1 ')
                            .trim(),
                        )
                      }
                      className="h-11 w-full bg-transparent px-3 text-md text-ink-900 outline-none placeholder:text-ink-300"
                    />
                    <div className="grid grid-cols-3 border-t border-line">
                      <input
                        aria-label="Expiry date"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="MM / YY"
                        value={cardExpiry}
                        onChange={(event) => {
                          const digits = event.target.value.replace(/\D/g, '').slice(0, 4);
                          setCardExpiry(
                            digits.length <= 2 ? digits : `${digits.slice(0, 2)}/${digits.slice(2)}`,
                          );
                        }}
                        className="h-11 w-full bg-transparent px-3 text-md text-ink-900 outline-none placeholder:text-ink-300"
                      />
                      <input
                        aria-label="Security code"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="CVC"
                        value={cardCvc}
                        onChange={(event) =>
                          setCardCvc(event.target.value.replace(/\D/g, '').slice(0, 4))
                        }
                        className="h-11 w-full border-l border-line bg-transparent px-3 text-md text-ink-900 outline-none placeholder:text-ink-300"
                      />
                      <input
                        aria-label="Postal code"
                        autoComplete="off"
                        placeholder="A1A 1A1"
                        value={cardPostal}
                        onChange={(event) =>
                          setCardPostal(event.target.value.toUpperCase().slice(0, 7))
                        }
                        className="h-11 w-full border-l border-line bg-transparent px-3 text-md text-ink-900 outline-none placeholder:text-ink-300"
                      />
                    </div>
                  </div>
                )}

                {user?.terms && user.terms !== 'prepaid' && (
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-md border p-3.5 transition-[border-color,background]',
                      values.paymentMethod === 'terms'
                        ? 'border-brand bg-brand-50'
                        : 'border-line hover:border-line-strong hover:bg-surface-2',
                    )}
                  >
                    <input
                      type="radio"
                      value="terms"
                      className="size-4 accent-[var(--color-brand)]"
                      {...register('paymentMethod')}
                    />
                    <Banknote className="size-5 shrink-0 text-ink-400" strokeWidth={1.5} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-md font-semibold text-ink-900">
                        On account - {user.terms.replace('net', 'Net ')}
                      </span>
                      <span className="tnum block text-sm text-ink-500">
                        {money(Math.max(0, (user.creditLimit ?? 0) - (user.balance ?? 0)))} credit
                        available
                      </span>
                    </span>
                  </label>
                )}
              </fieldset>

              {/* The PO number field is gone. A purchase order is a document a
                  BUYER raises against a SUPPLIER - it belongs to Cellvix's own
                  purchasing side, where AdminPurchaseOrders already owns it, and
                  asking a customer for one put a supplier's paperwork on a
                  retail checkout. */}
              <p className="mt-4 rounded-md bg-surface-2 px-3 py-2.5 text-sm leading-relaxed text-ink-500">
                Payments run against a test gateway in this build - no card details are sent or
                stored, and no card is charged. Delivery notes starting{' '}
                <span className="font-semibold text-ink-700">DECLINE</span> show the failed-payment
                path.
              </p>

              <Button className="mt-4" onClick={() => advance('payment')}>
                Review order
              </Button>
            </StepSection>

            {/* ---- 5. review -------------------------------------------- */}
            <StepSection
              index={5}
              label="Review & place order"
              state={stepState('review')}
              onEdit={() => setActiveStep('review')}
              isLast
            >
              <ul className="divide-y divide-line rounded-md border border-line">
                {/* Bundles are one line here too - reviewing an order should show
                    the same shape as the cart it came from. */}
                {bundles.map((bundle) => (
                  <li key={bundle.offerId} className="flex items-center gap-3 p-3">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-brand-gradient text-white">
                      <Package className="size-5" strokeWidth={1.5} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-md font-medium text-ink-900">
                        {bundle.title}
                      </span>
                      <span className="block text-2xs text-ink-300">
                        {bundle.products.length} parts · ×{bundle.qty}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-right">
                      <span className="block font-display text-md font-bold">
                        {money(bundle.lineTotal)}
                      </span>
                      {bundle.savings > 0 && (
                        <span className="block text-2xs text-ok">−{money(bundle.savings)}</span>
                      )}
                    </span>
                  </li>
                ))}
                {items.map((item) => (
                  <li key={item.productId} className="flex items-center gap-3 p-3">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 p-1.5">
                      <PartVisual product={item} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-md font-medium text-ink-900">
                        {item.name}
                      </span>
                      <span className="tnum block font-mono text-2xs text-ink-300">
                        {item.sku} · ×{item.qty}
                      </span>
                    </span>
                    <span className="tnum shrink-0 font-display text-md font-bold">
                      {money(item.lineTotal ?? item.unitPrice * item.qty)}
                    </span>
                  </li>
                ))}
              </ul>

              {submitError && (
                <p className="mt-4 flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                  {submitError}
                </p>
              )}

              {hasStockIssue && (
                <p className="mt-4 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
                  One or more lines exceed available stock.{' '}
                  <Link to="/cart" className="font-semibold underline">
                    Adjust your cart
                  </Link>{' '}
                  to continue.
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                fullWidth
                className="mt-4"
                loading={placeOrder.isPending}
                disabled={hasStockIssue}
              >
                Place order · {money(dueNow)}
              </Button>

              <p className="mt-3 flex items-start justify-center gap-2 text-xs text-ink-400">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                Every section above stays editable until you place the order.
              </p>
            </StepSection>
          </div>

          {/* ---- running total -------------------------------------------- */}
          <aside className="mt-4 lg:sticky lg:top-[calc(var(--chrome-h,158px)+16px)] lg:mt-0">
            <div className="rounded-lg border border-line bg-surface p-5">
              <h2 className="mb-4 font-display text-lg font-bold">
                Order summary
                <span className="tnum ml-2 text-sm font-medium text-ink-400">
                  {count} {count === 1 ? 'item' : 'items'}
                </span>
              </h2>

              {priceVisible && (
                <dl className="space-y-2.5 text-md">
                  <div className="flex justify-between">
                    <dt className="text-ink-500">Subtotal</dt>
                    <dd className="tnum font-medium text-ink-900">{money(subtotal)}</dd>
                  </div>

                  {bundleDiscount > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-ok">Bundle pricing</dt>
                      <dd className="tnum font-medium text-ok">−{money(bundleDiscount)}</dd>
                    </div>
                  )}
                  {promoDiscount > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-ok">
                        {promo?.code ? (
                          <span className="font-mono text-sm">{promo.code}</span>
                        ) : (
                          'Offer'
                        )}
                      </dt>
                      <dd className="tnum font-medium text-ok">−{money(promoDiscount)}</dd>
                    </div>
                  )}

                  <div className="flex justify-between">
                    <dt className="text-ink-500">{method.label}</dt>
                    <dd className={cn('tnum font-medium', shipping === 0 ? 'text-ok' : 'text-ink-900')}>
                      {shipping === 0 ? 'Free' : money(shipping)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-ink-500">HST (13%)</dt>
                    <dd className="tnum font-medium text-ink-900">{money(tax)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between border-t border-line pt-3">
                    <dt className="font-display text-md font-bold text-ink-900">Total</dt>
                    <dd className="tnum font-display text-2xl font-bold text-ink-900">
                      {money(total)}
                    </dd>
                  </div>

                  {storeCreditApplied > 0 && (
                    <>
                      <div className="flex justify-between">
                        <dt className="text-ok">Store credit</dt>
                        <dd className="tnum font-medium text-ok">−{money(storeCreditApplied)}</dd>
                      </div>
                      <div className="flex items-baseline justify-between">
                        <dt className="font-display text-sm font-bold text-ink-900">Due now</dt>
                        <dd className="tnum font-display text-lg font-bold text-ink-900">
                          {money(dueNow)}
                        </dd>
                      </div>
                    </>
                  )}
                </dl>
              )}

              {priceVisible && <PromoCodeField className="mt-4 border-t border-line pt-4" />}
            </div>
          </aside>
        </div>
      </form>
    </div>
  );
}

export default CheckoutPage;
