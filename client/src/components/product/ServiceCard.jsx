import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Check, Clock, Lock, ShieldCheck, ShoppingCart, Wrench } from 'lucide-react';

import cn from '@/lib/cn';
import { money } from '@/lib/format';
import { pressable } from '@/lib/motion';
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import useUiStore from '@/store/uiStore';
import Spinner from '@/components/ui/Spinner';
import QtyStepper from './QtyStepper';

/** Bench time as a person says it: "45 min", "2h", "1h 30m". */
export function serviceDuration(minutes) {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** Bench time and warranty, the two things a customer weighs against a price. */
export function ServiceFacts({ service, className }) {
  const bench = serviceDuration(service.durationMinutes);
  if (!bench && !(service.warrantyDays > 0)) return null;
  return (
    <p className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400', className)}>
      {bench && (
        <span className="inline-flex items-center gap-1">
          <Clock className="size-3.5" strokeWidth={2} aria-hidden="true" />
          {bench}
        </span>
      )}
      {service.warrantyDays > 0 && (
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="size-3.5" strokeWidth={2} aria-hidden="true" />
          {service.warrantyDays}-day warranty
        </span>
      )}
    </p>
  );
}

/**
 * One repair service in the Services grid, built as the product card is
 * (client ruling 2026-10-02: "whatever we are selling in website should be
 * treated same way").
 *
 * Same frame, same order, same controls: the picture square and edge to
 * edge, the repair type as the eyebrow over the name, then the fact a buyer
 * checks before the price (for a part, that it is in stock; for a service,
 * the bench time and warranty), the price behind the same gate, and the same
 * quantity stepper and gradient Add button. A service priced at nothing is
 * quoted on inspection, so it offers a quote where the button would be.
 */
export function ServiceCard({ service }) {
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);
  const [imageFailed, setImageFailed] = useState(false);

  const { services: lines, addService } = useCart();
  const openCartAfterAdd = useUiStore((s) => s.openCartAfterAdd);
  const openAccount = useUiStore((s) => s.openAccount);
  const { isAuthenticated, isPanelAccount } = useAuth();

  const inCartQty = lines.find((line) => line.serviceId === service.id)?.qty ?? 0;
  const gated = !service.priceVisible;
  const quoted = service.priceVisible && !(service.priceCents > 0);
  const photo = !imageFailed && service.image;
  const href = service.slug ? `/services/${service.slug}` : null;
  const Title = href ? Link : 'span';

  async function handleAdd() {
    if (adding) return;
    setAdding(true);
    setError(null);
    try {
      await addService(service.id, qty);
      setJustAdded(true);
      setTimeout(() => setJustAdded(false), 1400);
      openCartAfterAdd?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  const image = photo ? (
    <img
      src={photo}
      alt=""
      width={400}
      height={400}
      loading="lazy"
      onError={() => setImageFailed(true)}
      className="size-full object-cover"
    />
  ) : (
    <span className="flex size-full items-center justify-center">
      <Wrench className="size-10 text-ink-200" strokeWidth={1.25} aria-hidden="true" />
    </span>
  );

  return (
    <article
      aria-busy={adding || undefined}
      className="group relative @container flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition-[border-color] duration-snap ease-entrance hover:border-ink-200"
    >
      {adding && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-surface/65 backdrop-blur-[1px]"
          aria-hidden="true"
        >
          <Spinner size="md" className="text-brand" />
        </div>
      )}

      {/* ---- image ---------------------------------------------------- */}
      <div className="relative aspect-square shrink-0 overflow-hidden bg-surface-2">
        {href ? (
          <Link
            to={href}
            tabIndex={-1}
            aria-hidden="true"
            className="block size-full transition-transform duration-400 ease-entrance will-change-transform group-hover:scale-[1.07] motion-reduce:transition-none"
          >
            {image}
          </Link>
        ) : (
          image
        )}

        {inCartQty > 0 && (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full border border-brand/25 bg-surface/95 py-1 pl-1.5 pr-2 text-2xs font-semibold text-brand-700 backdrop-blur-[2px] @min-[200px]:bottom-3 @min-[200px]:right-3">
            <ShoppingCart className="size-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <span className="tnum">{inCartQty} in cart</span>
          </span>
        )}
      </div>

      {/* ---- body ------------------------------------------------------ */}
      <div className="flex flex-1 flex-col gap-1.5 p-3 @min-[200px]:gap-2 @min-[200px]:p-3.5">
        <div>
          <p className="eyebrow text-ink-300">{service.categoryLabel}</p>
          <h3 className="mt-0.5 line-clamp-2 font-display text-sm font-bold leading-tight tracking-tight text-ink-900 @min-[200px]:text-md">
            <Title {...(href ? { to: href } : {})} className={cn(href && pressable, href && 'hover:text-brand')}>
              {service.name}
            </Title>
          </h3>
          {service.scopeLabel && <p className="mt-0.5 truncate text-xs text-ink-500">{service.scopeLabel}</p>}
        </div>

        {/* Where a part says it is in stock, a service says how long and how covered. */}
        <ServiceFacts service={service} />

        {quoted ? (
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-sm font-medium text-ink-700">Quoted on inspection</span>
            <Link
              to="/contact?topic=quote"
              className={cn(pressable, 'inline-flex h-9 items-center gap-1 text-sm font-semibold text-brand hover:text-brand-700')}
            >
              Get a quote
              <ArrowRight className="size-3.5" strokeWidth={2} aria-hidden="true" />
            </Link>
          </div>
        ) : (
          <>
            <div className="relative mt-auto">
              <div className={cn(gated && 'price-gated')} aria-hidden={gated || undefined}>
                <span className="font-display text-lg font-bold tracking-tight text-ink-900 tnum @min-[200px]:text-xl @min-[260px]:text-2xl">
                  {gated ? '$000.00' : money(service.priceCents)}
                </span>
              </div>
              {gated && (
                <button
                  type="button"
                  onClick={() => openAccount('signin')}
                  className={cn(pressable, 'absolute inset-0 -m-1 flex items-center justify-center rounded-lg bg-surface/45 backdrop-blur-[1px] hover:bg-surface/25')}
                >
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink-700">
                    <Lock className="size-3" strokeWidth={2.5} aria-hidden="true" />
                    {isAuthenticated ? 'Pending approval' : 'Login to view price'}
                  </span>
                </button>
              )}
            </div>

            {!gated && !isPanelAccount && (
              <div className="mt-0.5 flex items-center gap-1.5 @min-[200px]:gap-2">
                <QtyStepper value={qty} onChange={setQty} size="card" className="shrink-0" />
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={adding}
                  aria-label={`Add ${service.name} to cart`}
                  className={cn(
                    pressable,
                    'flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md font-display text-sm font-semibold',
                    justAdded ? 'bg-ok text-white' : 'bg-brand-gradient text-white hover:brightness-110',
                  )}
                >
                  {justAdded ? (
                    <>
                      <Check className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                      <span className="hidden @min-[200px]:inline">Added</span>
                    </>
                  ) : (
                    <>
                      <ShoppingCart className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                      <span className="hidden @min-[200px]:inline">Add</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="border-l-2 border-danger pl-2 text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}

export default ServiceCard;
