/**
 * Whether this device has finished the Control pane's first-run setup card.
 * Remembered per device; until then the Screen and Join sections show inline
 * rather than only behind the hamburger menu.
 */
const KEY = 'presenter-setup-done';

export function isSetupDone(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markSetupDone(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // Storage blocked: the card simply comes back next visit.
  }
}
