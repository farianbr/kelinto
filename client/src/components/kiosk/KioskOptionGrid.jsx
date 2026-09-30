import { useState } from 'react';
import { Search } from 'lucide-react';

import Input from '@/components/ui/Input';
import KioskOption from './KioskOption';

/** Past this many answers, a filter box earns its place above the grid. */
const FILTER_FROM = 12;

/**
 * A tap-to-answer question's answers.
 *
 * Most of these are four or five buttons. The model list is not: a brand can
 * carry forty handsets, and hunting for one in a wall of buttons on a tablet is
 * the slowest part of any check-in. So past a dozen, a box above the grid
 * narrows it as they type, and the grid below still works for anybody who
 * would rather look than type.
 *
 * When the business has not built this level of its list at all, the customer
 * types the answer instead of meeting a dead end: the counter tidies it up.
 */
export function KioskOptionGrid({ options, onChoose, typedValue, onType }) {
  const [filter, setFilter] = useState('');

  if (options.length === 0) {
    return (
      <Input
        aria-label="Your answer"
        placeholder="Type it here"
        value={typedValue ?? ''}
        onChange={(event) => onType(event.target.value)}
        autoFocus
      />
    );
  }

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? options.filter((option) => option.toLowerCase().includes(needle))
    : options;

  return (
    <div>
      {options.length > FILTER_FROM && (
        <Input
          icon={Search}
          aria-label="Narrow the list"
          placeholder="Start typing to narrow the list"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          containerClassName="mb-4"
        />
      )}

      {shown.length === 0 ? (
        <p className="py-6 text-center text-lg text-ink-500">
          Nothing matches “{filter}”. Pick the closest, or clear the box.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((option) => (
            <KioskOption key={option} label={option} onClick={() => onChoose(option)} />
          ))}
        </div>
      )}
    </div>
  );
}

export default KioskOptionGrid;
