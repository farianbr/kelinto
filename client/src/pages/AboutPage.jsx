import { Link } from 'react-router';
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  ClipboardCheck,
  Gamepad2,
  Headphones,
  Laptop,
  MapPin,
  PackageCheck,
  ShieldCheck,
  Smartphone,
  Tablet,
  Truck,
  Watch,
  Wrench,
} from 'lucide-react';
import cn from '@/lib/cn';
import { date } from '@/lib/format';
import { GRADES, GRADE_ORDER } from '@/lib/constants';
import useBusinessInfo from '@/hooks/useBusinessInfo';
import Reveal from '@/components/motion/Reveal';
import CountUp from '@/components/motion/CountUp';
import Button from '@/components/ui/Button';
import Skeleton from '@/components/ui/Skeleton';
import Slab, { SectionHeader } from '@/components/ui/Slab';
import GradeBadge from '@/components/product/GradeBadge';
import PostCover from '@/components/blog/PostCover';
import { useBlogPosts } from '@/hooks/useContent';
import { pressable } from '@/lib/motion';

const MILESTONES = [
  { value: 420, suffix: '+', label: 'SKUs in stock', hint: 'Across six device categories' },
  { value: 6, label: 'Device categories', hint: 'Phones through consoles' },
  { value: 90, suffix: ' days', label: 'Warranty', hint: 'On every new and OEM part' },
  { value: 2, suffix: ' PM', label: 'Same-day cutoff', hint: 'Order before it, ships today' },
];

const CATEGORIES = [
  { icon: Smartphone, label: 'Phones' },
  { icon: Tablet, label: 'Tablets' },
  { icon: Laptop, label: 'Laptops' },
  { icon: Watch, label: 'Wearables' },
  { icon: Gamepad2, label: 'Consoles' },
  { icon: Headphones, label: 'Audio' },
];

const PRINCIPLES = [
  {
    icon: ClipboardCheck,
    title: 'Every part is tested',
    body: 'Nothing leaves the warehouse without being powered on and checked. Pulls are graded honestly - a Grade B is sold as a Grade B.',
  },
  {
    icon: BadgeCheck,
    title: 'Grades that mean something',
    body: 'NEW, OEM, Pull A, Pull B and Aftermarket are applied consistently, so what you order twice arrives the same twice.',
  },
  {
    icon: Truck,
    title: 'Shipped from Canada',
    body: 'Stock sits in Ontario, not overseas. No customs surprises, no three-week waits on a screen your customer is waiting for.',
  },
  {
    icon: Wrench,
    title: 'Built for repair businesses',
    body: 'Wholesale pricing, credit terms and a quick order pad - because you are ordering forty lines on a Tuesday, not browsing.',
  },
  {
    icon: ShieldCheck,
    title: 'Backed for 90 days',
    body: 'New and OEM parts carry a 90-day warranty, handled by the same sales desk that took the order. No ticket queue.',
  },
];

const TIMELINE = [
  {
    step: 'The problem',
    title: 'Parts sourcing was the bottleneck',
    body: 'Repair businesses were losing days to unreliable suppliers, mystery grading and parts that did not match the listing.',
  },
  {
    step: 'The approach',
    title: 'Test first, grade honestly',
    body: 'We built the warehouse process around testing before dispatch and applying one grading standard to everything that ships.',
  },
  {
    step: 'Today',
    title: 'A wholesale catalogue you can order from in two minutes',
    body: 'Four-level filtering, live stock, credit terms and same-day dispatch - for verified businesses only.',
  },
];

const GRADE_MEANING = {
  NEW: 'Sealed, never fitted. Full 90-day warranty.',
  OEM: 'Original manufacturer stock, sold as a service part.',
  'PULL-A': 'Pulled from a working device. No marks visible in use.',
  'PULL-B': 'Pulled and working, with cosmetic wear we describe up front.',
  AFTERMARKET: 'Third-party equivalent, tested to the same workshop standard.',
};

/* --------------------------------------------------------------------------
   Hero artwork. Cellvix has supplied no photography (PROGRESS.md open question
   #6), and the register of this page is a wholesale supplier's workshop, not a stock
   photo of a smiling warehouse. Drawn on tokens, so it recolours with the
   palette and stays crisp at any width.
   -------------------------------------------------------------------------- */
