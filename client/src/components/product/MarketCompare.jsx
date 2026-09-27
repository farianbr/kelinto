import { useId, useState } from 'react';
import { ChevronDown, TrendingDown } from 'lucide-react';
import cn from '@/lib/cn';
import { money } from '@/lib/format';
import { pressable } from '@/lib/motion';
import useBusinessInfo from '@/hooks/useBusinessInfo';

/**
 * The competitor comparison.
 *
 * Every number here is computed server-side (productService.marketPosition) and
 * arrives on `product.market`. Nothing in this file subtracts one price from
 * another - the saving on the card and the saving in the breakdown are the same
 * integer, so they cannot disagree by a rounding step.
 *
 * `market` is null whenever there is nothing honest to claim: no benchmarks, or
 * we are not actually cheaper than the market average. It also never survives
 * the price gate, so a buyer who cannot see our price cannot see the market's.
 *
 * Two shapes, one source:
 *   variant="card" - one line, collapsed, opens a breakdown in place.
 *   variant="detail" - the same breakdown, already open.
 */
export function MarketCompare({ market, price, variant = 'card', className }) {
  const info = useBusinessInfo();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (!market) return null;

  const { competitors, average, savings, savingsPercent, isLowest } = market;

  // The rows, ours included and cheapest first - a comparison table that does
  // not rank is just a list, and the reader has to do the ordering themselves.
  const rows = [
    { name: info.name || 'Us', price, isUs: true },
    ...competitors.map((entry) => ({ ...entry, isUs: false })),
  ].sort((a, b) => a.price - b.price);

  const breakdown = (
    <ul className="space-y-1">
      {rows.map((row) => (
        <li
          key={row.name}
          className={cn(
            'flex items-baseline justify-between gap-3 text-xs',
            row.isUs ? 'font-semibold text-ink-900' : 'text-ink-500',
          )}
        >
          <span className="min-w-0 truncate">{row.name}</span>
          <span className="tnum shrink-0">{money(row.price)}</span>
        </li>
      ))}
      <li className="flex items-baseline justify-between gap-3 border-t border-line pt-1 text-xs text-ink-400">
        <span>Market average</span>
        <span className="tnum">{money(average)}</span>
      </li>
    </ul>
  );

  if (variant === 'detail') {
    return (
      <div className={cn('rounded-lg border border-line bg-surface-2 p-4', className)}>
        <p className="flex items-center gap-2 font-display text-md font-bold text-ok">
          <TrendingDown className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          {isLowest ? 'Lowest price of the parts we track' : `Save ${money(savings)} vs market`}
        </p>
        <p className="mb-3 mt-1 text-xs leading-snug text-ink-400">
          {savingsPercent}% under the average of {competitors.length} comparable wholesale{' '}
          {competitors.length === 1 ? 'listing' : 'listings'}. Indicative pricing, checked
          periodically.
        </p>
        {breakdown}
      </div>
    );
  }

  // ---- card ---------------------------------------------------------------
  // A button, not a hover: the grid is the phone's primary surface and there is
  // no hover there.
  //
  // The breakdown opens as a layer over the card's own body rather than in
  // flow. Expanding it in flow stretched the grid row and shoved the price and
  // Add button of every other card on that row downwards - reading one card's
  // comparison should not move three cards the reader was not touching.
  //
  // It hangs UPWARD from the trigger (`bottom-full`) because the card clips its
  // own overflow: below the trigger there is only the Add row and then the card
  // edge, while above it is the image, which is the space to borrow.
  return (
    <div className={cn('relative', className)}>
      {/* A bordered button rather than a text row: the saving now lives beside
          the price as a badge, so this control's only job is to open the
          comparison - and a control that opens something should look like one.

          It names the count in full at EVERY width. "Compare 4" used to be the
          narrow form, on the theory that the number is the half that carries
          the information - but a bare count next to a chart glyph does not say
          what is being counted, and the phone grid is the surface most buyers
          are on. The word wraps to a second line on a very narrow card rather
          than being cut, which costs a few pixels of height and keeps the
          control legible. */}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className={cn(pressable, 'flex w-full items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 text-2xs font-semibold leading-tight text-ink-700 hover:border-line-strong hover:bg-surface-2 @min-[200px]:text-xs')}
      >
        <TrendingDown className="size-3 shrink-0 text-ok @min-[200px]:size-3.5" strokeWidth={2.5} aria-hidden="true" />
        <span className="tnum min-w-0 text-center">
          Compare {competitors.length} {competitors.length === 1 ? 'seller' : 'sellers'}
        </span>
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-ink-300 transition-transform duration-200',
            open && 'rotate-180',
          )}
          strokeWidth={2.25}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute inset-x-0 bottom-full z-20 mb-1.5 rounded-md bg-surface p-2.5 shadow-flyout"
        >
          {breakdown}
        </div>
      )}
    </div>
  );
}

export default MarketCompare;
