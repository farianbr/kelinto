import { Link } from 'react-router';
import { motion, useReducedMotion } from '@/lib/motionReact';
import { ArrowRight, Mail, MessageCircleQuestion, Package, Phone, Truck } from 'lucide-react';
import cn from '@/lib/cn';
import useBusinessInfo from '@/hooks/useBusinessInfo';
import Slab, { EyebrowPill, SectionHeader } from '@/components/ui/Slab';
import Reveal from '@/components/motion/Reveal';
import ContactForm from '@/components/website/ContactForm';
import { ease, pressable } from '@/lib/motion';

/**
 * The ways to reach this business, built per render rather than at import.
 *
 * A channel with no value behind it is dropped: a Support card reading nothing,
 * linking to `mailto:`, is worse than a page offering two ways in instead of
 * three. Support also collapses into Sales when the business has not set a
 * separate inbox - `publicProfile` falls `supportEmail` back to `email`, so
 * without this check the page would print the same address twice under two
 * headings.
 */
const channelsFor = (info) =>
  [
    info.phone && {
      icon: Phone,
      label: 'Sales desk',
      value: info.phone,
      hint: 'Stock, sourcing and credit',
      href: `tel:${info.phone.replace(/[^\d+]/g, '')}`,
    },
    info.email && {
      icon: Mail,
      label: 'Sales',
      value: info.email,
      hint: 'Accounts, pricing and quotes',
      href: `mailto:${info.email}`,
    },
    info.supportEmail &&
      info.supportEmail !== info.email && {
        icon: Mail,
        label: 'Support',
        value: info.supportEmail,
        hint: 'Orders, returns and warranty',
        href: `mailto:${info.supportEmail}`,
      },
  ].filter(Boolean);

const PROMISES = [
  {
    value: '1',
    unit: 'business day',
    label: 'Every message answered',
    hint: 'Usually the same afternoon, by the person who handles your account',
  },
  {
    value: '2',
    unit: 'PM ET',
    label: 'Same-day dispatch cutoff',
    hint: 'A stock question before it still leaves you time to order today',
  },
  {
    value: '2',
    unit: 'hours',
    label: 'Warehouse pickup ready',
    hint: 'Approved accounts, during business hours',
  },
];

/**
 * Contact Us (brief §9): functional-first, checkout-style fields, minimal
 * friction - laid out as the same slab stack the About page uses, so the two
 * editorial pages read as one site rather than as two templates.
 */
/**
 * The drawn map card and the "Find us" slab that used to close this page are
 * gone (2026-09-30): the Location section every website page now ends with
 * carries the address, the hours and the business's real Google map, and
 * printing them twice on one page would be two answers to one question.
 */
