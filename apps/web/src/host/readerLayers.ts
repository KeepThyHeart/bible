/**
 * Paint layers published by the reader paint controllers of active feature
 * modules (task 0127), keyed by tab. A controller (see `readerPaintControllers`
 * in `slots.tsx`) calls `publishReaderLayer` from a layout effect; the reader
 * (`BibleContent`) subscribes with `useReaderLayers` and resolves them with
 * `resolveChapterLayers`. Publishing from a layout effect makes the reader's
 * re-render a microtask, so the first paint already carries the marks.
 *
 * Entry-chunk code: imports only Preact and core types.
 */
import { useSyncExternalStore } from 'preact/compat';
import type { LayerDecorations } from '@bible/core/browser';

interface Source {
  readonly order: number;
  readonly layer: LayerDecorations;
}

const EMPTY: readonly LayerDecorations[] = Object.freeze([]);
const sources = new Map<string, Map<string, Source>>();
const snapshots = new Map<string, readonly LayerDecorations[]>();
const listeners = new Set<() => void>();

function rebuild(tabId: string): void {
  const bySource = sources.get(tabId);
  if (!bySource || bySource.size === 0) {
    sources.delete(tabId);
    snapshots.delete(tabId);
    return;
  }
  snapshots.set(
    tabId,
    [...bySource.values()].sort((a, b) => a.order - b.order).map((s) => s.layer),
  );
}

/** Publish (or, with null, withdraw) one source's layer for a tab. Lower `order` resolves first. */
export function publishReaderLayer(tabId: string, sourceId: string, order: number, layer: LayerDecorations | null): void {
  let bySource = sources.get(tabId);
  const current = bySource?.get(sourceId);
  if (layer === null) {
    if (!current) return;
    bySource!.delete(sourceId);
  } else {
    if (current && current.layer === layer && current.order === order) return;
    if (!bySource) sources.set(tabId, (bySource = new Map()));
    bySource.set(sourceId, { order, layer });
  }
  rebuild(tabId);
  for (const fn of [...listeners]) fn();
}

export function readerLayers(tabId: string): readonly LayerDecorations[] {
  return snapshots.get(tabId) ?? EMPTY;
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The layers active modules published for a tab; a stable array between publishes. */
export function useReaderLayers(tabId: string): readonly LayerDecorations[] {
  return useSyncExternalStore(subscribe, () => readerLayers(tabId));
}

/** Test hook: drop everything published. */
export function resetReaderLayers(): void {
  sources.clear();
  snapshots.clear();
  for (const fn of [...listeners]) fn();
}
