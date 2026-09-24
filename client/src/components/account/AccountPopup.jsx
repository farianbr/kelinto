import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Clock,
  Mail,
  MapPin,
  PackageSearch,
  Phone,
  ShieldCheck,
  ShoppingBag,
  UserRound,
  X,
} from 'lucide-react';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import api from '@/lib/api';
import useBusinessInfo from '@/hooks/useBusinessInfo';
import { COUNTRY_OPTIONS, DEFAULT_COUNTRY } from '@shared/countries';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import FormSection from '@/components/ui/FormSection';
import Button from '@/components/ui/Button';
import Checkbox from '@/components/ui/Checkbox';
import PhoneField from '@/components/ui/PhoneField';
import SelectField from '@/components/ui/SelectField';
import ConsentChannels, { EMPTY_CONSENT } from '@/components/ui/ConsentChannels';
import useUiStore from '@/store/uiStore';
import { useAuth } from '@/hooks/useAuth';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  supplierApplicationSchema,
} from '@shared/schemas/auth';

const TABS = [
  { key: 'signin', label: 'Sign In' },
  { key: 'signup', label: 'Sign Up' },
  { key: 'contact', label: 'Contact' },
];

/**
 * Value proposition panel beside the forms - the "side visual panel" of §8.1.
 *
 * The three blocks are spread down the panel rather than pushed to its two
 * ends. `justify-between` on a heading and a list left a hole in the middle
 * whose size was whatever the dialog's fixed height happened to leave over
 * on a tall viewport it was most of the panel. The figures in the middle are
 * what fills it: they are the answer to "why this supplier", which a list of
 * feature lines states but does not evidence.
 */