export function ContactPage() {
  const info = useBusinessInfo();
  const channels = channelsFor(info);
  const reduce = useReducedMotion();

  const headerMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 20, filter: 'blur(6px)' },
        animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
      };

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-6">
      {/* ---- opening + the three ways to reach a person -------------------- */}
      <Slab aria-labelledby="contact-heading">
        <motion.div
          {...headerMotion}
          transition={{ duration: 0.5, ease: ease.entrance }}
          className="mx-auto max-w-2xl text-center"
        >
          <EyebrowPill>Contact</EyebrowPill>

          <h1
            id="contact-heading"
            className="mt-6 text-d-sm leading-[1.04] tracking-[-0.035em] sm:text-d-lg lg:text-d-lg"
          >
            Talk to the sales desk
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-ink-400">
            Account questions, stock checks, warranty claims or a problem with an order - answered
            by a person who can see your account, within one business day.
          </p>
        </motion.div>

        {/* On a phone these were three stacked 150px-tall blocks - a lot of
            page spent restating three contact details. Below `sm` each one is a
            compact row instead: the icon holds the left edge and the label,
            value and hint sit beside it. From `sm` the three-up grid takes
            over and the card goes back to its stacked, taller shape. */}
        <ul className="mt-8 grid gap-2 sm:grid-cols-3 lg:mt-14">
          {channels.map(({ icon: Icon, label, value, hint, href }, index) => (
            <Reveal key={label} delay={index * 0.08} as="li">
              {/* The same two-element pill the FAQ rows use: a 2px edge that
                  becomes the brand gradient on hover, around a face that does
                  not move. */}
              <a
                href={href}
                className="group block h-full rounded-xl bg-line p-[2px] transition-[background-color,background-image] duration-200 hover:bg-brand-gradient sm:rounded-xl"
              >
                <span className="flex h-full items-center gap-3.5 rounded-lg bg-surface p-3.5 transition-shadow duration-200 group-hover:shadow-card sm:flex-col sm:items-stretch sm:gap-0 sm:rounded-xl sm:p-5">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-500 transition-colors group-hover:bg-brand group-hover:text-white sm:mb-4 sm:size-11"
                    aria-hidden="true"
                  >
                    <Icon className="size-5" strokeWidth={1.5} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="eyebrow block text-ink-400">{label}</span>
                    <span className="mt-1 block truncate font-display text-lg font-bold text-ink-900 sm:mt-2 sm:text-lg">
                      {value}
                    </span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-ink-400 sm:mt-1.5 sm:text-sm">
                      {hint}
                    </span>
                  </span>
                </span>
              </a>
            </Reveal>
          ))}
        </ul>
      </Slab>

      {/* ---- the form ------------------------------------------------------ */}
      <Slab aria-labelledby="message-heading">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-14">
          <div className="min-w-0">
            <Reveal>
              <EyebrowPill>Send a message</EyebrowPill>
              <h2
                id="message-heading"
                className="mt-5 text-3xl leading-[1.06] tracking-[-0.03em] sm:text-d-sm"
              >
                Tell us which part and which model
              </h2>
              <p className="mt-4 max-w-xl text-md leading-relaxed text-ink-400">
                The more of the device you name, the fewer round trips it takes. A SKU, a model or a
                photograph of the board is usually enough.
              </p>
            </Reveal>

            <Reveal delay={0.08}>
              <ContactForm className="mt-8" />
            </Reveal>
          </div>

          {/* ---- pickup and ordering ---------------------------------------
              The hours card that sat here moved to the Location section at the
              foot of the page, beside the map. */}
          <div className="space-y-3 lg:pt-2">
            <Reveal delay={0.2}>
              <div className="rounded-xl border border-line bg-surface-2 p-5 sm:p-6">
                <span
                  className="mb-4 flex size-11 items-center justify-center rounded-lg bg-brand text-white"
                  aria-hidden="true"
                >
                  <Package className="size-5" strokeWidth={1.5} />
                </span>
                <h3 className="text-lg">Warehouse pickup</h3>
                <p className="mt-2 text-md leading-relaxed text-ink-500">
                  Available to approved accounts during business hours. Select “Warehouse pickup” at
                  checkout and we will have your order ready in two hours.
                </p>
              </div>
            </Reveal>

            <Reveal delay={0.28}>
              <div className="rounded-xl border border-line bg-surface-2 p-5 sm:p-6">
                <span
                  className="mb-4 flex size-11 items-center justify-center rounded-lg bg-brand-50 text-brand"
                  aria-hidden="true"
                >
                  <Truck className="size-5" strokeWidth={1.5} />
                </span>
                <h3 className="text-lg">Ordering, not asking?</h3>
                <p className="mt-2 text-md leading-relaxed text-ink-500">
                  Stock, grades and lead times are on every product page - no need to write in for a
                  number the catalogue already shows.
                </p>
                <Link
                  to="/shop"
                  className={cn(pressable, 'mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-700')}
                >
                  Browse the catalogue
                  <ArrowRight className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </Slab>

      {/* ---- what happens after you send: the dark panel -------------------- */}
      <Slab tone="dark" aria-labelledby="promise-heading">
        <Reveal className="max-w-3xl">
          <p className="eyebrow mb-5 text-white/55">What happens next</p>
          <h2
            id="promise-heading"
            className="text-3xl leading-[1.08] tracking-[-0.03em] text-white sm:text-d-md lg:text-d-md"
          >
            Your message reaches the desk, not a queue.
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/65">
            Every approved account has a named rep. Sourcing an unlisted part, raising a credit
            limit or chasing a warranty claim is one message to the same person each time.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-8 border-t border-white/10 pt-10 sm:grid-cols-2 lg:mt-16 lg:grid-cols-3 lg:gap-6">
          {PROMISES.map(({ value, unit, label, hint }, index) => (
            <Reveal key={label} delay={index * 0.08}>
              <p className="tnum font-display text-d-md font-bold leading-none tracking-[-0.03em] text-white lg:text-d-lg">
                {value}
                <span className="ml-1.5 text-xl font-semibold lg:text-2xl">{unit}</span>
              </p>
              <p className="mt-4 font-display text-md font-bold text-white">{label}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-white/60">{hint}</p>
            </Reveal>
          ))}
        </div>
      </Slab>

      {/* ---- the quiet close ----------------------------------------------- */}
      <Slab aria-labelledby="faq-cta-heading" innerClassName="text-center" className="py-12 sm:py-14 lg:py-16">
        <SectionHeader
          id="faq-cta-heading"
          title="Already answered?"
          lede="Approval, credit terms, grading and warranty are covered in the help centre - most questions the desk gets are already there."
          centered
        />

        <Reveal className="mt-8 flex flex-wrap justify-center gap-2.5">
          <Link
            to="/faq"
            className="inline-flex h-12 items-center gap-2 rounded-full bg-brand-gradient px-6 font-display text-md font-semibold text-white transition-[filter] hover:brightness-110"
          >
            <MessageCircleQuestion className="size-4" strokeWidth={2} aria-hidden="true" />
            Read the FAQ
          </Link>
          <Link
            to="/about"
            className={cn(pressable, 'inline-flex h-12 items-center rounded-full border border-line-strong bg-surface px-6 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
          >
            About {info.name}
          </Link>
        </Reveal>
      </Slab>
    </div>
  );
}

export default ContactPage;
