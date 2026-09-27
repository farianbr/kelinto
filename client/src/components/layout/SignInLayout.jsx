import cn from '@/lib/cn';

/**
 * The frame every back-office sign-in stands in: the ERP, the console and a
 * business's supplier portal.
 *
 * **One piece, not two boxes.** The picture and the form are halves of a
 * single lifted card with no seam between them, so the page reads as one
 * designed object rather than two panels placed side by side. From `lg` the
 * halves sit left and right at equal size. **Below `lg` there is no picture**
 * (client ruling 2026-09-28): a band of art above the form only pushed the
 * fields down a small screen. The form stands alone, as a centred card on a
 * tablet and edge to edge on a phone, the way an app's sign-in does.
 *
 * **Every door says it runs on Kelinto**, in one line under the form: the
 * business-branded ones (a supplier portal, a business's own ERP domain) are
 * where that line is Kelinto's only appearance, which is the point of it.
 *
 * **The picture says what the door opens, without naming features.** A hub:
 * the business (or Kelinto, on the console) at the centre, a ring of plain
 * icons for the kinds of work around it, and a signal travelling along each
 * spoke into the middle. The icons are deliberately generic (people, money,
 * stock, paperwork): feature names change release to release, and a sign-in
 * page is the last place anybody should have to remember to update.
 *
 * **Two tones, one set of components.** Both use Kelinto's type and form
 * controls. `business` (a supplier portal, on a business's own website) adds
 * `.kelinto-business`, which re-points Kelinto's accent tokens at the
 * business's colour ramp, so the same buttons and fields come out in that
 * business's colour without a second component set.
 *
 * @param mark     the logo block above the form
 * @param art      `{ centre: { icon, image? }, nodes: [icon], title, body }`
 */
export function SignInLayout({ tone = 'kelinto', mark, art, children }) {
  return (
    <div
      className={cn(
        'kelinto flex min-h-dvh items-center justify-center bg-plat-bg sm:px-6 sm:py-10',
        tone === 'business' && 'kelinto-business',
      )}
    >
      <div
        className={cn(
          'flex min-h-dvh w-full flex-col overflow-hidden bg-plat-surface',
          'sm:min-h-0 sm:max-w-md sm:rounded-xl sm:shadow-flyout',
          'lg:grid lg:min-h-144 lg:max-w-5xl lg:grid-cols-2',
        )}
      >
        {art && <HubArt {...art} />}
        <main className="flex flex-1 flex-col px-6 py-10 sm:px-10 lg:px-14">
          <div className="flex flex-1 items-center">
            <div className="mx-auto w-full max-w-sm">
              <div className="mb-8">{mark}</div>
              {children}
            </div>
          </div>
          <PoweredByKelinto />
        </main>
      </div>
    </div>
  );
}

/** Where Kelinto's own site lives, for the footer's link. */
const KELINTO_SITE = 'https://kelinto.com';

/**
 * The line under every sign-in form. Kelinto's name set as the wordmark is
 * (DM Sans, bold, lower case), in ink rather than the page's accent, so on a
 * business's door it reads as a maker's mark and not as that business's brand.
 */
function PoweredByKelinto() {
  return (
    <p className="mt-10 flex items-center justify-center gap-1.5 text-xs text-plat-dim">
      Powered by
      <a
        href={KELINTO_SITE}
        target="_blank"
        rel="noopener noreferrer"
        className="font-kelinto text-sm font-bold tracking-tighter text-plat-text hover:text-plat-accent-soft"
      >
        kelinto
      </a>
    </p>
  );
}

/**
 * The heading every door opens with, and one line under it. Kept here so the
 * three pages cannot drift apart in size, weight or spacing.
 */
export function SignInHeading({ title = 'Sign in', children }) {
  return (
    <div className="text-center">
      <h1 className="text-2xl font-semibold tracking-kelinto text-plat-text">{title}</h1>
      {children && <p className="mt-2 text-md leading-normal text-plat-muted">{children}</p>}
    </div>
  );
}

/* ---- the hub ---------------------------------------------------------------
   Node positions are worked out from the count, evenly round a circle starting
   at twelve o'clock, as percentages of a square box so the SVG spokes and the
   HTML nodes land on the same points at every width. */

const RADIUS = 38;

function positions(count) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (-90 + (360 / count) * i) * (Math.PI / 180);
    return { x: 50 + RADIUS * Math.cos(angle), y: 50 + RADIUS * Math.sin(angle) };
  });
}

function HubArt({ centre, nodes, title, body }) {
  const points = positions(nodes.length);
  const CentreIcon = centre.icon;

  return (
    <div
      aria-hidden="true"
      className="relative hidden shrink-0 flex-col justify-between overflow-hidden bg-plat-accent p-12 text-white lg:flex"
    >
      {/* Light from the top right, so the flat ground has depth. */}
      <svg className="absolute inset-0 size-full" preserveAspectRatio="none" viewBox="0 0 100 100">
        <defs>
          <radialGradient id="sign-in-glow" cx="0.85" cy="0.1" r="0.9">
            <stop offset="0" stopColor="var(--color-plat-bright)" stopOpacity="0.75" />
            <stop offset="1" stopColor="var(--color-plat-bright)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100" height="100" fill="url(#sign-in-glow)" />
      </svg>

      <div className="relative mx-auto my-auto aspect-square w-full max-w-80">
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full overflow-visible">
          <circle cx="50" cy="50" r={RADIUS} fill="none" stroke="white" strokeOpacity="0.2" strokeWidth="0.4" strokeDasharray="0.8 1.8" />
          <circle cx="50" cy="50" r="22" fill="none" stroke="white" strokeOpacity="0.12" strokeWidth="0.4" />
          {points.map((p, i) => (
            <g key={i}>
              <line x1={p.x} y1={p.y} x2="50" y2="50" stroke="white" strokeOpacity="0.25" strokeWidth="0.4" />
              {/* The signal: a short dash running from the edge into the
                  centre, staggered so they never all arrive at once. */}
              <line
                x1={p.x}
                y1={p.y}
                x2="50"
                y2="50"
                pathLength="100"
                stroke="white"
                strokeWidth="0.9"
                strokeLinecap="round"
                className="sign-in-signal"
                style={{ animationDelay: `${(i * 0.55).toFixed(2)}s` }}
              />
            </g>
          ))}
        </svg>

        {/* The centre: what everything connects to, wearing its own icon
            when one has been uploaded. */}
        <span className="absolute left-1/2 top-1/2 flex size-[30%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white">
          <span className="absolute inset-[-12%] rounded-full border border-white/25" />
          {centre.image ? (
            <img src={centre.image} alt="" className="size-[55%] object-contain" decoding="async" />
          ) : (
            <CentreIcon className="size-[42%] text-plat-accent" strokeWidth={1.75} />
          )}
        </span>

        {nodes.map((Icon, i) => (
          <span
            key={i}
            className="absolute flex size-[17%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/25 backdrop-blur-sm"
            style={{ left: `${points[i].x}%`, top: `${points[i].y}%` }}
          >
            <Icon className="size-[48%] text-white" strokeWidth={1.75} />
          </span>
        ))}
      </div>

      <div className="relative">
        <p className="text-3xl font-semibold leading-tight tracking-kelinto text-white">{title}</p>
        {body && <p className="mt-3 text-md leading-relaxed text-white/80">{body}</p>}
      </div>
    </div>
  );
}

export default SignInLayout;
