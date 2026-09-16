import { Link, useNavigate } from 'react-router';
import { motion } from 'motion/react';
import {
  ArrowRight,
  BadgeCheck,
  Clock,
  PackageCheck,
  Tag,
  Truck,
} from 'lucide-react';
import cn from '@/lib/cn';
import { ease, pressable } from '@/lib/motion';
import { money } from '@/lib/format';
import { useHomeSections } from '@/hooks/useCatalog';
import { useOffers } from '@/hooks/useContent';
import { useAuth } from '@/hooks/useAuth';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import ProductCard from '@/components/product/ProductCard';
import Skeleton from '@/components/ui/Skeleton';
import CountdownTimer from '@/components/ui/CountdownTimer';
import SectionFrame from '@/components/ui/SectionFrame';
import PromoBanner from '@/components/home/PromoBanner';
import FeaturedSplit from '@/components/home/FeaturedSplit';
import TabWizard from '@/components/filters/TabWizard';
import useFilterStore, { toSearchParams } from '@/store/filterStore';
import { PartVisual } from '@/components/product/PartFrame';

/**
 * The homepage.
 *
 * NOT the catalogue. The shop moved to /shop and this page sits in front of it,
 * which changes what the front door is for: a buyer who knows the part they
 * need goes straight to search or the catalogue, so this page is for the two
 * who do not - somebody deciding whether to open an account, and a regular
 * checking what is worth ordering this week.
 *
 * Which is why every section here answers "what should I buy" rather than
 * restating the filter tree. The hero is the offer with a clock on it, the rows
 * below are clearance and new stock, and the categories are a way in for
 * somebody who does not yet know our part names.
 *
 * HOW IT IS STRUCTURED. Every section is a `SectionFrame` - a bordered box
 * whose heading sits in a tab breaking its top edge - and the run of frames is
 * broken twice by a `PromoBanner`, which is filled and carries a cut corner
 * rather than a border. That alternation is the layout idea: the page was
 * previously a flat column of heading-then-grid, where every section carried
 * identical weight and the eye had nothing to count. A reader skimming now sees
 * five containers and two interruptions instead of one continuous list.
 */

/** What the desk promises, stated once, under the hero. */
const ASSURANCES = [
  {
    icon: PackageCheck,
    title: 'Tested before boxing',
    body: 'Every part is checked at the Toronto warehouse, not sampled by the pallet.',
  },
  {
    icon: Truck,
    title: 'Same-day dispatch',
    body: 'Orders clearing before 2 PM ET leave the same day, Canada-wide.',
  },
  {
    icon: BadgeCheck,
    title: 'Graded, and it means something',
    body: 'NEW, OEM, Pull A/B and aftermarket. The grade on the card is the grade in the box.',
  },
];

/* -------------------------------------------------------------------------- */

/**
 * The hero.
 *
 * One offer, not a carousel. A rotating hero asks a reader to wait for the
 * thing they want to come back around, and on a wholesale site the thing that
 * earns the space is whatever is time-limited today - hence the clock. With no
 * live offer it falls back to the catalogue, because an empty hero is worse
 * than a plain one.
 */
