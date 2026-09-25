import { useEffect, useState } from 'react';
import { useFieldArray, Controller } from 'react-hook-form';
import useAdminForm from '@/hooks/useAdminForm';
import { Plus, Trash2 } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';

import { businessInfoSchema } from '@shared/schemas/admin';
import { PROVINCES } from '@shared/schemas/checkout';
import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import Panel from '@/components/ui/Panel';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import PhoneField from '@/components/ui/PhoneField';
import SelectField from '@/components/ui/SelectField';
import PageHeader from '@/components/admin/PageHeader';
import { SettingsFormActions, PlaceholderNotice } from '@/components/admin/settings/SettingsForm';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminSettings, useAdminMutations } from '@/hooks/useAdmin';

/**
 * Business Info (§6.15, category 1) - who Cellvix is on an invoice, an email
 * and the storefront footer.
 *
 * This screen is the answer to open question 1 on the PROGRESS board: the
 * `BUSINESS_INFO` placeholder constants in `lib/constants.js` were always meant
 * to become editable data, and this is where they become it.
 *
 * The values ship seeded and **the seeds are placeholders**, which is why the
 * notice is not optional (§6b, rule 5). A GST/HST number is the field most
 * likely to be believed simply because it is filled in, and it is also the one
 * that ends up printed on every invoice.
 */
const ADMIN_PAGE = { ...ADMIN_ROUTES['/admin/settings/business-info'], icon: adminIcon('Building2') };

const EMPTY = {
  name: '',
  tagline: '',
  phone: '',
  email: '',
  supportEmail: '',
  billingEmail: '',
  website: '',
  taxNumber: '',
  reviewUrl: '',
  logoUrl: '',
  whatsapp: '',
  mapUrl: '',
  hours: [],
  social: [],
  address: { line1: '', line2: '', city: '', region: 'ON', postal: '', country: 'CA' },
};

/**
 * The networks the storefront has a glyph for, offered as a picker.
 *
 * Free text underneath would let a typo (`instgram`) through, which renders as
 * a generic link chip labelled with the typo - working, but not what anybody
 * meant. The list matches `lib/socialIcons.js`.
 */
const NETWORKS = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'youtube', label: 'YouTube' },
];

/**
 * The document's `business` block, in the shape this form holds.
 *
 * The two lists have to be arrays even when the server sends nothing, because
 * `useFieldArray` cannot map over undefined.
 */
const formValues = (business = {}) => ({
  ...EMPTY,
  ...business,
  hours: business.hours ?? [],
  social: business.social ?? [],
  address: { ...EMPTY.address, ...business.address },
});

