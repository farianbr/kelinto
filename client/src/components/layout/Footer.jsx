import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpRight,
  Facebook,
  HelpCircle,
  Instagram,
  Linkedin,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquare,
  Phone,
  Youtube,
} from 'lucide-react';
import cn from '@/lib/cn';
import { BUSINESS_INFO } from '@/lib/constants';
import { pressable, transition } from '@/lib/motion';

/**
 * Support: the channels, not the sitemap.
 *
 * Separate from the Company column because these answer a different question.
 * A Company link is somewhere on this site; every one of these is a way to
 * reach a person, which is why each carries the out-arrow and opens its own
 * channel rather than a page that lists them. It leads the navigation row -
 * ahead of Shop - because a footer is where somebody goes once the site has
 * stopped answering them.
 *
 * Every row is ONE line. The value a row opens - an address, a number, an
 * inbox - lives in a popover on the three that have one rather than printed
 * under the label: underneath, a six-row list stood twelve lines tall and
 * every value clipped at a footer column's width. A reader who wants to dial
 * still sees the number before committing to it; a reader scanning the column
 * sees six labels. The panel opens on click - see `SupportRow`.
 */
const SUPPORT = [
  {
    key: 'location',
    icon: MapPin,
    label: 'Location',
    href: BUSINESS_INFO.mapUrl,
    external: true,
    // `title` names the field the way the paper form would, `body` is the value
    // itself, `cta` the thing to do with it.
    popover: {
      title: 'Store Address',
      body: `${BUSINESS_INFO.address.line1}, ${BUSINESS_INFO.address.city}, ${BUSINESS_INFO.address.region} ${BUSINESS_INFO.address.postal}, ${BUSINESS_INFO.address.country}`,
      cta: 'Get directions',
    },
  },
  {
    key: 'feedback',
    icon: MessageSquare,
    label: 'Feedback',
    href: '/contact',
  },
  {
    key: 'phone',
    icon: Phone,
    label: 'Phone',
    href: `tel:${BUSINESS_INFO.phone.replace(/[^\d+]/g, '')}`,
    external: true,
    popover: {
      title: 'Sales desk',
      body: BUSINESS_INFO.phone,
      note: `${BUSINESS_INFO.hours[0].days} · ${BUSINESS_INFO.hours[0].time}`,
      cta: 'Call the desk',
    },
  },
  {
    key: 'email',
    icon: Mail,
    label: 'Email',
    href: `mailto:${BUSINESS_INFO.supportEmail}`,
    external: true,
    popover: {
      title: 'Support inbox',
      body: BUSINESS_INFO.supportEmail,
      note: 'Answered within one business day',
      cta: 'Write to us',
    },
  },
  {
    key: 'whatsapp',
    icon: MessageCircle,
    label: 'WhatsApp',
    href: `https://wa.me/${BUSINESS_INFO.whatsapp.replace(/[^\d]/g, '')}`,
    external: true,
  },
  {
    key: 'faqs',
    icon: HelpCircle,
    label: 'FAQs',
    href: '/faq',
  },
];

