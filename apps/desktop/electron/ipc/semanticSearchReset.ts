/**
 * A tiny listener list for "the semantic search service was reset" (a pack was installed,
 * updated or removed). `searchHandlers` notifies; a feature module that caches results
 * derived from the pack (Similar) subscribes, so the search handlers never import it.
 */
import type { Disposable } from '@bible/core/browser';

const listeners = new Set<() => void>();

/** Run `fn` on every reset. Dispose the handle to stop. */
export function onSemanticSearchReset(fn: () => void): Disposable {
  listeners.add(fn);
  return { dispose: () => void listeners.delete(fn) };
}

export function notifySemanticSearchReset(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      // a listener must not break the reset
    }
  }
}
