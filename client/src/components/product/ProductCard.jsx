import { useState } from 'react';
import { Link } from 'react-router';
import { Check, Lock, PackageX, ShoppingCart } from 'lucide-react';
import { motion } from '@/lib/motionReact';
import cn from '@/lib/cn';
import { ease, pressable } from '@/lib/motion';
import { money, productTitle } from '@/lib/format';
import GradeBadge from './GradeBadge';
import QtyStepper from './QtyStepper';
import PartFrame, { PartVisual } from './PartFrame';
import MarketCompare from './MarketCompare';
import { useCart } from '@/hooks/useCart';
import useUiStore from '@/store/uiStore';
import { useAuth } from '@/hooks/useAuth';
import { useCatalogConfig } from '@/lib/catalogs';
import Spinner from '@/components/ui/Spinner';

/**
 * The product card (brief §6).
 *
 * Add to Cart is deliberately isolated: it mutates only this card's local state
 * and the cart store. Nothing re-queries, nothing else on the page re-renders,
 * and the quantity badge moves on the same frame as the click.
 */
export function ProductCard({ product }) {
  const [qty, setQty] = useState(1);
  const [justAdded, setJustAdded] = useState(false);

  const { addItem, isAdding, items } = useCart();
  const inCartQty = items.find((item) => item.productId === product.id)?.qty ?? 0;
  const openCartAfterAdd = useUiStore((s) => s.openCartAfterAdd);
  const openAccount = useUiStore((s) => s.openAccount);
  const { isAuthenticated } = useAuth();
  // The type's own grade names for the badge (grades per type).
  const catalog = useCatalogConfig();

  const outOfStock = !product.inStock;
  const gated = !product.priceVisible;

  /**
   * The one number this card strikes through, and what it saves.
   *
   * `compareAtPrice` wins over the market average when both exist. Two struck
   * numbers over one price is a card claiming two different discounts, and our
   * own former price is the more direct claim; the market average still shows
   * inside MarketCompare, where it is labelled.
   *
   * The percentage is derived from whichever number won rather than taken from
   * `market.savingsPercent`, which is computed against the market average. On a
   * product carrying both, those disagree - a 17% market saving beside a strike
   * worth 15% - and the badge has to describe the strike it is sitting next to.
   * Same rounding as the server uses for the market figure, so a card and the
   * breakdown behind it never differ by a point.
   */
  const struckPrice = product.compareAtPrice ?? product.market?.average ?? null;
  const savedPercent =
    struckPrice && struckPrice > product.price
      ? Math.round(((struckPrice - product.price) / struckPrice) * 100)
      : 0;

  function handleAdd() {
    if (outOfStock || isAdding) return;
    addItem(product, qty);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1400);
    // Desktop only - see openCartAfterAdd.
    openCartAfterAdd();
  }

  return (
    // @container so the card adapts to its own width, not the viewport's - the
    // same card sits in a 2-, 3- and 4-column grid.
    <article
      aria-busy={isAdding || undefined}
      // Bordered, not shadowed. §2 allows one or the other and this card is
      // bordered, so hover deepens the border it already has rather than
      // adding a shadow underneath it - a card that gains an elevation it did
      // not have at rest reads as lifting off the page, which is a much larger
      // gesture than "the pointer is here".
      className="group relative @container flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition-[border-color] duration-snap ease-entrance hover:border-ink-200"
    >
      {/* The whole card goes busy, not just the button: the stepper, the price
          and the in-cart pill are all about to change, and a spinner on one
          control implies the rest are still live. */}
      {isAdding && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-surface/65 backdrop-blur-[1px]"
          aria-hidden="true"
        >
          <Spinner size="md" className="text-brand" />
        </div>
      )}

      {/* ---- image ---------------------------------------------------- */}
      <div className="relative shrink-0 overflow-hidden bg-surface-2">
        {/* The dark "Out of stock" pill that used to sit in this corner was a
            third stamp on one image, next to the grade badge and the in-cart
            pill. The part itself carries the state now - drained of colour and
            sat back - and the words live once, down in the body. */}
        {/* PartFrame sets the model name as a watermark BEHIND the part and
            gives the drawing the whole frame, so the image is the biggest thing
            on the card while scrolling. The part type and model are read from
            the body below, with the rest of the text details.

            The zoom lives on the image's own wrapper. Three things were wrong
            with it: `duration-300` on a linear-ish default curve read as a
            lurch, the drawing was scaling inside a frame that also had to make
            room for a caption, and nothing promoted the layer - so the browser
            rasterised the photo mid-scale and the zoom stepped instead of
            gliding. `will-change-transform` promotes it up front, and the
            standard exit curve does the easing. */}
        <PartFrame product={product} aspect="aspect-square">
          <Link
            to={`/product/${product.slug}`}
            className={cn(
              'block size-full transition-transform duration-400 ease-entrance will-change-transform motion-reduce:transition-none',
              // Tailwind v4 compiles `hover:` (and so `group-hover:`) behind
              // `@media (hover: hover)` already, so this does not latch on after
              // a tap on a touch device.
              'group-hover:scale-[1.07]',
              outOfStock && 'opacity-45 grayscale',
            )}
            tabIndex={-1}
            aria-hidden="true"
          >
            <PartVisual product={product} />
          </Link>
        </PartFrame>

        <GradeBadge grade={product.grade} grades={catalog.grades} className="absolute left-2 top-2 @min-[200px]:left-3 @min-[200px]:top-3" />

        {/* A bare number in a coloured circle here read as a second grade stamp
            same shape, same corner of the same image. This is a labelled pill on
            a light ground instead: different shape, different weight, and it
            says what the number counts. */}
        {inCartQty > 0 && (
          <motion.span
            key={inCartQty}
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.22, ease: ease.entrance }}
            className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full border border-brand/25 bg-surface/95 py-1 pl-1.5 pr-2 text-2xs font-semibold text-brand-700 backdrop-blur-[2px] @min-[200px]:bottom-3 @min-[200px]:right-3"
          >
            <ShoppingCart className="size-3 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <span className="tnum">{inCartQty} in cart</span>
          </motion.span>
        )}
      </div>

      {/* ---- body ------------------------------------------------------ */}
      {/* Every size below is driven by the CARD's width (@container), never the
          viewport's: the same card sits in a 2-, 3- and 4-column grid, and on a
          375px phone the 2-up card is ~169px wide. */}
      <div className="flex flex-1 flex-col gap-1.5 p-3 @min-[200px]:gap-2 @min-[200px]:p-3.5">
        {/* The component type and the model are back below the image, with the
            rest of the text details. Above it they sat between the buyer and
            the picture and cost the part a third of the frame's height; the
            frame carries the model as a watermark behind the part instead, and
            the readable copy lives here.

            The <h3> is the card's heading and carries the product link. Clamped
            to two lines so prices stay level across a grid row. */}
        <div>
          <p className="eyebrow text-ink-300">{product.partTypeLabel}</p>
          <h3 className="mt-0.5 line-clamp-2 font-display text-sm font-bold leading-tight tracking-tight text-ink-900 @min-[200px]:text-md">
            <Link to={`/product/${product.slug}`} className={cn(pressable, ' hover:text-brand')}>
              {productTitle(product.name, product.partTypeLabel)}
            </Link>
          </h3>
        </div>

        {/* Availability and price share one slot, because for a part that cannot
            be bought they are one statement.
            A price on an out-of-stock card is a number nobody can act on: it
            invited a buyer to cost a job around a line we could not ship, and it
            made a dead card look like a live one at a glance down the grid. The
            unavailable state takes the slot instead - same height, so the row of
            cards stays level.
            In stock, availability is still a boolean: the on-hand count used to
            sit here, and a buyer planning a build around "37 in stock" was
            planning against a number that moves hourly. */}
        {outOfStock ? (
          <div className="rounded-md border border-line bg-surface-2 px-2.5 py-2">
            <p className="flex items-center gap-1.5 font-display text-sm font-semibold text-ink-500 @min-[200px]:text-sm">
              <PackageX className="size-3.5 shrink-0 text-ink-300" strokeWidth={2.25} aria-hidden="true" />
              Out of stock
            </p>
            <p className="mt-0.5 text-2xs leading-snug text-ink-300 @min-[200px]:text-xs">
              {/* A gated buyer never saw a price to lose, so promising one back
                  would be an odd thing to tell them. */}
              {gated ? 'Check back for availability' : 'Pricing returns when this part does'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5 text-xs @min-[200px]:text-sm">
              <span className="size-1.5 shrink-0 rounded-full bg-ok" aria-hidden="true" />
              <span className="text-ok">In stock</span>
            </div>

            {/* price, gated */}
            <div className="relative">
              <div className={cn(gated && 'price-gated', 'space-y-1')} aria-hidden={gated || undefined}>
                {/* One price row, not two.

                    A struck market average used to sit on its own line ABOVE
                    the price, while a struck `compareAtPrice` sat beside it.
                    So a card with a market saving was two lines tall and a card
                    with a former price was one - the same information in two
                    shapes, side by side in the same grid. Everything strikes
                    inline now, and the reserved spacer that row needed goes
                    with it. */}
                {/* `flex-wrap` with the badge allowed to drop to a second line.
                    A 140px card at 320px cannot hold price + strike + badge on
                    one line, and with everything `shrink-0` the badge was
                    simply clipped off the right edge - the card showed "Sa…"
                    or nothing at all. Wrapping keeps it. */}
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-display text-lg font-bold tracking-tight text-ink-900 tnum @min-[200px]:text-xl @min-[260px]:text-2xl">
                    {gated ? '$000.00' : money(product.price)}
                  </span>

                  {/* The struck number and the saving are ONE statement, so
                      they are rendered together rather than as alternatives.

                      They used to be a ternary: a struck `compareAtPrice`, OR
                      the market saving. That meant the 17 products carrying
                      both showed the strike and silently dropped the badge
                      the cards a buyer is most likely to compare were the ones
                      missing the reason to.

                      The percentage is computed from whichever number is
                      actually struck. Reusing `market.savingsPercent` beside a
                      struck own-price would label one comparison with the
                      other one's figure: on the Galaxy Z Flip 5 that is a 17%
                      market saving printed next to a strike worth 15%. */}
                  {!gated && struckPrice && (
                    <>
                      {/* Hidden on the narrowest card. Of the three figures the
                          strike is the one that can go: the badge already states
                          the saving as a number, and MarketCompare below repeats
                          the struck price with its sellers. */}
                      <span className="tnum hidden text-sm text-ink-300 line-through @min-[170px]:inline">
                        {money(struckPrice)}
                      </span>
                      {savedPercent > 0 && (
                        // The saving beside the price, not under it: it is a
                        // property of this number. The word "Save" is kept at
                        // every width - a bare "21%" beside a price is ambiguous
                        // enough to read as a rate rather than a discount, and
                        // the phone grid is where most buyers meet it.
                        <span className="tnum shrink-0 rounded-full bg-ok-50 px-1.5 py-0.5 text-2xs font-bold text-ok">
                          Save {savedPercent}%
                        </span>
                      )}
                    </>
                  )}
                </div>
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

            {/* What the same part costs elsewhere. Renders nothing unless the
                server sent a comparison - which it does not when the price is
                gated, or when we are not actually the cheaper option.
                Shown at every card width: it is the reason to buy the part, so
                hiding it on the surface most buyers are on was the wrong tradeoff.
                MarketCompare drops its own chevron and tightens its type below
                200px so it stays one line on a ~169px two-up card. */}
            <MarketCompare market={product.market} price={product.price} />
          </>
        )}

        {/* Add to cart. One row at every card width - the stepper narrows with
            the card (QtyStepper size="card") instead of dropping onto a second
            line, which is what made the two-up phone card 80px taller than it
            needed to be. Under 200px the button's word goes and the trolley
            carries it; the accessible name is on aria-label either way. */}
        {/* Out of stock, the whole action row goes. The stock block above already
            says the card is not actionable; a greyed control under it is a
            second way of saying so and a target people still try to press. */}
        {!outOfStock && (
          <div className="mt-0.5 flex items-center gap-1.5 @min-[200px]:gap-2">
            <QtyStepper value={qty} onChange={setQty} size="card" className="shrink-0" />

            <button
              type="button"
              onClick={handleAdd}
              disabled={isAdding}
              aria-label={`Add ${product.name} to cart`}
              className={cn(
                pressable,
                'flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md font-display text-sm font-semibold',
                /**
                 * The brand gradient. Add to cart is the card's primary
                 * action, and the client's direction is that the gradient IS
                 * the brand rather than a treatment to be rationed - a grid of
                 * cards each carrying it reads as Cellvix, which is the point.
                 *
                 * `justAdded` flips to solid green for its 1.4s, because that
                 * moment is confirmation rather than invitation and needs to be
                 * unmistakably a different state, not a different shade.
                 */
                justAdded
                  ? 'bg-ok text-white'
                  : 'bg-brand-gradient text-white hover:brightness-110',
              )}
            >
              {/* Icon only on a narrow card. The trolley is a well-understood
                  glyph and the button is the full width of the row beside the
                  stepper, so there is no doubt what it does - and dropping the
                  word buys the price and the compare control the horizontal
                  room they actually need. `aria-label` above carries the name
                  either way, so nothing is lost to a screen reader. */}
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
      </div>
    </article>
  );
}

export default ProductCard;