export function AdminBusinessInfoPage() {
  const { data, isLoading } = useAdminSettings();
  const { saveBusinessInfo } = useAdminMutations();
  const [saved, setSaved] = useState(false);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty, isSubmitting },
  } = useAdminForm({ resolver: zodResolver(businessInfoSchema), defaultValues: EMPTY });

  // Both are lists the staff member adds to and removes from, which is what a
  // field array is for - unlike the address, whose fields are fixed.
  const hours = useFieldArray({ control, name: 'hours' });
  const social = useFieldArray({ control, name: 'social' });

  // The server is the source of truth, and a refetch must never overwrite an
  // edit in progress - so this syncs only while the form is untouched.
  useEffect(() => {
    if (!data?.business || isDirty) return;
    reset(formValues(data.business));
  }, [data, isDirty, reset]);

  async function onSubmit(values) {
    setSaved(false);
    try {
      const next = await saveBusinessInfo.mutateAsync(values);
      // Reset *to the server's answer*, not to what was typed: it is what the
      // document now holds, and it is what makes the form clean again.
      reset(formValues(next.business));
      setSaved(true);
    } catch (err) {
      setError('root', { message: err.message });
    }
  }

  if (isLoading) return <p className="text-sm text-ink-500">Loading settings…</p>;

  return (
    <div className="form-page">
      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={ADMIN_PAGE.title}
        description={ADMIN_PAGE.description}
      />

      <PlaceholderNotice>
        These details ship with placeholder values and are printed on invoices, transactional email
        and the website footer. Replace them with the real ones - the GST/HST number especially,
        which is a stand-in and is not a valid registration.
      </PlaceholderNotice>

      <form onSubmit={handleSubmit(onSubmit)} className="max-w-form space-y-4">
        <Panel title="Identity" description="The name and line that appear above every document.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Business name"
              placeholder="CellShoppe Phone & Laptop Fix"
              required
              error={errors.name?.message}
              {...register('name')}
            />
            <Input
              label="Tagline"
              hint="One line, under the name."
              error={errors.tagline?.message}
              {...register('tagline')}
            />
            {/* A URL rather than an upload: every other image in this system is
                a path the catalogue already serves. Empty is the normal answer
                and prints the business name as a wordmark. */}
            <Input
              label="Logo URL"
              containerClassName="sm:col-span-2"
              hint="Shown in the website header. Leave empty to show the business name as text instead."
              placeholder="https://…/logo.png"
              error={errors.logoUrl?.message}
              {...register('logoUrl')}
            />
          </div>
        </Panel>

        {/* "this business", not "Cellvix": this screen is per business, and a
            repair shop reading its own settings should not be told whose
            contact details these are. */}
        <Panel
          title="Contact"
          description="How a customer reaches this business from a document or the footer."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              name="phone"
              control={control}
              render={({ field }) => (
                <PhoneField
                  label="Phone"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={errors.phone?.message}
                />
              )}
            />
            <Input label="Email" type="email" error={errors.email?.message} {...register('email')} />
            {/* Both fall back to the main address when left empty, which is why
                the hint says so rather than the field being pre-filled: a
                pre-filled copy would stop following the main one the moment it
                changed. */}
            <Input
              label="Support email"
              type="email"
              hint="Orders, returns and warranty. Leave empty to use the main email."
              error={errors.supportEmail?.message}
              {...register('supportEmail')}
            />
            <Input
              label="Billing email"
              type="email"
              hint="Invoices and statements. Leave empty to use the main email."
              error={errors.billingEmail?.message}
              {...register('billingEmail')}
            />
            <Input
              label="WhatsApp number"
              hint="Shown as a contact channel in the website footer. Leave empty to hide it."
              error={errors.whatsapp?.message}
              {...register('whatsapp')}
            />
            <Input
              label="Website"
              hint="Include https://"
              error={errors.website?.message}
              {...register('website')}
            />
            <Input
              label="GST/HST number"
              hint="Printed on every invoice. Required for input tax credits."
              error={errors.taxNumber?.message}
              {...register('taxNumber')}
            />
            {/* Empty is a real answer: the warranty sheet and the warranty email
                both drop the whole feedback block rather than show a button that
                goes nowhere. */}
            <Input
              label="Review link"
              containerClassName="sm:col-span-2"
              hint="Where a happy customer is sent to leave a review. Shown on the ticket warranty sheet and in the warranty email; leave it empty to show neither."
              placeholder="https://g.page/r/…"
              error={errors.reviewUrl?.message}
              {...register('reviewUrl')}
            />
          </div>
        </Panel>

        <Panel title="Address" description="The registered address, as it appears on an invoice.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Street address"
              containerClassName="sm:col-span-2"
              error={errors.address?.line1?.message}
              {...register('address.line1')}
            />
            <Input
              label="Unit / suite"
              // Half width, unlike the street line above it. "Unit 12" is the
              // shortest value on the page and it was sitting in the widest box,
              // which reads as the field expecting more than it wants. The
              // street line keeps its full span because addresses genuinely run
              // long.
              error={errors.address?.line2?.message}
              {...register('address.line2')}
            />
            <Input label="City" error={errors.address?.city?.message} {...register('address.city')} />
            <SelectField
              control={control}
              name="address.region"
              label="Province"
              options={PROVINCES}
              error={errors.address?.region?.message}
            />
            <Input
              label="Postal code"
              placeholder="A1A 1A1"
              error={errors.address?.postal?.message}
              {...register('address.postal')}
            />
            <Input
              label="Map link"
              containerClassName="sm:col-span-2"
              hint="Where the Location row in the website footer opens. Leave empty to hide that row."
              placeholder="https://maps.google.com/?q=…"
              error={errors.mapUrl?.message}
              {...register('mapUrl')}
            />
          </div>
        </Panel>

        {/* Printed, never computed. "Mon – Fri" and "By appointment" are both
            real answers, which is why both halves are free text rather than a
            weekday grid with open and close times. */}
        <Panel
          title="Opening hours"
          description="Shown on the contact page and in the website footer. Leave empty to show none."
        >
          <div className="space-y-3">
            {hours.fields.map((row, index) => (
              <div key={row.id} className="flex items-start gap-2">
                <Input
                  label={index === 0 ? 'Days' : undefined}
                  aria-label={index === 0 ? undefined : 'Days'}
                  containerClassName="flex-1"
                  placeholder="Mon – Fri"
                  error={errors.hours?.[index]?.days?.message}
                  {...register(`hours.${index}.days`)}
                />
                <Input
                  label={index === 0 ? 'Hours' : undefined}
                  aria-label={index === 0 ? undefined : 'Hours'}
                  containerClassName="flex-1"
                  placeholder="9:00 AM – 6:00 PM ET"
                  error={errors.hours?.[index]?.time?.message}
                  {...register(`hours.${index}.time`)}
                />
                <button
                  type="button"
                  onClick={() => hours.remove(index)}
                  aria-label={`Remove ${row.days || 'this row'}`}
                  className={cn(
                    pressable,
                    'flex size-9 shrink-0 items-center justify-center rounded-md border border-line text-ink-400 hover:border-danger hover:text-danger',
                    index === 0 && 'mt-6.5',
                  )}
                >
                  <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => hours.append({ days: '', time: '' })}
            >
              <Plus className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              Add a row
            </Button>
          </div>
        </Panel>

        {/* One row per profile the business actually has. The storefront draws
            an icon per row, so a business on one network gets one icon rather
            than four with three of them dead. */}
        <Panel
          title="Social profiles"
          description="Shown in the website footer and the mobile menu. Leave empty to show none."
        >
          <div className="space-y-3">
            {social.fields.map((row, index) => (
              <div key={row.id} className="flex items-start gap-2">
                <SelectField
                  control={control}
                  name={`social.${index}.network`}
                  label={index === 0 ? 'Network' : undefined}
                  options={NETWORKS}
                  containerClassName="w-36 shrink-0"
                  error={errors.social?.[index]?.network?.message}
                />
                <Input
                  label={index === 0 ? 'Profile URL' : undefined}
                  aria-label={index === 0 ? undefined : 'Profile URL'}
                  containerClassName="flex-1"
                  placeholder="https://…"
                  error={errors.social?.[index]?.url?.message}
                  {...register(`social.${index}.url`)}
                />
                <Input
                  label={index === 0 ? 'Handle' : undefined}
                  aria-label={index === 0 ? undefined : 'Handle'}
                  containerClassName="w-36 shrink-0"
                  placeholder="@name"
                  error={errors.social?.[index]?.handle?.message}
                  {...register(`social.${index}.handle`)}
                />
                <button
                  type="button"
                  onClick={() => social.remove(index)}
                  aria-label={`Remove ${row.network || 'this profile'}`}
                  className={cn(
                    pressable,
                    'flex size-9 shrink-0 items-center justify-center rounded-md border border-line text-ink-400 hover:border-danger hover:text-danger',
                    index === 0 && 'mt-6.5',
                  )}
                >
                  <Trash2 className="size-4" strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => social.append({ network: 'facebook', url: '', handle: '' })}
            >
              <Plus className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              Add a profile
            </Button>
          </div>
        </Panel>

        <SettingsFormActions
          unsavedLabel="this business's details"
          dirty={isDirty}
          saving={isSubmitting || saveBusinessInfo.isPending}
          saved={saved}
          error={errors.root?.message}
          onReset={() => {
            reset();
            setSaved(false);
          }}
        />
      </form>
    </div>
  );
}

export default AdminBusinessInfoPage;
