import { CONDITION_PARTS } from '@shared/schemas/admin';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';

/**
 * The ERP's four grades, in the words a customer would use.
 *
 * Same values as the counter's condition grid (`CONDITION_GRADES`), so the
 * counter reads the customer's answers in its own vocabulary. "Not sure" is
 * `untested`, which is exactly what it is: nobody has checked.
 */
const CUSTOMER_GRADES = [
  { value: 'working', label: 'Works' },
  { value: 'faulty', label: 'Not working' },
  { value: 'not_present', label: 'Missing' },
  { value: 'untested', label: 'Not sure' },
];

/**
 * The eight components the counter checks, answered by the customer.
 *
 * ## One screen, not eight
 *
 * Every other question has its own screen. This one does not, because it is
 * one question ("what state is it in?") with eight parts, and a customer
 * answering "Works" eight times across eight screens would give up on the
 * fourth. A row per component with the four answers beside it is the grid the
 * counter fills in, at a size a finger can hit.
 *
 * **"Everything works"** answers every row at once, because it is the most
 * common answer for most parts and the customer then corrects the one or two
 * that are not.
 */
export function KioskConditionPicker({ value = {}, onChange }) {
  const set = (key, grade) => onChange({ ...value, [key]: grade });

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={() =>
            onChange(Object.fromEntries(CONDITION_PARTS.map((part) => [part.key, 'working'])))
          }
          className={cn(
            pressable,
            'min-h-11 rounded-lg border border-line bg-surface px-4 text-md font-medium text-ink-700',
          )}
        >
          Everything works
        </button>
      </div>

      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {CONDITION_PARTS.map((part) => (
          <li
            key={part.key}
            className="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
          >
            <span
              id={`condition-${part.key}`}
              className="font-display text-lg font-semibold text-ink-900 sm:w-40 sm:shrink-0"
            >
              {part.label}
            </span>
            <div
              role="radiogroup"
              aria-labelledby={`condition-${part.key}`}
              className="grid flex-1 grid-cols-4 gap-1.5"
            >
              {CUSTOMER_GRADES.map((grade) => {
                const on = value[part.key] === grade.value;
                return (
                  <button
                    key={grade.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => set(part.key, grade.value)}
                    className={cn(
                      pressable,
                      'min-h-12 rounded-lg border px-1 text-sm font-semibold sm:text-md',
                      on
                        ? 'border-brand bg-brand-50 text-ink-900'
                        : 'border-line bg-surface-2 text-ink-500',
                    )}
                  >
                    {grade.label}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const GRADE_WORDS = { faulty: 'not working', not_present: 'missing', untested: 'not sure' };

/** The answers as one line, for a confirmation screen: only what is not "works". */
export function conditionSummary(condition = {}) {
  const answered = CONDITION_PARTS.filter((part) => condition[part.key]);
  if (answered.length === 0) return 'Not answered';
  const problems = answered.filter((part) => condition[part.key] !== 'working');
  if (problems.length === 0) return 'Everything works';
  return problems.map((part) => `${part.label}: ${GRADE_WORDS[condition[part.key]]}`).join(' · ');
}

export default KioskConditionPicker;
