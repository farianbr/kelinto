import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ArrowRight, Home, Search } from 'lucide-react';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { useFilterStore } from '@/store/filterStore';

/**
 * 404 - a recovery moment, not a dead end (brief §9).
 *
 * Deliberately the thinnest page in the app. A 404 is read for about two
 * seconds by someone who is already annoyed, so it offers exactly two ways out
 * - search the catalogue, or go home - and nothing else. The category chips and
 * the three cross-link cards that used to sit below the fold were removed for
 * that reason: they were a second menu on a page whose whole job is to hand you
 * back to the first one.
 *
 * ## The layout
 *
 * A centred column under a cable that has come apart. The illustration sits in
 * the same measure as the copy rather than bleeding to the viewport: the artwork
 * carries its own margin around the subject, so widening the FILE widens the
 * whitespace and shrinks the plugs relative to the page. Everything is centred
 * on one axis, so the eye goes parting, numerals, sentence, action, in that
 * order.
 *
 * The numerals are the biggest type in the app and they are `ink-900`, not the
 * brand ramp. A gradient fill on text is banned outright (§2.2), and with the
 * artwork now monochrome the CTA below is the only colour on the page - which
 * is the point: one place to look, and it is the way out.
 *
 * The search field is the point of the page: someone who followed a broken link
 * is looking for a part, and a list of category shortcuts is a slower answer
 * than a text box. It writes the shared filter store as well as the URL,
 * because the shop hydrates from the URL once per mount and merges into
 * whatever the store still holds from an earlier visit.
 */
export function NotFoundPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [query, setQuery] = useState('');

  function search(event) {
    event.preventDefault();
    const term = query.trim();
    if (!term) return;

    const store = useFilterStore.getState();
    store.resetAll();
    store.setQuery(term);
    // Straight to the grid. `/?q=` would redirect there anyway, but going via
    // the homepage means a wasted render and a history entry nobody wanted.
    navigate(`/shop?q=${encodeURIComponent(term)}`);
  }

  return (
    <div className="flex flex-col items-center overflow-hidden pt-8 pb-14 lg:pt-12 lg:pb-20">
      {/* Sized to the measure, not bled to the viewport.

          It WAS full-bleed and pushed to 170% on a phone, which is the right
          treatment for artwork whose subject runs edge to edge - the earlier
          inline SVG drew the cable at full width, so clipping the slack lead
          was free and the plugs stayed large. This file is not that: the
          subject sits in the middle with a lot of empty margin around it, so
          scaling the FILE up scales the margin up too. The plugs stayed small,
          the whitespace grew, and the picture swamped the page while saying
          less.

          So it is capped at the same 640px measure the copy below uses, and it
          is centred on the same axis. The parting sits directly over the
          numerals, which is the alignment the page is built around.

          `aspect-745/335` is the file's own ratio, reserved before the image
          decodes - without it the numerals jump down the page on load, and a
          404 that moves while somebody is reading it is the one thing this
          screen must not do.

          Eager, not lazy: it is the first thing in the viewport, and lazy
          loading the only picture on the page buys nothing. */}
      <img
        src="/404-artwork.png"
        alt=""
        width={745}
        height={335}
        loading="eager"
        decoding="async"
        className="aspect-745/335 h-auto w-full max-w-105 px-5 sm:max-w-130 lg:max-w-150"
      />

      <div className="mx-auto mt-2 flex w-full max-w-160 flex-col items-center px-5 text-center sm:px-6">
        {/* The numerals ARE the heading - marked up as one, not as decoration
            with a screen-reader label bolted beside it. `tabular-nums` so the
            two 4s and the 0 sit on even widths at this size, where the default
            proportional set leaves a visible gap after the first digit. */}
        {/* The top of the type scale, and the only place in the app that uses
            it. `d-xl` already carries its own tracking and a line-height of 1,
            so the numerals need nothing added: an arbitrary size here would be
            a defect (§2.1), and the scale stopping at 72px is the answer to
            "how big" rather than a limit to work around. */}
        <h1 className="tnum font-display text-d-md font-extrabold text-ink-900 sm:text-d-lg lg:text-d-xl">
          404
        </h1>

        <p className="mt-4 font-display text-2xl font-bold tracking-[-0.015em] text-ink-900 sm:text-3xl">
          This page came apart
        </p>

        <p className="mt-3 max-w-md text-lg leading-relaxed text-ink-500">
          Nothing here answers to{' '}
          <span className="break-all font-mono text-md text-ink-700">{pathname}</span>. Search
          the catalogue instead.
        </p>

        {/* The field and its button stack at 320 rather than squeezing onto one
            row: `flex-1` on a `min-w` basis wide enough to type into cannot fit
            beside a button at that width without one of them overflowing. */}
        <form
          onSubmit={search}
          className="mt-7 flex w-full max-w-md flex-col gap-2.5 sm:flex-row sm:items-center"
        >
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Part name, model or SKU…"
            icon={Search}
            aria-label="Search the catalogue"
            containerClassName="w-full sm:flex-1 sm:min-w-0"
          />
          <Button type="submit" size="md" iconRight={ArrowRight} className="w-full sm:w-auto">
            Search
          </Button>
        </form>

        {/* The gradient belongs on the CTA, and this is the CTA (§2.2). Styled
            inline the way every other button-shaped Link in the app is, because
            `Button` renders a real <button> and this has to be an anchor. */}
        <Link
          to="/"
          className="mt-4 inline-flex h-11 w-full max-w-md items-center justify-center gap-2 rounded-md bg-brand-gradient px-6 font-display text-md font-semibold text-white transition-[filter] duration-press hover:brightness-110 active:brightness-95 sm:mt-6 sm:w-auto"
        >
          <Home className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />
          Go to home
        </Link>
      </div>
    </div>
  );
}

export default NotFoundPage;
