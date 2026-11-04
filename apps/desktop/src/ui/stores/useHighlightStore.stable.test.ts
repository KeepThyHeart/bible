import { describe, it, expect, beforeEach } from 'vitest';
import { UserTextMarkup } from '@bible/core';
import { useHighlightStore } from './useHighlightStore';

const mk = (id: number, v: number) =>
  new UserTextMarkup({ markupId: id, moduleId: 1, verseIdStart: v, color: '#ffff00' });

describe('loadHighlightsForVerseRange keeps a stable array (B-131)', () => {
  beforeEach(() => useHighlightStore.setState({ highlightsByModule: new Map() }));

  it('reloading an unchanged range does not replace the module array', async () => {
    const repo = { getForVerseRange: async () => [mk(1, 10), mk(2, 11)] } as never;
    await useHighlightStore.getState().loadHighlightsForVerseRange(1, 10, 20, repo);
    const first = useHighlightStore.getState().highlightsByModule.get(1);
    const mapBefore = useHighlightStore.getState().highlightsByModule;
    await useHighlightStore.getState().loadHighlightsForVerseRange(1, 10, 20, repo);
    expect(useHighlightStore.getState().highlightsByModule.get(1)).toBe(first);
    expect(useHighlightStore.getState().highlightsByModule).toBe(mapBefore);
  });

  it('a changed range does replace it', async () => {
    let rows = [mk(1, 10)];
    const repo = { getForVerseRange: async () => rows } as never;
    await useHighlightStore.getState().loadHighlightsForVerseRange(1, 10, 20, repo);
    const first = useHighlightStore.getState().highlightsByModule.get(1);
    rows = [mk(1, 10), mk(3, 12)];
    await useHighlightStore.getState().loadHighlightsForVerseRange(1, 10, 20, repo);
    expect(useHighlightStore.getState().highlightsByModule.get(1)).not.toBe(first);
    expect(useHighlightStore.getState().highlightsByModule.get(1)).toHaveLength(2);
  });
});
