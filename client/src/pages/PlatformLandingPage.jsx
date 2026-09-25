import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Globe,
  MessageSquareText,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';

import cn from '@/lib/cn';
import api from '@/lib/api';
import { money, count as formatCount } from '@/lib/format';
import { pressable } from '@/lib/motion';
import { panelUrl } from '@/lib/surface';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import KelintoLogo from '@/components/platform/KelintoLogo';
import {
  AddressMock,
  PanelMock,
  PurchaseOrderMock,
  StorefrontMock,
  TicketMock,
} from '@/components/platform/LandingMocks';

/**
 * kelinto.com: where Kelinto is sold, as the suite a business runs on.
 *
 * **White, ink and tangerine; DM Sans throughout** (client ruling
 * 2026-09-25, third pass). One typeface at every size, weight and tracking
 * doing the ranking; one brand colour, used where the eye should land: the
 * key phrase, the call to action, the chart's current bar.
 *
 * **The hero shows the product working** rather than listing what it does:
 * one sentence, then the ERP on a stage with three moments floating beside it
 * (an invoice paid, a repair ready, a reorder drafted), which is the "one
 * place" claim made visible. The list of everything comes much further down,
 * for the reader who wants it.
 *
 * **Vocabulary** (Instructions §10): *website*, *ERP*, *Kelinto*.
 *
 * **Nothing invented.** No logos, customer counts or quotes; every feature
 * named exists in the registry (`shared/schemas/features.js`); prices come
 * from the plans the console edits (`GET /api/platform/plans`). The sample
 * rows in the drawn screens and cards are illustrations, and `aria-hidden`.
 */

// The address enquiries go to. One constant, so it changes in one place.
// Temporary: Kelinto mailboxes are not set up yet (client, 2026-09-25).
// Replace with the Kelinto address once it exists.
const CONTACT_EMAIL = 'technoir.app@gmail.com';
const CONTACT_HREF = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Kelinto demo')}`;

const EVERYTHING = [
  ['Sales', ['Customers', 'Orders', 'Tickets', 'Returns', 'Quotes', 'Web quote requests', 'Invoices', 'Devices you service', 'Service price list', 'Check-in kiosk']],
  ['Website', ['Public catalogue', 'Online checkout', 'Wholesale pricing gated by approval', 'Clearance and deals', 'Product reviews', 'Your own domain']],
  ['Money', ['Store credit ledger', 'Lines of credit and terms', 'Deposits and part payments', 'Refunds', 'GST and HST by province']],
  ['Purchasing', ['Suppliers', 'Purchase orders', 'Supplier bidding', 'Proforma invoices', 'Supplier agreements', 'Supplier returns', 'Bought-in services', 'Expenses', 'Inventory']],
  ['Reports', ['Profit and loss', 'Tax report', 'Staff performance']],
  ['Marketing', ['Email', 'SMS', 'WhatsApp', 'Call log', 'Referrals', 'Offers and promo codes', 'Blog', 'FAQ', 'Product articles']],
  ['Operations', ['Staff roles and permissions', 'Several outlets', 'Appointments', 'Activity log', 'Notification templates']],
];

const FLOW = [
  { word: 'Quote', note: 'Priced from your catalogue or your service list.' },
  { word: 'Order or ticket', note: 'Goods ship as an order; work runs as a ticket.' },
  { word: 'Invoice', note: 'Deposits and store credit carried across.' },
  { word: 'Paid', note: 'On the same customer record, start to finish.' },
];

const AUDIENCES = ['Repair shops', 'Parts wholesalers', 'Retailers', 'Garages', 'Salons', 'Clinics', 'IT services'];

/** Arrival: a short rise and fade, once. Readers who ask for less motion get none. */
function Reveal({ children, className, delay = 0, as = 'div' }) {
  const reduce = useReducedMotion();
  const Tag = as;
  if (reduce) return <Tag className={className}>{children}</Tag>;
  const MotionTag = motion[as] ?? motion.div;
  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, transform: 'translateY(16px)' }}
      whileInView={{ opacity: 1, transform: 'translateY(0px)' }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </MotionTag>
  );
}

function PrimaryCta({ href, children, className }) {
  return (
    <a
      href={href}
      className={cn(
        pressable,
        'group inline-flex h-12 items-center gap-2 rounded-full bg-plat-accent px-6 text-md font-semibold text-white hover:bg-plat-accent-dim',
        className,
      )}
    >
      {children}
      <ArrowRight className="size-4 transition-transform duration-fast group-hover:translate-x-0.5" strokeWidth={2.25} aria-hidden="true" />
    </a>
  );
}

