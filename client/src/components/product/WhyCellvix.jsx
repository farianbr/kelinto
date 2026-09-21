import { Link } from 'react-router';
import { ArrowUpRight, Check, MapPin, Stamp } from 'lucide-react';
import cn from '@/lib/cn';
import { GRADES } from '@/lib/constants';
import useBusinessInfo from '@/hooks/useBusinessInfo';
import { pressable } from '@/lib/motion';

/**
 * The trust block on a product page.
 *
 * Deliberately NOT a grid of six icons and six claims - that is what every
 * supplier's page says, and a wholesale buyer comparing two of them learns
 * nothing from it. This is shaped like the document a business buyer actually
 * trusts: a workshop record with the part's own SKU and grade stamped on it, the
 * four checks that grade was awarded against, and then the commercial terms as
 * numbered clauses rather than marketing tiles.
 *
 * The left column is specific to the product being looked at; the right column
 * is the same four promises everywhere, which is honest - they ARE the same
 * four promises. Without a product (the blog article uses it) the record
 * collapses to the house standard.
 *
 * The gradient appears as a 2px rule at the top and nowhere else: a bordered
 * panel, not a promo block (PROJECT_INSTRUCTIONS.md §2.2).
 */

/** The four faults every pull and aftermarket assembly is graded against. */
const WORKSHOP_CHECKS = [
  { label: 'Glass', detail: 'Hairlines under raking light, chips, bezel lift' },
  { label: 'Panel', detail: 'Dead and stuck subpixels, burn-in, backlight' },
  { label: 'Touch', detail: 'Full surface, then the outer 3 mm on its own' },
  { label: 'Flex', detail: 'Connector wear, kinks, evidence of re-seating' },
];

/**
 * Built from the business on screen rather than at import.
 *
 * The first clause named both the province and the city from the hardcoded
 * constant, so every business's product page claimed to ship from the
 * wholesaler's warehouse. The heading now follows the address it describes.
 */
const clausesFor = (info) => [
  {
    title: info.address?.region ? `Ships from ${info.address.region}` : 'Ships from our warehouse',
    body: `Stock sits in ${info.address?.city ? `the ${info.address.city} warehouse` : 'our own warehouse'}. In-stock parts ordered before 3:00 PM ET leave the same business day - no customs step in the middle.`,
  },
  {
    title: 'Wholesale pricing, on terms',
    body: 'Approved businesses buy on Net 15, 30 or 60 against a credit limit set by the sales desk, not a card charged one order at a time.',
  },
  {
    title: 'Warranty you can claim',
    body: '30 days as standard and 90 on NEW and OEM, from delivery. A claim is an order number and a photograph to your rep - approved ones ship a replacement from stock.',
  },
  {
    title: 'A named person to call',
    body: 'Every approved account has an account rep. Sourcing an unlisted part, raising a limit or chasing a claim is one message, not a ticket queue.',
  },
];

export function WhyCellvix({ product = null, className }) {
  const grade = product ? (GRADES[product.grade] ?? null) : null;
  const info = useBusinessInfo();
  const clauses = clausesFor(info);

  return (
    <section
      aria-labelledby="why-cellvix"
      className={cn('overflow-hidden rounded-lg border border-line bg-surface', className)}
    >
      <div className="rule-brand-gradient h-0.5" aria-hidden="true" />

      <div className="grid gap-0 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* ---- the workshop record ------------------------------------------- */}
        <div className="border-b border-line bg-surface-2 p-5 lg:border-b-0 lg:border-r lg:p-6">
          <p className="eyebrow mb-4 flex items-center gap-1.5 text-ink-400">
            <Stamp className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            Workshop record
          </p>

          {product ? (
            <div className="mb-5 flex items-start gap-3">
              {/* The grade as a stamp: the one thing a buyer checks first, and
                  the thing the four rows below are the evidence for. */}
              <span className="flex size-14 shrink-0 rotate-[-6deg] flex-col items-center justify-center rounded-md border-2 border-brand/35 bg-surface text-brand">
                <span className="font-display text-lg font-extrabold leading-none tracking-tight">
                  {(grade?.short ?? product.grade).split(' ')[0]}
                </span>
                {(grade?.short ?? '').split(' ')[1] && (
                  <span className="font-display text-lg font-extrabold leading-none tracking-tight">
                    {grade.short.split(' ')[1]}
                  </span>
                )}
              </span>

              <span className="min-w-0">
                <span className="block font-mono text-sm text-ink-700">{product.sku}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-ink-500">
                  Graded {grade?.label ?? product.grade} · {product.specs?.Warranty ?? '30 days'}{' '}
                  warranty
                </span>
                {info.address?.city && (
                  <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-ink-400">
                    <MapPin className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                    {[info.address.city, info.address.region].filter(Boolean).join(', ')}
                  </span>
                )}
              </span>
            </div>
          ) : (
            <p className="mb-5 text-sm leading-relaxed text-ink-500">
              Every pull and aftermarket assembly is graded by hand on the same four checks before
              it is listed, and quality-checked again at pick time.
            </p>
          )}

          <ul className="space-y-0 border-t border-line">
            {WORKSHOP_CHECKS.map((check) => (
              <li
                key={check.label}
                className="flex items-start gap-2.5 border-b border-line py-2.5"
              >
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-ok text-white">
                  <Check className="size-2.5" strokeWidth={4} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink-900">
                    {check.label}
                  </span>
                  <span className="block text-xs leading-snug text-ink-400">
                    {check.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-3.5 text-xs leading-relaxed text-ink-400">
            The worst result of the four sets the grade. Anything that fails touch or panel is
            scrap and never reaches the catalogue.
          </p>
        </div>

        {/* ---- the commercial clauses -------------------------------------- */}
        <div className="p-5 lg:p-6">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="why-cellvix" className="text-xl sm:text-xl">
              What buying from {info.name} gets you
            </h2>
            <Link
              to="/about"
              className={cn(pressable, 'inline-flex items-center gap-0.5 text-sm font-semibold text-brand hover:text-brand-700')}
            >
              About us
              <ArrowUpRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            </Link>
          </div>

          {/* Numbered clauses on hairlines, not tiles in boxes: this is a terms
              sheet, and it should read like one. */}
          <ol className="border-t border-line">
            {clauses.map((clause, index) => (
              <li key={clause.title} className="flex gap-4 border-b border-line py-3.5">
                <span className="tnum mt-0.5 shrink-0 font-mono text-xs font-medium text-brand">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0">
                  <span className="block text-md font-semibold text-ink-900">
                    {clause.title}
                  </span>
                  <span className="mt-1 block text-sm leading-relaxed text-ink-500">
                    {clause.body}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export default WhyCellvix;