function SidePanel() {
  const STATS = [
    { value: '400+', label: 'SKUs in stock' },
    { value: '24h', label: 'Typical approval' },
    { value: 'Net 60', label: 'Payment terms' },
  ];

  // No `h-full`: the panel is sized by its own content so it looks the same on
  // every tab, and the frame's leftover height shows as dialog below it rather
  // than as a taller red block.
  return (
    // The brand panel - the dialog's one editorial block, in the gradient.
    //
    // This is the first surface a business sees before it has an account, so it
    // is the place the brand should be loudest.
    //
    // The PANEL ramp, not the standard one. White needs 4.5:1 as body copy and
    // the standard ramp ends at #e8564a, where white manages 3.58 - fine on a
    // button whose label is bold and short, not fine on a tall block of
    // paragraphs. This ramp stops at #9d251d, where white clears 7.7:1 and even
    // white/70 clears 4.5, so the secondary lines can still fade.
    //
    // The submit button beside it also carries the gradient. They are not
    // competing: the panel is a filled block and the button is a control inside
    // a white column, so their contexts separate them without needing different
    // treatments.
    <aside className="scroll-slim relative hidden max-h-full w-full overflow-y-auto rounded-lg bg-brand-gradient-panel p-6 text-white md:flex md:flex-col md:gap-6">
      <div>
        <p className="eyebrow mb-2 opacity-70">Cellvix wholesale portal</p>
        <h3 className="text-2xl leading-tight text-white">
          Wholesale pricing for verified repair businesses
        </h3>
        <p className="mt-3 text-md leading-relaxed text-white/75">
          Accounts are reviewed by our team before wholesale pricing unlocks. It usually takes one
          business day.
        </p>
      </div>

      {/* Hairlines above and below rather than a card: a filled box on the
          gradient would read as a second surface floating on the accent, and
          §2.2 keeps the gradient an accent rather than a background things sit
          on top of. */}
      <dl className="grid grid-cols-3 gap-3 border-y border-white/15 py-4">
        {STATS.map((stat) => (
          <div key={stat.label}>
            <dt className="sr-only">{stat.label}</dt>
            <dd>
              <span className="tnum block font-display text-xl font-bold leading-none text-white">
                {stat.value}
              </span>
              <span className="mt-1.5 block text-2xs leading-tight text-white/70">
                {stat.label}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      {/* Three lines, not four, and each one short enough to hold one line at
          this width. The panel no longer sits in a fixed-height frame, so its
          own content is what sets the dialog's height - a fourth wrapped bullet
          bought two more rows of red beside a five-field sign-in form and
          nothing else. */}
      <ul className="space-y-2.5 text-sm text-white/85">
        {[
          'Graded pulls, tested before dispatch',
          'Same-day dispatch from Ontario',
          'A real sales desk, not a ticket queue',
        ].map((line) => (
          <li key={line} className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 opacity-80" strokeWidth={2} aria-hidden="true" />
            {line}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * Requesting a reset link.
 *
 * **Always reports success**, whether or not the address is registered - the
 * endpoint answers 204 either way for the same reason, and a form that said
 * "no such account" would turn this into a way to ask which businesses buy
 * from Cellvix. So the confirmation is worded as what was done ("if that
 * address has an account, a link is on its way") rather than as a fact about
 * the address.
 */
function ForgotPasswordView({ onBack }) {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(forgotPasswordSchema) });

  async function onSubmit(values) {
    setFormError(null);
    try {
      await api.post('/auth/forgot-password', values);
      setSent(true);
    } catch (error) {
      setFormError(error.message);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-ok-50 text-ok">
          <Mail className="size-7" strokeWidth={1.5} />
        </span>
        <div>
          <h3 className="text-xl">Check your inbox</h3>
          <p className="mx-auto mt-2 max-w-sm text-md leading-relaxed text-ink-500">
            If <span className="font-medium text-ink-900">{getValues('email')}</span> has a Cellvix
            account, a reset link is on its way. It expires in an hour and can only be used once.
          </p>
        </div>
        <Button variant="outline" onClick={onBack}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <ChangeAccountType onBack={onBack} label="Back to sign in" />

      {formError && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {formError}
        </p>
      )}

      <div>
        <h3 className="text-lg">Reset your password</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
          Enter the address you sign in with and we will email you a link.
        </p>
      </div>

      <Input
        label="Email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@yourcompany.ca"
        error={errors.email?.message}
        data-autofocus
        {...register('email')}
      />

      <Button type="submit" fullWidth size="lg" loading={isSubmitting}>
        Send reset link
      </Button>
    </form>
  );
}

function SignInTab({ onDone }) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState(null);
  const [pendingNotice, setPendingNotice] = useState(false);
  const [forgot, setForgot] = useState(false);

  /**
   * One address, panel accounts at several businesses, and the password opened
   * more than one of them. The server answers with the businesses it opened -
   * only those - and the person picks. Held with the credentials that produced
   * it, so picking re-sends exactly what was typed rather than asking again.
   */
  const [choice, setChoice] = useState(null);
  const [choosing, setChoosing] = useState(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { remember: true } });

  async function onSubmit(values) {
    setFormError(null);
    setPendingNotice(false);
    try {
      const user = await signIn(values);
      // A pending account signs in successfully on purpose - we tell them where
      // they stand instead of failing the credentials (brief §8.2).
      if (user.status === 'pending') {
        setPendingNotice(true);
        return;
      }
      onDone?.();
      // Staff belong in the admin console, not the shop's buyer dashboard -
      // and a staff member found through the login directory has just signed
      // in to a different business from the storefront they are standing on.
      if (['admin', 'staff'].includes(user.role)) navigate('/admin');
    } catch (error) {
      if (error.code === 'BUSINESS_CHOICE_REQUIRED' && error.fields?.choices?.length) {
        setChoice({ values, choices: error.fields.choices });
        return;
      }
      setFormError(error.message);
    }
  }

  async function pick(business) {
    setChoosing(business.id);
    try {
      await onSubmit({ ...choice.values, business: business.id });
    } finally {
      setChoosing(null);
    }
  }

  if (forgot) return <ForgotPasswordView onBack={() => setForgot(false)} />;

  if (choice) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-xl">Which business are you signing in to?</h3>
          <p className="mt-2 text-md leading-relaxed text-ink-500">
            {choice.values.email} has an account at each of these. Pick one - you can sign out and
            choose the other later.
          </p>
        </div>

        {formError && (
          <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            {formError}
          </p>
        )}

        <ul className="space-y-2">
          {choice.choices.map((business) => (
            <li key={business.id}>
              <Button
                variant="outline"
                size="lg"
                fullWidth
                loading={choosing === business.id}
                disabled={Boolean(choosing) && choosing !== business.id}
                onClick={() => pick(business)}
              >
                {business.name}
              </Button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => {
            setChoice(null);
            setFormError(null);
          }}
          className={cn(pressable, 'rounded text-sm font-medium text-brand hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900/15')}
        >
          Use a different email
        </button>
      </div>
    );
  }

  if (pendingNotice) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-warn-50 text-warn">
          <Clock className="size-7" strokeWidth={1.5} />
        </span>
        <div>
          <h3 className="text-xl">Your account is still under review</h3>
          <p className="mx-auto mt-2 max-w-sm text-md leading-relaxed text-ink-500">
            You are signed in, but wholesale pricing and ordering stay locked until our team verifies
            your business. We will email you the moment it is approved - usually within one business
            day.
          </p>
        </div>
        <Button variant="outline" onClick={onDone}>
          Continue browsing
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {formError && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {formError}
        </p>
      )}

      <Input
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="you@yourbusiness.ca"
        error={errors.email?.message}
        data-autofocus
        {...register('email')}
      />

      <Input
        label="Password"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        error={errors.password?.message}
        {...register('password')}
      />

      <div className="flex items-center justify-between gap-3">
        <Checkbox label="Remember me" className="-ml-2" {...register('remember')} />
        <button
          type="button"
          onClick={() => setForgot(true)}
          className={cn(pressable, 'rounded text-sm font-medium text-brand hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900/15')}
        >
          Forgot password?
        </button>
      </div>

      <Button type="submit" fullWidth size="lg" loading={isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}

/**
 * The way back out of a view that replaced the whole tab.
 *
 * At the top, not beside the submit button at the bottom. Picking "I want to
 * buy parts" or "Forgot password?" swaps out the entire tab and left no visible
 * way back - the supplier form had a Back button, but it sat at the end of a
 * scrolling form next to Send application, which is not where anyone looks for
 * an escape from a choice they just made by accident.
 *
 * The label names its destination rather than saying "Back", so it reads the
 * same to a screen reader as it does on screen and needs no separate
 * `aria-label` to explain itself.
 */
function ChangeAccountType({ onBack, label = 'Change account type' }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className={cn(
        pressable,
        '-ml-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium',
        'text-ink-500 hover:bg-surface-2 hover:text-ink-900',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900/15',
      )}
    >
      <ArrowLeft className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
      {label}
    </button>
  );
}

/**
 * Which side of the transaction the visitor is on.
 *
 * Asked before anything else because the two paths have nothing in common: a
 * buyer gets an account, a password and an approval queue, while a supplier
 * gets an application the purchasing team reads and no login at all. Putting
 * both behind one form would mean a page of fields half of which do not apply,
 * and a "are you a supplier?" checkbox that silently changes what Create
 * account means.
 */
function AccountTypeChoice({ onPick }) {
  const OPTIONS = [
    {
      key: 'buyer',
      icon: ShoppingBag,
      title: 'I want to buy parts',
      body: 'Open a wholesale account. Wholesale pricing and ordering unlock once our team approves your business.',
      cta: 'Open a buying account',
    },
    {
      key: 'supplier',
      icon: Building2,
      title: 'I want to supply Cellvix',
      body: 'Tell us what you stock. Our purchasing team reviews every application and gets in touch to agree terms.',
      cta: 'Apply as a supplier',
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-md leading-relaxed text-ink-500">
        Which of these is you?
      </p>

      {OPTIONS.map(({ key, icon: Icon, title, body, cta }) => (
        <button
          key={key}
          type="button"
          onClick={() => onPick(key)}
          className={cn(pressable, 'group flex w-full items-start gap-3.5 rounded-lg border border-line bg-surface p-4 text-left hover:border-brand hover:bg-brand-50/40')}
        >
          {/* Brand tint on hover, not the gradient. The gradient runs to
              #000000 at one end, so a white glyph landed on near-black and read
              as an icon that disappears when you point at it. */}
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-500 transition-colors group-hover:bg-brand-50 group-hover:text-brand">
            <Icon className="size-4.5" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-md font-bold text-ink-900">{title}</span>
            <span className="mt-1 block text-sm leading-relaxed text-ink-500">{body}</span>
            <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand">
              {cta}
              <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * A business applying to sell to Cellvix.
 *
 * No password and no account: this posts an application the purchasing team
 * reviews on the suppliers screen. The four required fields deliberately match
 * the buyer form's, so a sign-up asks for the same things whichever side of the
 * transaction you are on.
 */
function SupplierApplyForm({ onBack }) {
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState(null);

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(supplierApplicationSchema),
    defaultValues: {
      businessName: '',
      contactName: '',
      email: '',
      phone: '',
      website: '',
      supplies: '',
      address: { line1: '', line2: '', city: '', region: '', postal: '', country: DEFAULT_COUNTRY },
    },
  });

  async function onSubmit(values) {
    setFormError(null);
    try {
      await api.post('/auth/supplier-application', values);
      setSubmitted(true);
    } catch (error) {
      setFormError(error.message);
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-ok-50 text-ok">
          <ShieldCheck className="size-7" strokeWidth={1.5} />
        </span>
        <div>
          <h3 className="text-xl">Application received</h3>
          <p className="mx-auto mt-2 max-w-sm text-md leading-relaxed text-ink-500">
            Our purchasing team reviews every application and will be in touch to agree terms. No
            account has been created, so there is nothing to sign in to yet.
          </p>
        </div>
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <ChangeAccountType onBack={onBack} />

      {formError && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {formError}
        </p>
      )}

      <FormSection title="Your business" icon={Building2} collapsible={false}>
        <div className="space-y-3">
          <Input
            label="Business name"
            required
            placeholder="Pacific Parts Supply"
            error={errors.businessName?.message}
            data-autofocus
            {...register('businessName')}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Contact name"
              required
              placeholder="Dana Whitfield"
              error={errors.contactName?.message}
              {...register('contactName')}
            />
            {/* The same control the buyer form uses. Two phone fields that
                behave differently in one dialog would be the dialog telling the
                visitor their side of the transaction is a different product. */}
            <Controller
              name="phone"
              control={control}
              render={({ field }) => (
                <PhoneField
                  label="Phone"
                  required
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.phone?.message}
                />
              )}
            />
          </div>

          <Input
            label="Email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@yourbusiness.ca"
            error={errors.email?.message}
            {...register('email')}
          />
        </div>
      </FormSection>

      <FormSection title="What you supply" hint="optional" icon={PackageSearch}>
        <div className="space-y-3">
          <Input label="Website" placeholder="pacificparts.ca" {...register('website')} />
          <Textarea
            label="What do you supply?"
            rows={3}
            placeholder="OEM and aftermarket screens for Samsung and Apple, batteries, charging flexes."
            {...register('supplies')}
          />
        </div>
      </FormSection>

      <FormSection title="Address" hint="optional" icon={MapPin}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <Input label="Unit / suite" placeholder="101" {...register('address.line2')} />
            <Input label="Street" placeholder="123 Main Street" {...register('address.line1')} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="City" placeholder="Toronto" {...register('address.city')} />
            <Input label="Province" placeholder="ON" maxLength={2} {...register('address.region')} />
            <Input label="Postal code" placeholder="A1A 1A1" {...register('address.postal')} />
          </div>
          {/* Prefilled with Canada. Suppliers are the one group who genuinely
              are often not Canadian, so the field is asked rather than
              assumed. */}
          <SelectField
            control={control}
            name="address.country"
            label="Country"
            options={COUNTRY_OPTIONS}
          />
        </div>
      </FormSection>

      <p className="rounded-md bg-surface-2 px-3 py-2.5 text-sm leading-relaxed text-ink-500">
        This is an application, not an account. Nothing is created to sign in with, and our
        purchasing team gets in touch to agree terms.
      </p>

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="lg" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" fullWidth size="lg" loading={isSubmitting}>
          Send application
        </Button>
      </div>
    </form>
  );
}

/**
 * What the buyer sign-up **form** holds, which is not quite what the API takes.
 *
 * The contact's name is asked as two fields and stored as one: `contactName` is
 * what the model, the welcome mail, the approvals queue and every admin screen
 * read, so the halves are composed on submit rather than split in the model
 * the same call as `phone` and its dial code. So the resolver runs over this
 * shape, and `onSubmit` builds the payload `registerSchema` describes.
 *
 * Derived from `registerSchema` rather than restated, so a field added there
 * cannot go unvalidated here.
 */
const signUpFormSchema = registerSchema.omit({ contactName: true }).extend({
  firstName: z.string().trim().min(1, 'Enter a first name.'),
  lastName: z.string().trim().min(1, 'Enter a last name.'),
});

function SignUpTab({ onSwitch }) {
  const { signUp } = useAuth();
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState(null);
  // Which side of the transaction, chosen before any form is shown. Null means the
  // question has not been answered yet.
  const [accountType, setAccountType] = useState(null);

  /**
   * A referral link carries the referrer's code as `?ref=`, so somebody who
   * followed one does not have to be told a code over the phone and type it
   * correctly. It stays an ordinary editable field: attribution is set once at
   * registration and cannot be added later, so the person signing up has to be
   * able to see and correct what the link put there - which is also why its
   * section starts open when a code is present.
   *
   * Read once on mount rather than on every render, so a re-render cannot
   * reset a code the visitor has edited.
   */
  const [referredCode] = useState(
    () => new URLSearchParams(window.location.search).get('ref') ?? '',
  );

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(signUpFormSchema),
    // Land the cursor on the first field that failed, rather than leaving the
    // buyer to hunt for the red one - which matters most here, where half the
    // form can be collapsed out of sight.
    shouldFocusError: true,
    defaultValues: {
      referralCode: referredCode,
      firstName: '',
      lastName: '',
      phone: '',
      contactConsent: EMPTY_CONSENT,
    },
  });

  async function onSubmit({ firstName, lastName, ...values }) {
    setFormError(null);
    try {
      await signUp({
        ...values,
        // One stored name, asked as two. See `registerSchema`.
        contactName: `${firstName} ${lastName}`.trim(),
      });
      setSubmitted(true);
    } catch (error) {
      setFormError(error.message);
    }
  }

  // Brief §8.1: sign-up does not grant access. Say so plainly.
  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-ok-50 text-ok">
          <ShieldCheck className="size-7" strokeWidth={1.5} />
        </span>
        <div>
          <h3 className="text-xl">Thanks for signing up</h3>
          <p className="mx-auto mt-2 max-w-sm text-md leading-relaxed text-ink-500">
            Your account is pending admin approval. We will email you once your business is
            verified - usually within one business day.
          </p>
        </div>
        <Button variant="outline" onClick={() => onSwitch('signin')}>
          Back to sign in
        </Button>
      </div>
    );
  }

  // The question comes before either form, because the two paths share nothing
  // beyond the four identity fields.
  if (!accountType) return <AccountTypeChoice onPick={setAccountType} />;
  if (accountType === 'supplier') {
    return <SupplierApplyForm onBack={() => setAccountType(null)} />;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
      <ChangeAccountType onBack={() => setAccountType(null)} />

      {formError && (
        <p className="flex items-start gap-2 rounded-md bg-danger-50 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {formError}
        </p>
      )}

      {/* Same shape as the admin's new-customer form: the required fields in
          their own slab, then optional groups below it. The two forms open the
          same kind of account and should not look like different products.

          "Business" is gone from every label here. The visitor already chose "I
          want to buy parts" a screen ago and the panel beside them says
          wholesale - repeating it on four labels was the form restating its own
          context instead of naming its fields. `businessName` stays the field
          name: it is what the model, the API and every admin screen call it.

          The required identity sits in an open section and everything optional
          behind a collapsed one - progressive disclosure, which is what keeps a
          form with nine possible fields reading as a form with four. Fields are
          the default 44px: the 38px `size="sm"` used here before was under the
          minimum touch target, and the fix for a tall dialog is fewer fields on
          screen, not smaller ones. */}
      <FormSection title="Your details" icon={UserRound} collapsible={false}>
        <div className="space-y-3">
          {/* Two fields, one stored value.  is what the model, the
              welcome mail and the approvals queue all read, so the halves are
              composed on submit rather than split in the model - the same call
              as  and its dial code. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="First name"
              required
              autoComplete="given-name"
              placeholder="Dana"
              error={errors.firstName?.message}
              data-autofocus
              {...register('firstName')}
            />
            <Input
              label="Last name"
              required
              autoComplete="family-name"
              placeholder="Whitfield"
              error={errors.lastName?.message}
              {...register('lastName')}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@yourcompany.ca"
              error={errors.email?.message}
              {...register('email')}
            />
            {/* Controlled rather than d: the field's value is one
                composed string built from two controls, so it needs the value
                back on every render to know which code is selected and how far
                through the number the buyer is. */}
            <Controller
              name="phone"
              control={control}
              render={({ field }) => (
                <PhoneField
                  label="Phone"
                  required
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.phone?.message}
                />
              )}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Password"
              type="password"
              required
              autoComplete="new-password"
              hint="At least 8 characters, with a letter and a number."
              error={errors.password?.message}
              {...register('password')}
            />
            {/* Referral code (§6.13). Beside the password rather than inside the
                optional company block: somebody who was referred was told a
                code by a person, and a code they cannot find is a referrer who
                silently loses their commission - it is only worth asking for
                where it will actually be seen.

                Set once and never editable afterwards: a referrer that can be
                changed later is a way to redirect money already earned. An
                unrecognised code is refused server-side rather than quietly
                dropped, so nobody is told they were referred when they were
                not. */}
            <Input
              label="Referral code"
              placeholder="ABCD2345"
              hint="Optional. Cannot be added later."
              autoCapitalize="characters"
              error={errors.referralCode?.message}
              {...register('referralCode')}
            />
          </div>
        </div>
      </FormSection>

      {/* Everything optional, collapsed. The company name lives here now: the
          account is identified by the person, and a sole trader may not have a
          registered company name at all - so requiring one to sign up was
          turning an optional detail into a barrier. It can be added later from
          Account & security. */}
      <FormSection
        title="Company details"
        hint="optional"
        icon={Building2}
        hasError={Boolean(errors.businessName || errors.businessType || errors.taxId)}
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Company name"
              placeholder="Northline Device Repair"
              error={errors.businessName?.message}
              {...register('businessName')}
            />
            <Input
              label="Type of company"
              placeholder="Repair shop"
              error={errors.businessType?.message}
              {...register('businessType')}
            />
          </div>

          <Input
            label="Tax / reseller ID"
            placeholder="RT0001-88213"
            hint="Speeds up approval."
            error={errors.taxId?.message}
            {...register('taxId')}
          />
        </div>
      </FormSection>

      {/* ---- CASL consent (§6.13) ----------------------------------------
          Asked at the point the account is created, because that is when there
          is a person to ask. Every channel starts off: an untouched control has
          to record "not asked for", never a fabricated opt-in, and the schema
          leaves the field unset when nothing is ticked.

          This is narrower than `marketingConsent`, which registration grants on
          the implied basis of s.10(9) for messages about the relationship
          itself. Ticking nothing here does not block an invoice reaching them. */}
      <Controller
        name="contactConsent"
        control={control}
        render={({ field }) => (
          <div>
            {/* One line, not two. The longer version wrapped on this column and
                cost a row of height to restate "optional", which the word
                already says. */}
            <p className="text-sm font-medium text-ink-700">
              How may we contact you?{' '}
              <span className="font-normal text-ink-400">Optional.</span>
            </p>
            <ConsentChannels className="mt-2" value={field.value} onChange={field.onChange} />
          </div>
        )}
      />

      <div className="space-y-2 pt-0.5">
        <Button type="submit" fullWidth size="lg" loading={isSubmitting}>
          Create account
        </Button>
        {/* Under the button rather than in a filled slab above it: it is the
            small print on the action, and as a box it cost a whole block of
            height to say what one line says. */}
        <p className="text-center text-xs leading-relaxed text-ink-400">
          Wholesale only. Accounts are reviewed before pricing and ordering unlock.
        </p>
      </div>
    </form>
  );
}

function ContactTab() {
  const info = useBusinessInfo();

  return (
    <div className="space-y-5">
      <p className="text-md leading-relaxed text-ink-500">
        Our sales desk answers account, pricing and stock questions during business hours.
      </p>

      {/* A row the business has not filled in is dropped rather than printed
          with a blank value beside its icon. */}
      <ul className="space-y-3">
        {[
          { icon: Phone, label: 'Phone', value: info.phone },
          { icon: Mail, label: 'Email', value: info.email },
          {
            icon: MapPin,
            label: 'Warehouse',
            value: [
              info.address?.line1,
              info.address?.city,
              [info.address?.region, info.address?.postal].filter(Boolean).join(' '),
            ]
              .filter(Boolean)
              .join(', '),
          },
        ]
          .filter((row) => row.value)
          .map(({ icon: Icon, label, value }) => (
            <li key={label} className="flex items-start gap-3 rounded-md border border-line p-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-500" aria-hidden="true">
                <Icon className="size-4" strokeWidth={2} />
              </span>
              <span>
                <span className="eyebrow block text-ink-300">{label}</span>
                <span className="mt-0.5 block text-md font-medium text-ink-900">{value}</span>
              </span>
            </li>
          ))}
      </ul>

      {/* The whole card goes when the business has not entered its hours - an
          "Hours" heading over an empty list says less than nothing. */}
      {info.hours.length > 0 && (
        <div className="rounded-md border border-line p-3">
          <span className="eyebrow mb-2 block text-ink-300">Hours</span>
          <ul className="space-y-1">
            {info.hours.map((row) => (
              <li key={row.days} className="flex justify-between gap-4 text-sm">
                <span className="text-ink-500">{row.days}</span>
                <span className="font-medium text-ink-900">{row.time}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Sign In / Sign Up / Contact popup, triggered from the header account button. */
export function AccountPopup() {
  const open = useUiStore((s) => s.accountPopupOpen);
  const close = useUiStore((s) => s.closeAccount);
  const tab = useUiStore((s) => s.accountPopupTab);
  const setTab = useUiStore((s) => s.setAccountTab);

  return (
    // Width is the sum of what the two columns need, not a round number: a
    // 480px form column, a 268px panel, and the gaps and insets between and
    // around them. It was 900px, which left ~90px of unused white between the
    // capped form and the panel - visible as a blank gutter down the middle of
    // the dialog.
    // Sized to its content rather than to a breakpoint: a form column wide
    // enough for a two-up field row without the inputs going stubby, beside a
    // fixed-width panel. It was 700/380, which fit sign-in but made the longer
    // sign-up form scroll almost immediately.
    <Modal
      open={open}
      onClose={close}
      size="lg"
      className="max-w-[832px]"
      // The dialog draws its own close button, beside the tabs - see below.
      // Modal's floating one sits top-right over the content, which is fine on
      // desktop where it lands on the red panel, and wrong below `md` where the
      // panel is hidden and it floats over the form with nothing behind it.
      showClose={false}
      /**
       * `overflow-hidden` overrides `Modal`'s own `overflow-y-auto` on the
       * body, and it is what keeps the red panel still.
       *
       * With the body scrolling, expanding "Company details" grew the grid past
       * the frame and the **whole dialog** scrolled - banner included, so the
       * panel slid up out of view and the tab row went with it. The scroll
       * belongs to the form column alone (it already has `overflow-y-auto` and
       * `min-h-0`); the grid must therefore be the thing that cannot overflow,
       * which is what this does. `md:overflow-hidden` repeats it because the
       * base utility is otherwise re-applied at the breakpoint.
       */
      bodyClassName="p-0 md:p-0 overflow-hidden md:overflow-hidden"
    >
      {/* **The content sets the height.** The frame used to be pinned to the
          tallest tab (760px), so Sign In - which needs barely half of that
          opened as a mostly empty box with the form marooned at the top. Each
          tab is its own size now, and the dialog is only as tall as what it is
          actually showing.

          The banner is the exception: it keeps the height it had, so it does
          not change shape as the form beside it grows and shrinks. `items-start`
          on its own cell (below) already stopped it stretching; `md:min-h` here
          is what stops the SHORT tabs from squashing it - the frame will not go
          under the panel's own height, so Sign In and Sign Up show the same red
          block.

          `max-h` rather than `h` so a short viewport caps the frame and the form
          column scrolls inside it instead of the dialog overflowing. `min-h-0`
          on the scrolling child is what lets it scroll rather than stretch. */}
      {/* `grid-rows-[minmax(0,1fr)]` is what makes the form column scroll
          rather than overflow. A grid row defaults to `auto`, which sizes to
          its tallest child and ignores the container's `max-h` - so the column
          grew to its full content height, pushed past the frame and took the
          banner with it. Pinning the row to a shrinkable `1fr` gives the
          column a real height to scroll inside; `min-h-0` on the column itself
          (below) is the other half of that rule. */}
      <div className="grid max-h-[82vh] grid-rows-[minmax(0,1fr)] gap-6 md:max-h-[86vh] md:min-h-[560px] md:grid-cols-[minmax(0,516px)_minmax(0,268px)] md:justify-center md:gap-7">
        {/* The column keeps its 480px cap at every width. It was released at
            `md` (`md:max-w-none`), so the form stretched to whatever the grid
            column happened to be - around 600px - and a single email or
            password input ran the width of the dialog. A text field that wide
            is harder to read, not more generous, and it made a short form look
            sprawling. Capped, the two-up rows stay comfortable and the lone
            fields stop looking like the most important thing on the page. */}
        <div className="scroll-slim mx-auto min-h-0 w-full min-w-0 max-w-[480px] overflow-y-auto px-5 pb-6 pt-5 md:mx-0 md:pl-6 md:pr-0">
          {/* The close button shares this row with the tabs rather than floating
              over the content. Below `md` the red panel is hidden, so a floating
              X had nothing behind it and read as stuck to the form; on the row
              it is part of the layout at every width, and the tabs give it a
              baseline to sit on. */}
          <div className="mb-5 flex items-center gap-2">
            <div
              role="tablist"
              aria-label="Account"
              className="flex min-w-0 flex-1 gap-1 rounded-md bg-surface-2 p-1"
            >
              {TABS.map((item) => (
                <button
                  key={item.key}
                  role="tab"
                  type="button"
                  aria-selected={tab === item.key}
                  onClick={() => setTab(item.key)}
                  className={cn(
                    'flex-1 rounded-md py-2 font-display text-sm font-semibold transition-[background,color,box-shadow] duration-press',
                    tab === item.key
                      ? 'bg-surface text-ink-900 shadow-card'
                      : 'text-ink-400 hover:text-ink-700',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Hidden at `md` and up, where the dialog's own top-right corner is
                the red panel and a close button there is conventional - that one
                is drawn by the grid cell below. */}
            <button
              type="button"
              onClick={close}
              aria-label="Close dialog"
              className={cn(pressable, 'flex size-9 shrink-0 items-center justify-center rounded-md text-ink-400 hover:bg-surface-2 hover:text-ink-900 md:hidden')}
            >
              <X className="size-4.5" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>

          {tab === 'signin' && <SignInTab onDone={close} />}
          {tab === 'signup' && <SignUpTab onSwitch={setTab} />}
          {tab === 'contact' && <ContactTab />}
        </div>

        {/* The panel keeps its own height and sits at the top; any slack in the
            frame falls **below** it as empty dialog rather than stretching it.
            Stretched, its four blocks spread out to fill whatever the tallest
            tab needed and the panel visibly changed shape between tabs - the
            one element on this dialog that should look identical on all three.

            `items-start` on this cell rather than the grid, so only the panel
            opts out of stretching; the form column still fills the frame and
            scrolls inside it. Insets match the form column's (`pt-5 pb-6`) so
            both start on the same line. */}
        <div className="relative hidden min-h-0 items-start pb-6 pl-0 pr-5 pt-5 md:flex">
          <SidePanel />

          {/* The desktop close, over the red panel where it has a dark ground to
              sit on and reads as the dialog's corner. Below `md` the panel is
              hidden and this goes with it - the tab row carries the close there
              instead.

              Offsets are measured from THIS wrapper, which already carries
              `pr-5 pt-5` of its own. `right-8 top-8` therefore put the button
              20px further in and 20px further down than intended - squarely on
              top of the panel's eyebrow, so the X and the words "CELLVIX
              WHOLESALE PORTAL" overlapped. The panel's inner padding is 6, so
              matching it here lands the button in the panel's own corner. */}
          <button
            type="button"
            onClick={close}
            aria-label="Close dialog"
            className={cn(
            pressable,
            'absolute right-6 top-6 z-10 flex size-9 items-center justify-center rounded-md text-white/70 hover:bg-white/15 hover:text-white',
            )}
          >
            <X className="size-4.5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>
    </Modal>
  );
}

// The sign-in form alone, for the admin host's own sign-in page - one form, so
// the business chooser and the pending-account answer cannot drift apart.
export { SignInTab };

export default AccountPopup;