function Hero({ offer, isLoading }) {
  if (isLoading) {
    return <Skeleton className="h-[380px] rounded-xl sm:h-[420px]" />;
  }

  const hasOffer = Boolean(offer);
  const endsAt = offer?.endsAt ? new Date(offer.endsAt) : null;
  const lead = offer?.products?.[0] ?? null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: ease.entrance }}
      // A BORDERED LIGHT PANEL, not a flooded one.
      //
      // This was a full-bleed brand gradient, which broke the rule the gradient
      // exists to serve: it is a signature, not a background (Instructions
      // §2.2). At hero size the ramp stopped reading as depth and became a wall
      // of red that every element on it then had to fight - white text, a white
      // button, a white price chip and four translucent countdown tiles, none
      // of which could be the thing the eye went to first, because the loudest
      // thing on the panel was the panel.
      //
      // On surface, the brand goes back to being scarce: the eyebrow, the
      // countdown separators, the saving and the one primary button. Bordered,
      // not shadowed, per §2.
      className="overflow-hidden rounded-xl border border-line bg-surface"
      aria-label={hasOffer ? offer.title : 'Wholesale parts'}
    >
      <div className="grid items-center gap-8 px-5 py-8 sm:px-8 sm:py-10 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-12 lg:px-12 lg:py-14">
        {/* ---- the words ------------------------------------------------ */}
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-2 text-brand">
            <Tag className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
            {hasOffer ? (offer.badge || 'Running now') : 'Wholesale'}
          </p>

          <h1 className="mt-3 font-display text-2xl font-bold leading-tight text-ink-900 sm:text-d-sm lg:text-d-md">
            {hasOffer ? offer.title : 'Graded parts, wholesale prices, on terms.'}
          </h1>

          <p className="mt-3 max-w-lg text-md leading-relaxed text-ink-500">
            {hasOffer
              ? offer.subtitle || offer.description
              : 'Over 400 SKUs across phones, tablets, laptops and consoles, picked and tested in Toronto and shipped Canada-wide.'}
          </p>

          {/* The clock is the reason this offer is in the hero rather than in
              the offers list, so it sits directly under the claim. */}
          {endsAt && (
            <div className="mt-6">
              <p className="eyebrow mb-2 flex items-center gap-1.5 text-ink-400">
                <Clock className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                Ends in
              </p>
              <CountdownTimer endsAt={endsAt} />
            </div>
          )}

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              to={hasOffer ? `/deals/${offer.slug}` : '/shop'}
              // The one gradient on the panel, and the only filled element:
              // with everything else on surface it is unambiguously the thing
              // to press.
              //
              // COMPACT ramp. The button is about 170px wide, and on the
              // standard ramp its near-black opening takes the first third of
              // that - which reads as a dark blob on the left of the button
              // rather than as depth across it.
              className={cn(pressable, 'inline-flex h-12 items-center gap-2 rounded-lg bg-brand-gradient-compact px-6 font-display text-md font-semibold text-white hover:brightness-110')}
            >
              {hasOffer ? 'See the deal' : 'Browse the catalogue'}
              <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
            </Link>

            {hasOffer && (
              <Link
                to="/shop"
                className={cn(pressable, 'inline-flex h-12 items-center rounded-lg border border-line px-6 font-display text-md font-semibold text-ink-700 hover:border-line-strong hover:text-ink-900')}
              >
                Browse all parts
              </Link>
            )}
          </div>
        </div>

        {/* ---- the part -------------------------------------------------
            The lead part from the offer, drawn on its own disc. No stock
            photography anywhere on this site, so the hero shows the thing
            being sold rather than somebody holding it. */}
        {lead && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.15, ease: ease.entrance }}
            className="relative hidden lg:block"
          >
            {/* A faint brand tint, not a field of it. The disc exists to give
                the part an edge to sit against so it does not float on bare
                surface - that needs about 4% of the colour, not all of it. */}
            <div className="mx-auto flex aspect-square w-full max-w-[340px] items-center justify-center rounded-full bg-brand-50 p-12">
              <PartVisual product={lead} />
            </div>

            {offer.priceVisible && offer.bundlePrice > 0 && (
              /* Two rows, centred, not three values on one line.
                 Crammed onto a single row the saving wrapped and sat under the
                 price as a stray fragment, because the pill is centred on the
                 disc and sized by its own contents. Price and list price are
                 one thought and stay on one line; the saving is a second
                 thought and gets its own badge under it. */
              <div className="absolute bottom-0 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5 rounded-2xl border border-line bg-surface px-5 py-3 shadow-flyout">
                <span className="flex items-baseline gap-2 whitespace-nowrap">
                  <span className="tnum font-display text-xl font-bold text-ink-900">
                    {money(offer.bundlePrice)}
                  </span>
                  {offer.regularTotal > offer.bundlePrice && (
                    <span className="tnum text-sm text-ink-400 line-through">
                      {money(offer.regularTotal)}
                    </span>
                  )}
                </span>

                {/* The saving is the argument, so it is the one thing here
                    carrying colour. A struck-through list price on its own
                    makes the reader do the subtraction. */}
                {offer.regularTotal > offer.bundlePrice && (
                  <span className="tnum whitespace-nowrap rounded-full bg-ok-50 px-2 py-0.5 text-xs font-semibold text-ok">
                    Save {money(offer.regularTotal - offer.bundlePrice)}
                  </span>
                )}
              </div>
            )}
          </motion.div>
        )}
      </div>
    </motion.section>
  );
}

/* -------------------------------------------------------------------------- */

