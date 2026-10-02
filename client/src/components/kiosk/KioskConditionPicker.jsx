import { CONDITION_PARTS, conditionAnswered, conditionProblems } from '@shared/deviceCondition';

import KioskOption from './KioskOption';

/** The key of the first condition screen, for "Edit" on a confirmation. */
export const FIRST_CONDITION_STEP = `condition-${CONDITION_PARTS[0].key}`;

/** Two or four answers sit in pairs; three sit in one row, so none is orphaned. */
const GRID = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2' };

/**
 * The eight components the counter checks, one screen each.
 *
 * ## Eight screens, not one grid (client ruling, 2026-10-01)
 *
 * One question per screen, as everywhere else on the tablet: "What condition
 * is its screen in?", then its battery, and so on, each advancing on the tap.
 *
 * ## Each part asks in its own words (client ruling, 2026-10-02)
 *
 * The answers are the ERP's own, per part (`shared/deviceCondition.js`): a
 * screen offers "Broken Touch Working" and "Good No Touch", a charging port
 * "Dirty" and "Good". The same four generic answers on every screen asked a
 * customer whether their back glass was "missing" and never whether it was
 * scratched. Each answer carries a plain-words line under it, because the
 * counter's labels are terse.
 *
 * There is no "Everything works" shortcut any more (client ruling): it let a
 * customer skip seven parts with one tap, and the answers are what the counter
 * starts its own check from.
 *
 * An answer already given shows as selected, so a customer who goes back can
 * see what they said rather than guess.
 */
export function conditionSteps({ hint } = {}) {
  return CONDITION_PARTS.map((part) => ({
    key: `condition-${part.key}`,
    prompt: `What condition is its ${part.label.toLowerCase()} in?`,
    hint,
    footer: 'none',
    valid: (a) => Boolean(a.condition?.[part.key]),
    render: ({ answers: a, next }) => (
      <div role="group" aria-label={part.label} className={`grid gap-3 ${GRID[part.options.length] ?? 'sm:grid-cols-2'}`}>
        {part.options.map((option) => (
          <KioskOption
            key={option.value}
            label={option.label}
            detail={option.detail}
            selected={a.condition?.[part.key] === option.value ? true : undefined}
            onClick={() => next({ condition: { ...a.condition, [part.key]: option.value } })}
          />
        ))}
      </div>
    ),
  }));
}

/** The answers as one line, for a confirmation screen: only what is not "Good". */
export function conditionSummary(condition = {}) {
  if (!conditionAnswered(condition)) return 'Not answered';
  return conditionProblems(condition) || 'Everything is good';
}

export default conditionSteps;
