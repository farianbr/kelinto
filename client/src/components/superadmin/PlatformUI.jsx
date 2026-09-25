import { Fragment } from 'react';
import { Link, NavLink } from 'react-router';
import { ChevronRight } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable, pressableSurface } from '@/lib/motion';

/**
 * The console's own surfaces (SAAS_PLATFORM §0.1).
 *
 * **Separate from `components/ui` on purpose.** Those are the tenant's: light
 * surfaces, brand red, the business panel's language. The console is a
 * different application wearing a different identity, and sharing a `Panel`
 * between them would mean every change to a tenant's look silently reshaped
 * the platform's.
 *
 * Grown from four pieces to a small kit when the console became a set of real
 * pages (2026-09-25): a page needs to say where it is (`PlatformBreadcrumbs`),
 * what it is about (`PlatformHeader`), the figures that matter
 * (`PlatformStat`), the records it lists (`PlatformTable`) and the facts about
 * one record (`PlatformFacts`). Each exists because at least two pages needed
 * it, not ahead of them.
 */

/** A raised surface. `footer` is where a panel's actions live, below a real edge. */
export function PlatformPanel({ title, description, action, footer, children, className, flush }) {
  return (
    <section
      className={cn(
        // A border OR a shadow, never both: anchored in the page, so bordered.
        'rounded-xl border border-plat-line bg-plat-surface',
        className,
      )}
    >
      {(title || action) && (
        <header className="flex flex-wrap items-start gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            {title && (
              <h2 className="text-lg font-semibold leading-tight tracking-tight text-plat-text">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-1 text-sm leading-normal text-plat-muted">{description}</p>
            )}
          </div>
          {action}
        </header>
      )}
      {children && <div className={cn(flush ? '' : title || action ? 'px-5 pb-5' : 'p-5')}>{children}</div>}
      {footer && (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-plat-line-soft px-5 py-3">
          {footer}
        </footer>
      )}
    </section>
  );
}

/**
 * A row inside a panel - a business, a thread, a grant.
 *
 * `to` makes the whole row a link and `onClick` a button; without either the
 * row renders as a plain element, so a static row never advertises itself as
 * pressable.
 */
export function PlatformRow({ icon: Icon, children, onClick, to, className }) {
  const interactive = Boolean(onClick || to);
  const classes = cn(
    'flex w-full flex-wrap items-center gap-3 rounded-lg border border-plat-line-soft',
    'bg-plat-raised px-4 py-3 text-left',
    interactive && cn(pressableSurface, 'hover:border-plat-line hover:bg-plat-raised/80'),
    className,
  );
  const body = (
    <>
      {Icon && <Icon className="size-4 shrink-0 text-plat-dim" strokeWidth={2} aria-hidden="true" />}
      {children}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {body}
      </button>
    );
  }
  return <div className={classes}>{body}</div>;
}

const TONES = {
  neutral: 'bg-plat-text/6 text-plat-muted',
  // The highlighter behind ink: the one place the identity's colour carries a word.
  accent: 'bg-plat-mark text-plat-accent-soft',
  ok: 'bg-plat-ok/15 text-plat-ok',
  warn: 'bg-plat-warn/15 text-plat-warn',
  danger: 'bg-plat-danger/15 text-plat-danger',
};

const DOTS = {
  neutral: 'bg-plat-dim',
  accent: 'bg-plat-text',
  ok: 'bg-plat-ok',
  warn: 'bg-plat-warn',
  danger: 'bg-plat-danger',
};

/**
 * A status pill. Tinted background, coloured text, never a solid fill.
 *
 * The leading mark is a dot, or an icon where the state has a shape of its own
 * (a lock for "always on"). Short words only: a pill holding a sentence is a
 * notice that lost its layout.
 */
export function PlatformBadge({ tone = 'neutral', icon: Icon, children, className }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5',
        'text-2xs font-medium leading-5',
        TONES[tone] ?? TONES.neutral,
        className,
      )}
    >
      {Icon ? (
        <Icon className="size-3 shrink-0" strokeWidth={2.25} aria-hidden="true" />
      ) : (
        <span className={cn('size-1.5 rounded-full', DOTS[tone] ?? DOTS.neutral)} aria-hidden="true" />
      )}
      {children}
    </span>
  );
}

