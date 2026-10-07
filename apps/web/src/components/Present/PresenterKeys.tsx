import { usePresenterShortcuts } from './usePresenterShortcuts';

/**
 * Headless: the presenter's global keyboard (arrows, `.`, `B`, Alt/Ctrl
 * shortcuts). The app shell mounts it while a presenter session is live, so
 * the keys work whichever app is on screen, including a cold `#/@present`
 * boot where Study (and its PresentBar) is not mounted.
 */
export function PresenterKeys(): null {
  usePresenterShortcuts();
  return null;
}
