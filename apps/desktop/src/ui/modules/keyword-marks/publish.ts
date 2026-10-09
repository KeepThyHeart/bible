/**
 * Publishes each tab's keyword-mark layers into the host's chapter-layer store
 * (`extensions/chapterLayers.ts`), and withdraws them again when the module is deactivated.
 * Runs in the store's own `set` call chain, so a recomputed chapter reaches the verses in the same
 * React batch (no flash of unmarked text).
 */
import type { Disposable } from '@bible/core/browser';
import { publishChapterLayers, withdrawChapterLayerSource } from '../../extensions/chapterLayers';
import { useKeywordMarkStore } from './useKeywordMarkStore';
import type { ChapterMarks } from './keywordMarkLayer';

export const KEYWORD_LAYER_SOURCE = 'keyword-marks';
/** Below the weights-and-measures layers (order 10): keyword marks are painted last. */
export const KEYWORD_LAYER_ORDER = 20;

function publishTab(tabId: string, chapter: ChapterMarks | undefined): void {
  publishChapterLayers(
    tabId,
    KEYWORD_LAYER_SOURCE,
    chapter ? { moduleId: chapter.input.moduleId, order: KEYWORD_LAYER_ORDER, verseLayers: chapter.verseLayers } : undefined,
  );
}

export function startKeywordLayerPublishing(): Disposable {
  const store = useKeywordMarkStore;
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
      withdrawChapterLayerSource(KEYWORD_LAYER_SOURCE);
    },
  };
}
