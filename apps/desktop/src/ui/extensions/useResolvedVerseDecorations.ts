/**
 * Bible-pane-facing hook: subscribes to `verseDecorationStore` and returns a
 * verse's resolved paint (task 0036, P0.1a, amendment A1).
 *
 * `surface` is `undefined` for any caller that hasn't opted a surface in
 * (Parallel view, and any future one) - the hook returns `null` in that
 * case, which is the whole mechanism by which such callers render no
 * decorations at all without needing their own conditional.
 */

import { useMemo } from 'react';
import type { WordInfo } from '../utils/wordIndexing';
import { useVerseDecorationStore } from './verseDecorationStore';
import { resolveVerseDecorations, type LayerDecorations, type ResolvedVerse } from './decorationResolver';
import { resolveThemeColor } from './themeColorResolver';

const EMPTY_LAYERS: LayerDecorations[] = [];

export function useResolvedVerseDecorations(
  verseId: number,
  moduleId: number,
  surface: 'standard' | 'reading' | 'study' | undefined,
  words: Pick<WordInfo, 'text'>[],
): ResolvedVerse | null {
  const layers = useVerseDecorationStore((s) =>
    surface ? s.getDecorationsForVerse(verseId, moduleId) : EMPTY_LAYERS,
  );

  return useMemo(() => {
    if (!surface) return null;
    if (layers.length === 0) return null;
    return resolveVerseDecorations({
      verseId,
      wordCount: words.length,
      layers,
      surface,
      resolveColor: resolveThemeColor,
    });
  }, [verseId, words.length, layers, surface]);
}

/**
 * Just the gutter marks for one verse (amendment A4) - the gutter lane lives
 * OUTSIDE `HighlightedVerse`'s own span (next to the verse-number affordance
 * in `BibleVerseList`/`StudyModeView`), so it needs its own small resolve
 * rather than reaching into `HighlightedVerse`'s internals. `wordCount: 0` is
 * deliberate - gutter marks don't depend on the rendered word sequence at
 * all, so this never re-parses `verseHTML`.
 */
export function useVerseGutterMarks(
  verseId: number,
  moduleId: number,
  surface: 'standard' | 'study' | 'reading',
): { gutter: ResolvedVerse['gutter']; gutterOverflow: number } {
  const layers = useVerseDecorationStore((s) => s.getDecorationsForVerse(verseId, moduleId));
  return useMemo(() => {
    if (layers.length === 0) return { gutter: [], gutterOverflow: 0 };
    const resolved = resolveVerseDecorations({
      verseId,
      wordCount: 0,
      layers,
      surface,
      resolveColor: resolveThemeColor,
    });
    return { gutter: resolved.gutter, gutterOverflow: resolved.gutterOverflow };
  }, [verseId, layers, surface]);
}

/** True while at least one verse decorator layer is registered and enabled - the gutter LANE's presence gate (amendment A4). */
export function useHasEnabledDecoratorLayers(): boolean {
  return useVerseDecorationStore((s) => {
    for (const layer of s.layers.values()) if (layer.enabled) return true;
    return false;
  });
}
