import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowRight, Wrench } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import ProductArticle from '@/components/product/ProductArticle';
import ProductFaq from '@/components/product/ProductFaq';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import { ServiceCard, serviceDuration } from '@/components/product/ServiceCard';
import {
  DetailBreadcrumbs,
  DetailBuyRow,
  DetailFacts,
  DetailHero,
  DetailPrice,
  DetailSection,
  DetailShell,
} from '@/components/catalog/ItemDetail';
import { useServiceDetail } from '@/hooks/useCatalog';
import { usePageSections } from '@/hooks/useContent';
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import useUiStore from '@/store/uiStore';

/**
 * One repair service on the website (`/services/:slug`), on the same detail
 * frame as every product (`components/catalog/ItemDetail`): the same
 * breadcrumbs, picture column, title block, badges, price gate, buy row and
 * facts table, in the same order and spacing. A service fills the slots with
 * what it has instead of stock: its repair type, the device it is for, bench
 * time and warranty. The long copy staff wrote and other repairs of the same
 * type follow as sections, like a product's article and related items.
 */
export function ServiceDetailPage() {
  const { slug } = useParams();
  const { data, isLoading, error } = useServiceDetail(slug);
  const [imageFailed, setImageFailed] = useState(false);
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);
  const { isAuthenticated, isPanelAccount } = useAuth();
  const { services: lines, addService } = useCart();
  const openAccount = useUiStore((s) => s.openAccount);
  const openCartAfterAdd = useUiStore((s) => s.openCartAfterAdd);
  const service = data?.service;
  // The Services page's FAQ is every repair's FAQ.
  const { data: servicesPage } = usePageSections('services');
  useDocumentTitle(service?.name ?? null);

  if (isLoading) {
    return (
      <DetailShell>
        <div className="grid gap-6 md:grid-cols-2 lg:gap-10">
          <Skeleton className="aspect-square rounded-lg" />
          <div className="space-y-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-3/4" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </DetailShell>
    );
  }

  if (error || !service) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="text-2xl">That service is not offered any more</h1>
        <p className="mt-3 text-md text-ink-500">It may have been renamed or taken off the list.</p>
        <Link to="/services" className="mt-6 inline-flex items-center gap-1.5 text-md font-semibold text-brand hover:text-brand-700">
          See every repair
        </Link>
      </div>
    );
  }

  const photo = !imageFailed && service.image;
  const related = data.related ?? [];
  const gated = !service.priceVisible;
  const quoted = service.priceVisible && !(service.priceCents > 0);
  const inCart = lines.find((line) => line.serviceId === service.id);
  const bench = serviceDuration(service.durationMinutes);

  async function handleAdd() {
    setAdding(true);
    setAddError(null);
    try {
      await addService(service.id, qty);
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 1400);
      openCartAfterAdd?.();
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  }

  const media = (
    <div className="overflow-hidden rounded-lg border border-line bg-surface-2">
      <div className="aspect-square">
        {photo ? (
          <img
            src={photo}
            alt={service.name}
            width={800}
            height={800}
            onError={() => setImageFailed(true)}
            className="size-full object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center">
            <Wrench className="size-14 text-ink-200" strokeWidth={1.25} aria-hidden="true" />
          </span>
        )}
      </div>
    </div>
  );

  return (
    <DetailShell>
      <DetailBreadcrumbs
        items={[
          { label: 'Services', to: '/services' },
          { label: service.categoryLabel, to: `/services?partType=${encodeURIComponent(service.category)}` },
        ]}
      />

      <DetailHero
        media={media}
        eyebrow={service.categoryLabel}
        title={service.name}
        badges={
          (service.warrantyDays > 0 || bench) && (
            <>
              {service.warrantyDays > 0 && <Badge tone="ok">{service.warrantyDays}-day warranty</Badge>}
              {bench && <Badge tone="neutral">{bench} on the bench</Badge>}
            </>
          )
        }
        price={
          <DetailPrice
            gated={gated}
            amount={service.priceCents}
            signedIn={isAuthenticated}
            onSignIn={() => openAccount('signin')}
            quoted={
              quoted && (
                <div className="flex flex-wrap items-center gap-4">
                  <span className="text-lg font-medium text-ink-700">Quoted on inspection</span>
                  <Link
                    to="/contact?topic=quote"
                    className={cn(pressable, 'inline-flex items-center gap-1 text-md font-semibold text-brand hover:text-brand-700')}
                  >
                    Get a quote
                    <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
                  </Link>
                </div>
              )
            }
          />
        }
        buy={
          !gated &&
          !quoted &&
          !isPanelAccount && (
            <DetailBuyRow
              qty={qty}
              onQty={setQty}
              onAdd={handleAdd}
              loading={adding}
              justAdded={justAdded}
              error={addError}
              footnote={inCart && !justAdded ? `${inCart.qty} in your cart` : null}
            />
          )
        }
        note={<p className="text-sm text-ink-400">Booked and paid for here, carried out at the counter when you bring the device in.</p>}
        description={service.description}
        facts={
          <DetailFacts
            rows={[
              ['Repair type', service.categoryLabel],
              ['For', service.scopeLabel || 'Any device'],
              ['Bench time', bench],
              ['Warranty', service.warrantyDays > 0 ? `${service.warrantyDays} days` : null],
            ]}
          />
        }
      />

      {/* The same sections, in the same order and spacing, as a product's page:
          its FAQ, its article (the details staff wrote), then related items.
          Google reviews and location follow from the page registry. */}
      <ProductFaq
        faqs={servicesPage?.faqs ?? []}
        title="Questions about this repair"
        askLabel="Ask about this repair"
        askBody="Ask the counter directly about your device, and a person replies."
        className="mt-10 lg:mt-14"
      />

      <ProductArticle
        article={
          service.details
            ? {
                heading: `About ${service.name.toLowerCase().startsWith('the ') ? service.name : `the ${service.name.toLowerCase()}`}`,
                body: service.details,
                readMinutes: Math.max(1, Math.round(service.details.split(/\s+/).length / 200)),
              }
            : null
        }
        eyebrow="About this repair"
        headingId="service-article"
        className="mt-10 lg:mt-14"
      />

      {related.length > 0 && (
        <DetailSection id="related-services" title="More repairs like this">
          {/* The same grid as a product page's related items. */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">
            {related.slice(0, 4).map((entry) => (
              <ServiceCard key={entry.id} service={entry} />
            ))}
          </div>
        </DetailSection>
      )}
    </DetailShell>
  );
}

export default ServiceDetailPage;
