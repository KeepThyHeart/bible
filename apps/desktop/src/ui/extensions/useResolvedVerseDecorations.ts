/**
 * Bible-pane-facing hook: subscribes to `verseDecorationStore` and returns a
 * verse's resolved paint (task 0036, P0.1a, amendment A1; word/token
 * targeting added P0.1b).
 *
 * `surface` is `undefined` for any caller that hasn't opted a surface in
 * (Parallel view, and any future one) - the hook returns `null` in that
 * case, which is the whole mechanism by which such callers render no
 * decorations at all without needing their own conditional.
 */

import { useEffect, useMemo } from 'react';
import type { WordInfo } from '../utils/wordIndexing';
import { useVerseDecorationStore } from './verseDecorationStore';
import {
  resolveVerseDecorations,
  countWordTextMatches,
  type LayerDecorations,
  type ResolvedVerse,
} from './decorationResolver';
import { resolveThemeColor } from './themeColorResolver';
import { registerVerseWords, sumCachedMatches } from './verseWordTextCache';

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

  // Registers this verse's rendered words for any sibling verse's cumulative
  // `occurrence` count (P0.1b - see `verseWordTextCache.ts`). Cheap and
  // idempotent; runs even when `surface` is undefined so a Parallel-view
  // verse (which renders no decorations of its own) still contributes its
  // words to a passage scope another surface might be resolving.
  useEffect(() => {
    registerVerseWords(moduleId, verseId, words);
  }, [moduleId, verseId, words]);

  return useMemo(() => {
    if (!surface) return null;
    if (layers.length === 0) return null;
    return resolveVerseDecorations({
      verseId,
      wordCount: words.length,
      words,
      layers,
      surface,
      resolveColor: resolveThemeColor,
      priorWordMatchCounts: computePriorWordMatchCounts(verseId, moduleId, layers),
    });
  }, [verseId, moduleId, words, layers, surface]);
}

/**
 * For every `occurrence`-bearing, passage-scoped `'word'` target among
 * `layers`' decorations: how many matches of its text already occurred in
 * earlier verses of its scope, summed from `verseWordTextCache` (P0.1b, see
 * that module's ordering note). Verses the cache has no entry for yet
 * (scope extends outside the loaded chapter, or simply hasn't rendered)
 * contribute 0 - the same "paints the part that is on screen" tolerance the
 * design doc already applies to a passage extending past the loaded chapter
 * (§4.1).
 */
function computePriorWordMatchCounts(
  verseId: number,
  moduleId: number,
  layers: LayerDecorations[],
): Map<string, number> | undefined {
  let counts: Map<string, number> | undefined;
  for (const layer of layers) {
    layer.decorations.forEach((d, decorationIndex) => {
      const targets = Array.isArray(d.target) ? d.target : [d.target];
      targets.forEach((t, targetIndex) => {
        if (t.kind !== 'word' || t.occurrence === undefined) return;
        if (!('startVerseId' in t.scope)) return; // verse scope needs no prior count
        if (verseId <= t.scope.startVerseId) return; // first verse of scope (or before it) - prior is 0
        const prior = sumCachedMatches(moduleId, t.scope.startVerseId, verseId, (cachedWords) =>
          countWordTextMatches(t.text, t.matchCase, cachedWords.map((text) => ({ text }))),
        );
        if (prior === 0) return; // default; no entry needed
        (counts ??= new Map()).set(`${layer.layerKey}#${decorationIndex}:${targetIndex}`, prior);
      });
    });
  }
  return counts;
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

/**
 * Just this verse's static hover content (task 0036, P0.1c, design doc
 * §11.1's "a verse" row) - for a verse-level hover trigger (hovering the
 * verse row itself, outside any specific word), which needs it without
 * reaching into `HighlightedVerse`'s internals, the same reasoning as
 * `useVerseGutterMarks`.
 */
export function useVerseHoverStaticContent(
  verseId: number,
  moduleId: number,
  surface: 'standard' | 'study' | 'reading',
): ResolvedVerse['verseHovers'] {
  const layers = useVerseDecorationStore((s) => s.getDecorationsForVerse(verseId, moduleId));
  return useMemo(() => {
    if (layers.length === 0) return [];
    return resolveVerseDecorations({
      verseId,
      wordCount: 0,
      layers,
      surface,
      resolveColor: resolveThemeColor,
    }).verseHovers;
  }, [verseId, layers, surface]);
}

/** True while at least one verse decorator layer is registered and enabled - the gutter LANE's presence gate (amendment A4). */
export function useHasEnabledDecoratorLayers(): boolean {
  return useVerseDecorationStore((s) => {
    for (const layer of s.layers.values()) if (layer.enabled) return true;
    return false;
  });
}