export function HomePage() {
  useDocumentTitle();
  const navigate = useNavigate();

  const { user } = useAuth();
  const isApproved = user?.status === 'approved';
  // Signed in, waiting on the desk. A distinct state from "guest": the account
  // exists, so inviting them to open one is the wrong thing to say. Matched
  // exactly rather than as "not approved" - `rejected` and `suspended` are also
  // not approved, and telling either of those that the desk is still reviewing
  // them would be a lie the panel cannot back up.
  const isPending = user?.status === 'pending';
  // Nobody signed in. The only state the "open an account" pitch is for -
  // a rejected or suspended account sees nothing, because neither the pitch nor
  // the reassurance is true for them and the homepage is not where that
  // conversation belongs.
  const isGuest = !user;
  const priceVisible = isApproved;

  const { data: sections, isLoading } = useHomeSections();
  const { data: offersData } = useOffers(priceVisible);

  /**
   * `/offers` answers `{ featured, deals, combos }`, not a flat list - the
   * offers page renders those three differently and the endpoint shapes them
   * for it. Flattened here because this page cares about one thing only:
   * which offers are exclusive.
   */
  const offers = [
    ...(offersData?.featured ? [offersData.featured] : []),
    ...(offersData?.combos ?? []),
    ...(offersData?.deals ?? []),
  ].filter(
    (offer, index, all) => all.findIndex((other) => other.id === offer.id) === index,
  );

  // The exclusive deal leads if there is one; otherwise whatever is featured.
  const heroOffer = offers.find((o) => o.isExclusive) ?? offers.find((o) => o.isFeatured) ?? offers[0];
  const exclusives = offers.filter((o) => o.isExclusive);

  const brands = sections?.brands ?? [];


  /**
   * Take a wizard choice to the catalogue.
   *
   * The wizard writes the shared filter store, which on the Shop page is the
   * whole mechanism - the grid re-renders under it. Here there is no grid, so a
   * pick wrote the store and visibly did nothing.
   *
   * **Navigated WITH the query string, not just to `/shop`.** The store is a
   * module singleton and survives the navigation, so `/shop` alone would in fact
   * show the right products - and the URL would say nothing, which breaks the
   * back button, a refresh, and sharing the link. `useFilterUrlSync` treats the
   * URL as the whole filter state and re-hydrates from it before paint, so
   * arriving at a bare `/shop` would actively CLEAR the choices that were just
   * made. The params are built by `toQueryParams`, the same function that hook
   * writes with, so the two cannot disagree about how a filter is spelled.
   */
  function showParts() {
    const query = toSearchParams(useFilterStore.getState()).toString();
    navigate(query ? `/shop?${query}` : '/shop');
  }
  const clearance = sections?.clearance ?? [];
  const newest = sections?.newest ?? [];

  /**
   * The two promo banners.
   *
   * Each is real stock, never a placeholder: the first shows a cleared part,
   * the second something newly on the shelf. A banner carrying invented art on
   * a wholesale site is the one thing that would make the whole page read as a
   * template, and both rows are already loaded for the sections below, so this
   * costs no extra request.
   *
   * Indexed past the cards rather than at [0]: the first four of each row are
   * already drawn as cards in their own section a few hundred pixels up, and a
   * banner repeating one of them is a wasted block. The server sends eight.
   */
  const clearancePromo = clearance[4] ?? clearance[0] ?? null;
  const newestPromo = newest[5] ?? newest[0] ?? null;

  /** The featured split: one part large, the rest of the row beside it. */
  const featuredLead = newest[0] ?? null;
  const featuredRest = newest.slice(1, 6);

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-4 sm:px-4 lg:px-6 lg:py-6">
      <Hero offer={heroOffer} isLoading={isLoading && !offersData} />

      {/* ---- what the desk promises -------------------------------------
          Deliberately NOT a framed section: these are three statements about
          the business rather than a container of stock, and putting a tab on
          them would claim they are one more browsable list. They sit tight
          under the hero because they qualify it. */}
      <ul className="mt-4 grid gap-3 sm:grid-cols-3">
        {ASSURANCES.map(({ icon: Icon, title, body }) => (
          <li
            key={title}
            className="flex gap-3 rounded-lg border border-line bg-surface p-4"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              <Icon className="size-4.5" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block font-display text-md font-bold text-ink-900">{title}</span>
              <span className="mt-0.5 block text-sm leading-relaxed text-ink-500">{body}</span>
            </span>
          </li>
        ))}
      </ul>

      {/* ---- find your part -------------------------------------------
          The way in for somebody who does not yet know our part names.

          **This replaced a "Shop by device" tile grid**, and the reason is what
          the catalogue actually is: smartphone-only by rule (CLAUDE.md), so that
          grid was usually ONE tile reading "Smartphone - 773 parts". A section
          whose whole job is to offer a choice, offering one, is a section that
          answers nothing - and the tile only took the buyer to the same
          unfiltered grid `/shop` already is.

          The wizard asks the question the tile was standing in for: which
          component, for which device. It is the same `TabWizard` the Shop page
          carries, writing the same shared filter store, so a buyer who starts
          here arrives at `/shop` with their choices already applied rather than
          starting again. One filter with three faces (§5.3), not a fourth.

          Unconditional, unlike the tiles: the wizard loads its own taxonomy and
          renders its own skeleton, so it has something to show before
          `useHomeSections` resolves. */}
      <SectionFrame
        id="home-find-part"
        eyebrow="Start here"
        title="Find your part"
        to="/shop"
        linkLabel="All parts"
      >
        <TabWizard onComplete={showParts} />
      </SectionFrame>

      {/* ---- clearance ------------------------------------------------- */}
      {clearance.length > 0 && (
        <SectionFrame
          id="home-clearance"
          eyebrow="Finite stock"
          title="On clearance"
          to="/clearance"
          linkLabel="All clearance"
          tone="muted"
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
            {clearance.slice(0, 4).map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </SectionFrame>
      )}

      {/* ---- promo: clearance ------------------------------------------
          The first break in the run of frames. Clearance is the page's
          strongest argument to a price-led buyer, so it gets the block that is
          a different shape rather than a fifth card in the grid above. */}
      {clearancePromo && (
        <PromoBanner
          eyebrow="Cleared to go"
          title="Last of the line."
          titleAccent="Priced to clear."
          script="While the shelf lasts"
          to="/clearance"
          ctaLabel="Clearance"
          product={clearancePromo}
        />
      )}

      {/* ---- exclusive deals ------------------------------------------- */}
      {exclusives.length > 0 && (
        <SectionFrame id="home-exclusive" eyebrow="Ends on the clock" title="Exclusive deals" fit>
          {/* A width for the frame to fit TO. The frame is `fit`, so without
              one a lone deal collapses to the width of its own title; with a
              full-width frame it was the opposite defect, a 90px strip with
              700px of empty panel after the text. Two deals go side by side
              and set their own width. */}
          <div
            className={cn(
              'grid gap-3',
              exclusives.length > 1 ? 'lg:grid-cols-2' : 'lg:w-[560px]',
            )}
          >
            {exclusives.map((offer) => (
              <Link
                key={offer.id}
                to={`/deals/${offer.slug}`}
                className={cn(pressable, 'group flex items-center gap-5 rounded-lg border border-line bg-surface p-5 transition-[border-color] duration-snap ease-entrance hover:border-brand/40')}
              >
                {offer.products?.[0] && (
                  <span className="flex size-24 shrink-0 items-center justify-center rounded-lg bg-surface-2 p-3">
                    <PartVisual product={offer.products[0]} />
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="eyebrow text-brand">{offer.badge || 'Exclusive'}</span>
                  <span className="mt-1 block font-display text-lg font-bold text-ink-900 group-hover:text-brand">
                    {offer.title}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-sm leading-relaxed text-ink-500">
                    {offer.subtitle || offer.description}
                  </span>

                  {offer.priceVisible && offer.bundlePrice > 0 && (
                    <span className="mt-2.5 flex items-baseline gap-2">
                      <span className="tnum font-display text-lg font-bold text-ink-900">
                        {money(offer.bundlePrice)}
                      </span>
                      {offer.savings > 0 && (
                        <span className="tnum text-sm font-medium text-ok">
                          Save {money(offer.savings)}
                        </span>
                      )}
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </SectionFrame>
      )}

      {/* ---- newest ---------------------------------------------------- */}
      {newest.length > 0 && (
        <SectionFrame
          id="home-newest"
          eyebrow="Just landed"
          title="New in stock"
          to="/shop?sort=newest"
          linkLabel="See what is new"
          tone="muted"
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
            {newest.slice(0, 4).map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </SectionFrame>
      )}

      {/* ---- promo: new stock ------------------------------------------
          Reversed, so the two banners do not read as the same block printed
          twice down the page. */}
      {newestPromo && (
        <PromoBanner
          eyebrow="Just landed"
          title="New on the shelf."
          titleAccent="Tested this week."
          script="Fresh off the workshop"
          to="/shop?sort=newest"
          ctaLabel="New stock"
          product={newestPromo}
          reverse
        />
      )}

      {/* ---- one part, up close ----------------------------------------
          A fourth grid of equal cards would say nothing the three above have
          not already said. This gives one part the room to be argued for, and
          keeps the rest of the row reachable beside it. */}
      {featuredLead && (
        <SectionFrame
          id="home-featured"
          eyebrow="Worth a look"
          title="Part of the week"
          to="/shop"
          linkLabel="Browse the catalogue"
        >
          <FeaturedSplit lead={featuredLead} rest={featuredRest} />
        </SectionFrame>
      )}

      {/* ---- brands ----------------------------------------------------
          Depth of catalogue per brand, not a logo wall - we have no licensed
          brand marks and setting the names as type is honest about that. The
          count is the claim: it says what we actually carry. */}
      {brands.length > 0 && (
        <SectionFrame id="home-brands" eyebrow="Depth of stock" title="Brands we carry" tone="muted" fit>
          {/* Same reason as the device tiles: ten brands is the cap and we
              usually carry four, so these size to content and wrap. */}
          <div className="flex flex-wrap gap-3">
            {brands.map((brand) => (
              <Link
                key={brand.slug}
                to={`/shop?brand=${brand.slug}`}
                className={cn(pressable, 'group flex min-w-[130px] flex-1 basis-[150px] flex-col items-center gap-1 rounded-lg border border-line bg-surface px-3 py-5 text-center transition-[border-color] duration-snap ease-entrance hover:border-brand/40 sm:max-w-[200px] sm:flex-none')}
              >
                <span className="font-display text-md font-bold text-ink-900 group-hover:text-brand">
                  {brand.name}
                </span>
                {/* A hairline under the name: it separates the claim from the
                    name without needing a second weight of type, and it is
                    what stops the tile being two lines of text in a box. */}
                <span className="my-1 block h-px w-8 bg-line-strong" aria-hidden="true" />
                <span className="tnum text-xs text-ink-400">{brand.count} parts</span>
              </Link>
            ))}
          </div>
        </SectionFrame>
      )}

      {/* ---- open an account ------------------------------------------
          Last, and only one of them. A wholesale site's front page has exactly
          one conversion and this is it; putting it here rather than in the
          hero means a reader meets it after the stock has made the case.

          It is for people who do not have an account. An approved buyer sees
          nothing here - they are already inside, prices are already showing,
          and "Prices show once your account is approved" reads as a site that
          does not know who it is talking to. Somebody still waiting gets the
          one thing they actually need, which is to know the wait is normal.

          NOT framed and NOT cut: it is the page one conversion, and it closes
          the page rather than joining the browsable stack above it. */}
      {(isGuest || isPending) && (
        <section className="mt-10 overflow-hidden rounded-xl border border-line bg-surface px-5 py-8 sm:mt-12 sm:px-8 sm:py-10">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="min-w-0 max-w-lg">
              <h2 className="font-display text-xl font-bold text-ink-900 sm:text-2xl">
                {isPending
                  ? 'Your account is still under review.'
                  : 'Prices show once your account is approved.'}
              </h2>
              <p className="mt-2 text-md leading-relaxed text-ink-500">
                {isPending
                  ? 'The desk usually clears an application within one business day. Your cart is kept while you wait, and pricing appears the moment it is approved.'
                  : 'Wholesale pricing, credit terms and the quick order pad, usually within one business day. Browsing needs nothing.'}
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              {isPending ? (
                <Link
                  to="/contact"
                  className={cn(pressable, 'inline-flex h-12 items-center gap-2 rounded-lg border border-line-strong bg-surface px-6 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
                >
                  Ask the desk
                  <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
                </Link>
              ) : (
                <Link
                  to="/contact"
                  className={cn(pressable, 'inline-flex h-12 items-center gap-2 rounded-lg bg-brand-gradient px-6 font-display text-md font-semibold text-white transition-[filter] hover:brightness-110')}
                >
                  Open an account
                  <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
                </Link>
              )}
              <Link
                to="/shop"
                className={cn(pressable, 'inline-flex h-12 items-center rounded-lg border border-line-strong bg-surface px-6 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
              >
                {isPending ? 'Keep browsing' : 'Browse first'}
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export default HomePage;