/**
 * `ghost` sits at `plat-muted`, not `plat-dim`.
 *
 * On a dark surface a dim grey label reads as *disabled* rather than as quiet:
 * the first pass used the dimmest step and every row action looked switched
 * off. Muted is the quietest step that still reads as available.
 */
const VARIANTS = {
  primary: 'bg-plat-accent text-white hover:bg-plat-accent-dim',
  secondary: 'border border-plat-line bg-plat-raised text-plat-text hover:border-plat-dim',
  ghost: 'text-plat-muted hover:bg-plat-text/8 hover:text-plat-text',
  danger: 'text-plat-danger hover:bg-plat-danger/10',
  'danger-solid': 'bg-plat-danger text-plat-bg hover:bg-plat-danger/90',
};

export function PlatformButton({
  variant = 'ghost',
  size = 'md',
  icon: Icon,
  loading,
  children,
  className,
  to,
  // Defaulted explicitly rather than left to spread order: a button inside a
  // form defaults to `submit` in HTML, so a control that only meant to be
  // pressable would submit the form it happens to sit in.
  type = 'button',
  ...props
}) {
  const classes = cn(
    pressable,
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium',
    'transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'h-8 px-2.5 text-sm' : 'h-9 px-3.5 text-md',
    VARIANTS[variant] ?? VARIANTS.ghost,
    className,
  );
  const body = (
    <>
      {Icon && <Icon className="size-4 shrink-0" strokeWidth={2} aria-hidden="true" />}
      {loading ? 'Working…' : children}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes} {...props}>
        {body}
      </Link>
    );
  }
  return (
    <button type={type} {...props} disabled={props.disabled || loading} className={classes}>
      {body}
    </button>
  );
}

/**
 * Where this page sits, as links back up the tree.
 *
 * The last crumb is the page itself and is not a link: a link to where you
 * already are is a control that does nothing. On a phone only the parent is
 * shown, as a back link, because four crumbs at 360px wrap into a paragraph.
 */