function WorkshopScene() {
  const rack = [
    { x: 74, y: 92, w: 62, accent: true },
    { x: 148, y: 92, w: 62 },
    { x: 74, y: 136, w: 62 },
    { x: 148, y: 136, w: 62, accent: true },
    { x: 74, y: 180, w: 136 },
  ];

  return (
    <svg
      viewBox="0 0 960 300"
      className="h-auto w-full"
      role="img"
      aria-label="A repair workshop: a rack of graded parts trays, a phone under test with probes on it, and a laptop and tablet waiting on the workshop"
    >
      {/* Pegboard - the texture of a workshop, faint enough to sit behind. */}
      <g fill="var(--color-ink-200)" opacity="0.28">
        {Array.from({ length: 6 }).map((_, row) =>
          Array.from({ length: 32 }).map((__, column) => (
            <circle key={`${row}-${column}`} cx={38 + column * 28} cy={30 + row * 26} r="1.5" />
          )),
        )}
      </g>

      <g
        fill="none"
        stroke="var(--color-ink-200)"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* workshop line */}
        <path d="M28 250h904" strokeWidth="2.2" />

        {/* rack of trays */}
        <rect x="60" y="78" width="164" height="172" rx="6" />
        <path d="M60 128h164M60 172h164M60 216h164" />

        {/* phone under test */}
        <rect x="392" y="62" width="126" height="188" rx="16" />
        <rect x="404" y="80" width="102" height="146" rx="7" opacity="0.6" />
        <path d="M436 72h38" />

        {/* probe arms reaching in from the right of the phone */}
        <path d="M560 118l-42 22M560 118l30-16M560 176l-42-22M560 176l30 16" opacity="0.75" />

        {/* laptop, open: lid, hinge, then the keyboard deck in perspective */}
        <rect x="676" y="96" width="180" height="112" rx="8" />
        <rect x="690" y="108" width="152" height="88" rx="4" opacity="0.5" />
        <path d="M660 250l18-42h176l18 42z" />
        <path d="M702 232h128" opacity="0.7" />

        {/* tablet standing on the workshop */}
        <rect x="268" y="126" width="96" height="124" rx="10" />
        <rect x="279" y="137" width="74" height="94" rx="4" opacity="0.5" />
        <path d="M303 241h26" opacity="0.7" />
      </g>

      {/* Graded trays. The accented ones carry the brand - three touches, not a
          wash: this is an accent palette, never a ground. */}
      {rack.map((tray) => (
        <rect
          key={`${tray.x}-${tray.y}`}
          x={tray.x}
          y={tray.y}
          width={tray.w}
          height="26"
          rx="4"
          fill="none"
          stroke={tray.accent ? 'var(--color-brand)' : 'var(--color-ink-200)'}
          strokeWidth="1.8"
          opacity={tray.accent ? 1 : 0.55}
        />
      ))}

      {/* The test pass: a brand tick on the screen being checked. */}
      <path
        d="M432 158l20 22 44-52"
        fill="none"
        stroke="var(--color-brand)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle cx="590" cy="102" r="5" fill="var(--color-brand)" />
      <circle cx="590" cy="192" r="5" fill="var(--color-brand)" />

      <text
        x="60"
        y="284"
        fontSize="11"
        fontWeight="700"
        letterSpacing="2.4"
        fill="var(--color-ink-200)"
        className="font-display"
      >
        TESTED · GRADED · PACKED
      </text>
    </svg>
  );
}

/** The racking diagram that carries the warehouse section. */
function RackScene() {
  const trays = [
    { x: 44, y: 60, w: 44, accent: true },
    { x: 96, y: 60, w: 44 },
    { x: 44, y: 108, w: 44 },
    { x: 96, y: 108, w: 44, accent: true },
    { x: 44, y: 156, w: 96 },
    { x: 178, y: 88, w: 44 },
    { x: 230, y: 88, w: 44, accent: true },
    { x: 178, y: 136, w: 96 },
    { x: 178, y: 172, w: 44, accent: true },
  ];

  return (
    <svg
      viewBox="0 0 320 220"
      className="h-auto w-full"
      role="img"
      aria-label="Warehouse racking with graded parts trays"
    >
      <g
        fill="none"
        stroke="var(--color-ink-200)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 200h280" strokeWidth="2" />
        <rect x="34" y="52" width="118" height="148" rx="4" />
        <rect x="168" y="80" width="118" height="120" rx="4" />
        <path d="M34 100h118M34 148h118M168 128h118M168 164h118" />
      </g>

      {trays.map((tray) => (
        <rect
          key={`${tray.x}-${tray.y}`}
          x={tray.x}
          y={tray.y}
          width={tray.w}
          height="30"
          rx="3"
          fill="none"
          stroke={tray.accent ? 'var(--color-brand)' : 'var(--color-ink-200)'}
          strokeWidth="1.6"
          opacity={tray.accent ? 1 : 0.55}
        />
      ))}

      <text
        x="160"
        y="216"
        textAnchor="middle"
        fontSize="9"
        fontWeight="700"
        letterSpacing="1.6"
        fill="var(--color-ink-200)"
        className="font-display"
      >
        GRADED · TESTED · PACKED
      </text>
    </svg>
  );
}

