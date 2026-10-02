import { useId, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from '@/lib/motionReact';
import { Plus } from 'lucide-react';
import cn from '@/lib/cn';
import RichText from '@/lib/richText';
import { ease, pressable } from '@/lib/motion';

/**
 * Disclosure list. One implementation serves the FAQ page and the per-product
 * FAQ section - the same pattern in two places would drift into two patterns.
 *
 * Each entry is a rounded pill made of two elements: a 2px outer that carries
 * the edge and an inner that carries the face. Closed, the outer is a hairline
 * in `line`; open, it becomes the brand gradient, so the accent arrives as a
 * thin active-state rule rather than as a filled panel (PROJECT_INSTRUCTIONS.md
 * §2.2). Nothing resizes between the two states - only the two backgrounds and
 * the icon's rotation change.
 *
 * Accessibility: the header is a real `<button>` carrying `aria-expanded` and
 * `aria-controls`; the panel is a labelled region. Collapsed panels are removed
 * from the tree rather than hidden with CSS, so a screen reader and a Ctrl-F
 * agree about what is on the page.
 *
 * Items: `{ id, question, answer }`. Answers go through RichText, so an author
 * can use bullets and bold without any HTML reaching the DOM.
 *
 * **Nothing is open on arrival, on any page** (client ruling, 2026-10-01). There
 * is deliberately no prop to open one by default: the product page used to open
 * its first entry, and a per-page exception is how a rule like this erodes.
 */
export function Accordion({
  items = [],
  className,
  numbered = true,
  /** Rows animate in on scroll. Off inside an already-animated container. */
  reveal = true,
}) {
  const [openId, setOpenId] = useState(null);
  const reduce = useReducedMotion();
  const baseId = useId();

  if (items.length === 0) return null;

  // The reveal is a blur-and-rise rather than a plain fade: the blur is what
  // makes a stack of near-identical pills read as arriving in order. Under
  // `prefers-reduced-motion` it degrades to opacity only, per §2.5 - a filter
  // animation is exactly the kind of motion that setting exists to stop.
  const hidden = reduce
    ? { opacity: 0 }
    : { opacity: 0, y: 24, filter: 'blur(6px)' };
  const shown = reduce ? { opacity: 1 } : { opacity: 1, y: 0, filter: 'blur(0px)' };

  return (
    <ul className={cn('flex flex-col gap-2', className)}>
      {items.map((item, index) => {
        const id = item.id ?? `${baseId}-${index}`;
        const isOpen = openId === id;
        const panelId = `${baseId}-panel-${index}`;
        const buttonId = `${baseId}-button-${index}`;

        return (
          <motion.li
            key={id}
            initial={reveal ? hidden : false}
            whileInView={reveal ? shown : undefined}
            viewport={reveal ? { once: true, amount: 0.2 } : undefined}
            transition={{ duration: 0.5, delay: index * 0.06, ease: ease.entrance }}
            className={cn(
              'rounded-xl p-[2px] transition-[background-color,background-image] duration-300',
              isOpen ? 'bg-brand-gradient' : 'bg-line hover:bg-line-strong',
            )}
          >
            <div
              className={cn(
                'rounded-xl bg-surface transition-shadow duration-300',
                isOpen && 'shadow-card',
              )}
            >
              <h3>
                <button
                  type="button"
                  id={buttonId}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpenId(isOpen ? null : id)}
                  className="group flex w-full items-center gap-3 px-4 py-4 text-left sm:gap-4 sm:px-6 sm:py-5"
                >
                  {numbered ? (
                    // Hidden on phones, where the row has no width to spare
                    // the same call the reference layout makes.
                    <span
                      className={cn(
                        'tnum hidden size-8 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-medium transition-colors sm:flex',
                        'shadow-[inset_0_-2px_2px_rgb(10_10_11/0.04)]',
                        isOpen
                          ? 'border-brand-100 bg-brand-50 text-brand-700'
                          : 'border-line bg-surface-2 text-ink-400',
                      )}
                      aria-hidden="true"
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
                  ) : null}

                  <span
                    className={cn(
                      pressable,
                      'min-w-0 flex-1 font-display text-lg font-bold leading-snug sm:text-lg',
                      isOpen ? 'text-ink-900' : 'text-ink-900 group-hover:text-brand',
                    )}
                  >
                    {item.question}
                  </span>

                  {/* A rotating plus, not a swapped plus/minus glyph: the icon
                      stays one element, so the transform is the only thing that
                      changes and nothing reflows under the cursor. The circle
                      uses the same two-element trick as the row - a gradient
                      edge appears around a white face once it is open. */}
                  {/* Sized down on phones: at 44px it was the loudest thing in
                      a 320px row and crowded the question off two lines. 32px
                      still clears the 24px minimum target with the row's own
                      padding around it, and it grows back at `sm`. */}
                  <span
                    className={cn(
                      'flex size-8 shrink-0 rounded-full p-[2px] transition-[background-color,background-image] duration-300 sm:size-11',
                      isOpen ? 'bg-brand-gradient' : 'bg-ink-900 group-hover:bg-ink-700',
                    )}
                    aria-hidden="true"
                  >
                    <span
                      className={cn(
                        'flex size-full items-center justify-center rounded-full transition-[transform,background-color,color] duration-300 ease-entrance',
                        isOpen ? 'rotate-45 bg-surface text-ink-900' : 'bg-ink-900 text-white',
                      )}
                    >
                      <Plus className="size-3.5 sm:size-4" strokeWidth={2.25} />
                    </span>
                  </span>
                </button>
              </h3>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                    initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                    animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                    exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
                    /* The height runs long and eased; the fade is deliberately
                       shorter and offset so the text is not still ghosting in
                       while the panel is nearly open, and is gone before the
                       panel finishes collapsing. One duration for both made the
                       slower drawer read as laggy rather than as considered. */
                    transition={
                      reduce
                        ? { duration: 0.2 }
                        : {
                            height: { duration: 0.44, ease: ease.entrance },
                            opacity: { duration: 0.28, ease: 'linear' },
                          }
                    }
                    className="overflow-hidden"
                  >
                    {/* Indented to the question's text, not to the number - the
                        answer belongs to the question, not to the list. */}
                    <div
                      className={cn(
                        'max-w-[46rem] px-4 pb-5 pr-14 sm:pb-6 sm:pr-20',
                        numbered ? 'sm:pl-[4.5rem]' : 'sm:pl-6',
                      )}
                    >
                      <RichText tone="compact">{item.answer}</RichText>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}

export default Accordion;
