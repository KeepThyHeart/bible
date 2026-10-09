/**
 * Chapter decoration layers contributed by feature modules (task 0127).
 *
 * A module that paints words in the chapter on screen (keyword marks, weights and measures, ...)
 * computes a per-verse `LayerDecorations` list for a Bible tab and PUBLISHES it here, keyed by
 * tab id and the module's source id. `useResolvedVerseDecorations` reads the store (one verse's
 * slice per source, reference-stable until that source recomputes) and merges the layers below
 * the verse-decorator layers, in `order`. A module that is off publishes nothing, so nothing
 * of it reaches the renderer.
 *
 * Also holds the small chapter-text helpers every layer builder shares.
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { InterlinearSpan, LayerDecorations } from '@bible/core/browser';

/** The verse fields the pane already has. */
export interface PaneVerse {
  verse_id: number;
  text_html?: string | null;
  text?: string | null;
}

/** Flatten `bible:getInterlinearWordsForChapter` (`{verseId: rows[]}`) into match spans. */
export function interlinearToSpans(
  byVerse: Record<string, { wordPositionStart: number; wordPositionEnd: number; strongsNumber?: string; morphology?: string }[]> | null | undefined,
): InterlinearSpan[] {
  const out: InterlinearSpan[] = [];
  for (const [verseKey, rows] of Object.entries(byVerse ?? {})) {
    const verseId = Number(verseKey);
    if (!Number.isFinite(verseId)) continue;
    for (const r of rows ?? []) {
      out.push({
        verseId,
        start: r.wordPositionStart,
        end: r.wordPositionEnd,
        ...(r.strongsNumber ? { strongs: r.strongsNumber } : {}),
        ...(r.morphology ? { morph: r.morphology } : {}),
      });
    }
  }
  return out;
}

/** Split a layer into one layer per verse so each verse holds a stable, small decoration list. */
export function splitLayerByVerse(layer: LayerDecorations): Map<number, LayerDecorations> {
  const byVerse = new Map<number, LayerDecorations>();
  for (const d of layer.decorations) {
    const targets = Array.isArray(d.target) ? d.target : [d.target];
    const grouped = new Map<number, typeof targets>();
    for (const t of targets) {
      if (t.kind !== 'tokens') continue;
      const list = grouped.get(t.verseId) ?? [];
      list.push(t);
      grouped.set(t.verseId, list);
    }
    for (const [verseId, list] of grouped) {
      let vl = byVerse.get(verseId);
      if (!vl) {
        vl = { ...layer, decorations: [] };
        byVerse.set(verseId, vl);
      }
      vl.decorations.push({ ...d, target: list });
    }
  }
  return byVerse;
}

/** Append layers to a verse's layers; returns `base` itself when there is nothing to add. */
export function appendLayers(base: LayerDecorations[], extra: LayerDecorations[] | undefined): LayerDecorations[] {
  return extra && extra.length > 0 ? [...base, ...extra] : base;
}

/** One source's layers for a tab's chapter. */
export interface PublishedChapterLayers {
  /** The Bible module the chapter was computed for; verses of another module ignore it. */
  moduleId: number;
  /** Merge position among sources (lower first, i.e. painted below). */
  order: number;
  verseLayers: ReadonlyMap<number, LayerDecorations[]>;
}

interface ChapterLayerState {
  /** tabId -> sourceId -> layers. */
  tabs: Readonly<Record<string, Readonly<Record<string, PublishedChapterLayers>>>>;
}

export const useChapterLayerStore = create<ChapterLayerState>(() => ({ tabs: {} }));

/** Publish (or, with `undefined`, withdraw) one source's layers for a tab. */
export function publishChapterLayers(tabId: string, sourceId: string, layers: PublishedChapterLayers | undefined): void {
  useChapterLayerStore.setState((s) => {
    const current = s.tabs[tabId];
    if (layers === undefined) {
      if (!current || !(sourceId in current)) return s;
      const rest = { ...current };
      delete rest[sourceId];
      const tabs = { ...s.tabs };
      if (Object.keys(rest).length === 0) delete tabs[tabId];
      else tabs[tabId] = rest;
      return { tabs };
    }
    return { tabs: { ...s.tabs, [tabId]: { ...(current ?? {}), [sourceId]: layers } } };
  });
}

/** Withdraw every layer a source published (module deactivation). */
export function withdrawChapterLayerSource(sourceId: string): void {
  useChapterLayerStore.setState((s) => {
    let changed = false;
    const tabs: Record<string, Record<string, PublishedChapterLayers>> = {};
    for (const [tabId, sources] of Object.entries(s.tabs)) {
      if (sourceId in sources) {
        changed = true;
        const rest = { ...sources };
        delete rest[sourceId];
        if (Object.keys(rest).length > 0) tabs[tabId] = rest;
      } else {
        tabs[tabId] = sources as Record<string, PublishedChapterLayers>;
      }
    }
    return changed ? { tabs } : s;
  });
}

const NO_SLICES: readonly LayerDecorations[][] = Object.freeze([]);

/**
 * One verse's published layer lists for a tab, one entry per source in `order`. Each entry is the
 * source's own reference, so the array compares shallow-equal until that verse's layers change.
 */
export function useChapterLayerSlices(tabId: string | undefined, moduleId: number, verseId: number): readonly LayerDecorations[][] {
  return useChapterLayerStore(
    useShallow((s) => {
      if (!tabId) return NO_SLICES;
      const sources = s.tabs[tabId];
      if (!sources) return NO_SLICES;
      const out: LayerDecorations[][] = [];
      for (const src of Object.values(sources).sort((a, b) => a.order - b.order)) {
        if (src.moduleId !== moduleId) continue;
        const layers = src.verseLayers.get(verseId);
        if (layers && layers.length > 0) out.push(layers);
      }
      return out.length === 0 ? NO_SLICES : out;
    }),
  );
}