/* ==========================================================================
   Sections
   ========================================================================== */

function Hero() {
  const info = useBusinessInfo();

  return (
    <Slab aria-labelledby="about-heading">
      <Reveal className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-end lg:gap-14">
        <div>
          <p className="eyebrow mb-5 text-brand">About Cellvix</p>
          <h1
            id="about-heading"
            className="text-d-md leading-[1.02] tracking-[-0.035em] sm:text-d-lg lg:text-d-xl"
          >
            Repair parts you can quote a customer on
          </h1>
        </div>

        <div>
          <p className="text-lg leading-relaxed text-ink-400">
            Cellvix is a Canadian wholesale supplier of replacement parts for phones, tablets,
            laptops, wearables and consoles. We sell to repair businesses only - which is why every
            price, grade and stock figure on this site is one you can build a quote around.
          </p>
          <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-500">
            <MapPin className="size-4 text-brand" strokeWidth={2} aria-hidden="true" />
            Shipped from {info.address.city}, {info.address.region}
            <span className="text-ink-200" aria-hidden="true">
              ·
            </span>
            Wholesale accounts only
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.12} className="mt-10 lg:mt-14">
        <div className="rounded-xl border border-line bg-surface-2 p-5 sm:p-8 lg:p-10">
          <WorkshopScene />

          <ul className="mt-8 grid grid-cols-3 gap-2 border-t border-line pt-6 sm:gap-3 lg:grid-cols-6">
            {CATEGORIES.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="flex flex-col items-center gap-2 rounded-lg bg-surface px-2 py-3 text-center"
              >
                <Icon className="size-5 text-brand" strokeWidth={1.5} aria-hidden="true" />
                <span className="font-display text-sm font-bold text-ink-900">{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </Reveal>
    </Slab>
  );
}

function Statement() {
  return (
    <Slab tone="dark" aria-labelledby="statement-heading">
      <Reveal className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between lg:gap-12">
        <div className="max-w-3xl">
          <p className="eyebrow mb-5 text-white/55">Why we exist</p>
          <h2
            id="statement-heading"
            className="text-3xl leading-[1.08] tracking-[-0.03em] text-white sm:text-d-md lg:text-d-lg"
          >
            A repair shop should not have to gamble on a screen to quote a job.
          </h2>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/65">
            So we run the catalogue the way a workshop runs a workshop: one grading sheet, live stock,
            a price that does not move between the listing and the invoice, and parts that go out
            the door the same day you order them.
          </p>
        </div>

        <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white/85">
          <BadgeCheck className="size-4" strokeWidth={2} aria-hidden="true" />
          Accounts verified in one business day
        </span>
      </Reveal>

      <div className="mt-12 grid gap-8 border-t border-white/10 pt-10 sm:grid-cols-2 lg:mt-16 lg:grid-cols-4 lg:gap-6">
        {MILESTONES.map((milestone, index) => (
          <Reveal key={milestone.label} delay={index * 0.08}>
            <p className="font-display text-d-md font-bold leading-none tracking-[-0.03em] text-white lg:text-d-lg">
              <CountUp to={milestone.value} suffix={milestone.suffix ?? ''} />
            </p>
            <p className="mt-4 font-display text-md font-bold text-white">{milestone.label}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-white/60">{milestone.hint}</p>
          </Reveal>
        ))}
      </div>
    </Slab>
  );
}

function Principles() {
  return (
    <Slab aria-labelledby="principles-heading">
      <SectionHeader
        id="principles-heading"
        eyebrow="How we work"
        title="What sets a Cellvix order apart"
        lede="Five commitments that decide what we stock, how it is graded and when it ships."
        centered
      />

      {/* Three across, then two wider - an even five-up row would leave a gap
          where the fifth card should be. */}
      <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {PRINCIPLES.map(({ icon: Icon, title, body }, index) => (
          <Reveal
            key={title}
            delay={index * 0.07}
            className={index < 3 ? 'lg:col-span-2' : 'lg:col-span-3'}
          >
            <div className="h-full rounded-xl border border-line bg-surface-2 p-6">
              <span
                className="mb-5 flex size-11 items-center justify-center rounded-lg bg-brand text-white"
                aria-hidden="true"
              >
                <Icon className="size-5" strokeWidth={1.5} />
              </span>
              <h3 className="text-lg">{title}</h3>
              <p className="mt-2.5 text-md leading-relaxed text-ink-500">{body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Slab>
  );
}

function Story() {
  return (
    <Slab aria-labelledby="story-heading">
      <SectionHeader
        id="story-heading"
        eyebrow="Our story"
        title="How we got here"
        lede="Cellvix started as a fix for the part of a repair business nobody photographs: sourcing."
      />

      {/* Reveal renders AS the <li> - wrapping list items in a motion <div>
          puts a non-<li> directly inside the <ol> and breaks the list for
          screen readers. */}
      <ol className="mt-12 space-y-0">
        {TIMELINE.map((entry, index) => (
          <Reveal
            key={entry.step}
            as="li"
            delay={index * 0.1}
            className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-8"
          >
            {/* The rail: a numbered marker with a connector that stops at the
                last entry rather than trailing into nothing. */}
            <div className="flex items-center gap-4 sm:flex-col sm:items-center sm:gap-0">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 font-display text-sm font-bold text-brand">
                {String(index + 1).padStart(2, '0')}
              </span>
              {index < TIMELINE.length - 1 ? (
                <span className="h-px flex-1 bg-line sm:h-full sm:w-px sm:flex-1" aria-hidden="true" />
              ) : null}
            </div>

            <div className={cn('pb-10', index === TIMELINE.length - 1 && 'pb-0')}>
              <span className="eyebrow text-ink-300">{entry.step}</span>
              <h3 className="mt-3 text-xl leading-snug sm:text-2xl">{entry.title}</h3>
              <p className="mt-3 max-w-2xl text-md leading-relaxed text-ink-500">
                {entry.body}
              </p>
            </div>
          </Reveal>
        ))}
      </ol>
    </Slab>
  );
}

function Grading() {
  return (
    <Slab aria-labelledby="grading-heading">
      <SectionHeader
        id="grading-heading"
        eyebrow="The grading sheet"
        title="Five grades, applied the same way every time"
        lede="The grade on the listing is the grade that arrives. It is the one number a repair shop cannot afford to guess at, so it is never a judgement call at the packing bench."
      />

      <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {GRADE_ORDER.map((grade, index) => (
          <Reveal key={grade} delay={index * 0.06}>
            <div className="flex h-full flex-col rounded-xl border border-line bg-surface-2 p-5">
              <GradeBadge grade={grade} className="mb-4" />
              <h3 className="text-lg">{GRADES[grade].label}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-500">
                {GRADE_MEANING[grade]}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </Slab>
  );
}

function Warehouse() {
  const info = useBusinessInfo();
  const checks = [
    { icon: PackageCheck, text: 'Powered on and function-tested before packing' },
    { icon: Boxes, text: 'Anti-static packaging on every screen and board' },
    { icon: MapPin, text: 'Canadian stock - no customs delays' },
  ];

  return (
    <Slab aria-labelledby="warehouse-heading">
      <div className="grid gap-10 lg:grid-cols-2 lg:items-stretch lg:gap-16">
        <Reveal>
          <p className="eyebrow mb-5 text-brand">The warehouse</p>
          <h2
            id="warehouse-heading"
            className="text-3xl leading-[1.06] tracking-[-0.03em] sm:text-d-md lg:text-d-md"
          >
            One warehouse, one standard
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-ink-400">
            Everything ships from {info.address.city}. Orders placed before 2 PM ET go out
            the same day, and every line is picked against the same grading sheet - so the Grade A
            pull you ordered last month is the Grade A pull that arrives this month.
          </p>

          <ul className="mt-8 space-y-3.5">
            {checks.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-md text-ink-700">
                <span
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ok-50 text-ok"
                  aria-hidden="true"
                >
                  <Icon className="size-3.5" strokeWidth={2.25} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={0.12} className="h-full">
          <div className="flex h-full items-center rounded-xl border border-line bg-surface-2 p-8 lg:p-12">
            <RackScene />
          </div>
        </Reveal>
      </div>
    </Slab>
  );
}

function LatestPosts() {
  const { data, isLoading } = useBlogPosts();
  const posts = (data?.posts ?? []).slice(0, 3);

  // An empty blog is a legitimate state on a fresh database - render nothing
  // rather than an empty heading.
  if (!isLoading && posts.length === 0) return null;

  return (
    <Slab aria-labelledby="posts-heading">
      <SectionHeader
        id="posts-heading"
        eyebrow="From the workshop"
        title="What we are writing about"
        lede="Repair guides, grading notes and supply updates from the people picking the orders."
      />

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading
          ? Array.from({ length: 3 }).map((_, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={index} className="overflow-hidden rounded-xl border border-line">
                <Skeleton className="h-44 w-full rounded-none" />
                <div className="space-y-2 p-5">
                  <Skeleton className="h-5 w-4/5" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
            ))
          : posts.map((post, index) => (
              <Reveal key={post.slug} delay={index * 0.08}>
                <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-line bg-surface-2 transition-[border-color] duration-snap ease-entrance hover:border-ink-200">
                  <PostCover post={post} className="shrink-0 border-b border-line" />

                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="text-lg leading-snug">
                      <Link to={`/blog/${post.slug}`} className={cn(pressable, ' hover:text-brand')}>
                        {post.title}
                      </Link>
                    </h3>
                    <p className="mt-2.5 line-clamp-3 flex-1 text-md leading-relaxed text-ink-500">
                      {post.excerpt}
                    </p>
                    <p className="mt-5 text-sm text-ink-400">
                      <time dateTime={post.publishedAt ?? undefined}>{date(post.publishedAt)}</time>
                      <span aria-hidden="true"> · </span>
                      {post.readMinutes} min read
                    </p>
                  </div>
                </article>
              </Reveal>
            ))}
      </div>

      <Reveal className="mt-10 flex justify-center">
        <Link to="/blog">
          <Button variant="outline" size="lg" iconRight={ArrowRight}>
            Read the blog
          </Button>
        </Link>
      </Reveal>
    </Slab>
  );
}

function ClosingCta() {
  return (
    <Slab tone="gradient" aria-labelledby="cta-heading">
      <Reveal className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-16">
        <div>
          <h2
            id="cta-heading"
            className="max-w-2xl text-3xl leading-[1.06] tracking-[-0.03em] text-white sm:text-d-md lg:text-d-md"
          >
            Open a wholesale account
          </h2>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/75">
            Wholesale pricing, credit terms and same-day dispatch. Accounts are verified by our team
 - usually within one business day.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            to="/shop"
            className={cn(pressable, 'inline-flex h-13 items-center gap-2 rounded-lg bg-white px-7 font-display text-lg font-semibold text-ink-900 hover:bg-white/90')}
          >
            Browse the catalogue
            <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
          </Link>
          <Link
            to="/contact"
            className={cn(pressable, 'inline-flex h-13 items-center rounded-lg border border-white/35 px-7 font-display text-lg font-semibold text-white hover:bg-white/10')}
          >
            Talk to the sales desk
          </Link>
        </div>
      </Reveal>
    </Slab>
  );
}

/**
 * About Us (brief §9): storytelling-forward, scroll-triggered reveals, milestone
 * counters.
 *
 * The page is built as a stack of rounded slabs rather than one flat column
 * each section owns its ground, and the two that carry weight (the statement
 * with the counters, and the closing CTA) invert to dark. The gradient appears
 * exactly once, on the CTA, per PROJECT_INSTRUCTIONS.md §2.2: the dark
 * statement slab is solid `ink-900`, not a second gradient panel.
 */
export function AboutPage() {
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-6">
      <Hero />
      <Statement />
      <Principles />
      <Story />
      <Grading />
      <Warehouse />
      <LatestPosts />
      <ClosingCta />
    </div>
  );
}

export default AboutPage;
