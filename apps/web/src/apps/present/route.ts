/**
 * Where the Presenter lives: `#/@present`, the hash format task 0080 plans for
 * its app host. Until that lands, `App.tsx` reads this to decide whether to
 * render `PresenterApp` in place of Study (Study stays mounted, hidden).
 *
 * The reader's own hash (`#/KJV/43/3`, see `bibleStore.updateHash`) occupies
 * the same slot, so leaving the Presenter has to put it back. `bibleStore`
 * ignores a hash it cannot parse, so `#/@present` is harmless to it.
 */

export const PRESENTER_HASH = '#/@present';

/** Fired on `window` whenever the Presenter is opened or closed by these helpers. */
export const PRESENTER_ROUTE_EVENT = 'presenter-route';

let hashBeforeOpen = '';

export function isPresenterHash(hash: string = window.location.hash): boolean {
  return hash === PRESENTER_HASH;
}

/**
 * Whether the Presenter is showing. Tracked rather than read from the hash,
 * because `bibleStore.updateHash()` (replaceState, no event) can rewrite the
 * hash while the Presenter is open; only navigation (open, close, Back,
 * a hand-edited hash) changes it.
 */
let open = typeof window !== 'undefined' && isPresenterHash();
let poppedFromPresenter = false;

export function presenterOpen(): boolean {
  return open;
}

/**
 * True once, right after a Back/Forward that left the Presenter. The hash has
 * already changed by the time other `popstate` listeners run, so they cannot
 * tell; the hidden mobile Study uses this to skip its own back step.
 */
export function consumePresenterPop(): boolean {
  const was = poppedFromPresenter;
  poppedFromPresenter = false;
  return was;
}

if (typeof window !== 'undefined') {
  // Registered at module load, so it runs before listeners added by components.
  window.addEventListener('popstate', () => {
    poppedFromPresenter = open && !isPresenterHash();
    open = isPresenterHash();
  });
  window.addEventListener('hashchange', () => { open = isPresenterHash(); });
}

function announce(): void {
  window.dispatchEvent(new Event(PRESENTER_ROUTE_EVENT));
}

/** Navigate to the Presenter, remembering the reader's hash for the way back. */
export function openPresenter(): void {
  if (open && isPresenterHash()) return;
  hashBeforeOpen = window.location.hash;
  try {
    history.pushState(null, '', PRESENTER_HASH);
  } catch {
    window.location.hash = PRESENTER_HASH;
  }
  open = true;
  announce();
}

/** Back to Study, restoring the reader's own hash without re-navigating it. */
export function closePresenter(): void {
  // The reader may have rewritten the hash while the Presenter was open, so
  // always announce; only put the reader's hash back over the Presenter's own.
  if (isPresenterHash()) {
    try {
      history.replaceState(null, '', hashBeforeOpen || window.location.pathname + window.location.search);
    } catch {
      // Nothing more to do: the state flip below is what shows Study again.
    }
  }
  hashBeforeOpen = '';
  open = false;
  announce();
}

/**
 * A cold load at `#/@present` never went through the reader, so there is no
 * hash to restore. `main.tsx` boots the reader as if the hash were empty, then
 * calls this with the reader's own hash (if it set one) so Back lands there.
 */
export function rememberReaderHash(hash: string): void {
  hashBeforeOpen = isPresenterHash(hash) ? '' : hash;
}
