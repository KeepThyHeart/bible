import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * Register an `afterEach` that deterministically flushes `@tiptap/react`'s
 * deferred editor teardown, for any test file that renders `NoteEditor` (or
 * anything else using `useEditor`).
 *
 * `EditorInstanceManager.scheduleDestroy` (in `@tiptap/react`) does not call
 * `editor.destroy()` synchronously from the component's unmount effect; it
 * defers it one tick via `setTimeout(..., 1)`, so a fast remount (e.g. React
 * Strict Mode, or a dependency-driven recreate) can reuse the instance
 * instead of tearing it down. The global `afterEach(cleanup)` in
 * `vitest.setup.ts` unmounts synchronously, so that timer is still pending
 * when a test finishes; if it survives long enough to fire after this file's
 * jsdom environment is torn down (or mid the next file's), `destroy()`
 * touches `window` and throws `ReferenceError: window is not defined`, which
 * vitest reports as an unhandled error even though every assertion already
 * passed - the failure this fixes (seen in admin/scripts/verify-*.sh runs).
 *
 * This hook runs BEFORE the global setup file's `afterEach` (vitest runs a
 * test file's own hooks before its setupFiles' hooks), so switching to fake
 * timers here, unmounting, and advancing the clock fires that pending
 * `setTimeout` deterministically while `window` still exists - no dependence
 * on real wall-clock timing. The later, real-timer `cleanup()` in
 * vitest.setup.ts then finds nothing left mounted and is a no-op.
 */
export function flushTiptapDestroyOnTeardown(): void {
  afterEach(() => {
    vi.useFakeTimers();
    try {
      cleanup();
      // The destroy is scheduled 1ms out; advance well past it.
      vi.advanceTimersByTime(5);
    } finally {
      vi.useRealTimers();
    }
  });
}