const COLUMNS = [
  {
    title: 'Shop',
    links: [
      { label: 'All parts', to: '/shop' },
      { label: 'Phone parts', to: '/shop?deviceType=smartphone' },
      { label: 'Tablet parts', to: '/shop?deviceType=tablet' },
      { label: 'Laptop parts', to: '/shop?deviceType=laptop' },
      { label: 'Console parts', to: '/shop?deviceType=game-console' },
      { label: 'Combo deals', to: '/offers' },
      { label: 'Stock clearance', to: '/clearance' },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Dashboard', to: '/account' },
      { label: 'Order history', to: '/account/orders' },
      { label: 'Invoices & statements', to: '/account/invoices' },
      { label: 'Quick order pad', to: '/account/quick-order' },
      { label: 'Saved addresses', to: '/account/addresses' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About us', to: '/about' },
      { label: 'Blog', to: '/blog' },
      { label: 'FAQ', to: '/faq' },
      { label: 'Contact us', to: '/contact' },
    ],
  },
];

/**
 * The hosting badges, served by their issuer.
 *
 * Supplied artwork carrying a partner's mark, so it is used as issued and never
 * recoloured or redrawn - height is the only thing set. No border and no plate
 * behind them: each is drawn with its own lockup and framing them put a badge
 * inside a badge. They sit above Follow us because a credential outranks a
 * handle, centred across the column, and they scale slightly on hover so the
 * pair reads as pressable without a box around them saying so.
 */
const BADGES = [
  {
    src: 'https://s.whc.ca/badges/hosted-in-canada-badge-3.svg',
    href: 'https://whc.ca/hosted-in-canada/?aff=3153&gbid=8en',
    alt: 'Proudly hosted in Canada',
  },
  {
    src: 'https://s.whc.ca/badges/green-badge-8.svg',
    href: 'https://whc.ca/green-powered/?aff=3153&gbid=8en',
    alt: 'Green powered website',
  },
];

const SOCIAL = [
  { icon: Facebook, key: 'facebook', label: 'Facebook' },
  { icon: Instagram, key: 'instagram', label: 'Instagram' },
  { icon: Linkedin, key: 'linkedin', label: 'LinkedIn' },
  { icon: Youtube, key: 'youtube', label: 'YouTube' },
];

/**
 * One Support row.
 *
 * The three rows carrying a value open a panel **on click**, not on hover. A
 * row is a link to a channel and the panel is the value it will use, so
 * opening it is a decision the reader makes rather than something that happens
 * to them on the way past. That also makes one interaction serve every input:
 * a mouse, a keyboard and a finger all open it the same way, where hover had
 * needed a focus fallback beside it and still left touch out.
 *
 * Which means the row is a BUTTON when it carries a panel, and the channel is
 * opened from the panel's own action. A link that does not navigate when
 * clicked is a broken link, so the two cases are different elements rather
 * than one element with its default suppressed.
 */
function SupportRow({ item }) {
  const { icon: Icon, label, href, external, popover } = item;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef(null);

  // Escape closes it, and so does a click anywhere else - the panel sits over
  // the rows above it, and the way out should not be "find the trigger again".
  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const isHttp = typeof href === 'string' && href.startsWith('http');
  const targetProps = isHttp ? { target: '_blank', rel: 'noopener noreferrer' } : {};

  const inner = (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-400 transition-[color,border-color] duration-snap ease-entrance group-hover:border-brand group-hover:text-brand">
        <Icon className="size-3.5" strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="flex items-center gap-1 text-md text-ink-500 transition-colors group-hover:text-brand">
        {label}
        <ArrowUpRight
          className="size-3.5 shrink-0 text-ink-200 transition-[transform,color] duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand"
          strokeWidth={2.25}
          aria-hidden="true"
        />
      </span>
    </>
  );

  const rowClass = cn(pressable, 'group flex items-center gap-2.5 py-0.5 text-left');

  return (
    <li className="relative" ref={rootRef}>
      {popover ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className={rowClass}
        >
          {inner}
        </button>
      ) : external ? (
        <a href={href} {...targetProps} className={rowClass}>
          {inner}
        </a>
      ) : (
        <Link to={href} className={rowClass}>
          {inner}
        </Link>
      )}

      {/* The panel floats over the column, so it takes the shadow anything
          lifted off the page takes and no border with it. Anchored to the row's
          left edge and wider than the column itself - the address is one line
          of prose, and a 200px column would set it as five. The panel ramp,
          not the standard one: this is a large block carrying text under 18px,
          where white only clears 3.58:1 on the bright end of the full ramp.

          It opens UPWARD. That needed the footer's outer panel to stop being
          `overflow-hidden` - see the wordmark block, which now does its own
          clipping - because the crop that shapes the wordmark was slicing the
          top off any panel that rose above a row.

          It rises 4px as it arrives rather than appearing in place: the motion
          is what says the panel belongs to the row it came out of. */}
      {popover && (
        <AnimatePresence>
          {open && (
            <motion.div
              id={panelId}
              initial={{ opacity: 0, y: 4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 2, scale: 0.98, transition: transition.exit }}
              transition={transition.panel}
              style={{ transformOrigin: 'bottom left' }}
              className="absolute bottom-[calc(100%+8px)] left-0 z-20 w-72 max-w-[calc(100vw-3rem)] rounded-lg bg-brand-gradient-panel p-4 shadow-lg"
            >
              <p className="font-display text-md font-bold text-white">{popover.title}</p>
              <p className="mt-2 text-sm leading-relaxed text-white/80">{popover.body}</p>
              {popover.note && <p className="mt-1.5 text-xs text-white/70">{popover.note}</p>}

              {/* The action, now that the row itself only opens the panel. */}
              <a
                href={href}
                {...targetProps}
                className={cn(pressable, 'mt-3 flex items-center gap-1 text-sm font-semibold text-white underline-offset-4 hover:underline')}
              >
                {popover.cta}
                <ArrowUpRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
              </a>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </li>
  );
}

/**
 * The footer.
 *
 * One rounded slab that sits IN the page rather than a full-bleed band ruled off
 * the bottom of it - the old version was four equal columns of grey links and
 * read as a sitemap dump. The weight is redistributed: a statement carries the
 * left with the hosting credentials and the social handles under it, and the
 * navigation is four columns led by Support.
 *
 * The wordmark underneath is the brand at the size it deserves once, at the end,
 * where nothing has to compete with it.
 */
export function Footer() {
  return (
    <footer className="mt-14 px-3 pb-3 sm:px-4 sm:pb-4 lg:px-6 lg:pb-6">
      {/* Two boxes, not one: a rounded panel that holds the content and clips
          the wordmark, and the fine print sitting outside it on the page's own
          surface. The wordmark is cropped BY that panel's rounded bottom edge
          it is a texture the footer ends on, not a logo to be read, and letting
          it run out of the box is what stops it reading as a fifth column. */}
      {/* `overflow-hidden` is what makes the gradient rule below read as the
          panel EDGE rather than as a separate line laid across the top of it.

          The rule is a square-ended bar and the panel is `rounded-xl`, so
          unclipped its two ends overhang the curve by the corner radius - a
          straight line sticking out past both shoulders, which is exactly what
          it looked like. Clipped, it takes the corner with the panel and the
          accent belongs to the box.

          The wordmark lower down is cropped by this same clip, which is
          deliberate and pre-existing: it is a texture the footer ends on, not a
          logo to be read. */}
      <div className="mx-auto max-w-[1400px] overflow-hidden rounded-xl bg-surface-2 ring-1 ring-line">
        {/* The gradient as a hairline rule - accent, not fill. */}
        <div className="rule-brand-gradient h-1" aria-hidden="true" />

        <div className="px-5 pt-8 sm:px-7 lg:px-10 lg:pt-12">
          {/* 4 / 8 of twelve from lg up. The pair of calls to action that held
              a third column is gone: "Call the desk" restated the Phone row
              and "Open an account" the Contact link, so the column was two
              accents repeating rows sitting two columns over. */}
          <div className="grid gap-x-8 gap-y-10 lg:grid-cols-12">
            {/* ---- statement, credentials, social ------------------------ */}
            <div className="lg:col-span-4">
              <h2 className="max-w-sm font-display text-xl font-bold leading-snug text-ink-900 sm:text-2xl">
                Cellvix keeps Canadian repair businesses in graded parts, at wholesale
                prices, on terms.
              </h2>

              {/* No address here: it is the Location row's popover now, and
                  printing it twice on one row is one fact taking two places
                  to say. */}
              {/* Ranged left, on the same axis as the statement above and the
                  social row below.

                  It was centred, on the argument that two unequal badge widths
                  read as a ragged edge. They do less harm than the centring did:
                  the column has a left edge that the heading, the "Follow us"
                  label and every row under it share, and one block floating off
                  that axis is the thing the eye catches first. A ragged right
                  edge inside a column is normal; a ragged LEFT edge is a mistake. */}
              <ul className="mt-7 flex flex-wrap items-center gap-5">
                {BADGES.map((badge) => (
                  <li key={badge.href}>
                    <a href={badge.href} target="_blank" rel="noopener noreferrer" className="block">
                      <img
                        src={badge.src}
                        alt={badge.alt}
                        loading="lazy"
                        decoding="async"
                        draggable="false"
                        className="h-14 w-auto select-none transition-transform duration-200 ease-entrance hover:scale-105 active:scale-[0.97] motion-reduce:transition-none motion-reduce:hover:scale-100"
                      />
                    </a>
                  </li>
                ))}
              </ul>

              {/* Handle beside the glyph: a row of bare circles told a reader
                  which networks exist, not which account they land on. */}
              <div className="mt-7">
                <h3 className="eyebrow mb-3 text-ink-400">Follow us</h3>
                {/* A 2x2 rather than a wrapping row. Four chips do not fit
                    across this rail, so a flex row broke 3 + 1 - which reads as
                    a list that ran out of room. An even grid reads as a block
                    that was meant to be one. */}
                <ul className="grid max-w-sm grid-cols-2 gap-1.5">
                  {SOCIAL.map(({ icon: Icon, key, label }) => (
                    <li key={key}>
                      <a
                        href={BUSINESS_INFO.social[key]}
                        aria-label={label}
                        className={cn(pressable, 'flex items-center gap-1.5 rounded-full border border-line bg-surface py-1.5 pl-2 pr-2.5 text-xs font-medium text-ink-500 hover:border-brand hover:text-brand')}
                      >
                        <Icon className="size-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                        {BUSINESS_INFO.handles[key]}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* ---- navigation --------------------------------------------
                Two columns on a phone, not one. Stacked, the link lists ran the
                footer to most of a screen's height and left a column of dead
                space beside every 13px link - the lists are far narrower than
                the viewport, so the width was there and unused.

                Support leads: it is the column somebody opens a footer for. It
                is also the only one whose rows open a panel, so it sits at the
                left edge where that panel has room to grow into. */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4 sm:gap-y-8 lg:col-span-8">
              <nav aria-label="Support">
                <h3 className="eyebrow mb-3.5 text-ink-400">Support</h3>
                <ul className="space-y-2.5">
                  {SUPPORT.map((item) => (
                    <SupportRow key={item.key} item={item} />
                  ))}
                </ul>
              </nav>

              {COLUMNS.map((column) => (
                <nav key={column.title} aria-label={column.title}>
                  <h3 className="eyebrow mb-3.5 text-ink-400">{column.title}</h3>
                  <ul className="space-y-2.5">
                    {column.links.map((link) => (
                      <li key={link.label}>
                        <Link
                          to={link.to}
                          className={cn(pressable, 'text-md text-ink-500 hover:text-brand')}
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              ))}
            </div>
          </div>
        </div>

        {/* ---- the wordmark ------------------------------------------------
            The real mark, not type set to look like it. This is the CELLV*X
            wordmark lifted out of the client's lockup and flattened to its
            black-and-leaf colourway - the letters carry the logo's own grunge
            texture, which no font can stand in for, and the maple leaf is the
            brand's, not a red `o`. The tagline and domain that ride along in
            the full lockup are dropped: at this size they would shout three
            things where the footer wants one quiet one.

            The asset is trimmed to its ink, so `w-full` puts the C and the X
            flush against both edges of the panel - which is why this block has
            no side padding.

            The crop: the wrapper's aspect ratio is the image's own width over
            70% of its height, and the image is pinned to the wrapper's top at
            full width. So exactly the top 70% shows and the bottom 30% is cut
 - the word runs out of the panel rather than sitting in it, which
            is what stops it reading as a fifth column. Nothing under it on
            purpose; the panel's rounded bottom edge does the rest of the
            clipping.

            Decorative - the header carries the accessible name. */}
        <div className="pt-8 lg:pt-10">
          {/* The rounded bottom corners live HERE rather than on the outer
              panel. That panel used to carry `overflow-hidden` to clip this
              image against its corners, and the same rule sliced the top off
              any Support popover rising above its row. This block already
              crops the image; matching the panel's own `rounded-xl` on its
              bottom two corners is the rest of what that clip was doing. */}
          <div className="relative aspect-2456/305 w-full overflow-hidden rounded-b-xl">
            <img
              src="/brand/wordmark.png"
              alt=""
              aria-hidden="true"
              draggable="false"
              loading="lazy"
              decoding="async"
              className="pointer-events-none absolute inset-x-0 top-0 w-full select-none"
            />
          </div>
        </div>
      </div>

      {/* ---- the fine print ------------------------------------------------
          Outside the panel, on the page's own surface - the panel ends on the
          cropped wordmark, and a rule under it would undo the crop. */}
      <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-2 pt-4 text-sm text-ink-400 sm:flex-row sm:items-center sm:justify-between sm:px-4 lg:px-6">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            {BUSINESS_INFO.name} ©{new Date().getFullYear()}
          </span>
          <Link to="/contact" className={cn(pressable, ' hover:text-brand')}>
            Privacy
          </Link>
          <Link to="/contact" className={cn(pressable, ' hover:text-brand')}>
            Terms
          </Link>
        </p>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{BUSINESS_INFO.address.city}</span>
          <span className="text-ink-300">All prices CAD</span>
        </p>
      </div>
    </footer>
  );
}

export default Footer;
