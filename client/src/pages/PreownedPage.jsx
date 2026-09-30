import { useState } from 'react';
import { Check, ShoppingCart, Smartphone } from 'lucide-react';

import cn from '@/lib/cn';
import { money, count as formatCount } from '@/lib/format';
import { pressable } from '@/lib/motion';
import Button from '@/components/ui/Button';
import Skeleton from '@/components/ui/Skeleton';
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import { usePreownedListings } from '@/hooks/usePreowned';
import useUiStore from '@/store/uiStore';

/**
 * Pre-owned phones, on the website (`/pre-owned`).
 *
 * ## What the page is opened for
 *
 * "Which phones do you have, and what are they like?" So a card leads with the
 * picture and the model, and the grade sits beside the title: with a used
 * phone the grade is half the product. Storage and colour follow, then the
 * description the staff member wrote about this one handset.
 *
 * ## Prices
 *
 * Shown to approved accounts only (client ruling, 2026-09-29), and gated on
 * the server, not blurred here: a guest's payload carries no price at all. So
 * a guest is offered sign-in, a pending account is told why, and only an
 * approved one sees a number and a button.
 *
 * Every phone is one unit. "Add to cart" becomes "In your cart" rather than a
 * quantity, and a phone somebody else buys first disappears from this page.
 */
function PreownedCard({ device, inCart, onAdd, adding, viewer }) {
  const [imageFailed, setImageFailed] = useState(false);
  const openAccount = useUiStore((s) => s.openAccount);
  const photo = !imageFailed && device.photos[0];

  return (
    <li className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <div className="aspect-square bg-surface-2">
        {photo ? (
          <img
            src={photo}
            alt={device.title}
            width={400}
            height={400}
            loading="lazy"
            onError={() => setImageFailed(true)}
            className="size-full object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center">
            <Smartphone className="size-10 text-ink-200" strokeWidth={1.25} aria-hidden="true" />
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3.5 sm:p-4">
        <p className="eyebrow text-brand">{device.gradeLabel}</p>
        <h3 className="mt-1 font-display text-md font-bold leading-snug text-ink-900">
          {[device.brand, device.model].filter(Boolean).join(' ')}
        </h3>
        <p className="mt-0.5 text-sm text-ink-500">
          {[device.storage, device.colour].filter(Boolean).join(' · ') || ' '}
        </p>
        {device.description && (
          <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-500">{device.description}</p>
        )}

        <div className="mt-auto pt-4">
          {device.priceVisible ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="tnum font-display text-xl font-bold text-ink-900">{money(device.priceCents)}</span>
              {viewer === 'staff' ? null : inCart ? (
                <span className="inline-flex h-9 items-center gap-1.5 text-sm font-semibold text-ok">
                  <Check className="size-4" strokeWidth={2.5} aria-hidden="true" />
                  In your cart
                </span>
              ) : (
                <Button size="sm" icon={ShoppingCart} loading={adding} onClick={() => onAdd(device)}>
                  Add to cart
                </Button>
              )}
            </div>
          ) : viewer === 'pending' ? (
            <p className="text-sm text-ink-500">Prices show once your account is approved.</p>
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
      </div>
    </li>
  );
}

export function PreownedPage() {
  const { data, isLoading, error } = usePreownedListings();
  const { user, isApproved, isPanelAccount } = useAuth();
  const { preowned, addPreowned } = useCart();
  const openCart = useUiStore((s) => s.openCart);
  const [adding, setAdding] = useState(null);
  const [addError, setAddError] = useState(null);

  const devices = data?.devices ?? [];
  const inCart = new Set(preowned.map((line) => line.deviceId));
  const viewer = isPanelAccount ? 'staff' : isApproved ? 'approved' : user ? 'pending' : 'guest';

  async function add(device) {
    setAdding(device.id);
    setAddError(null);
    try {
      await addPreowned(device.id);
      openCart?.();
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-6 sm:px-4 lg:px-6 lg:py-8">
      <header className="rounded-xl border border-line bg-surface px-5 py-7 sm:px-8 sm:py-9">
        <p className="eyebrow flex items-center gap-2 text-brand">
          <Smartphone className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
          Pre-owned
        </p>
        <h1 className="mt-3 max-w-xl font-display text-2xl font-bold leading-tight text-ink-900 sm:text-d-sm">
          Phones checked by our technicians, one of each.
        </h1>
        <p className="mt-3 max-w-xl text-md leading-relaxed text-ink-500">
          Every phone here was bought in our shop, tested component by component and graded before it
          was listed. What you see is the handset you get: when it is sold, it is gone.
        </p>
      </header>

      <div className="mb-3 mt-6 flex flex-wrap items-baseline gap-2">
        <h2 className="font-display text-lg font-bold sm:text-xl">
          For sale now
          <span className="tnum ml-2 text-md font-medium text-ink-400">
            {isLoading ? '–' : `${formatCount(devices.length)} ${devices.length === 1 ? 'phone' : 'phones'}`}
          </span>
        </h2>
      </div>

      {addError && (
        <p role="alert" className="mb-3 border-l-2 border-danger pl-3 text-sm text-danger">
          {addError}
        </p>
      )}

      {isLoading ? (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <li key={index}>
              <Skeleton className="aspect-[3/4]" />
            </li>
          ))}
        </ul>
      ) : error ? (
        <p className="py-16 text-center text-md text-ink-500">{error.message}</p>
      ) : devices.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface px-6 py-16 text-center">
          <p className="font-display text-lg font-bold text-ink-900">Nothing for sale right now</p>
          <p className="mt-2 text-md text-ink-500">
            New phones arrive as customers sell them to us. Check back soon.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-4">
          {devices.map((device) => (
            <PreownedCard
              key={device.id}
              device={device}
              viewer={viewer}
              inCart={inCart.has(device.id)}
              adding={adding === device.id}
              onAdd={add}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export default PreownedPage;
