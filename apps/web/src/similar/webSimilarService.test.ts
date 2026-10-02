import { describe, it, expect, vi } from 'vitest';
import { encodeNeighbourTable, NeighbourTable } from '@bible/core/browser';
import type { NeighbourTableMeta } from '@bible/core/browser';

const meta: NeighbourTableMeta = { neighbourFloor: 0.5, scoreMin: 0.5, scoreMax: 1, k: 3, levels: ['verse'], excludeWindow: 2 };
const table = NeighbourTable.fromBytes(encodeNeighbourTable(meta, [
  {
    key: { startVerseId: 43003016, endVerseId: 43003018, level: 'verse' },
    neighbours: [
      { startVerseId: 45005008, endVerseId: 45005008, level: 'verse', score: 0.9 },
      { startVerseId: 19023001, endVerseId: 19023001, level: 'verse', score: 0.8 },
    ],
  },
]));
vi.mock('./similarTable', () => ({ getLoadedSimilarTable: () => table }));

import { createWebSimilar } from './webSimilarService';
import type { SimilarProviders } from './webSimilarService';

const XREF = 'TSKxref';

function providers(reject = false) {
  const getGroupsForVerse = vi.fn(async (module: string, verseId: number) => {
    if (reject) throw new Error('404');
    // Only the xref module answers, and only for the MIDDLE verse of the range.
    return module === XREF && verseId === 43003017
      ? [{ entries: [{ target_verse_id: 45005008, target_verse_end_id: null }] }]
      : [];
  });
  const p = {
    bible: { getVerseTexts: vi.fn(async () => ({ verses: {} })) },
    crossRef: { getGroupsForVerse },
    topical: { getTopicsForVerse: vi.fn(async () => []) },
  } as unknown as SimilarProviders;
  return { p, getGroupsForVerse };
}

const range = { startVerseId: 43003016, endVerseId: 43003018 };

describe('createWebSimilar cross-references', () => {
  it('asks the xref module (not the Bible module) for every verse of the range; flags and hides', async () => {
    const { p, getGroupsForVerse } = providers();
    const web = createWebSimilar(p, () => 'KJV', { crossRefModule: XREF });
    const flagged = await web.service.findSimilar(range, { crossRefs: 'flag', source: 'auto' });
    expect(getGroupsForVerse.mock.calls.map((c) => c[0])).toEqual([XREF, XREF, XREF]);
    expect(getGroupsForVerse.mock.calls.map((c) => c[1])).toEqual([43003016, 43003017, 43003018]);
    expect(flagged.passages.find((x) => x.startVerseId === 45005008)?.isCrossReference).toBe(true);
    expect(flagged.passages.find((x) => x.startVerseId === 19023001)?.isCrossReference).toBe(false);
    web.service.reset();
    const hidden = await web.service.findSimilar(range, { crossRefs: 'hide', source: 'auto' });
    expect(hidden.passages.map((x) => x.startVerseId)).toEqual([19023001]);
  });

  it('keeps a failing xref request non-fatal', async () => {
    const { p } = providers(true);
    const web = createWebSimilar(p, () => 'KJV', { crossRefModule: XREF });
    const res = await web.service.findSimilar(range, { crossRefs: 'flag', source: 'auto' });
    expect(res.passages).toHaveLength(2);
  });
});
