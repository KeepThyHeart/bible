/**
 * The startup module scan (`detectAndRegisterModulesAsync`) as a shared,
 * awaitable fact.
 *
 * The scan registers module files that are on disk but not in `main.db`'s
 * registry. It yields between files so the app stays responsive, which means
 * the renderer's first requests can arrive while it is still running. A
 * lookup that misses during the scan does not mean "not installed" - the
 * module may simply not have been reached yet. Reporting it as missing is what
 * left the reader saying the KJV was not installed until the user re-selected
 * it: the miss was cached (the module loaders remember a failed load for 30 s)
 * and nothing ever retried it.
 *
 * So: handlers that answer "is X installed / give me X" await
 * {@link whenModuleScanSettled} first, and when the scan registers modules the
 * module loaders forget earlier misses for them and every window is told the
 * library changed.
 */
import log from 'electron-log';

let current: Promise<void> | null = null;

/** Resolves once no scan is running (immediately when none was started). Never rejects. */
export function whenModuleScanSettled(): Promise<void> {
  return current ?? Promise.resolve();
}

export function isModuleScanRunning(): boolean {
  return current !== null;
}

/**
 * Start `scan` unless one is running; returns the running scan's settle
 * promise. `onFinished` runs with the scan's result before that promise
 * settles, so anything awaiting the scan sees its effects.
 */
export function runModuleScan<R extends { registeredModules: Array<{ abbreviation: string; moduleType: string }> }>(
  scan: () => Promise<R>,
  onFinished: (result: R) => void
): Promise<void> {
  if (current) return current;
  const run = (async () => {
    try {
      const result = await scan();
      try {
        onFinished(result);
      } catch (error) {
        log.error('[ModuleScan] Reacting to the module scan failed:', error);
      }
    } catch (error) {
      log.error('[ModuleScan] Module scan failed:', error);
    } finally {
      current = null;
    }
  })();
  current = run;
  return run;
}

/** Test seam. */
export function resetModuleScanForTests(): void {
  current = null;
}
