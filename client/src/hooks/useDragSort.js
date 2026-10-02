import { useCallback, useState } from 'react';

/**
 * Drag a row by its grip to reorder a list; arrow keys on the grip do the same.
 *
 * Native drag and drop, no library: the lists it serves are short and the ERP
 * is used at a desktop. Two details make it behave inside a form:
 *
 * - **Armed from the grip only.** A row is `draggable` only while its grip is
 *   held. A row that is always draggable steals the mouse from the inputs in
 *   it, so selecting a word in a benefit name started dragging the whole row.
 * - **Scoped by its own state.** Each list keeps its own "what is moving", and
 *   a row ignores a drag that list did not start. Sections and the benefit
 *   rows inside them can then both be sortable without a row landing in the
 *   section list or the other way round.
 *
 * `onMove(from, to)` is a `useFieldArray` `move`, or anything shaped like it.
 */
export function useDragSort(onMove, count) {
  const [armed, setArmed] = useState(null);
  const [from, setFrom] = useState(null);
  const [over, setOver] = useState(null);

  const reset = useCallback(() => {
    setArmed(null);
    setFrom(null);
    setOver(null);
  }, []);

  const rowProps = (index) => ({
    draggable: armed === index,
    onDragStart: (event) => {
      if (armed !== index) return;
      event.stopPropagation();
      setFrom(index);
      event.dataTransfer.effectAllowed = 'move';
      // Firefox will not start a drag without data.
      event.dataTransfer.setData('text/plain', String(index));
    },
    onDragOver: (event) => {
      if (from === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (over !== index) setOver(index);
    },
    onDrop: (event) => {
      if (from === null) return;
      event.preventDefault();
      event.stopPropagation();
      if (from !== index) onMove(from, index);
      reset();
    },
    onDragEnd: reset,
  });

  const gripProps = (index, label) => ({
    'aria-label': `${label}: drag to reorder, or press the up and down arrow keys`,
    onPointerDown: () => setArmed(index),
    onPointerUp: () => {
      if (from === null) setArmed(null);
    },
    onKeyDown: (event) => {
      const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      const to = index + step;
      if (!step || to < 0 || to >= count) return;
      event.preventDefault();
      onMove(index, to);
    },
  });

  return { rowProps, gripProps, dragging: from, over };
}

export default useDragSort;
