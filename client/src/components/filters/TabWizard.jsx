import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, RotateCcw, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import cn from '@/lib/cn';
import { pressable, pressableSurface } from '@/lib/motion';
import { FILTER_LEVELS } from '@/lib/constants';
import { optionsFor } from '@/lib/taxonomy';
import { StepIndicator } from '@/components/ui/StepIndicator';
import WizardOverlay from './WizardOverlay';
import useFilterStore from '@/store/filterStore';
import { useWizardTaxonomy } from '@/hooks/useCatalog';
import Skeleton from '@/components/ui/Skeleton';

const LEVEL_KEYS = FILTER_LEVELS.map((l) => l.key);

/**
 * The guided tab-wizard filter (brief §5.3).
 *
 * Behaviour that matters:
 *  - picking an option closes the overlay, flips that tab to "completed", and
 *    auto-opens the NEXT step - but only when the step was reached in sequence;
 *  - re-opening an already-completed tab is a non-linear edit: it applies the
 *    cascade reset from the store and stops, rather than dragging the user
 *    through every downstream step again;
 *  - every completed tab stays clickable and clearable, forever.
 *
 * The steps are Component Type > Device Type > Brand > Series > Model. The
 * component leads because a business buyer knows they need a screen before they
 * know whose, and because it lets the server prune every level below it to the
 * branches that actually stock that component - so the wizard can never offer a
 * combination that returns an empty grid.
 *
 * Layout is two shapes, not one that squeezes:
 *  - lg and up: five equal cards in a grid; md wraps them 3+2;
 *  - below md: an expanding sequence. Exactly one step is open - the first one
 *    still to answer - and every other step collapses to its number. Five cards
 *    do not fit on a 375px phone, and the horizontal scroller this replaces put
 *    the later steps off the right edge where nobody found them.
 *
 * It writes to the same store the sidebar and mega menu write to - it is a third
 * face on one filter, not a filter of its own.
 *
 * ## `onComplete`
 *
 * **Optional, and only the homepage passes it.** On the Shop page the wizard
 * needs no such thing: the store IS the page's state, `useFilterUrlSync` mirrors
 * it into the URL and the grid re-renders under it, so a pick is visibly
 * answered where the buyer is standing.
 *
 * The homepage has no grid and no sync, so a pick there wrote the store and
 * appeared to do nothing. Rather than teach the wizard to navigate - which would
 * make it a router-aware component on every screen that shows it - the caller
 * says what a completed choice means where it sits.
 */