function SecondaryCta({ href, children }) {
  return (
    <a
      href={href}
      className={cn(pressable, 'inline-flex h-12 items-center rounded-full border border-plat-line bg-plat-surface px-6 text-md font-semibold text-plat-text hover:border-plat-dim')}
    >
      {children}
    </a>
  );
}

function Eyebrow({ children }) {
  return <p className="text-sm font-semibold text-plat-accent-soft">{children}</p>;
}

function SectionHead({ eyebrow, title, body, center }) {
  return (
    <div className={cn('max-w-3xl', center && 'mx-auto text-center')}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="mt-3 text-d-sm font-semibold tracking-kelinto text-plat-text sm:text-d-md">{title}</h2>
      {body && <p className="mt-5 text-xl leading-relaxed text-plat-muted">{body}</p>}
    </div>
  );
}

/**
 * A moment beside the hero screen. Floating over the stage, so it takes a
 * shadow and no border (lifted, never both).
 */
function FloatCard({ icon: Icon, tone, title, body, className, delay }) {
  const reduce = useReducedMotion();
  const card = (
    <div className="flex w-64 items-start gap-3 rounded-lg bg-plat-surface p-3.5 text-left shadow-flyout">
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          tone === 'ok' && 'bg-plat-ok/10 text-plat-ok',
          tone === 'warn' && 'bg-plat-warn/10 text-plat-warn',
          tone === 'accent' && 'bg-plat-mark text-plat-accent-soft',
        )}
      >
        <Icon className="size-4" strokeWidth={2.25} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-plat-text">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-plat-muted">{body}</span>
      </span>
    </div>
  );
  return (
    <div aria-hidden="true" className={cn('absolute z-10 hidden lg:block', className)}>
      {reduce ? (
        card
      ) : (
        <motion.div
          initial={{ opacity: 0, transform: 'translateY(12px) scale(0.97)' }}
          animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
          transition={{ duration: 0.5, delay, ease: [0.23, 1, 0.32, 1] }}
        >
          {card}
        </motion.div>
      )}
    </div>
  );
}

/** A grey stage a drawn screen sits on, so it reads as a product shot. */
function Stage({ children, className }) {
  return <div className={cn('rounded-xl bg-plat-raised p-4 sm:p-8', className)}>{children}</div>;
}

