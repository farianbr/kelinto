import { useNavigate, Link } from 'react-router';
import { useWatch } from 'react-hook-form';
import { Info } from 'lucide-react';

import { INVOICE_SERVICE_TYPES, SERVICE_INVOICE_TYPES } from '@shared/schemas/admin';
import Input from '@/components/ui/Input';
import SelectField from '@/components/ui/SelectField';
import { Section } from '@/components/admin/DeviceLines';

/**
 * The "Basic information" block at the top of the ticket, the quote and the
 * service invoice.
 *
 * **One component, because the client asked for one section** (2026-10-05:
 * "exactly same Basic Customer Information section like Quote for Ticket,
 * Invoice"). The quote's version is the standard: an account picked from a
 * searchable list, the document's date, and how the job is done. The three
 * forms used to ask the same question three ways - the ticket as three free
 * text boxes with an optional shortcut above them - so the same customer was
 * typed differently on each document of one job.
 *
 * Fields the documents do NOT share (a ticket's technician, an invoice's due
 * date) go in `children`, under the shared row, so the row itself reads the
 * same on every screen.
 */
export function SalesCustomerSection({
  control,
  register,
  errors,
  clients,
  /** `{ name, label, hint? }` - the document's own date. */
  dateField,
  /** A quote's customer is fixed once it exists (the server drops it). */
  lockCustomer = false,
  /** "a quote is addressed to somebody" - finishes the sentence under the row. */
  addHint,
  children,
}) {
  const navigate = useNavigate();

  /**
   * The three ways a repair counter works, plus the stored value when it is the
   * retired fourth.
   *
   * Mail-in is no longer offered (see `SERVICE_INVOICE_TYPES`), but a record
   * written while it was still has it, and a select that cannot show its own
   * value reads as blank - which a save would then overwrite.
   */
  const current = useWatch({ control, name: 'serviceType' });
  const serviceTypes = SERVICE_INVOICE_TYPES.some((entry) => entry.value === current)
    ? SERVICE_INVOICE_TYPES
    : [...SERVICE_INVOICE_TYPES, ...INVOICE_SERVICE_TYPES.filter((entry) => entry.value === current)];

  return (
    <Section icon={Info} title="Basic information">
      <div className="grid gap-3 lg:grid-cols-3">
        <SelectField
          control={control}
          name="user"
          label="Customer"
          required={!lockCustomer}
          disabled={lockCustomer}
          hint={lockCustomer ? 'Fixed once the document exists.' : undefined}
          // Searchable explicitly, not by row count: this is every account and
          // it grows with the business, so it has to be typeable at 500 rows
          // as well as at five.
          searchable
          searchPlaceholder="Name, business or email…"
          options={[
            { value: '', label: '– Choose a customer –' },
            ...clients.map((client) => ({
              value: client.id,
              label: `${client.displayName}${client.email ? ` · ${client.email}` : ''}`,
            })),
          ]}
          // A customer is a record with a dozen fields, so this hands off to the
          // form that owns it rather than inventing a second one, and carries
          // the typed name so it is not retyped there.
          onCreate={(typed) =>
            navigate(`/admin/clients?new=1${typed ? `&name=${encodeURIComponent(typed)}` : ''}`)
          }
          createLabelEmpty="Add a customer"
        />
        <Input
          label={dateField.label}
          type="date"
          hint={dateField.hint}
          error={errors?.[dateField.name]?.message}
          {...register(dateField.name)}
        />
        <SelectField control={control} name="serviceType" label="Service type" options={serviceTypes} />
      </div>

      {children}

      {!lockCustomer && (
        <p className="mt-2 text-xs text-ink-400">
          No account yet?{' '}
          <Link to="/admin/clients?new=1" className="font-medium text-brand underline">
            Add a customer
          </Link>{' '}
          first - {addHint}.
        </p>
      )}
    </Section>
  );
}

export default SalesCustomerSection;
