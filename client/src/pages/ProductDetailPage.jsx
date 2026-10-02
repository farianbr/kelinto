import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Search, ShieldCheck } from 'lucide-react';
import cn from '@/lib/cn';
import { uploadThumb } from '@/lib/media';
import api from '@/lib/api';
import { productTitle } from '@/lib/format';
import { gradeMeta } from '@/lib/constants';
import { categoryPath } from '@shared/catalog';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import GradeBadge from '@/components/product/GradeBadge';
import PartFrame from '@/components/product/PartFrame';
import ImageZoom from '@/components/product/ImageZoom';
import ProductCard from '@/components/product/ProductCard';
import MarketCompare from '@/components/product/MarketCompare';
import ProductFaq from '@/components/product/ProductFaq';
import GradeOptions from '@/components/product/GradeOptions';
import ProductArticle from '@/components/product/ProductArticle';
import ProductReviews from '@/components/product/ProductReviews';
import Stars from '@/components/ui/Stars';
import scrollToSection from '@/lib/scrollToSection';
import WhyCellvix from '@/components/product/WhyCellvix';
import {
  DetailBreadcrumbs,
  DetailBuyRow,
  DetailFacts,
  DetailHero,
  DetailPrice,
  DetailSection,
  DetailShell,
} from '@/components/catalog/ItemDetail';
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import { useCatalogCategories } from '@/hooks/useCatalog';
import useBusinessInfo from '@/hooks/useBusinessInfo';
import useUiStore from '@/store/uiStore';
import useFilterStore from '@/store/filterStore';
import { pressable } from '@/lib/motion';

/**
 * One product's page, for every product type (Parts, Phones and any type a
 * business adds), on the shared detail frame (`components/catalog/ItemDetail`).
 *
 * What the type decides, the type supplies: the breadcrumb starts at its own
 * catalogue page, the facts table lists the type's own features (Storage and
 * Colour on a phone, whatever a new type defines), the grade badge reads the
 * type's own grades, and "related" is named after the type. The one block that
 * belongs to Parts alone, the workshop record of screen checks, shows on Parts
 * only: a phone was not graded on glass, panel, touch and flex.
 */
