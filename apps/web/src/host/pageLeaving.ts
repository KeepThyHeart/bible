/**
 * True once the page has started to unload (reload, navigation, close).
 *
 * WebKit rejects every in-flight dynamic import with "Importing a module script
 * failed" when a navigation cuts the load short. Whatever was loading is going
 * away with the page, so reporting that as an app failure is noise: callers that
 * log a failed import check this first.
 */
let leaving = false;

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { leaving = true; });
  window.addEventListener('beforeunload', () => {
    leaving = true;
    // An unload can be cancelled (a "leave site?" prompt), and then no pageshow follows.
    setTimeout(() => { if (document.visibilityState !== 'hidden') leaving = false; }, 3000);
  });
  window.addEventListener('pageshow', () => { leaving = false; });
  // The bundler's preload helper rejects too ("Unable to preload CSS") when a reload cuts a
  // lazy chunk short, and nothing can catch that promise: say it is handled.
  window.addEventListener('unhandledrejection', (event) => {
    const message = (event.reason as { message?: unknown } | null)?.message;
    if (leaving && typeof message === 'string'
      && /Unable to preload CSS|Failed to fetch dynamically imported module|Importing a module script failed/i.test(message)) {
      event.preventDefault();
    }
  });
}

export function isPageLeaving(): boolean {
  return leaving;
}
