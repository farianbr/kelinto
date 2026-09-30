import { useEffect } from 'react';
import { ArrowRight, ShoppingBag, Smartphone, Wrench } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import KioskChrome from './KioskChrome';

/**
 * The three doors, in the order the client drew them.
 *
 * Each icon names what the door is for, which is the one job an icon may do
 * here: a customer scanning three tiles from a step away reads the picture
 * before the word.
 */
const DOORS = [
  {
    mode: 'sell',
    icon: Smartphone,
    title: 'Sell your phone',
    detail: 'Tell us about a phone you no longer use and we will make you an offer.',
  },
  {
    mode: 'repair',
    icon: Wrench,
    title: 'Repair',
    detail: 'Check your device in for repair. It takes about two minutes.',
  },
  {
    mode: 'buy',
    icon: ShoppingBag,
    title: 'Buy parts',
    detail: 'Sign in, shop our parts and pay at the counter.',
  },
];

/**
 * The welcome screen: which of the three things did you come in for?
 *
 * **The one thing on it is the choice**, so the three doors take the screen and
 * everything else steps back: the business's welcome line is a subtitle, not a
 * hero. The doors are equal in weight on purpose, because they are peers and
 * the tablet has no business steering a customer toward one.
 *
 * A door whose feature is off for this business is not drawn at all, rather
 * than drawn disabled: a customer cannot do anything about a greyed tile, and
 * one choice left on its own still reads as a start button.
 *
 * **It reads itself aloud**, the question and then each door's title, the
 * same as each question in a flow. It was the one screen that stayed silent,
 * so a customer relying on the voice was never told what the choices were.
 * Titles only: with the welcome line and every door's description it ran to
 * half a minute, which is longer than anybody waits before tapping.
 * `quiet` holds it back when the idle clock sent the tablet here.
 */
export function KioskHome({ config, onChoose, chrome, speak, quiet = false }) {
  const modes = config?.modes ?? { repair: true };
  const doors = DOORS.filter((door) => modes[door.mode]);

  const line = ['How can we help today?', ...doors.map((door) => `${door.title}.`)].join(' ');

  // Re-runs when read-aloud is switched on (`speak` changes with it), so the
  // speaker button reads the screen that is showing, as it does in a flow.
  useEffect(() => {
    if (!quiet) speak?.(line);
  }, [line, quiet, speak]);

  return (
    <KioskChrome {...chrome}>
      <div className="text-center">
        <h1 className="text-balance font-display text-d-sm font-bold text-ink-900 sm:text-d-md">
          How can we help today?
        </h1>
        {config?.welcomeMessage && (
          <p className="mx-auto mt-3 max-w-xl text-xl text-ink-500">{config.welcomeMessage}</p>
        )}
      </div>

      <div
        className={cn(
          'mt-10 grid gap-4',
          doors.length === 3 && 'md:grid-cols-3',
          doors.length === 2 && 'sm:grid-cols-2',
        )}
      >
        {doors.map(({ mode, icon: Icon, title, detail }) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChoose(mode)}
            className={cn(
              pressable,
              'group flex flex-col rounded-xl border border-line bg-surface p-6 text-left hover:border-brand',
              'md:min-h-64',
            )}
          >
            <Icon className="size-8 text-brand" strokeWidth={1.75} aria-hidden="true" />
            <span className="mt-5 font-display text-2xl font-bold text-ink-900">{title}</span>
            <span className="mt-2 text-lg leading-snug text-ink-500">{detail}</span>
            <span className="mt-auto inline-flex items-center gap-2 pt-6 font-display text-lg font-semibold text-brand">
              Start
              <ArrowRight className="size-5" strokeWidth={2.25} aria-hidden="true" />
            </span>
          </button>
        ))}
      </div>
    </KioskChrome>
  );
}

export default KioskHome;
