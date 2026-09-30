import { useSearchParams } from 'react-router';
import { Clock, ShieldCheck, Wrench } from 'lucide-react';

import cn from '@/lib/cn';
import { money } from '@/lib/format';
import { pressable } from '@/lib/motion';
import Skeleton from '@/components/ui/Skeleton';
import { useAuth } from '@/hooks/useAuth';
import { usePublicServices } from '@/hooks/useContent';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import useUiStore from '@/store/uiStore';

/**
 * Repair services, on the website (`/services`, 2026-09-30).
 *
 * ## What the page is opened for
 *
 * "Do you fix this, and what does it cost?" So it reads as a price list, not a
 * catalogue: one row per service, the name and what it covers on the left, the
 * price on the right where the eye goes looking for it. Bench time and warranty
 * sit under the name, because they are the two things a customer weighs
 * against the price.
 *
 * ## Prices
 *
 * Gated on the server like every part: a guest's payload carries no price, so
 * a guest is offered sign-in and a pending account is told why.
 *
 * `?category=` picks a category; the mobile menu's Shop › Services drill-down
 * links straight to one. With none picked the list is grouped under headings.
 */
function duration(minutes) {
  if (!minutes) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function ServiceRow({ service, viewer }) {
  const openAccount = useUiStore((s) => s.openAccount);
  const bench = duration(service.durationMinutes);

  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:px-5">
      <div className="min-w-0">
        <h3 className="font-display text-md font-bold text-ink-900">{service.name}</h3>
        {service.description && (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-500">{service.description}</p>
        )}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
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
          {service.deviceTypes.length > 0 && <span>{service.deviceTypes.join(' · ')}</span>}
        </p>
      </div>

      <div className="shrink-0 sm:text-right">
        {service.priceCents !== undefined ? (
          <span className="tnum font-display text-lg font-bold text-ink-900">
            {service.priceCents > 0 ? money(service.priceCents) : 'Quoted on inspection'}
          </span>
        ) : viewer === 'pending' ? (
          <span className="text-sm text-ink-500">Prices show once your account is approved.</span>
        ) : (
          <button
            type="button"
            onClick={() => openAccount('signin')}
            className={cn(pressable, 'text-sm font-semibold text-brand hover:text-brand-700')}
          >
            Sign in to see the price
          </button>
        )}
      </div>
    </li>
  );
}

function ServiceList({ services, viewer }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {services.map((service) => (
        <ServiceRow key={service.id} service={service} viewer={viewer} />
      ))}
    </ul>
  );
}

export function ServicesPage() {
  useDocumentTitle('Services');

  const { user, isApproved, isPanelAccount } = useAuth();
  const { data, isLoading, error } = usePublicServices(isApproved || isPanelAccount);
  const [params, setParams] = useSearchParams();

  const categories = data?.categories ?? [];
  const services = data?.services ?? [];
  const requested = params.get('category');
  const category = categories.some((entry) => entry.slug === requested) ? requested : null;
  const viewer = isApproved || isPanelAccount ? 'approved' : user ? 'pending' : 'guest';

  const pick = (slug) => setParams(slug ? { category: slug } : {}, { replace: true });

  return (
    <div className="mx-auto max-w-[1100px] px-3 py-6 sm:px-4 lg:px-6 lg:py-8">
      <header className="rounded-xl border border-line bg-surface px-5 py-7 sm:px-8 sm:py-9">
        <p className="eyebrow flex items-center gap-2 text-brand">
          <Wrench className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
          Services
        </p>
        <h1 className="mt-3 max-w-xl font-display text-2xl font-bold leading-tight text-ink-900 sm:text-d-sm">
          Repairs we do at the counter, and what they cost.
        </h1>
        <p className="mt-3 max-w-xl text-md leading-relaxed text-ink-500">
          Every price is a starting point for a device in normal condition. We confirm it once we
          have seen yours, before any work begins.
        </p>
      </header>

      {categories.length > 1 && (
        <div className="scroll-slim -mx-3 mt-6 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {[{ slug: null, name: 'All services', count: services.length }, ...categories].map((option) => {
            const active = category === option.slug;
            return (
              <button
                key={option.slug ?? 'all'}
                type="button"
                onClick={() => pick(option.slug)}
                aria-pressed={active}
                className={cn(
                  pressable,
                  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium',
                  active
                    ? 'border-brand bg-brand-50 text-brand-700'
                    : 'border-line bg-surface text-ink-500 hover:border-line-strong hover:text-ink-900',
                )}
              >
                {option.name}
                <span className="tnum text-xs text-ink-300">{option.count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-5">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-20 rounded-lg" />
            ))}
          </div>
        ) : error || services.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface px-6 py-16 text-center">
            <p className="font-display text-lg font-bold text-ink-900">No services listed yet</p>
            <p className="mt-2 text-md text-ink-500">
              Tell us what needs fixing through Contact us and we will price it for you.
            </p>
          </div>
        ) : category ? (
          <ServiceList services={services.filter((row) => row.category === category)} viewer={viewer} />
        ) : (
          <div className="space-y-6">
            {categories.map((group) => (
              <section key={group.slug} aria-labelledby={`services-${group.slug}`}>
                <h2 id={`services-${group.slug}`} className="mb-2 font-display text-lg font-bold text-ink-900">
                  {group.name}
                </h2>
                <ServiceList
                  services={services.filter((row) => row.category === group.slug)}
                  viewer={viewer}
                />
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ServicesPage;