function AppSection({ id, eyebrow, title, body, points, visual, flip }) {
  return (
    <section id={id} className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
        <Reveal className={cn('min-w-0', flip && 'lg:order-2')}>
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="mt-3 text-d-sm font-semibold tracking-kelinto text-plat-text sm:text-d-md">{title}</h2>
          <p className="mt-5 text-xl leading-relaxed text-plat-muted">{body}</p>
          <ul className="mt-8 space-y-3.5">
            {points.map((point) => (
              <li key={point} className="flex gap-3 text-lg leading-snug text-plat-text">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-plat-mark">
                  <Check className="size-3 text-plat-accent-soft" strokeWidth={3} aria-hidden="true" />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={0.08} className={cn('min-w-0', flip && 'lg:order-1')}>
          <Stage>{visual}</Stage>
        </Reveal>
      </div>
    </section>
  );
}

function Pricing() {
  const { data, isLoading } = useQuery({
    queryKey: ['platform', 'plans'],
    queryFn: () => api.get('/platform/plans'),
    staleTime: 5 * 60 * 1000,
  });
  const plans = data?.plans ?? [];
  // The middle plan is the one we point most businesses at first: a
  // recommendation, not a claim about what others chose.
  const featured = plans.length >= 3 ? plans[Math.floor(plans.length / 2)].id : null;

  return (
    <section id="pricing" className="scroll-mt-20 bg-plat-bg py-20 sm:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <Reveal>
          <SectionHead
            center
            eyebrow="Pricing"
            title="One monthly price. No module fees."
            body="Plans differ by how many businesses you run and what each one starts with. Any feature can be switched on later."
          />
        </Reveal>

        {isLoading ? (
          <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <div key={key} className="h-96 animate-pulse rounded-xl bg-plat-raised motion-reduce:animate-none" />
            ))}
          </div>
        ) : plans.length ? (
          <div className={cn('mt-14 grid grid-cols-1 gap-4', plans.length >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
            {plans.map((plan, index) => {
              const featuredPlan = plan.id === featured;
              return (
                <Reveal key={plan.id} delay={index * 0.06} className="min-w-0">
                  <div
                    className={cn(
                      'relative flex h-full flex-col rounded-xl border bg-plat-surface p-7',
                      featuredPlan ? 'border-plat-accent ring-1 ring-plat-accent' : 'border-plat-line',
                    )}
                  >
                    {featuredPlan && (
                      <span className="absolute -top-3 left-7 rounded-full bg-plat-accent px-3 py-1 text-xs font-semibold text-white">
                        Recommended
                      </span>
                    )}
                    <h3 className="text-xl font-semibold text-plat-text">{plan.name}</h3>
                    <p className="mt-2 min-h-12 text-md leading-relaxed text-plat-muted">{plan.description}</p>
                    <p className="mt-6 text-plat-text">
                      <span className="tnum text-d-sm font-semibold tracking-kelinto">{money(plan.priceCents)}</span>
                      <span className="ml-2 text-md text-plat-dim">a month</span>
                    </p>
                    <a
                      href={CONTACT_HREF}
                      className={cn(
                        pressable,
                        'mt-6 flex h-11 items-center justify-center rounded-full text-md font-semibold',
                        featuredPlan ? 'bg-plat-accent text-white hover:bg-plat-accent-dim' : 'border border-plat-line text-plat-text hover:border-plat-dim',
                      )}
                    >
                      Talk to us about {plan.name}
                    </a>
                    <ul className="mt-7 space-y-3 border-t border-plat-line-soft pt-6 text-md text-plat-text">
                      {[
                        plan.includedSlots === 1 ? 'One business' : `Up to ${formatCount(plan.includedSlots)} businesses`,
                        'Website and ERP on your own domain',
                        'A database of its own for every business',
                      ].map((line) => (
                        <li key={line} className="flex gap-2.5">
                          <Check className="mt-0.5 size-4 shrink-0 text-plat-accent-soft" strokeWidth={2.5} aria-hidden="true" />
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                </Reveal>
              );
            })}
          </div>
        ) : (
          <p className="mt-12 text-center text-xl text-plat-muted">
            Pricing is set with each business.{' '}
            <a href={CONTACT_HREF} className="font-semibold text-plat-accent-soft hover:underline">
              Talk to us
            </a>
          </p>
        )}
      </div>
    </section>
  );
}

export function PlatformLandingPage() {
  useDocumentTitle('Kelinto · Run your entire business from one place');

  return (
    <div className="kelinto min-h-dvh bg-plat-surface text-plat-text antialiased">
      <header className="sticky top-0 z-50 border-b border-plat-line-soft bg-plat-surface/85 backdrop-blur-lg">
        <nav aria-label="Kelinto" className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-4 sm:px-6">
          <a href="#top" aria-label="Kelinto, back to top">
            <KelintoLogo size="md" />
          </a>
          <ul className="hidden items-center gap-7 lg:flex">
            {[
              ['#sales', 'Sales'],
              ['#service', 'Service'],
              ['#purchasing', 'Purchasing'],
              ['#everything', 'Features'],
              ['#pricing', 'Pricing'],
            ].map(([href, label]) => (
              <li key={href}>
                <a href={href} className="text-md font-medium text-plat-muted transition-colors duration-fast hover:text-plat-text">
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <div className="ml-auto flex items-center gap-2">
            <a href={panelUrl('/')} className={cn(pressable, 'rounded-full px-3 py-2 text-md font-medium text-plat-text hover:bg-plat-raised')}>
              Sign in
            </a>
            <a
              href={CONTACT_HREF}
              className={cn(pressable, 'hidden rounded-full bg-plat-accent px-4 py-2 text-md font-semibold text-white hover:bg-plat-accent-dim sm:inline-flex')}
            >
              Book a demo
            </a>
          </div>
        </nav>
      </header>

      <main id="top">
        {/* ---- hero: the claim beside the product working ----------------------
            Words on the left, the ERP on the right, both in the first screen:
            the sentence says "one place" and the picture beside it shows the
            one place, so neither has to wait for a scroll. No label above the
            headline; the headline is the label. */}
        <section className="overflow-hidden">
          <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:gap-12 lg:py-24">
            <Reveal className="min-w-0 lg:col-span-5">
              <h1 className="text-d-md font-semibold tracking-kelinto text-plat-text sm:text-d-lg">
                Run your entire business from <span className="text-plat-accent">one place.</span>
              </h1>
              <p className="mt-6 max-w-xl text-xl leading-relaxed text-plat-muted">
                Sales, service, purchasing, stock, invoices and your own website, sharing one set of customers and one set
                of books. Everyone works in the same system, so nothing is typed twice.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <PrimaryCta href={CONTACT_HREF}>Book a demo</PrimaryCta>
                <SecondaryCta href="#how">See how it works</SecondaryCta>
              </div>
            </Reveal>

            {/* The product on a stage, with three moments around it. */}
            <div className="relative min-w-0 lg:col-span-7">
              <div className="relative rounded-xl bg-linear-to-br from-plat-mark to-plat-raised p-4 sm:p-8">
                <Reveal delay={0.1}>
                  <PanelMock />
                </Reveal>
                <FloatCard
                  icon={CheckCircle2}
                  tone="ok"
                  title="Invoice 1042 paid"
                  body="$1,284.00 by card. Receipt sent to the customer."
                  className="-left-10 -top-6"
                  delay={0.55}
                />
                <FloatCard
                  icon={MessageSquareText}
                  tone="accent"
                  title="Ready for pickup"
                  body="iPhone 15 Pro screen. The customer has been texted."
                  className="-right-4 bottom-24 xl:-right-10"
                  delay={0.7}
                />
                <FloatCard
                  icon={AlertTriangle}
                  tone="warn"
                  title="6 parts to reorder"
                  body="A purchase order is drafted for your suppliers."
                  className="-bottom-8 left-10"
                  delay={0.85}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ---- who it is for -------------------------------------------------- */}
        <section aria-labelledby="audience" className="border-y border-plat-line-soft bg-plat-surface py-10">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p id="audience" className="text-center text-sm font-medium text-plat-dim">
              Built for businesses that sell goods, sell work, or both
            </p>
            <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
              {AUDIENCES.map((name) => (
                <li key={name} className="text-lg font-semibold text-plat-muted">
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---- one record, start to finish ------------------------------------------ */}
        <section id="how" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <SectionHead
                center
                eyebrow="How it works"
                title="One customer. One record. From the first quote to the last payment."
                body="The order placed on your website, the device left at the counter and the invoice paid last week all sit on one account."
              />
            </Reveal>
            <ol className="relative mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FLOW.map((step, index) => (
                <Reveal key={step.word} as="li" delay={index * 0.08} className="min-w-0 rounded-xl border border-plat-line bg-plat-surface p-6">
                  <span className="flex size-9 items-center justify-center rounded-full bg-plat-accent text-md font-semibold text-white">
                    {index + 1}
                  </span>
                  <p className="mt-5 text-2xl font-semibold tracking-tight text-plat-text">{step.word}</p>
                  <p className="mt-2 text-md leading-relaxed text-plat-muted">{step.note}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <div className="border-t border-plat-line-soft" />

        <AppSection
          id="sales"
          eyebrow="Sales and website"
          title="A website that is yours, not a template."
          body="Your catalogue, your prices and your address. Customers browse, sign in and order; the order lands in the ERP your staff already work in."
          points={[
            'Your own domain, with the security certificate handled for you',
            'Wholesale pricing hidden until you approve an account',
            'Clearance, combo deals and promo codes the checkout honours',
            'In stock or out of stock for customers; counts stay private',
          ]}
          visual={<StorefrontMock />}
        />

        <AppSection
          id="service"
          flip
          eyebrow="Service"
          title="Every job, from check-in to pickup."
          body="Tickets carry the device, the diagnosis, the parts and the labour. Customers hear from you at each stage without anybody writing a message."
          points={[
            'A check-in tablet customers fill in themselves',
            'Quotes that become tickets, tickets that become invoices',
            'Deposits and payments carried onto the invoice',
            'Updates by text, WhatsApp or email as the work moves',
          ]}
          visual={<TicketMock />}
        />

        <AppSection
          id="purchasing"
          eyebrow="Purchasing"
          title="Your suppliers bid. You choose."
          body="Send a purchase order and your suppliers price it in their own portal. Compare complete bids side by side, then receive the stock against the order it came on."
          points={[
            'One supplier login for every business they supply',
            'Proforma invoices and signed agreements on the order',
            'Stock received line by line, reorder levels that notice',
            'Expenses feeding the same profit and loss',
          ]}
          visual={<PurchaseOrderMock />}
        />

        {/* ---- built around the business ----------------------------------------- */}
        <section className="bg-plat-bg py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <SectionHead eyebrow="Built around you" title="It fits the business, not the other way round." />
            </Reveal>
            <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
              {[
                {
                  icon: SlidersHorizontal,
                  title: 'Only the apps you need',
                  body: 'Tell us whether you sell goods, sell work or both, and the ERP starts with exactly those apps. Switch any feature on or off later.',
                },
                {
                  icon: Globe,
                  title: 'Your own address, front and back',
                  body: 'Customers use your website at your domain. Staff sign in to the ERP at another of yours, where only your own accounts are accepted.',
                  extra: <AddressMock />,
                },
                {
                  icon: Building2,
                  title: 'A second business, without starting over',
                  body: 'One account can own several businesses, each with its own website, staff, stock and books, reached from the same sign-in.',
                },
                {
                  icon: ShieldCheck,
                  title: 'Your records stay yours',
                  body: 'Every business keeps its data in a database of its own. If Kelinto support ever needs to look inside, they state why, access expires on a timer, and both are written into your activity log.',
                },
              ].map(({ icon: Icon, title, body, extra }, index) => (
                <Reveal key={title} delay={(index % 2) * 0.06} className="flex min-w-0 flex-col rounded-xl border border-plat-line bg-plat-surface p-7 sm:p-9">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-plat-mark">
                    <Icon className="size-5 text-plat-accent-soft" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <h3 className="mt-6 text-2xl font-semibold tracking-tight text-plat-text">{title}</h3>
                  <p className="mt-3 text-lg leading-relaxed text-plat-muted">{body}</p>
                  {extra && <div className="mt-7">{extra}</div>}
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---- everything ----------------------------------------------------------- */}
        <section id="everything" className="scroll-mt-20 py-20 sm:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <SectionHead
                eyebrow="Features"
                title="Everything a business runs on."
                body="All of it is included, and every part can be switched on or off for each business."
              />
            </Reveal>
            <dl className="mt-12 divide-y divide-plat-line-soft border-y border-plat-line-soft">
              {EVERYTHING.map(([area, items]) => (
                <div key={area} className="grid grid-cols-1 gap-3 py-6 md:grid-cols-5 md:gap-8">
                  <dt className="text-xl font-semibold text-plat-text">{area}</dt>
                  <dd className="flex flex-wrap gap-2 md:col-span-4">
                    {items.map((item) => (
                      <Fragment key={item}>
                        <span className="rounded-full border border-plat-line px-3 py-1 text-sm text-plat-text">{item}</span>
                      </Fragment>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <Pricing />

        {/* ---- the close ------------------------------------------------------------ */}
        <section className="py-20 sm:py-28">
          <Reveal className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="rounded-xl bg-plat-accent px-6 py-14 text-center sm:px-12 sm:py-20">
              <h2 className="mx-auto max-w-3xl text-d-sm font-semibold tracking-kelinto text-white sm:text-d-md">
                Bring the whole business across. We will set it up with you.
              </h2>
              <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                <a
                  href={CONTACT_HREF}
                  className={cn(pressable, 'inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-md font-semibold text-plat-text hover:bg-plat-mark')}
                >
                  Book a demo
                  <ArrowRight className="size-4" strokeWidth={2.25} aria-hidden="true" />
                </a>
                <a href={panelUrl('/')} className="inline-flex h-12 items-center px-4 text-md font-semibold text-white underline decoration-white/40 underline-offset-4 hover:decoration-white">
                  Sign in to the ERP
                </a>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-plat-line-soft">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-8 text-sm text-plat-muted sm:px-6">
          <KelintoLogo size="sm" />
          <a href={panelUrl('/')} className="hover:text-plat-text">
            ERP sign-in
          </a>
          <a href={CONTACT_HREF} className="hover:text-plat-text">
            {CONTACT_EMAIL}
          </a>
          {/* Customers of a business sometimes land here by dropping its
              subdomain; one line sends them where they meant to be. */}
          <span className="lg:ml-auto">
            Shopping with a business? Use its own website, like <span className="font-mono">name.kelinto.com</span>
          </span>
        </div>
        <p className="border-t border-plat-line-soft py-5 text-center text-xs text-plat-dim">© {new Date().getFullYear()} Kelinto</p>
      </footer>
    </div>
  );
}

export default PlatformLandingPage;