export function PlatformBreadcrumbs({ items }) {
  if (!items?.length) return null;
  const parent = items.length > 1 ? items[items.length - 2] : null;

  return (
    <nav aria-label="Breadcrumb" className="mb-3 min-w-0">
      {parent?.to && (
        <Link
          to={parent.to}
          className={cn(pressable, 'inline-flex items-center gap-1 text-sm text-plat-muted hover:text-plat-text sm:hidden')}
        >
          <ChevronRight className="size-3.5 rotate-180" strokeWidth={2} aria-hidden="true" />
          {parent.label}
        </Link>
      )}
      <ol className="hidden min-w-0 flex-wrap items-center gap-1 text-sm sm:flex">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <Fragment key={`${item.label}-${index}`}>
              <li className="min-w-0">
                {last || !item.to ? (
                  <span
                    aria-current={last ? 'page' : undefined}
                    className={cn('block truncate', last ? 'text-plat-text' : 'text-plat-dim')}
                  >
                    {item.label}
                  </span>
                ) : (
                  <Link
                    to={item.to}
                    className="block truncate text-plat-muted transition-colors duration-fast hover:text-plat-text"
                  >
                    {item.label}
                  </Link>
                )}
              </li>
              {!last && (
                <li aria-hidden="true" className="text-plat-line">
                  <ChevronRight className="size-3.5" strokeWidth={2} />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The page's title block. One per page, always at the top.
 *
 * `meta` is the line of facts that identifies the record (a code, an address,
 * a plan), set in the dim step so the title keeps the weight. `badges` sit on
 * the title line because a status is part of what the record IS right now.
 */
export function PlatformHeader({ crumbs, eyebrow, title, description, meta, badges, action }) {
  return (
    <header className="mb-6">
      <PlatformBreadcrumbs items={crumbs} />
      {/* A column on a phone, so the description gets the full width instead
          of a third of it beside the action; a row from `sm` up. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          {eyebrow && <p className="eyebrow mb-2 text-plat-accent-soft">{eyebrow}</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* Tracking tightens as the size grows: the optical correction that
                separates a set headline from a scaled-up paragraph. */}
            <h1 className="min-w-0 text-3xl font-semibold tracking-tight text-plat-text">{title}</h1>
            {/* The badges wrap as one group, never one per line. */}
            {badges && <span className="flex flex-wrap items-center gap-1.5">{badges}</span>}
          </div>
          {meta && <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-plat-dim">{meta}</div>}
          {description && (
            <p className="mt-2 max-w-[62ch] text-md leading-relaxed text-plat-muted">{description}</p>
          )}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
    </header>
  );
}

/** The middot between facts on a meta line. Decorative, so hidden from readers. */
export function MetaDot() {
  return (
    <span aria-hidden="true" className="text-plat-line">
      ·
    </span>
  );
}

/**
 * One figure, and what it is of.
 *
 * The number is the tile: largest thing in it, tabular so a row of tiles lines
 * up digit for digit. `detail` says what the figure is out of or made of, since
 * "3" on its own answers nothing. `tone` colours the figure only when it is a
 * state somebody must act on; a healthy number stays ink.
 */
export function PlatformStat({ label, value, detail, tone, to }) {
  const Tag = to ? Link : 'div';
  return (
    <Tag
      to={to}
      className={cn(
        'block rounded-xl border border-plat-line bg-plat-surface px-4 py-4',
        to && cn(pressableSurface, 'hover:border-plat-dim/60'),
      )}
    >
      <p className="text-sm text-plat-muted">{label}</p>
      <p
        className={cn(
          'tnum mt-2 text-3xl font-semibold tracking-tight',
          tone === 'warn' ? 'text-plat-warn' : tone === 'danger' ? 'text-plat-danger' : 'text-plat-text',
        )}
      >
        {value}
      </p>
      {detail && <p className="mt-1 text-xs text-plat-dim">{detail}</p>}
    </Tag>
  );
}

/**
 * A record list, as a real table from `sm` up.
 *
 * On a phone a six-column table is a horizontal scroll nobody finds, so each
 * row becomes a stacked card: the first column is the heading and the rest
 * follow as labelled lines. `columns` carries both readings - `label` for the
 * header and the stacked label, `render` for the cell, `align` for figures.
 */
export function PlatformTable({ columns, rows, rowKey = (row) => row.id, rowTo, empty }) {
  if (!rows.length) return empty ?? null;

  return (
    <div className="overflow-hidden rounded-xl border border-plat-line bg-plat-surface">
      <table className="w-full border-collapse text-left text-md">
        <thead className="hidden border-b border-plat-line bg-plat-raised/50 sm:table-header-group">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-4 py-2.5 text-xs font-medium text-plat-dim',
                  column.align === 'right' && 'text-right',
                  column.hideBelow === 'lg' && 'hidden lg:table-cell',
                  column.hideBelow === 'md' && 'hidden md:table-cell',
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-plat-line-soft">
          {rows.map((row) => {
            const to = rowTo?.(row);
            return (
              <tr
                key={rowKey(row)}
                className={cn(
                  'block px-4 py-3 sm:table-row sm:p-0',
                  to && 'relative transition-colors duration-fast hover:bg-plat-text/3',
                )}
              >
                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    className={cn(
                      // One display rule per breakpoint, never two competing at
                      // the same one: a column hidden on tablets is a card line
                      // on a phone, gone at `sm`, and a cell again from its own
                      // breakpoint up.
                      column.hideBelow === 'lg'
                        ? 'block sm:hidden lg:table-cell'
                        : column.hideBelow === 'md'
                          ? 'block sm:hidden md:table-cell'
                          : 'block sm:table-cell',
                      'py-0.5 sm:px-4 sm:py-3 sm:align-middle',
                      column.align === 'right' && 'sm:text-right',
                    )}
                  >
                    {index > 0 && (
                      <span className="mr-2 text-xs text-plat-dim sm:hidden">{column.label}</span>
                    )}
                    {/* The first cell carries the row link, stretched over the
                        whole row, so the row is one target without nesting
                        the other cells' own links inside an anchor. */}
                    {index === 0 && to ? (
                      <Link
                        to={to}
                        className="font-medium text-plat-text after:absolute after:inset-0 after:content-['']"
                      >
                        {column.render(row)}
                      </Link>
                    ) : (
                      column.render(row)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Sections of one record, as links rather than state.
 *
 * Each tab is a route, so a section can be linked to, survives a reload and
 * answers the browser's back button: the whole reason the console moved off
 * modals.
 */
export function PlatformTabs({ items }) {
  return (
    <nav aria-label="Sections" className="scroll-slim -mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="flex min-w-max gap-1 border-b border-plat-line">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'relative -mb-px flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-md font-medium',
                'transition-colors duration-fast',
                isActive
                  ? 'border-plat-accent text-plat-text'
                  : 'border-transparent text-plat-muted hover:text-plat-text',
              )
            }
          >
            {item.label}
            {item.count > 0 && (
              <span className="tnum rounded-full bg-plat-warn/15 px-1.5 text-2xs font-semibold leading-5 text-plat-warn">
                {item.count}
              </span>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/**
 * Labelled facts about one record.
 *
 * A description list, because that is what it is: a term and its value. Two
 * columns from `sm` up so a record with eight short facts is four rows rather
 * than eight.
 */
export function PlatformFacts({ items, columns = 2 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4', columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3')}>
      {items.filter(Boolean).map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-plat-dim">{item.label}</dt>
          <dd className={cn('mt-1 wrap-break-word text-md text-plat-text', item.mono && 'font-mono text-sm')}>
            {item.value ?? <span className="text-plat-dim">Not set</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Nothing here yet, said in a way that explains what would put something here. */
export function PlatformEmpty({ icon: Icon, title, body, action }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      {Icon && <Icon className="size-5 text-plat-dim" strokeWidth={1.75} aria-hidden="true" />}
      <div>
        <p className="text-md font-medium text-plat-text">{title}</p>
        {body && <p className="mx-auto mt-1 max-w-[46ch] text-sm text-plat-muted">{body}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * A loading block in the console's own material.
 *
 * Not `components/ui/Skeleton`: that is the storefront's, a light shimmer
 * built for white pages, and on graphite it read as a row of glowing slabs,
 * louder than the content it stood in for. This is one step up from the
 * surface and pulses, so the page's shape arrives before its data without
 * flashing.
 */
export function PlatformSkeleton({ className }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-lg bg-plat-raised motion-reduce:animate-none', className)} />;
}

/** The page's loading shape: a title, a strip of tiles, a panel. */
export function PlatformPageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <PlatformSkeleton className="h-4 w-40" />
      <PlatformSkeleton className="mt-3 h-8 w-64" />
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <PlatformSkeleton className="h-24 rounded-xl" />
        <PlatformSkeleton className="h-24 rounded-xl" />
        <PlatformSkeleton className="h-24 rounded-xl" />
      </div>
      <PlatformSkeleton className="mt-4 h-56 w-full rounded-xl" />
    </div>
  );
}

/**
 * The record a URL named does not exist, or no longer does.
 *
 * A page rather than a redirect: somebody who followed a link deserves to be
 * told the record is gone, not dropped on a list wondering what happened.
 */
export function PlatformNotFound({ crumbs, what, back }) {
  return (
    <>
      <PlatformHeader crumbs={crumbs} title={`${what} not found`} />
      <PlatformPanel>
        <PlatformEmpty
          title={`No ${what.toLowerCase()} at this address`}
          body="It may have been removed, or the link was copied incomplete."
          action={
            back && (
              <PlatformButton variant="secondary" size="sm" to={back.to}>
                {back.label}
              </PlatformButton>
            )
          }
        />
      </PlatformPanel>
    </>
  );
}

export default PlatformPanel;
