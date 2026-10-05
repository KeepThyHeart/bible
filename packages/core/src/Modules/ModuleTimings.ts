/**
 * Dev timing view of feature-module activations (task 0113 performance rule).
 * The host reports each activation; this log keeps them for a dev overlay or
 * `console.table`. A store, so a UI may subscribe.
 */

import type { ActivationTiming } from './FeatureModuleHost';

export interface ModuleTimingLog {
  record(timing: ActivationTiming): void;
  list(): readonly ActivationTiming[];
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly ActivationTiming[];
  /** Plain-text table, one row per activation, slowest total first. */
  format(): string;
  clear(): void;
}

export function createModuleTimingLog(): ModuleTimingLog {
  let items: readonly ActivationTiming[] = [];
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of [...listeners]) l();
  };
  return {
    record(timing) {
      items = [...items, timing];
      emit();
    },
    list: () => items,
    getSnapshot: () => items,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    format() {
      if (items.length === 0) return '(no feature module has been activated)';
      const rows = [...items]
        .sort((a, b) => b.loadMs + b.activateMs - (a.loadMs + a.activateMs))
        .map((t) => [t.moduleId, t.event, t.loadMs.toFixed(1), t.activateMs.toFixed(1), (t.loadMs + t.activateMs).toFixed(1)]);
      const header = ['module', 'event', 'load ms', 'activate ms', 'total ms'];
      const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
      const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
      return [line(header), ...rows.map(line)].join('\n');
    },
    clear() {
      items = [];
      emit();
    },
  };
}
