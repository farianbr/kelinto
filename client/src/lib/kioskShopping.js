import { useSyncExternalStore } from 'react';

/**
 * "Buy parts" mode: a customer shopping the website from the kiosk tablet.
 *
 * ## Why sessionStorage
 *
 * The flag belongs to this tab on this tablet and to nothing else. A phone at
 * home must never believe it is a kiosk (it would offer "pay at the counter",
 * which the server refuses anyway without the tablet's cookie), and a closed
 * tab should forget it. `sessionStorage` is exactly that lifetime.
 *
 * It is a presentation flag only. What it switches on (the kiosk bar, the idle
 * clock, pickup and pay-at-the-counter at checkout, the way back to `/kiosk`)
 * is all UI; the one thing it enables on the server is gated there by the
 * kiosk's own session cookie.
 */
const KEY = 'kelinto.kioskShopping';
const listeners = new Set();

function read() {
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function write(on) {
  try {
    if (on) window.sessionStorage.setItem(KEY, '1');
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Storage refused (private mode, a locked-down tablet). The mode simply
    // does not persist across a reload, which is the safe way round.
  }
  for (const listener of listeners) listener();
}

export function isKioskShopping() {
  return read();
}

export function startKioskShopping() {
  write(true);
}

export function endKioskShopping() {
  write(false);
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders when the mode starts or ends. */
export function useKioskShopping() {
  return useSyncExternalStore(subscribe, read, () => false);
}

export default useKioskShopping;
