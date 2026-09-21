import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Headphones, MessageCircleQuestion, Search } from 'lucide-react';
import cn from '@/lib/cn';
import useBusinessInfo from '@/hooks/useBusinessInfo';
import Input from '@/components/ui/Input';
import SelectMenu from '@/components/ui/SelectMenu';
import Skeleton from '@/components/ui/Skeleton';
import Accordion from '@/components/ui/Accordion';
import { EyebrowPill } from '@/components/ui/Slab';
import scrollToSection from '@/lib/scrollToSection';
import { useFaqs } from '@/hooks/useContent';
import useActiveSection from '@/hooks/useActiveSection';
import useDebouncedValue from '@/hooks/useDebouncedValue';
import { ease, pressable } from '@/lib/motion';

/**
 * The category jump list.
 *
 * Two presentations of one nav, chosen by width rather than one layout squeezed
 * into both. From `lg` it is a sticky rail beside the answers - a help page's
 * sections are a permanent map, and a map belongs in the margin. Below that it
 * is the same `SelectMenu` the shop toolbar sorts with: the row of pills it
 * replaces scrolled sideways on a phone, and a native `<select>` was no better
 * - the platform draws that popup wider than its trigger and clips it against
 * the viewport edge.
 *
 * Both go through `scrollToSection` rather than letting the browser follow the
 * anchor, because a native smooth scroll gets cancelled here - see that file.
 */
