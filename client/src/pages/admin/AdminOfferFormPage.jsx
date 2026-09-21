import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import PageHeader from '@/components/admin/PageHeader';
import Panel from '@/components/ui/Panel';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminOffers, useAdminMutations } from '@/hooks/useAdmin';
import { useTaxonomy, usePartTypes } from '@/hooks/useCatalog';
import { OfferForm } from './AdminOffersPage';

/**
 * New and edit offer, on a page of its own.
 *
 * **It was a modal**, and the form outgrew it: an offer carries a title,
 * subtitle, description, terms, a type, a badge, a promo code, a discount type
 * and value, minimum quantity and spend, four targeting selects, a SKU list, a
 * video and its poster, an audience picker and a date range. That is a screen's
 * worth of decisions inside a scrolling box, with the save button below the
 * fold and the list it came from greyed out behind it.
 *
 * The form itself is unchanged - it is the same `OfferForm` the modal rendered,
 * imported rather than forked, so the two can never drift into different
 * versions of the same fields.
 *
 * **Edit reads from the list rather than its own endpoint.** There is no
 * `GET /admin/offers/:id`, and adding one to serve a screen that is always
 * reached from the list would be a second read path for the same record. The
 * list is cached by the time this mounts; arriving cold fetches it once.
 */
const ROUTE = ADMIN_ROUTES['/admin/marketing/offers/new'];
const ADMIN_PAGE = { ...ROUTE, icon: adminIcon(ROUTE.icon) };

export function AdminOfferFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const { data, isLoading } = useAdminOffers({});
  const { createOffer, updateOffer } = useAdminMutations();
  const { data: tree } = useTaxonomy();
  const { data: partTypeFacets } = usePartTypes();

  const offer = isEdit ? (data?.offers ?? []).find((row) => row.id === id) : null;

  /**
   * `usePartTypes` answers facet rows, and the form wants options.
   *
   * The list page reshapes them the same way before handing them over. Passing
   * the facets through raw crashed the form - it spreads this into a select's
   * options and a facet row is not that shape.
   */
  const partTypes = useMemo(
    () => (partTypeFacets ?? []).map((facet) => ({ value: facet.value, label: facet.label })),
    [partTypeFacets],
  );

  const pending = createOffer.isPending || updateOffer.isPending;
  const error = createOffer.error?.message ?? updateOffer.error?.message;

  const back = () => navigate('/admin/marketing/offers');

  function submit(values) {
    const options = { onSuccess: back };
    if (isEdit) updateOffer.mutate({ id, ...values }, options);
    else createOffer.mutate(values, options);
  }

  // Edit needs its record before the form can be filled in. New does not, so it
  // renders immediately rather than waiting on a list it will not read.
  if (isEdit && isLoading) {
    return <p className="text-sm text-ink-500">Loading offer…</p>;
  }

  /**
   * An id that matches nothing gets a plain answer, not an empty form.
   *
   * A blank Edit screen would save as a NEW offer under an id the list does not
   * have, which is a silent duplicate rather than a visible error.
   */
  if (isEdit && !offer) {
    return (
      <div className="form-page">
        <button
          type="button"
          onClick={back}
          className={cn(
            pressable,
            'mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900',
          )}
        >
          <ArrowLeft className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
          Back to offers
        </button>
        <PageHeader icon={ADMIN_PAGE.icon} title="Offer not found" />
        <Panel>
          <p className="text-sm leading-relaxed text-ink-500">
            This offer has been deleted, or the link is wrong.{' '}
            <button type="button" onClick={back} className="font-semibold text-brand hover:text-brand-700">
              Back to discount codes
            </button>
          </p>
        </Panel>
      </div>
    );
  }

  /*
    One centred column, header included.
   *
   * `max-w-form` is the 760px every other settings form already holds itself
   * to: full-bleed, the fields ran the width of a 1440px window, and a title
   * input a metre wide says "type a lot here" about a one-line field. The
   * heading is inside the same column rather than above it - a centred form
   * under a left-aligned title reads as two unrelated blocks, and the title is
   * the form's own label.
   */
  return (
    <div className="form-page">
      {/* The only way out of this screen was Cancel at the foot of a long
          form, or the browser button. A form opened from a list needs a way
          back to that list from the top of it, where somebody who opened the
          wrong offer is already looking. */}
      <button
        type="button"
        onClick={back}
        className={cn(
          pressable,
          'mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900',
        )}
      >
        <ArrowLeft className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        Back to offers
      </button>

      <PageHeader
        icon={ADMIN_PAGE.icon}
        title={isEdit ? 'Edit offer' : 'New offer'}
        description={
          isEdit
            ? offer.title
            : 'A promo code, a combo bundle or a deal. Everything below is optional except the title and how the discount is worked out.'
        }
      />

      <OfferForm
        offer={offer}
        tree={tree}
        partTypes={partTypes}
        onSubmit={submit}
        onCancel={back}
        isPending={pending}
        error={error}
      />
    </div>
  );
}

export default AdminOfferFormPage;
