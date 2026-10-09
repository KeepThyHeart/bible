/**
 * The host seam for module-published chapter layers (task 0127): a module publishes per-verse
 * `LayerDecorations` for a tab; `useResolvedVerseDecorations` merges them below the extension layers
 * in `order`, only for the tab and Bible module they were computed for, and never without a surface.
 * Nothing here knows which feature published.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { LayerDecorations } from '@bible/core/browser';
import {
  appendLayers,
  publishChapterLayers,
  useChapterLayerSlices,
  useChapterLayerStore,
  withdrawChapterLayerSource,
} from './chapterLayers';
import { useResolvedVerseDecorations } from './useResolvedVerseDecorations';

const V = 43003016;
const words = ['For', 'God', 'so', 'loved'].map((text) => ({ text }));

function layer(key: string, tokenIndex: number): LayerDecorations {
  return {
    layerKey: `core::${key}`,
    extensionId: 'core',
    layerSeq: 0,
    surfaces: ['standard', 'study', 'reading'],
    decorations: [
      {
        target: { kind: 'tokens', verseId: V, startTokenIndex: tokenIndex },
        appearance: { kind: 'underline', color: 'accent.primary' },
      } as LayerDecorations['decorations'][number],
    ],
  };
}

beforeEach(() => useChapterLayerStore.setState({ tabs: {} }));

describe('chapter layer store', () => {
  it('publishes per tab and source, ordered, and filtered by Bible module', () => {
    const a = layer('a', 0);
    const b = layer('b', 1);
    publishChapterLayers('t1', 'late', { moduleId: 5, order: 20, verseLayers: new Map([[V, [b]]]) });
    publishChapterLayers('t1', 'early', { moduleId: 5, order: 10, verseLayers: new Map([[V, [a]]]) });
    const hook = renderHook(() => useChapterLayerSlices('t1', 5, V));
    expect(hook.result.current).toEqual([[a], [b]]);
    expect(renderHook(() => useChapterLayerSlices('t1', 6, V)).result.current).toEqual([]);
    expect(renderHook(() => useChapterLayerSlices('t2', 5, V)).result.current).toEqual([]);
    expect(renderHook(() => useChapterLayerSlices(undefined, 5, V)).result.current).toEqual([]);
  });

  it('keeps a verse\'s slices reference-stable while only another verse or tab changes', () => {
    const a = layer('a', 0);
    publishChapterLayers('t1', 'src', { moduleId: 5, order: 1, verseLayers: new Map([[V, [a]]]) });
    const hook = renderHook(() => useChapterLayerSlices('t1', 5, V));
    const first = hook.result.current;
    act(() => publishChapterLayers('other', 'src', { moduleId: 5, order: 1, verseLayers: new Map() }));
    expect(hook.result.current).toBe(first);
  });

  it('withdraws one source or every layer of a source', () => {
    publishChapterLayers('t1', 'x', { moduleId: 5, order: 1, verseLayers: new Map([[V, [layer('x', 0)]]]) });
    publishChapterLayers('t2', 'x', { moduleId: 5, order: 1, verseLayers: new Map([[V, [layer('x', 0)]]]) });
    publishChapterLayers('t2', 'y', { moduleId: 5, order: 2, verseLayers: new Map([[V, [layer('y', 0)]]]) });
    publishChapterLayers('t1', 'x', undefined);
    expect(Object.keys(useChapterLayerStore.getState().tabs)).toEqual(['t2']);
    withdrawChapterLayerSource('x');
    expect(Object.keys(useChapterLayerStore.getState().tabs.t2)).toEqual(['y']);
    withdrawChapterLayerSource('y');
    expect(useChapterLayerStore.getState().tabs).toEqual({});
  });

  it('appendLayers keeps the base reference when there is nothing to add', () => {
    const base: LayerDecorations[] = [];
    expect(appendLayers(base, undefined)).toBe(base);
    expect(appendLayers(base, [])).toBe(base);
  });
});

describe('useResolvedVerseDecorations + published layers', () => {
  it('paints a published layer for its tab and module only, and never without a surface', () => {
    publishChapterLayers('t1', 'src', { moduleId: 5, order: 1, verseLayers: new Map([[V, [layer('a', 1)]]]) });
    const painted = renderHook(() => useResolvedVerseDecorations(V, 5, 'standard', words, 't1'));
    expect(painted.result.current?.words.get(1)?.underlines.length).toBeGreaterThan(0);
    expect(painted.result.current?.words.get(0)).toBeUndefined();
    expect(renderHook(() => useResolvedVerseDecorations(V, 6, 'standard', words, 't1')).result.current).toBeNull();
    expect(renderHook(() => useResolvedVerseDecorations(V, 5, 'standard', words, 'other')).result.current).toBeNull();
    expect(renderHook(() => useResolvedVerseDecorations(V, 5, undefined, words, 't1')).result.current).toBeNull();
    act(() => withdrawChapterLayerSource('src'));
    expect(painted.result.current).toBeNull();
  });

  it('merges several sources in order', () => {
    publishChapterLayers('t1', 'a', { moduleId: 5, order: 2, verseLayers: new Map([[V, [layer('a', 0)]]]) });
    publishChapterLayers('t1', 'b', { moduleId: 5, order: 1, verseLayers: new Map([[V, [layer('b', 2)]]]) });
    const hook = renderHook(() => useResolvedVerseDecorations(V, 5, 'standard', words, 't1'));
    expect(hook.result.current?.words.get(0)?.underlines.length).toBeGreaterThan(0);
    expect(hook.result.current?.words.get(2)?.underlines.length).toBeGreaterThan(0);
  });
});