function CategoryNav({ groups, activeId }) {
  if (groups.length < 2) return null;

  return (
    <>
      {/* --- phone / tablet ------------------------------------------------ */}
      <div className="lg:hidden">
        <p className="mb-1.5 text-sm font-medium text-ink-700">Jump to a section</p>
        <SelectMenu
          size="md"
          align="left"
          srLabel="Jump to a section"
          value={activeId ?? groups[0].value}
          onChange={(value) => scrollToSection(`faq-${value}`)}
          options={groups.map((group) => ({
            value: group.value,
            label: group.label,
            count: group.faqs.length,
          }))}
        />
      </div>

      {/* --- laptop and up -------------------------------------------------- */}
      <nav aria-label="FAQ sections" className="hidden lg:block">
        <div className="sticky top-[calc(var(--chrome-h,158px)+24px)]">
          <p className="eyebrow mb-3 px-3 text-ink-300">Sections</p>
          <ul className="flex flex-col gap-0.5">
            {groups.map((group) => {
              const isActive = activeId === group.value;

              return (
                <li key={group.value}>
                  <a
                    href={`#faq-${group.value}`}
                    onClick={(event) => {
                      event.preventDefault();
                      scrollToSection(`faq-${group.value}`);
                    }}
                    aria-current={isActive ? 'true' : undefined}
                    className={cn(
                      'relative flex items-center gap-2 rounded-md py-2 pl-3 pr-2.5',
                      pressable,
                      'text-md font-medium duration-200',
                      isActive
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-ink-500 hover:bg-surface-2 hover:text-ink-900',
                    )}
                  >
                    {/* The accent arrives as a 2px rule on the active item, not
                        as a filled tab (§2.2). */}
                    <span
                      className={cn(
                        'absolute inset-y-1.5 left-0 w-[2px] rounded-full transition-opacity duration-200',
                        isActive ? 'rule-brand-gradient opacity-100' : 'opacity-0',
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">{group.label}</span>
                    <span
                      className={cn(
                        'tnum text-xs',
                        isActive ? 'text-brand-700' : 'text-ink-300',
                      )}
                    >
                      {group.faqs.length}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>
    </>
  );
}

/**
 * The general FAQ.
 *
 * Centred header over a two-column body: the categories hold the left rail from
 * `lg` up, the questions stack beside them as rounded pills that open one at a
 * time. Below `lg` the rail becomes a picker and the questions take the full
 * width.
 *
 * Search filters on the client rather than round-tripping: the whole published
 * set is a few dozen short entries and arrives in one request, so filtering
 * locally is instant and works while the network is slow. The server-side `q`
 * parameter exists for anyone hitting the API directly.
 */
export function FaqPage() {
  const info = useBusinessInfo();
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 180).trim().toLowerCase();
  const reduce = useReducedMotion();

  const { data, isLoading } = useFaqs();
  const groups = data?.groups ?? [];

  const filtered = useMemo(() => {
    if (!debounced) return groups;
    return groups
      .map((group) => ({
        ...group,
        faqs: group.faqs.filter(
          (faq) =>
            faq.question.toLowerCase().includes(debounced) ||
            faq.answer.toLowerCase().includes(debounced),
        ),
      }))
      .filter((group) => group.faqs.length > 0);
  }, [groups, debounced]);

  const matchCount = filtered.reduce((total, group) => total + group.faqs.length, 0);

  // The rail tracks the groups actually on the page, so a search that hides
  // three of them does not leave the nav pointing at anchors that are gone.
  const sectionIds = useMemo(() => filtered.map((group) => `faq-${group.value}`), [filtered]);
  const activeSection = useActiveSection(sectionIds);
  const activeGroup = activeSection?.replace(/^faq-/, '') ?? null;

  const headerMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 20, filter: 'blur(6px)' },
        animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
      };

  return (
    <div className="mx-auto max-w-[1400px] px-3 py-10 sm:px-4 lg:px-6 lg:py-16">
      {/* ---- header ------------------------------------------------------- */}
      <motion.header
        {...headerMotion}
        transition={{ duration: 0.5, ease: ease.entrance }}
        className="mx-auto max-w-2xl text-center"
      >
        {/* No count in the pill: "047 · Help centre" read as a statistic about
            the page rather than as a label for it. */}
        <EyebrowPill>Help centre</EyebrowPill>

        <h1 className="mt-6 text-d-sm leading-[1.04] tracking-[-0.035em] sm:text-d-lg lg:text-d-lg">
          Common questions
        </h1>

        <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-ink-400">
          Approval, pricing, credit terms, shipping and warranty - the answers the sales desk gives
          most often. If yours is not here, the desk is a phone call away.
        </p>

        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the FAQ…"
          icon={Search}
          aria-label="Search the FAQ"
          containerClassName="mx-auto mt-7 max-w-md"
        />

        {debounced && (
          <p className="mt-2.5 text-sm text-ink-400" role="status">
            {matchCount === 0
              ? 'No answer matches that.'
              : `${matchCount} ${matchCount === 1 ? 'answer' : 'answers'} match “${debounced}”.`}
          </p>
        )}
      </motion.header>

      {/* ---- rail + answers ------------------------------------------------ */}
      {isLoading ? (
        <div className="mt-10 space-y-2 lg:mt-14">
          {Array.from({ length: 8 }).map((_, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <Skeleton key={index} className="h-[76px] rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-10 flex flex-col items-center rounded-xl border border-line bg-surface py-16 text-center lg:mt-14">
          <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-2 text-ink-300">
            <MessageCircleQuestion className="size-5" strokeWidth={1.5} aria-hidden="true" />
          </span>
          <h2 className="text-xl">No answer for that yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-md text-ink-500">
            Ask the sales desk directly - and the answer usually ends up on this page.
          </p>
          <Link
            to="/contact"
            className={cn(pressable, 'mt-6 inline-flex h-12 items-center rounded-lg border border-line-strong bg-surface px-6 font-display text-md font-semibold text-ink-900 hover:border-ink-300 hover:bg-surface-2')}
          >
            Contact us
          </Link>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 lg:mt-14 lg:grid-cols-[224px_minmax(0,1fr)] lg:gap-10">
          <CategoryNav groups={filtered} activeId={activeGroup} />

          <div className="min-w-0 space-y-10 lg:space-y-14">
            {filtered.map((group) => (
              <section
                key={group.value}
                id={`faq-${group.value}`}
                className="scroll-mt-[calc(var(--chrome-h,158px)+20px)]"
              >
                <h2 className="mb-4 px-1 text-xl sm:text-2xl">{group.label}</h2>
                <Accordion items={group.faqs} />
              </section>
            ))}
          </div>
        </div>
      )}

      {/* ---- still stuck ---------------------------------------------------
          The reference closes the list with a single quiet line rather than a
          panel; the phone number stays because the sales desk is the point. */}
      <section className="mx-auto mt-12 max-w-[860px] text-center lg:mt-16">
        <h2 className="text-xl sm:text-2xl">Have any other questions?</h2>
        <p className="mx-auto mt-2.5 max-w-md text-md leading-relaxed text-ink-400">
          The sales desk answers sourcing, credit and warranty questions directly - no ticket queue.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <Link
            to="/contact"
            className="inline-flex h-12 items-center gap-2 rounded-full bg-brand-gradient px-6 font-display text-md font-semibold text-white transition-[filter] hover:brightness-110"
          >
            Contact us
            <ArrowRight className="size-4" strokeWidth={2} aria-hidden="true" />
          </Link>
          {info.phone && (
            <a
              href={`tel:${info.phone.replace(/[^\d+]/g, '')}`}
              className={cn(pressable, 'inline-flex h-12 items-center gap-2 rounded-full border border-line-strong bg-surface px-6 font-display text-md font-semibold text-ink-700 hover:border-ink-300 hover:bg-surface-2')}
            >
              <Headphones className="size-4" strokeWidth={2} aria-hidden="true" />
              {info.phone}
            </a>
          )}
        </div>
      </section>
    </div>
  );
}

export default FaqPage;