export function TabWizard({ onComplete }) {
  const [openLevel, setOpenLevel] = useState(null);

  // True while the user is walking the steps in order. A non-linear edit clears
  // it so we do not chain-open overlays they did not ask for.
  const inSequence = useRef(false);

  const {
    path,
    labels,
    selectedComponents,
    componentLabels,
    setPathLevel,
    wizardComponentType,
    clearLevel,
    resetAll,
  } = useFilterStore(
    useShallow((s) => ({
      path: s.path,
      labels: s.labels,
      selectedComponents: s.facets.partType,
      componentLabels: s.componentLabels,
      setPathLevel: s.setPathLevel,
      wizardComponentType: s.wizardComponentType,
      clearLevel: s.clearLevel,
      resetAll: s.resetAll,
    })),
  );

  // The tree is pruned to the chosen components, so steps 2-5 can only offer
  // combinations that actually return parts. Joined because the query key has to
  // be a stable primitive - a fresh array every render would refetch forever.
  const componentKey = selectedComponents.join(',');
  const { data, isLoading } = useWizardTaxonomy(componentKey);
  const tree = data?.tree;
  const componentTypes = data?.componentTypes ?? [];

  // A deep link carries `?partType=battery,screen-assembly` but no display
  // names, so the first tab would read slugs. Fill in whichever are missing once
  // the list lands.
  useEffect(() => {
    if (selectedComponents.length === 0 || componentTypes.length === 0) return;

    const missing = selectedComponents.filter((slug) => !componentLabels[slug]);
    if (missing.length === 0) return;

    const found = {};
    for (const slug of missing) {
      const match = componentTypes.find((c) => c.slug === slug);
      if (match) found[slug] = match.name;
    }

    if (Object.keys(found).length) {
      useFilterStore.setState((s) => ({ componentLabels: { ...s.componentLabels, ...found } }));
    }
  }, [selectedComponents, componentLabels, componentTypes]);

  // Step 1 is not a node in the tree, so it is merged in here rather than
  // special-cased at every read below. `answers`/`answerLabels` are the path as
  // the WIZARD sees it: five steps, component type first.
  //
  // Step 1's "answer" is the count of ticks, not a slug - it is the one
  // multi-select step, so what the rest of the wizard needs from it is whether
  // it has been answered at all, and its label is the list read back.
  const componentSummary =
    selectedComponents.length === 0
      ? null
      : selectedComponents.length === 1
        ? (componentLabels[selectedComponents[0]] ?? selectedComponents[0])
        : `${componentLabels[selectedComponents[0]] ?? selectedComponents[0]} +${selectedComponents.length - 1}`;

  const answers = { componentType: selectedComponents.length ? componentKey : null, ...path };
  const answerLabels = { componentType: componentSummary, ...labels };

  const options = openLevel
    ? openLevel === 'componentType'
      ? componentTypes
      : optionsFor(tree, path, openLevel)
    : [];

  const handleSelect = useCallback(
    (option) => {
      const level = openLevel;

      // Step 1 is MULTI-SELECT: it toggles the component facet and the overlay
      // STAYS OPEN, because one tick is rarely the whole answer and closing the
      // panel on the first would make the second tick a second trip. The buyer
      // closes it themselves - or steps forward - when they are done choosing.
      if (level === 'componentType') {
        wizardComponentType(option.slug, option.name);
        return;
      }

      setPathLevel(level, option.slug, option.name);

      const index = LEVEL_KEYS.indexOf(level);
      const nextLevel = LEVEL_KEYS[index + 1];

      /**
       * The wizard is FINISHED, so the caller may act on it.
       *
       * Finished means every level answered, or a level with nothing under it
       * to ask next - some branches genuinely stop at a series. It fired on
       * every pick before, which on the homepage navigated away the moment a
       * device type was chosen and left the buyer to find the remaining four
       * steps on another page. A wizard that walks somebody out of itself
       * halfway through is not a wizard.
       *
       * Deferred a frame: the store has only just cascaded, and the caller reads
       * it to build the query. Acting inside this tick would serialise the state
       * as it was one level ago.
       */
      const leafReached = (option.children ?? []).length === 0;
      if (!nextLevel || leafReached) {
        setOpenLevel(null);
        if (onComplete) queueMicrotask(onComplete);
        return;
      }

      if (!inSequence.current) {
        setOpenLevel(null);
        return;
      }

      setOpenLevel(nextLevel);
    },
    [openLevel, setPathLevel, wizardComponentType, onComplete],
  );

  function openStep(level, index) {
    const isCompleted = Boolean(answers[level]);
    const previousLevel = LEVEL_KEYS[index - 1];

    // Cannot pick a brand before a device type, nor anything before a component.
    if (previousLevel && !answers[previousLevel]) return;

    // Sequence mode only when stepping into the first unfinished step.
    inSequence.current = !isCompleted;
    setOpenLevel(level);
  }

  /** Completed / active / upcoming, plus whether the level above is unanswered. */
  function stateOf(level, index) {
    const locked = index > 0 && !answers[LEVEL_KEYS[index - 1]];
    if (answers[level.key]) return { state: 'completed', locked };
    return { state: locked ? 'upcoming' : 'active', locked };
  }

  const anySelected = LEVEL_KEYS.some((level) => answers[level]);


  // The one step the mobile layout leaves open: the first that is neither
  // answered nor locked. Null once every level has an answer.
  const expandedKey =
    FILTER_LEVELS.find(
      (level, index) => !answers[level.key] && (index === 0 || Boolean(answers[LEVEL_KEYS[index - 1]])),
    )?.key ?? null;


  if (isLoading) {
    return (
      <div className="flex gap-2 overflow-hidden rounded-lg border border-line bg-surface p-3">
        {FILTER_LEVELS.map((level) => (
          <Skeleton key={level.key} className="h-14 flex-1" />
        ))}
      </div>
    );
  }

  return (
    <section
      aria-label="Guided part finder"
      className="overflow-hidden rounded-lg border border-line bg-surface"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <p className="eyebrow text-ink-400">Find your part</p>

        {/* No "See parts" shortcut.

            One existed, and it contradicted the rule the wizard now follows: the
            caller is told once, when every step is answered. A button offering to
            leave early is a second, quieter way out that makes the finished state
            meaningless - and on the homepage it would navigate with half a filter,
            which is the thing being fixed. Somebody who wants the unfiltered
            catalogue has "All parts" in the section header above. */}
        {anySelected && (
          <button
            type="button"
            onClick={() => {
              resetAll();
              inSequence.current = false;
            }}
            className={cn(pressable, 'inline-flex items-center gap-1.5 text-xs font-medium text-ink-400 hover:text-brand')}
          >
            <RotateCcw className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
            Start over
          </button>
        )}
      </header>

      {/* ---- below md ------------------------------------------------------
          Two states, because a finished wizard and a running one are asking the
          reader for different things.

          RUNNING: the answered steps stay as a row of dots - they are progress,
          not content - and the step in hand gets a full-width row beneath them.
          Sharing one row with four dots left it ~130px wide on a 375px phone,
          where a two-word level name wrapped inside a fixed 44px pill and
          pushed against its own border.

          COMPLETE: the wizard steps back. Five identical ticks said only "done",
          which the reader already knows, and the concatenated line under them
          was clipped mid-word. Listing all five answers here instead would just
          restate the chip row that sits directly below with the result count
          ActiveFilterChips is the canonical readout of everything filtering the
          grid, and two copies of it stacked on a phone is the same mistake in a
          tidier shape. So this collapses to the narrowest thing it alone owns:
          the walk is finished, and here is the way back into it. */}
      <div className="p-2.5 md:hidden">
        {expandedKey ? (
          <>
            <ol className="flex items-center gap-1.5">
              {FILTER_LEVELS.map((level, index) => {
                const value = answers[level.key];
                const { state, locked } = stateOf(level, index);
                const isCurrent = level.key === expandedKey;

                return (
                  <li key={level.key} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => openStep(level.key, index)}
                      disabled={locked}
                      aria-current={isCurrent ? 'step' : undefined}
                      aria-label={
                        value
                          ? `Step ${index + 1}, ${level.label}: ${answerLabels[level.key]}. Change.`
                          : `Step ${index + 1}, ${level.label}${locked ? ', locked' : ''}`
                      }
                      className={cn(
                        'flex size-9 items-center justify-center rounded-full transition-opacity',
                        locked ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
                      )}
                    >
                      <StepIndicator
                        state={isCurrent ? 'active' : state}
                        index={index + 1}
                        size="md"
                        glyph="index"
                      />
                    </button>
                  </li>
                );
              })}
            </ol>

            {/* The step in hand, its own full width. */}
            {(() => {
              const index = LEVEL_KEYS.indexOf(expandedKey);
              const level = FILTER_LEVELS[index];
              return (
                <button
                  type="button"
                  onClick={() => openStep(expandedKey, index)}
                  aria-expanded={openLevel === expandedKey}
                  /**
                   * "You are here" said once, not four times.
                   *
                   * This carried a brand border AND a brand tint AND a brand
                   * label AND a brand chevron - four signals for one piece of
                   * meaning, on the only coloured block on a phone screen that
                   * already has a red announcement bar above it. The step read
                   * as an alert rather than as the next thing to tap.
                   *
                   * The border alone marks it. Everything inside goes back to
                   * ink, which is also what makes "Choose…" - the actual
                   * instruction - the most legible thing in the row.
                   */
                  className={cn(
                    pressableSurface,
                    'mt-2 flex w-full items-center gap-3 rounded-md border border-brand bg-brand-50 px-3 py-2.5 text-left',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="eyebrow block text-ink-400">{level.label}</span>
                    <span className="mt-0.5 block font-display text-md font-semibold text-ink-900">
                      Choose…
                    </span>
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-ink-300"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                </button>
              );
            })()}
          </>
        ) : (
          <div className="flex items-center gap-2.5 rounded-md border border-ok/25 bg-ok-50/60 py-2 pl-3 pr-2">
            <Check className="size-4 shrink-0 text-ok" strokeWidth={2} aria-hidden="true" />
            <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-ink-700">
              All five steps answered.
            </p>
            <button
              type="button"
              onClick={() => openStep('model', LEVEL_KEYS.indexOf('model'))}
              className={cn(pressable, 'shrink-0 rounded-sm px-2 py-1 text-xs font-semibold text-brand hover:bg-surface')}
            >
              Change model
            </button>
          </div>
        )}
      </div>

      {/* ---- md and up: equal cards, one per step --------------------------
          Five across only from lg. At md each card would be ~140px and the
          model names inside them truncate to nothing, so the steps wrap to a
          3+2 grid instead - still no scroller, every label still readable. */}
      <ol className="hidden gap-2 p-3 md:grid md:grid-cols-3 lg:grid-cols-5">
        {FILTER_LEVELS.map((level, index) => {
          const value = answers[level.key];
          const label = answerLabels[level.key];
          const { state, locked } = stateOf(level, index);
          const isOpen = openLevel === level.key;

          return (
            <li key={level.key} className="min-w-0">
              <div
                className={cn(
                  // items-start: the value wraps to two lines, and a centred step
                  // indicator beside a two-line value floats below its own label.
                  'group relative flex h-full items-start gap-3 rounded-md border p-2.5 transition-[border-color,background] duration-panel',
                  value
                    ? 'border-ok/30 bg-ok-50/60'
                    : isOpen
                      ? 'border-brand bg-brand-50'
                      : locked
                        ? 'border-line bg-surface-2'
                        : 'border-line bg-surface hover:border-line-strong',
                )}
              >
                <button
                  type="button"
                  onClick={() => openStep(level.key, index)}
                  disabled={locked}
                  aria-expanded={isOpen}
                  className={cn(
                    'flex min-w-0 flex-1 items-start gap-3 text-left',
                    locked ? 'cursor-not-allowed' : 'cursor-pointer',
                  )}
                >
                  <StepIndicator state={state} index={index + 1} size="md" />

                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        'eyebrow block',
                        value ? 'text-ok' : locked ? 'text-ink-300' : 'text-ink-400',
                      )}
                    >
                      {level.label}
                    </span>
                    <span
                      className={cn(
                        // Wraps rather than truncates: at lg the five columns
                        // are ~190px, where "iPhone 15 Pro Max" and "Front
                        // Camera" both clipped. Two lines, clamped, so a long
                        // value cannot make one card taller than its row.
                        'mt-0.5 line-clamp-2 block font-display text-md font-semibold leading-snug',
                        value ? 'text-ink-900' : 'text-ink-300',
                      )}
                    >
                      {label ?? (locked ? 'Locked' : 'Choose…')}
                    </span>
                  </span>

                  {!value && !locked && (
                    <ChevronRight
                      className="size-4 shrink-0 text-ink-300 transition-transform group-hover:translate-x-0.5"
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  )}
                </button>

                {value && (
                  <button
                    type="button"
                    onClick={() => {
                      clearLevel(level.key);
                      inSequence.current = false;
                    }}
                    aria-label={`Clear ${level.label}`}
                    className={cn(pressable, 'flex size-6 shrink-0 items-center justify-center rounded-full text-ink-400 hover:bg-surface-3 hover:text-ink-900')}
                  >
                    <X className="size-3.5" strokeWidth={2.25} />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <WizardOverlay
        open={Boolean(openLevel)}
        onClose={() => {
          const wasWalking = inSequence.current;
          setOpenLevel(null);
          inSequence.current = false;

          /**
           * Abandoning a run clears what it had gathered - but only where the
           * wizard is a one-shot form.
           *
           * On the HOMEPAGE (`onComplete` passed) the steps are a single
           * question asked in five parts, and nothing acts on them until the last
           * one. Half an answer left behind is a filter the buyer cannot see the
           * effect of, sitting in a module-level store that outlives this mount -
           * so their next visit to /shop would open a narrowed catalogue with
           * nothing on screen explaining why.
           *
           * On the SHOP page it is the opposite: the grid is filtering live, a
           * partial path is a perfectly good filter somebody is reading results
           * from, and clearing it because they closed a panel would throw away
           * work they can see. `resetAll` there is the explicit "Start over".
           *
           * Only on an abandoned WALK, not on closing a panel that was reopened
           * to edit one finished step.
           */
          if (onComplete && wasWalking) resetAll();
        }}
        // Step 1's Next: carry the walk into step 2 rather than just dismissing
        // the panel. The tree is refetching against the new component ticks, so
        // Device Type opens and renders its options when they land - the same
        // handoff the old single-select path did automatically.
        onNext={() => {
          inSequence.current = true;
          setOpenLevel(LEVEL_KEYS[1]);
        }}
        level={openLevel}
        label={openLevel ? FILTER_LEVELS.find((l) => l.key === openLevel)?.label : ''}
        title={openLevel ? `Select ${FILTER_LEVELS.find((l) => l.key === openLevel)?.label}` : ''}
        options={options}
        // An ARRAY for step 1, so the overlay renders it as multi-select and
        // stays open; a slug for every other step.
        selected={
          openLevel === 'componentType' ? selectedComponents : openLevel ? answers[openLevel] : null
        }
        onSelect={handleSelect}
      />
    </section>
  );
}

export default TabWizard;
