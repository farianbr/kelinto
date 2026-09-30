import useFocusTrap from '@/hooks/useFocusTrap';
import KioskButton from './KioskButton';

/**
 * "Still there?", counting down before the kiosk signs out and starts again.
 *
 * **Rendered in place, not through `ui/Overlay`.** Overlay portals to `body`,
 * and the kiosk's business colours are custom properties on the kiosk's own
 * root, so a portalled warning would appear in the house palette on a screen
 * painted in the shop's. It is the one dialog the kiosk has, so a fixed layer
 * inside that root costs less than teaching the portal about themes.
 *
 * `alertdialog` because it interrupts: a screen reader user has to hear that
 * their session is about to end without having moved focus to it.
 */
export function KioskIdleWarning({ open, remaining, onStay, onLeave, leaveLabel = 'Start over' }) {
  const trapRef = useFocusTrap(open);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink-900/45" aria-hidden="true" />
      <div
        ref={trapRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="kiosk-idle-title"
        aria-describedby="kiosk-idle-body"
        className="relative w-full max-w-md rounded-xl bg-surface p-6 text-center shadow-lg sm:p-8"
      >
        <h2 id="kiosk-idle-title" className="font-display text-3xl font-bold text-ink-900">
          Still there?
        </h2>
        <p id="kiosk-idle-body" className="mt-2 text-lg text-ink-500">
          For your privacy, this screen clears itself in
        </p>
        {/* The number is the message. Everything else on the card explains it. */}
        <p className="tnum mt-3 font-display text-d-md font-bold text-ink-900" aria-live="polite">
          {remaining}
          <span className="sr-only"> seconds</span>
        </p>

        <div className="mt-6 grid gap-3">
          <KioskButton onClick={onStay} data-autofocus>
            I&apos;m still here
          </KioskButton>
          <KioskButton tone="quiet" onClick={onLeave}>
            {leaveLabel}
          </KioskButton>
        </div>
      </div>
    </div>
  );
}

export default KioskIdleWarning;
