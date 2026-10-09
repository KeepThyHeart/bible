/**
 * Publishes each tab's weights-and-measures layers into the host's chapter-layer store
 * (`extensions/chapterLayers.ts`), and withdraws them again when the module is deactivated.
 */
import type { Disposable } from '@bible/core/browser';
import { publishChapterLayers, withdrawChapterLayerSource } from '../../extensions/chapterLayers';
import { useMeasureStore } from './useMeasureStore';
import type { MeasureChapter } from './measureLayer';

export const MEASURE_LAYER_SOURCE = 'measures';
/** Painted below the keyword marks (order 20). */
export const MEASURE_LAYER_ORDER = 10;

function publishTab(tabId: string, chapter: MeasureChapter | undefined): void {
  publishChapterLayers(
    tabId,
    MEASURE_LAYER_SOURCE,
    chapter ? { moduleId: chapter.moduleId, order: MEASURE_LAYER_ORDER, verseLayers: chapter.verseLayers } : undefined,
  );
}

export function startMeasureLayerPublishing(): Disposable {
  const store = useMeasureStore;
  for (const [tabId, chapter] of Object.entries(store.getState().chapters)) publishTab(tabId, chapter); // allow-getstate: activation-time read
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.chapters === prev.chapters) return;
    const ids = new Set([...Object.keys(state.chapters), ...Object.keys(prev.chapters)]);
    for (const tabId of ids) {
      if (state.chapters[tabId] !== prev.chapters[tabId]) publishTab(tabId, state.chapters[tabId]);
    }
  });
  return {
    dispose() {
      unsubscribe();
      withdrawChapterLayerSource(MEASURE_LAYER_SOURCE);
    },
  };
}