export function ProductDetailPage() {
  const { slug } = useParams();
  const [qty, setQty] = useState(1);
  // Which of the product's own pictures is in the frame; null is the main one.
  const [shown, setShown] = useState(null);
  const [justAdded, setJustAdded] = useState(false);

  const { addItem } = useCart();
  const { isAuthenticated } = useAuth();
  const info = useBusinessInfo();
  const { data: categories = [] } = useCatalogCategories();
  const openCartAfterAdd = useUiStore((s) => s.openCartAfterAdd);
  const openAccount = useUiStore((s) => s.openAccount);
  const setPath = useFilterStore((s) => s.setPath);

  const { data, isLoading, error } = useQuery({
    queryKey: ['product', slug],
    queryFn: () => api.get(`/products/${slug}`),
  });

  if (isLoading) {
    return (
      <DetailShell>
        <div className="grid gap-8 md:grid-cols-2">
          <Skeleton className="aspect-square" />
          <div className="space-y-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </DetailShell>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="text-2xl">Not found</h1>
        <p className="mt-3 text-md text-ink-500">{error.message}</p>
        <Link to="/shop" className="mt-6 inline-flex items-center gap-1.5 text-md font-semibold text-brand hover:text-brand-700">
          Back to the catalogue
        </Link>
      </div>
    );
  }

  const { product, related, faqs, grades, article, reviews } = data;
  const gated = !product.priceVisible;
  const outOfStock = !product.inStock;
  const typeSlug = product.category || 'parts';
  const type = categories.find((entry) => entry.slug === typeSlug);
  const typeName = type?.name ?? (typeSlug === 'parts' ? 'Parts' : 'Shop');
  const typePage = categoryPath({ slug: typeSlug });
  const grade = product.grade ? gradeMeta(product.grade, type?.grades ?? []) : null;
  const isParts = typeSlug === 'parts';
  // What one of these is called on its page: a part, a phone, or a product.
  const noun = isParts ? 'part' : typeSlug === 'phones' ? 'phone' : 'product';

  // The strike-through: our former price wins over the market average.
  const struck = product.compareAtPrice ?? null;
  const saving = !struck && product.market ? product.market.savingsPercent : null;

  function handleAdd() {
    addItem(product, qty);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1400);
    // Desktop only - on a phone the dropdown would cover the page.
    openCartAfterAdd();
  }

  // Crumbs filter the type's own page rather than pointing at routes of their own.
  const filterCrumb = (label, path) => ({ label, to: typePage, onClick: () => setPath(path) });
  const crumbs = [
    { label: typeName, to: typePage },
    filterCrumb(product.deviceTypeName, { deviceType: product.deviceTypeSlug }),
    filterCrumb(product.brandName, { deviceType: product.deviceTypeSlug, brand: product.brandSlug }),
    filterCrumb(product.modelName, {
      deviceType: product.deviceTypeSlug,
      brand: product.brandSlug,
      series: product.seriesSlug,
      model: product.modelSlug,
    }),
  ];

  const media = (
    <>
      <div className="group relative overflow-hidden rounded-lg border border-line bg-surface-2">
        <ImageZoom product={shown ? { ...product, image: shown } : product}>
          <PartFrame
            product={shown ? { ...product, image: shown } : product}
            aspect="aspect-square"
            sizes="(min-width: 768px) 50vw, 100vw"
            priority
          />
        </ImageZoom>
        {product.grade && <GradeBadge grade={product.grade} grades={type?.grades} className="absolute left-4 top-4 z-3" />}
        <p className="pointer-events-none absolute bottom-4 right-4 z-3 hidden items-center gap-1.5 rounded-full border border-line bg-surface/90 px-2.5 py-1 text-xs font-medium text-ink-500 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-0 [@media(hover:hover)]:inline-flex">
          <Search className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
          Hover to magnify
        </p>
      </div>

      {product.images?.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="More pictures">
          {[product.image, ...product.images].filter(Boolean).map((url) => {
            const active = (shown ?? product.image) === url;
            return (
              <li key={url}>
                <button
                  type="button"
                  onClick={() => setShown(url === product.image ? null : url)}
                  aria-pressed={active}
                  aria-label="Show this picture"
                  className={cn(
                    pressable,
                    'size-16 overflow-hidden rounded-md border bg-surface-2',
                    active ? 'border-ink-900' : 'border-line hover:border-line-strong',
                  )}
                >
                  <img src={uploadThumb(url)} alt="" className="size-full object-contain p-1" loading="lazy" decoding="async" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {product.video && (
        // Nothing but the poster downloads until somebody presses play.
        <video
          src={product.video}
          poster={product.videoPoster || undefined}
          controls
          playsInline
          preload="none"
          className="mt-3 aspect-video w-full rounded-lg border border-line bg-ink-900"
        />
      )}
    </>
  );

  const warranty = product.specs?.Warranty;
  const shipsFrom = info.address?.city || info.address?.region;

  return (
    <DetailShell>
      <DetailBreadcrumbs items={crumbs} />

      <DetailHero
        media={media}
        eyebrow={product.partTypeLabel}
        title={productTitle(product.name, product.partTypeLabel)}
        rating={
          // The rating, directly under the title; absent with no reviews, since
          // an empty star row reads as a zero score.
          reviews?.count > 0 && (
            <button
              type="button"
              onClick={() => scrollToSection('product-reviews')}
              className={cn(pressable, 'mt-3 inline-flex items-center gap-2 text-sm text-ink-500 hover:text-ink-900')}
            >
              <Stars rating={reviews.average} />
              <span className="tnum">
                {reviews.average.toFixed(1)} from {reviews.count} {reviews.count === 1 ? 'review' : 'reviews'}
              </span>
            </button>
          )
        }
        badges={
          <>
            {grade && <Badge tone={grade.tone ?? 'neutral'}>{grade.label}</Badge>}
            {/* Availability is a boolean everywhere on the website; the count is warehouse data. */}
            <Badge tone={outOfStock ? 'neutral' : 'ok'}>{outOfStock ? 'Out of stock' : 'In stock'}</Badge>
          </>
        }
        price={
          <DetailPrice
            gated={gated}
            amount={product.price}
            struck={struck ?? (product.market ? product.market.average : null)}
            saving={saving}
            signedIn={isAuthenticated}
            onSignIn={() => openAccount('signin')}
            after={<MarketCompare market={product.market} price={product.price} variant="detail" className="mt-5" />}
          />
        }
        buy={<DetailBuyRow qty={qty} onQty={setQty} onAdd={handleAdd} disabled={outOfStock} justAdded={justAdded} />}
        note={
          (warranty || shipsFrom) && (
            <p className="flex items-start gap-2 text-sm text-ink-400">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
              {[warranty && `${warranty} warranty`, shipsFrom && `Ships from ${shipsFrom}`].filter(Boolean).join(' · ')}
            </p>
          )
        }
        description={product.description}
        facts={
          // The SKU first (a reordering reference), then the type's own features
          // marked for the product page, then any free-form specs.
          <DetailFacts
            rows={[
              ['SKU', product.sku],
              ...(product.features ?? []).map((feature) => [feature.label, feature.value]),
              ...Object.entries(product.specs ?? {}),
            ]}
          />
        }
      />

      {/* The workshop record grades screens on glass, panel, touch and flex: Parts only. */}
      {isParts && <WhyCellvix product={product} className="mt-10 lg:mt-14" />}

      <ProductFaq
        faqs={faqs}
        product={product}
        title={`Questions about this ${noun}`}
        askLabel={`Ask about this ${noun}`}
        className="mt-10 lg:mt-14"
      />

      <ProductReviews
        reviews={reviews?.reviews}
        average={reviews?.average ?? 0}
        count={reviews?.count ?? 0}
        noun={noun}
        className="mt-10 lg:mt-14"
      />

      <ProductArticle article={article} product={product} className="mt-10 lg:mt-14" />

      {/* The same item at another grade, then more for the same model. */}
      <GradeOptions product={product} grades={grades} className="mt-10 lg:mt-14" />

      {related?.length > 0 && (
        <DetailSection id="related-items" title={product.modelName ? `More for the ${product.modelName}` : `More ${typeName.toLowerCase()}`}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">
            {related.slice(0, 4).map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        </DetailSection>
      )}
    </DetailShell>
  );
}

export default ProductDetailPage;
