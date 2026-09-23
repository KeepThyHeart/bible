/**
 * Renderer-local fan-out of "the active verse changed", published from the
 * same two call sites in `verseSlice.ts` that already IPC it to the main
 * process (`window.electron.window.broadcastVerseChange`, which main
 * forwards to worker extensions as `bible.onDidChangeActiveVerse`).
 *
 * Panel iframes (`useIframeBridge.ts`) need the same signal to forward as
 * `verse.activeChanged` to `BibleExtUI.onActiveVerseChanged`, but they run in
 * the renderer already - round-tripping through main and back would be pure
 * overhead. Subscribing here instead guarantees the panel iframe sees exactly
 * the same active-verse changes, at exactly the same moments, as a worker
 * extension does - not a second, possibly-diverging notion of "active".
 */

export interface ActiveVerseChange {
  verseId: number;
  /** Abbreviation of the translation the verse was read in, when known. */
  module?: string;
}

type Listener = (change: ActiveVerseChange) => void;

const listeners = new Set<Listener>();

/** Subscribe to active-verse broadcasts. Returns an unsubscribe function. */
export function subscribeActiveVerseBroadcast(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Publish an active-verse change. Called from `verseSlice.ts` alongside its
 * existing `broadcastVerseChange` IPC call - see that file for why both
 * exist (this one is synchronous and renderer-only; the IPC call reaches
 * worker extensions).
 */
export function publishActiveVerseBroadcast(change: ActiveVerseChange): void {
  for (const listener of [...listeners]) {
    try {
      listener(change);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[activeVerseBroadcast] listener threw', err);
    }
  }
}
