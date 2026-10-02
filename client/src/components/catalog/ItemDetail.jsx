import { Link } from 'react-router';
import { Check, ChevronRight, Lock, ShoppingCart } from 'lucide-react';

import cn from '@/lib/cn';
import { money } from '@/lib/format';
import { pressable } from '@/lib/motion';
import Button from '@/components/ui/Button';
import QtyStepper from '@/components/product/QtyStepper';

/**
 * The detail page every sellable thing shares (client ruling 2026-10-02:
 * "properly redesign/rework the product/service detail page so that the page
 * design is properly maintained as businesses add more product types").
 *
 * ## Why pieces, not one page
 *
 * A part, a phone, a car and a repair are bought the same way and read the
 * same way: where it sits in the catalogue, a picture, what it is, what
 * condition, whether it can be had, the price, the button, then the facts and
 * the long copy. What differs is only what fills those slots (a part has a
 * market comparison, a repair has a bench time). So the page is a fixed frame
 * of named slots, and each item kind fills them; a new product type gets the
 * whole page by filling the same slots with its own features, and nothing on
 * the page has to learn what a phone or a car is.
 *
 * - `DetailShell`: the width and the vertical rhythm.
 * - `DetailBreadcrumbs`: where it sits, starting from its own catalogue.
 * - `DetailHero`: picture left, the decision right, in a fixed order.
 * - `DetailPrice`, `DetailBuyRow`: the one price block and the one button row,
 *   behind the same gate everywhere.
 * - `DetailFacts`: the reference table (SKU, the type's features, specs).
 * - `DetailSection`: every block under the hero, one heading style, one gap.
 */

export function DetailShell({ children }) {
  return <div className="mx-auto max-w-[1400px] px-3 py-6 sm:px-4 lg:px-6 lg:py-8">{children}</div>;
}

/** `items`: `{ label, to, onClick }`, the first being the item's own catalogue. */
export function DetailBreadcrumbs({ items }) {
  const list = items.filter((item) => item?.label);
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-center gap-1 text-sm">
      {list.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-1">
          {index > 0 && <ChevronRight className="size-3.5 text-ink-300" strokeWidth={2.25} aria-hidden="true" />}
          {item.to ? (
            <Link to={item.to} onClick={item.onClick} className={cn(pressable, 'text-ink-400 hover:text-brand')}>
              {item.label}
            </Link>
          ) : (
            <span className="text-ink-500">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/**
 * Picture left, decision right. The right column always reads in this order,
 * whatever the item: eyebrow (its type or kind), title, rating, badges
 * (grade, availability), the price, the buy row, one reassurance line, the
 * short description, the facts table. A slot left empty simply closes up.
 */
export function DetailHero({ media, eyebrow, title, rating, badges, price, buy, note, description, facts }) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:gap-10">
      <div className="min-w-0">{media}</div>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2 text-ink-300">{eyebrow}</p>}
        <h1 className="text-2xl leading-tight sm:text-3xl">{title}</h1>
        {rating}
        {badges && <div className="mt-4 flex flex-wrap items-center gap-2">{badges}</div>}
        {price && <div className="mt-6">{price}</div>}
        {buy && <div className="mt-6">{buy}</div>}
        {note && <div className="mt-4">{note}</div>}
        {description && <p className="mt-6 text-md leading-relaxed text-ink-500">{description}</p>}
        {facts && <div className="mt-6">{facts}</div>}
      </div>
    </div>
  );
}

/**
 * The price, behind the same gate on every item: a blurred placeholder and a
 * sign-in pill for anybody not approved to see it, never the number. `struck`
 * and `saving` are the strike-through and its badge when there is one; `after`
 * sits under the price (a part's market comparison). `quoted` replaces the
 * whole block for an item priced on inspection.
 */
export function DetailPrice({ gated, amount, struck = null, saving = null, after = null, signedIn, onSignIn, quoted = null }) {
  if (quoted) return quoted;
  return (
    <div>
      <div className="relative">
        <div className={cn(gated && 'price-gated')} aria-hidden={gated || undefined}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
            <span className="tnum font-display text-d-sm font-bold tracking-tight text-ink-900">
              {gated ? '$000.00' : money(amount)}
            </span>
            {!gated && struck != null && <span className="tnum text-lg text-ink-300 line-through">{money(struck)}</span>}
            {!gated && saving != null && saving > 0 && (
              <span className="tnum shrink-0 rounded-full bg-ok-50 px-2 py-0.5 text-sm font-bold text-ok">Save {saving}%</span>
            )}
          </div>
        </div>
        {gated && (
          <button
            type="button"
            onClick={onSignIn}
            className={cn(pressable, 'absolute inset-0 -m-2 flex items-center justify-start rounded-lg bg-surface/40 backdrop-blur-[1px] hover:bg-surface/20')}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-semibold text-ink-700">
              <Lock className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              {signedIn ? 'Pending approval' : 'Sign in to view the price'}
            </span>
          </button>
        )}
      </div>
      {!gated && after}
    </div>
  );
}

/** The quantity stepper and the one Add to cart button, the same for every item. */
export function DetailBuyRow({ qty, onQty, onAdd, disabled = false, loading = false, justAdded = false, error = null, footnote = null }) {
  return (
    <div>
      <div className="flex flex-wrap items-stretch gap-3">
        <QtyStepper value={qty} onChange={onQty} disabled={disabled} />
        <Button
          size="md"
          className="min-w-[180px] flex-1"
          onClick={onAdd}
          disabled={disabled}
          loading={loading}
          icon={justAdded ? Check : ShoppingCart}
          variant={justAdded ? 'solid' : 'primary'}
        >
          {justAdded ? 'Added to cart' : 'Add to cart'}
        </Button>
      </div>
      {footnote && <p className="mt-3 text-sm text-ink-500">{footnote}</p>}
      {error && (
        <p role="alert" className="mt-3 border-l-2 border-danger pl-3 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** The reference table: `rows` as `[label, value]`, empty values left out. */
export function DetailFacts({ rows }) {
  const list = rows.filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (!list.length) return null;
  return (
    <dl className="overflow-hidden rounded-lg border border-line">
      {list.map(([label, value], index) => (
        <div key={label} className={cn('flex justify-between gap-4 px-4 py-2.5 text-sm', index % 2 === 1 && 'bg-surface-2')}>
          <dt className="text-ink-500">{label}</dt>
          <dd className="text-right font-medium text-ink-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One block under the hero: the same gap, rule and heading everywhere. */
export function DetailSection({ id, title, action = null, children, className }) {
  return (
    <section aria-labelledby={id} className={cn('mt-10 border-t border-line pt-8 lg:mt-14', className)}>
      {title && (
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id={id} className="font-display text-xl font-bold text-ink-900">
            {title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
