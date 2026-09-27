import cn from '@/lib/cn';
import useBusinessInfo from '@/hooks/useBusinessInfo';

/**
 * Full-bleed illustrations for the moments that are not a product grid: order
 * confirmed, page missing, payment refused.
 *
 * These are drawn rather than photographed for the same reason `PartIllustration`
 * is: Cellvix has supplied no photography (PROGRESS.md open question #6), and a
 * stock photo of a smiling call-centre would be the wrong register for a wholesale
 * supplier anyway. Everything here is inline SVG on design tokens, so it recolours
 * with the palette, costs no network request and stays crisp at any size.
 *
 * The CV monogram sits in the corner as a real raster asset, so each scene reads
 * as Cellvix's rather than as generic line art.
 */

const STROKE = {
  fill: 'none',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

/** The shared ground: a workshop bench surface with a soft brand wash above it. */
function Workbench({ id }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-wash`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.10" />
          <stop offset="55%" stopColor="var(--color-brand)" stopOpacity="0.03" />
          <stop offset="100%" stopColor="var(--color-ink-900)" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id={`${id}-rule`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-brand)" />
          <stop offset="100%" stopColor="var(--color-ink-900)" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="320" height="220" rx="18" fill={`url(#${id}-wash)`} />

      {/* Pegboard: the texture of a repair workshop, kept faint enough to sit
          behind the subject rather than compete with it. */}
      <g fill="var(--color-ink-200)" opacity="0.35">
        {Array.from({ length: 7 }).map((_, row) =>
          Array.from({ length: 11 }).map((__, column) => (
            <circle key={`${row}-${column}`} cx={28 + column * 27} cy={24 + row * 19} r="1.4" />
          )),
        )}
      </g>

      <rect x="0" y="176" width="320" height="44" rx="0" fill="var(--color-surface)" opacity="0.65" />
      <path d="M0 176h320" stroke="var(--color-line-strong)" strokeWidth="1.5" />
      <rect x="0" y="214" width="320" height="3" fill={`url(#${id}-rule)`} opacity="0.8" />
    </>
  );
}

/** Order confirmed: a sealed, labelled box leaving the workshop. */
function SuccessScene() {
  return (
    <>
      <Workbench id="scene-success" />

      <g transform="translate(96 62)">
        <path
          d="M4 26 64 6l60 20v62l-60 22-60-22z"
          fill="var(--color-surface)"
          stroke="var(--color-ink-700)"
          {...STROKE}
        />
        <path d="M4 26 64 48l60-22M64 48v62" stroke="var(--color-ink-700)" {...STROKE} />
        <path d="M34 16 94 36v20" stroke="var(--color-ink-200)" strokeDasharray="4 4" {...STROKE} />

        {/* Shipping label */}
        <rect
          x="76"
          y="42"
          width="34"
          height="26"
          rx="3"
          fill="var(--color-surface)"
          stroke="var(--color-line-strong)"
          strokeWidth="1.2"
        />
        <path d="M81 50h24M81 55h18M81 60h13" stroke="var(--color-ink-200)" strokeWidth="1.4" strokeLinecap="round" />

        {/* Tape, in brand - the one accent on the box */}
        <path d="M4 26 64 48v62" stroke="var(--color-brand)" strokeWidth="2.4" fill="none" opacity="0.35" />
      </g>

      <g transform="translate(206 44)">
        <circle cx="22" cy="22" r="21" fill="var(--color-ok-50)" stroke="var(--color-ok)" strokeWidth="2" />
        <path
          d="M12 22.5 19 30 33 15"
          stroke="var(--color-ok)"
          strokeWidth="3.2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      <g stroke="var(--color-brand)" strokeWidth="1.6" strokeLinecap="round" opacity="0.55">
        <path d="M62 58l-9-9M54 78H41M70 44V31" />
      </g>
    </>
  );
}

/** 404: the device came apart on the workshop bench, and the parts are still there. */
function NotFoundScene() {
  return (
    <>
      <Workbench id="scene-404" />

      <text
        x="160"
        y="150"
        textAnchor="middle"
        fontFamily="Archivo, Inter, sans-serif"
        fontSize="128"
        fontWeight="800"
        letterSpacing="-6"
        fill="var(--color-ink-900)"
        opacity="0.06"
      >
        404
      </text>

      {/* Rear housing, set down flat */}
      <g transform="rotate(-9 76 108)">
        <rect
          x="50"
          y="58"
          width="52"
          height="96"
          rx="10"
          fill="var(--color-surface)"
          stroke="var(--color-ink-700)"
          {...STROKE}
        />
        <rect x="58" y="66" width="20" height="20" rx="5" stroke="var(--color-ink-200)" strokeWidth="1.3" fill="none" />
        <circle cx="64" cy="72" r="3" fill="var(--color-ink-200)" />
        <circle cx="72" cy="80" r="3" fill="var(--color-ink-200)" />
        <path d="M60 128h32M60 138h20" stroke="var(--color-ink-200)" strokeWidth="1.3" strokeLinecap="round" />
      </g>

      {/* Screen assembly, lifted away - the piece that "came apart" */}
      <g transform="rotate(11 196 100)">
        <rect
          x="168"
          y="50"
          width="58"
          height="102"
          rx="10"
          fill="var(--color-surface)"
          stroke="var(--color-brand)"
          {...STROKE}
        />
        <rect x="175" y="59" width="44" height="84" rx="4" fill="var(--color-brand-50)" stroke="none" />
        <path d="M186 55h22" stroke="var(--color-ink-200)" strokeWidth="2.2" strokeLinecap="round" />
        <path
          d="M183 92h28M183 104h18"
          stroke="var(--color-brand)"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.55"
        />
      </g>

      {/* The flex cable that used to join them, unplugged */}
      <path
        d="M110 96c14 6 20 16 34 12"
        stroke="var(--color-brand)"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="5 5"
      />
      <rect x="104" y="90" width="10" height="12" rx="2.5" fill="var(--color-brand)" opacity="0.8" />
      <rect x="146" y="100" width="10" height="12" rx="2.5" fill="var(--color-ink-200)" />

      {/* Workshop tools */}
      <g stroke="var(--color-ink-200)" strokeWidth="1.6" strokeLinecap="round" fill="none">
        <path d="M232 176v-22l8-8" />
        <path d="M240 146a7 7 0 1 0-9.5-6.6" />
        <path d="M74 176v-14M84 176v-20" />
      </g>
      <circle cx="262" cy="170" r="5.5" stroke="var(--color-ink-200)" strokeWidth="1.6" fill="none" />
      <path d="M266 174l8 6" stroke="var(--color-ink-200)" strokeWidth="1.6" strokeLinecap="round" />
    </>
  );
}

/** Payment refused: the terminal said no. Nothing was charged, nothing was lost. */
function PaymentFailedScene() {
  return (
    <>
      <Workbench id="scene-payment" />

      <g transform="translate(58 62)">
        <rect
          x="0"
          y="6"
          width="132"
          height="84"
          rx="10"
          fill="var(--color-surface)"
          stroke="var(--color-ink-700)"
          {...STROKE}
        />
        <path d="M0 30h132" stroke="var(--color-ink-700)" strokeWidth="9" strokeLinecap="butt" opacity="0.9" />
        <rect x="14" y="48" width="24" height="17" rx="3" fill="var(--color-warn-50)" stroke="var(--color-warn)" strokeWidth="1.3" />
        <path d="M14 56.5h24M26 48v17" stroke="var(--color-warn)" strokeWidth="1.1" />
        <path d="M52 74h44M104 74h14" stroke="var(--color-ink-200)" strokeWidth="2.4" strokeLinecap="round" />
      </g>

      {/* The refusal itself: a hard stop, in danger - never in the brand red,
          which would read as branding rather than as an error (§2.2). */}
      <g transform="translate(198 40)">
        <circle cx="26" cy="26" r="24" fill="var(--color-danger-50)" stroke="var(--color-danger)" strokeWidth="2" />
        <path
          d="M17 17l18 18M35 17 17 35"
          stroke="var(--color-danger)"
          strokeWidth="3.4"
          strokeLinecap="round"
        />
      </g>

      {/* A severed line between card and terminal - the connection, not the money */}
      <path
        d="M62 150h60"
        stroke="var(--color-ink-200)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M138 150h56"
        stroke="var(--color-ink-200)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M124 142l6 8-6 8M136 142l-6 8 6 8"
        stroke="var(--color-danger)"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <rect x="196" y="140" width="58" height="20" rx="6" fill="var(--color-surface)" stroke="var(--color-line-strong)" strokeWidth="1.4" />
      <path d="M206 150h38" stroke="var(--color-ink-200)" strokeWidth="1.6" strokeLinecap="round" />
    </>
  );
}

const SCENES = {
  success: { render: SuccessScene, alt: 'A sealed parcel on the workshop bench, marked complete' },
  'not-found': {
    render: NotFoundScene,
    alt: 'A device disassembled on a repair workshop, its screen and housing separated',
  },
  'payment-failed': {
    render: PaymentFailedScene,
    alt: 'A card and a payment terminal with the connection between them broken',
  },
};

export function BrandScene({ variant = 'success', className, showMark = true }) {
  const scene = SCENES[variant] ?? SCENES.success;
  const Render = scene.render;
  const info = useBusinessInfo();

  return (
    <div className={cn('relative w-full max-w-[420px]', className)}>
      <svg
        viewBox="0 0 320 220"
        role="img"
        aria-label={scene.alt}
        className="h-auto w-full overflow-hidden rounded-xl border border-line bg-surface"
      >
        <Render />
      </svg>

      {/* The business's own logo, when it has uploaded one. */}
      {showMark && info.logoUrl && (
        <img
          src={info.logoUrl}
          alt=""
          aria-hidden="true"
          width="512"
          height="512"
          loading="lazy"
          className="absolute -bottom-3 -right-3 size-14 rounded-lg border border-line bg-surface object-contain p-1.5"
        />
      )}
    </div>
  );
}

export default BrandScene;
