/**
 * Performance marks for the Memory UI (design-r2 section 1c, subtask P0).
 *
 * Cheap and always on: a screen is timed from the moment `render()` starts building it to one animation
 * frame after it is appended (`memory:screen:<name>`), every request through `requestVia` is timed
 * (`memory:req:<type>`) and counted, and a `PerformanceObserver('longtask')` counts long tasks while Memory
 * is mounted. The e2e spec (`memory-perf.spec.ts`) reads the entries and `window.__memoryPerf`.
 *
 * Nothing here touches the DOM or imports another module, so it is safe to call from any view. Every
 * function is a no-op where `performance` is missing.
 */

export interface PerfCounters {
  /** Requests sent since the page loaded (never reset by Memory; callers diff two reads). */
  requests: number;
  /** Background requests (the idle-time speech probe): not a tab-switch read, so not in `requests`. */
  backgroundRequests: number;
  /** Long tasks (over 50 ms) seen while Memory was mounted. */
  longTasks: number;
  /** The longest of them, in ms. */
  longTaskMaxMs: number;
}

export const perfCounters: PerfCounters = { requests: 0, backgroundRequests: 0, longTasks: 0, longTaskMaxMs: 0 };

/** The performance entries are cleared when more than this many `memory:` entries pile up. */
const CLEAR_AFTER = 200;

const perf: Performance | undefined = typeof performance !== 'undefined' ? performance : undefined;
const starts = new Map<string, number>();
let entriesMade = 0;

function measure(name: string, start: number, end: number): void {
  if (!perf || typeof perf.measure !== 'function') return;
  try {
    perf.measure(name, { start, end });
    if (++entriesMade > CLEAR_AFTER) {
      entriesMade = 0;
      for (const e of perf.getEntriesByType('measure')) {
        if (e.name.startsWith('memory:')) perf.clearMeasures(e.name);
      }
    }
  } catch {
    // measuring is best effort
  }
}

/** A screen starts building. */
export function perfScreenStart(view: string): void {
  if (perf) starts.set(view, perf.now());
}

/** The screen is appended; the measure ends one animation frame later (when it can be seen). */
export function perfScreenEnd(view: string): void {
  if (!perf) return;
  const start = starts.get(view);
  if (start === undefined) return;
  starts.delete(view);
  const done = () => measure(`memory:screen:${view}`, start, perf.now());
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(done);
  else done();
}

/** A request goes out; call the returned function when it settles. */
export function perfRequestStart(type: string): () => void {
  // The idle-time speech probe is background work, not a tab-switch read.
  if (type === 'refreshSpeech') perfCounters.backgroundRequests += 1;
  else perfCounters.requests += 1;
  if (!perf) return () => undefined;
  const start = perf.now();
  return () => measure(`memory:req:${type}`, start, perf.now());
}

/**
 * Counts long tasks until the returned stop function is called. Call it when Memory mounts and stop it on
 * dispose; also publishes the counters as `window.__memoryPerf` for the e2e spec.
 */
export function perfStartLongTasks(): () => void {
  const g = globalThis as { __memoryPerf?: PerfCounters; PerformanceObserver?: typeof PerformanceObserver };
  g.__memoryPerf = perfCounters;
  const Observer = g.PerformanceObserver;
  if (!Observer) return () => undefined;
  let observer: PerformanceObserver | null = null;
  try {
    observer = new Observer((list) => {
      for (const entry of list.getEntries()) {
        perfCounters.longTasks += 1;
        if (entry.duration > perfCounters.longTaskMaxMs) perfCounters.longTaskMaxMs = entry.duration;
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    observer = null; // longtask is not supported everywhere
  }
  return () => observer?.disconnect();
}
