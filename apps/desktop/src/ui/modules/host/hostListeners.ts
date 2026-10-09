/**
 * Small listener lists the desktop host fires at moments a feature module may care about but that
 * no core reader hook covers (task 0126). A module adds a listener in its `activate()` and pushes
 * the returned Disposable to `ctx.subscriptions`; the host never imports the module.
 *
 * - `verseFollowers`: the reader deliberately picked a verse (`syncPanesWithVerse`): panels that
 *   follow the selected verse move to it. Unlike `reader.verseChanged`, this does NOT fire for
 *   previews or other selection changes, which the follow-the-verse panes ignore on purpose.
 * - `libraryChangeListeners`: an install, uninstall or update finished (`setNotifyLibraryChanged`).
 * - `verseMenuOpenListeners`: the verse context menu opened.
 *
 * Entry-chunk code: imports nothing.
 */
export interface Listeners<A extends unknown[]> {
  /** Add a listener; dispose the handle to remove it. */
  add(fn: (...args: A) => void): { dispose(): void };
  emit(...args: A): void;
}

export function createListeners<A extends unknown[]>(): Listeners<A> {
  const fns = new Set<(...args: A) => void>();
  return {
    add(fn) {
      fns.add(fn);
      return { dispose: () => void fns.delete(fn) };
    },
    emit(...args) {
      for (const fn of [...fns]) {
        try {
          fn(...args);
        } catch (err) {
          console.error('[hostListeners] listener failed', err);
        }
      }
    },
  };
}

export const verseFollowers = createListeners<[verseId: number]>();
export const libraryChangeListeners = createListeners<[]>();
export const verseMenuOpenListeners = createListeners<[]>();
