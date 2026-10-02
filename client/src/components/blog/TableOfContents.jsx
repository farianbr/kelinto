import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from '@/lib/motionReact';
import { ChevronDown, List } from 'lucide-react';
import cn from '@/lib/cn';
import scrollToSection from '@/lib/scrollToSection';
import { ease, pressable } from '@/lib/motion';

/**
 * An article's table of contents, built from the headings the body actually
 * contains (see `extractHeadings` in `lib/richText.jsx`) rather than from a
 * field an author has to keep in sync.
 *
 * Two presentations of the same list, because a long-form page has room for a
 * rail on a wide screen and none at all on a phone:
 *
 *   `variant="rail"` - sticky in the left margin from `xl` up, with the
 *                        current section marked. Hidden below that.
 *   `variant="inline"` - a collapsed disclosure above the body, for every width
 *                        narrower than the rail. Collapsed by default: a reader
 *                        who wants the map opens it, and one who does not is
 *                        not made to scroll past six links to reach paragraph
 *                        one.
 *
 * Renders nothing for an article with fewer than two headings - a contents list
 * of one entry is furniture, not navigation.
 */
export function TableOfContents({ headings = [], activeId, variant = 'rail', className }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  if (headings.length < 2) return null;

  const links = (
    <ul className="flex flex-col gap-0.5">
      {headings.map((heading) => {
        const isActive = activeId === heading.id;

        return (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              onClick={(event) => {
                event.preventDefault();
                // Closed first, then scrolled: the inline panel collapsing is a
                // ~110px layout shift above the target, and `scrollToSection`
                // recomputes its destination every frame, so it absorbs the
                // collapse instead of landing short of the heading by its height.
                setOpen(false);
                scrollToSection(heading.id);
              }}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                pressable,
                'relative block rounded-md py-1.5 pr-2 text-sm leading-snug duration-200',
                heading.level === 3 ? 'pl-6' : 'pl-3',
                isActive
                  ? 'bg-brand-50 font-semibold text-brand-700'
                  : 'text-ink-400 hover:bg-surface-2 hover:text-ink-900',
              )}
            >
              {/* The accent is a 2px rule on the current section, not a filled
                  block (PROJECT_INSTRUCTIONS.md §2.2). */}
              <span
                className={cn(
                  'absolute inset-y-1 left-0 w-[2px] rounded-full transition-opacity duration-200',
                  isActive ? 'rule-brand-gradient opacity-100' : 'opacity-0',
                )}
                aria-hidden="true"
              />
              {heading.text}
            </a>
          </li>
        );
      })}
    </ul>
  );

  if (variant === 'rail') {
    return (
      <aside className={cn('hidden xl:block', className)}>
        <nav
          aria-label="On this page"
          className="sticky top-[calc(var(--chrome-h,158px)+24px)]"
        >
          <p className="eyebrow mb-3 px-3 text-ink-300">On this page</p>
          {links}
        </nav>
      </aside>
    );
  }

  return (
    <nav
      aria-label="On this page"
      className={cn('rounded-lg border border-line bg-surface-2 xl:hidden', className)}
    >
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <List className="size-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
        <span className="flex-1 font-display text-md font-bold text-ink-900">
          On this page
        </span>
        <span className="tnum text-xs text-ink-300">{headings.length}</span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-ink-400 transition-transform duration-300 ease-entrance',
            open && 'rotate-180',
          )}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={
              reduce
                ? { duration: 0.2 }
                : {
                    height: { duration: 0.36, ease: ease.entrance },
                    opacity: { duration: 0.24, ease: 'linear' },
                  }
            }
            className="overflow-hidden"
          >
            <div className="border-t border-line px-2 pb-2 pt-2">{links}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

export default TableOfContents;
