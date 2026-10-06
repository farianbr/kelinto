import cn from '@/lib/cn';

/**
 * Every admin screen opens the same way (§4, convention 6): icon + H1 +
 * one-line description on the left, primary action top-right.
 *
 * The icon tile is the flat `brand-50` tint, **not** the gradient - the
 * gradient is a signature reserved for primary CTAs and one hero block a page
 * (§2b), and a page header is neither. A grey glyph on a grey tile was the
 * single biggest reason the panel read as unbranded: it is the first mark on
 * every screen, and it was the one mark carrying no colour at all.
 */
/**
 * @param badgesBelow put the badges on their own line under the title.
 *
 * **Opt-in, because it depends on how many there are.** One or two badges sit
 * comfortably beside a title and reading them as a continuation of it is
 * correct. A record screen carries four or five - status, priority, age,
 * source - and inline they push the title around, wrap unpredictably at narrow
 * widths, and turn a heading into a sentence of chips. Below the title they
 * read as what they are: the state of the record the title names.
 */
export function PageHeader({
  icon: Icon,
  title,
  description,
  action,
  badge,
  badgesBelow = false,
  className,
}) {
  return (
    <header className={cn('mb-5 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-md border border-brand/15 bg-brand-50 text-brand">
            <Icon className="size-5" strokeWidth={1.5} aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl leading-tight sm:text-2xl">{title}</h1>
            {!badgesBelow && badge}
          </div>
          {badgesBelow && badge && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{badge}</div>
          )}
          {description && (
            <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-ink-500">
              {description}
            </p>
          )}
        </div>
      </div>

      {/* `max-w-full` is what lets the row wrap: as a non-shrinking flex item
          it is otherwise as wide as all its buttons in a line, so on a phone a
          record's four or five actions ran off the right edge instead of
          dropping onto a second row. */}
      {action && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}

export default PageHeader;
