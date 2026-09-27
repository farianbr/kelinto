import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, Lock, Search, ShieldCheck, ShoppingCart } from 'lucide-react';
import cn from '@/lib/cn';
import { uploadThumb } from '@/lib/media';
import api from '@/lib/api';
import { money, productTitle } from '@/lib/format';
import { GRADES } from '@/lib/constants';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import QtyStepper from '@/components/product/QtyStepper';
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
import { useCart } from '@/hooks/useCart';
import { useAuth } from '@/hooks/useAuth';
import useUiStore from '@/store/uiStore';
import useFilterStore from '@/store/filterStore';
import { pressable } from '@/lib/motion';

function Breadcrumbs({ product }) {
  const setPath = useFilterStore((s) => s.setPath);

  // Crumbs filter the shop rather than pointing at category routes - the
  // taxonomy has no pages of its own (brief §3, §5).
  const crumbs = [
    { label: product.deviceTypeName, path: { deviceType: product.deviceTypeSlug } },
    {
      label: product.brandName,
      path: { deviceType: product.deviceTypeSlug, brand: product.brandSlug },
    },
    {
      label: product.modelName,
      path: {
        deviceType: product.deviceTypeSlug,
        brand: product.brandSlug,
        series: product.seriesSlug,
        model: product.modelSlug,
      },
    },
  ].filter((crumb) => crumb.label);

  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1 text-sm">
      <Link to="/shop" className={cn(pressable, 'text-ink-400 hover:text-brand')}>
        Shop
      </Link>
      {crumbs.map((crumb) => (
        <span key={crumb.label} className="flex items-center gap-1">
          <ChevronRight className="size-3.5 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
          <Link
            to="/shop"
            onClick={() => setPath(crumb.path)}
            className={cn(pressable, 'text-ink-400 hover:text-brand')}
          >
            {crumb.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}

export function ProductDetailPage() {
  const { slug } = useParams();
  const [qty, setQty] = useState(1);
  // Which of the product's own pictures is in the frame; null is the main one.
  const [shown, setShown] = useState(null);
  const [justAdded, setJustAdded] = useState(false);

  const { addItem } = useCart();
  const { isAuthenticated } = useAuth();
  const openCartAfterAdd = useUiStore((s) => s.openCartAfterAdd);
  const openAccount = useUiStore((s) => s.openAccount);

  const { data, isLoading, error } = useQuery({
    queryKey: ['product', slug],
    queryFn: () => api.get(`/products/${slug}`),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-8 lg:px-6">
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
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 className="text-2xl">Part not found</h1>
        <p className="mt-3 text-md text-ink-500">{error.message}</p>
        <Link
          to="/shop"
          className="mt-6 inline-flex items-center gap-1.5 text-md font-semibold text-brand hover:text-brand-700"
        >
          Back to the catalogue
        </Link>
      </div>
    );
  }

  const { product, related, faqs, grades, article, reviews } = data;
  const gated = !product.priceVisible;
  const outOfStock = !product.inStock;
  const grade = GRADES[product.grade];

  function handleAdd() {
    addItem(product, qty);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1400);
    // Desktop only - on a phone the dropdown would cover the page you just
    // acted on. See openCartAfterAdd.
    openCartAfterAdd();
  }

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-6 sm:px-4 lg:px-6 lg:py-8">
      <Breadcrumbs product={product} />

      <div className="grid gap-6 md:grid-cols-2 lg:gap-10">
        {/* ---- visual ------------------------------------------------------ */}
        {/* The same PartFrame the grid card uses, at aspect-square - the model
            sits as a watermark behind the part. One component, so the treatment
            cannot drift between the two. The <h1> beside this owns the name.

            ImageZoom wraps it for the mouse: a wholesale buyer is checking a
            connector or a stamped number against the part in their hand, which
            a 600px photo does not settle. It renders its children untouched on
            touch devices and where there is no photograph. */}
        <div className="min-w-0">
        <div className="group relative overflow-hidden rounded-lg border border-line bg-surface-2">
          <ImageZoom product={shown ? { ...product, image: shown } : product}>
            <PartFrame
              product={shown ? { ...product, image: shown } : product}
              aspect="aspect-square"
              sizes="(min-width: 768px) 50vw, 100vw"
              priority
            />
          </ImageZoom>

          <GradeBadge grade={product.grade} className="absolute left-4 top-4 z-3" />

          {/* Says the magnifier is there. Hidden from touch, where it is not,
              and it fades once the pointer is over the image - by then the lens
              is on screen and saying so twice is clutter over the picture. */}
          <p className="pointer-events-none absolute bottom-4 right-4 z-3 hidden items-center gap-1.5 rounded-full border border-line bg-surface/90 px-2.5 py-1 text-xs font-medium text-ink-500 backdrop-blur-[2px] transition-opacity duration-200 group-hover:opacity-0 [@media(hover:hover)]:inline-flex">
            <Search className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
            Hover to magnify
          </p>
        </div>

        {/* The product's other pictures, when the business uploaded any. The
            main picture leads the row so there is always a way back to it. */}
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
        </div>

        {/* ---- detail ------------------------------------------------------ */}
        <div className="min-w-0">
          <p className="eyebrow mb-2 text-ink-300">{product.partTypeLabel}</p>
          <h1 className="text-2xl leading-tight sm:text-3xl">
            {productTitle(product.name, product.partTypeLabel)}
          </h1>

          {/* The rating, directly under the title. It is the one number a
              buyer wants before any other on this page, and it links to the
              reviews rather than repeating them here. Absent entirely with no
              reviews - an empty star row reads as a zero score. */}
          {reviews?.count > 0 && (
            <button
              type="button"
              onClick={() => scrollToSection('product-reviews')}
              className={cn(pressable, 'mt-3 inline-flex items-center gap-2 text-sm text-ink-500 hover:text-ink-900')}
            >
              <Stars rating={reviews.average} />
              <span className="tnum">
                {reviews.average.toFixed(1)} from {reviews.count}{' '}
                {reviews.count === 1 ? 'review' : 'reviews'}
              </span>
            </button>
          )}

          {/* Availability is a boolean here and everywhere else on the
              storefront. The on-hand count is warehouse data, and printing it
              invited buyers to plan against a number that moves hourly. */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge tone={grade?.tone ?? 'neutral'}>{grade?.label ?? product.grade}</Badge>
            <Badge tone={outOfStock ? 'neutral' : 'ok'}>
              {outOfStock ? 'Out of stock' : 'In stock'}
            </Badge>
          </div>

          {/* price, gated */}
          <div className="relative mt-6">
            {/* The same shape as the grid card, at detail-page sizes: the
                struck comparison ABOVE, so it is read before the number it
                justifies, and the saving as a badge BESIDE that number, because
                it is a property of it. The two surfaces disagreeing about how a
                discount looks made the same product read as two different
                offers.

                `compareAtPrice` wins when both exist - two struck numbers over
                one price is a card claiming two discounts, and our own former
                price is the more direct claim. */}
            <div className={cn(gated && 'price-gated')} aria-hidden={gated || undefined}>
              {!gated && !product.compareAtPrice && product.market && (
                <span className="tnum text-lg text-ink-300 line-through">
                  {money(product.market.average)}
                </span>
              )}

              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                <span className="tnum font-display text-d-sm font-bold tracking-tight text-ink-900">
                  {gated ? '$000.00' : money(product.price)}
                </span>

                {!gated && product.compareAtPrice ? (
                  <span className="tnum text-lg text-ink-300 line-through">
                    {money(product.compareAtPrice)}
                  </span>
                ) : (
                  !gated &&
                  product.market && (
                    <span className="tnum shrink-0 rounded-full bg-ok-50 px-2 py-0.5 text-sm font-bold text-ok">
                      Save {product.market.savingsPercent}%
                    </span>
                  )
                )}
              </div>
            </div>

            {gated && (
              <button
                type="button"
                onClick={() => openAccount('signin')}
                className={cn(pressable, 'absolute inset-0 -m-2 flex items-center justify-start rounded-lg bg-surface/40 backdrop-blur-[1px] hover:bg-surface/20')}
              >
                <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-semibold text-ink-700">
                  <Lock className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                  {isAuthenticated ? 'Pending approval' : 'Sign in to view wholesale pricing'}
                </span>
              </button>
            )}
          </div>

          {/* What the same part costs elsewhere. Absent while the price is
              gated - the server sends no comparison without a price to compare. */}
          {!gated && (
            <MarketCompare market={product.market} price={product.price} variant="detail" className="mt-5" />
          )}

          {/* add to cart */}
          <div className="mt-6 flex flex-wrap items-stretch gap-3">
            <QtyStepper value={qty} onChange={setQty} disabled={outOfStock} />
            <Button
              size="md"
              className="min-w-[180px] flex-1"
              onClick={handleAdd}
              disabled={outOfStock}
              icon={justAdded ? Check : ShoppingCart}
              variant={justAdded ? 'solid' : 'primary'}
            >
              {justAdded ? 'Added to cart' : 'Add to cart'}
            </Button>
          </div>

          <p className="mt-4 flex items-start gap-2 text-sm text-ink-400">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            Tested before dispatch · {product.specs?.Warranty ?? '30 days'} warranty · Ships from
            Ontario
          </p>

          {product.description && (
            <p className="mt-6 text-md leading-relaxed text-ink-500">{product.description}</p>
          )}

          {/* The SKU used to sit under the title, where it was the second thing
              on the page and meant nothing to a buyer still deciding. It is a
              reordering reference, so it lives with the rest of the reference
              data - first row, because it is the one a buyer comes back for. */}
          {product.specs && Object.keys(product.specs).length > 0 && (
            <dl className="mt-6 overflow-hidden rounded-lg border border-line">
              {Object.entries({ SKU: product.sku, ...product.specs }).map(([key, value], index) => (
                <div
                  key={key}
                  className={cn(
                    'flex justify-between gap-4 px-4 py-2.5 text-sm',
                    index % 2 === 1 && 'bg-surface-2',
                  )}
                >
                  <dt className="text-ink-500">{key}</dt>
                  <dd className="text-right font-medium text-ink-900">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>

      {/* ---- why Cellvix ---------------------------------------------------- */}
      <WhyCellvix product={product} className="mt-10 lg:mt-14" />

      {/* ---- product FAQ ---------------------------------------------------- */}
      {/* Sits above Related on purpose: the questions belong to the part being
          looked at, and a grid of other parts is an invitation to leave. */}
      <ProductFaq faqs={faqs} product={product} className="mt-10 lg:mt-14" />

      {/* ---- reviews --------------------------------------------------------
          Above the article and below the FAQ. A review is short, specific and
          about this exact part, which makes it more use to a wavering buyer
          than several hundred words about the component type in general.
          Renders nothing until somebody has written one. */}
      <ProductReviews
        reviews={reviews?.reviews}
        average={reviews?.average ?? 0}
        count={reviews?.count ?? 0}
        className="mt-10 lg:mt-14"
      />

      {/* ---- the article ----------------------------------------------------
          Below the FAQ: the questions are shorter and more often the actual
          blocker, so they get the higher slot. Above Related for the reason
          Related is last - a grid of other parts is an invitation to leave, and
          it should not sit in the middle of something being read. */}
      <ProductArticle article={article} product={product} className="mt-10 lg:mt-14" />

      {/* ---- the same part, other grades ------------------------------------
          Directly above Related, and drawn with the same card grid, so the two
          read as a pair: the same part at another grade, then other parts for
          the same phone. A grade is a separate product with its own price,
          stock and add-to-cart, so it gets the component the site already uses
          for a product you might buy rather than a row in a table of
          attributes. Renders nothing when we stock this part at one grade. */}
      <GradeOptions product={product} grades={grades} className="mt-10 lg:mt-14" />

      {/* ---- related -------------------------------------------------------- */}
      {related?.length > 0 && (
        <section className="mt-10 lg:mt-14">
          <h2 className="mb-4 text-xl">More parts for the {product.modelName}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">
            {related.slice(0, 4).map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default ProductDetailPage;
