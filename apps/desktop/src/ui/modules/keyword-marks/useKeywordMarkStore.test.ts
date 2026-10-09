import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryKeywordSetStore } from '@bible/core/browser';

vi.mock('../../stores/helpers/sessionNotifier', () => ({ markSessionDirty: vi.fn() }));
vi.mock('./keywordSetsAPI', () => ({ keywordSetsAPI: {} }));

import { createKeywordMarkStore } from './useKeywordMarkStore';

const V1 = 43003016;
const verses = [
  { verse_id: V1, text_html: 'For God so loved the world' },
  { verse_id: V1 + 1, text_html: 'God sent his Son, for God loved' },
];
const params = (tabId = 'tab-1') => ({
  tabId, moduleId: 1, abbreviation: 'KJV', language: 'en', bookNumber: 43, chapter: 3, verses,
});

function setup() {
  const fetchInterlinear = vi.fn().mockResolvedValue({
    [String(V1)]: [{ wordPositionStart: 3, wordPositionEnd: 3, strongsNumber: 'G25' }],
  });
  const store = new MemoryKeywordSetStore();
  const useStore = createKeywordMarkStore({ store, fetchInterlinear });
  return { useStore, fetchInterlinear, store };
}

describe('useKeywordMarkStore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is off per tab by default and computes nothing', () => {
    const { useStore } = setup();
    const s = useStore.getState();
    s.syncChapter(params());
    expect(s.getTabState('tab-1').enabled).toBe(false);
    expect(useStore.getState().chapters['tab-1']).toBeUndefined();
  });

  it('toggleTab turns marks on for that tab only', () => {
    const { useStore } = setup();
    useStore.getState().syncChapter(params('a'));
    useStore.getState().syncChapter(params('b'));
    useStore.getState().toggleTab('a');
    expect(useStore.getState().chapters['a']).toBeDefined();
    expect(useStore.getState().chapters['b']).toBeUndefined();
    useStore.getState().toggleTab('a');
    expect(useStore.getState().chapters['a']).toBeUndefined();
  });

  it('fetches interlinear rows once for connectives and recomputes with them', async () => {
    const { useStore, fetchInterlinear } = setup();
    useStore.getState().setTabEnabled('tab-1', true);
    useStore.getState().syncChapter(params());
    expect(useStore.getState().chapters['tab-1']?.result.wantsInterlinear).toBe(true);
    await vi.waitFor(() => expect(useStore.getState().chapters['tab-1']?.input.interlinear).toBeDefined());
    expect(fetchInterlinear).toHaveBeenCalledTimes(1);
    expect(fetchInterlinear).toHaveBeenCalledWith('KJV', 43, 3);
    useStore.getState().syncChapter(params()); // same chapter again: cached
    expect(fetchInterlinear).toHaveBeenCalledTimes(1);
  });

  it('does not refetch after a failed fetch', async () => {
    const { useStore, fetchInterlinear } = setup();
    fetchInterlinear.mockRejectedValue(new Error('boom'));
    useStore.getState().setTabEnabled('tab-1', true);
    useStore.getState().syncChapter(params());
    await vi.waitFor(() => expect(useStore.getState().chapters['tab-1']?.input.interlinear).toEqual([]));
    useStore.getState().syncChapter(params());
    expect(fetchInterlinear).toHaveBeenCalledTimes(1);
  });

  it('does not fetch when the caller already supplies rows', () => {
    const { useStore, fetchInterlinear } = setup();
    useStore.getState().setTabEnabled('tab-1', true);
    useStore.getState().syncChapter({ ...params(), interlinear: [{ verseId: V1, start: 1, end: 1, strongs: 'G2316' }] });
    expect(fetchInterlinear).not.toHaveBeenCalled();
  });

  it('addMarkFromWord creates "My keywords", picks a free colour, enables the tab and marks the word', async () => {
    const { useStore, store } = setup();
    useStore.getState().syncChapter(params());
    const mark = await useStore.getState().addMarkFromWord('tab-1', { text: 'God,' }, 'word');
    expect(mark?.rule).toEqual({ kind: 'word', forms: ['god'] });
    expect(mark?.style.color).toMatch(/^mark\.[1-8]$/);
    expect((await store.list()).map((s) => s.name)).toEqual(['My keywords']);
    expect(useStore.getState().getTabState('tab-1').enabled).toBe(true);
    const rows = useStore.getState().getLegendRows('tab-1');
    expect(rows.find((r) => r.markId === mark!.id)?.hits).toBe(3);

    const second = await useStore.getState().addMarkFromWord('tab-1', { text: 'Son' }, 'word');
    expect(second?.style.color).not.toBe(mark?.style.color); // next free colour, same set
    expect((await store.list()).length).toBe(1);

    const again = await useStore.getState().addMarkFromWord('tab-1', { text: 'god' }, 'word');
    expect(again?.id).toBe(mark!.id); // reuses the existing mark
  });

  it('addMarkFromWord with a Strong\'s number makes a strongs rule; without one it does nothing', async () => {
    const { useStore } = setup();
    useStore.getState().syncChapter(params());
    expect(await useStore.getState().addMarkFromWord('tab-1', { text: 'loved' }, 'strongs')).toBeNull();
    const m = await useStore.getState().addMarkFromWord('tab-1', { text: 'loved', strongs: 'G25' }, 'strongs');
    expect(m?.rule).toEqual({ kind: 'strongs', numbers: ['G25'] });
  });

  it('toggleMark hides a mark from the layer and legend keeps it', async () => {
    const { useStore } = setup();
    useStore.getState().syncChapter(params());
    const mark = (await useStore.getState().addMarkFromWord('tab-1', { text: 'God' }, 'word'))!;
    const mine = useStore.getState().sets.find((s) => s.name === 'My keywords')!;
    useStore.getState().setActiveSets('tab-1', [mine.id]); // leave the connectives out of it
    expect(useStore.getState().chapters['tab-1']!.verseLayers.size).toBe(2);
    useStore.getState().toggleMark('tab-1', mark.id);
    expect(useStore.getState().chapters['tab-1']!.verseLayers.size).toBe(0);
    expect(useStore.getState().getLegendRows('tab-1').find((r) => r.markId === mark.id)?.hidden).toBe(true);
  });

  it('exposes occurrences and suggestions', async () => {
    const { useStore } = setup();
    useStore.getState().syncChapter(params());
    const mark = (await useStore.getState().addMarkFromWord('tab-1', { text: 'God' }, 'word'))!;
    const occ = useStore.getState().getOccurrences('tab-1', mark.id);
    expect(occ.map((o) => [o.verseId, o.start])).toEqual([[V1, 1], [V1 + 1, 0], [V1 + 1, 5]]);
    expect(Array.isArray(useStore.getState().getSuggestions('tab-1'))).toBe(true);
  });

  it('round-trips per-tab state through the session data', () => {
    const { useStore } = setup();
    useStore.getState().setTabEnabled('tab-1', true);
    useStore.getState().toggleMark('tab-1', 'x');
    useStore.getState().setColorSafe(false);
    useStore.getState().setTabEnabled('tab-2', false); // untouched: not saved
    const saved = useStore.getState().getSessionData();
    expect(Object.keys(saved.tabs)).toEqual(['tab-1']);

    const other = setup().useStore;
    other.getState().loadFromSession(JSON.parse(JSON.stringify(saved)));
    expect(other.getState().getTabState('tab-1')).toEqual({ enabled: true, activeSetIds: null, hiddenMarkIds: ['x'] });
    expect(other.getState().colorSafe).toBe(false);
    other.getState().loadFromSession('garbage'); // ignored
    expect(other.getState().getTabState('tab-1').enabled).toBe(true);
  });

  it('defaults colorSafe to true', () => {
    expect(setup().useStore.getState().colorSafe).toBe(true);
  });

  describe('set management', () => {
    const mark = (id: string, form: string) => ({
      id, label: form, rule: { kind: 'word' as const, forms: [form] }, style: { color: 'mark.1' as const, line: 'solid' as const }, enabled: true,
    });

    it('saveMark creates My keywords, then replaces the mark by id', async () => {
      const { useStore } = setup();
      await useStore.getState().saveMark('tab-1', mark('m1', 'faith'));
      let mine = useStore.getState().sets.find((s) => !s.builtIn)!;
      expect(mine.name).toBe('My keywords');
      expect(mine.marks.map((m) => m.label)).toEqual(['faith']);
      expect(useStore.getState().getTabState('tab-1').enabled).toBe(true);
      await useStore.getState().saveMark('tab-1', { ...mark('m1', 'faith'), label: 'Faith', enabled: false }, mine.id);
      mine = useStore.getState().sets.find((s) => !s.builtIn)!;
      expect(mine.marks).toHaveLength(1);
      expect(mine.marks[0].label).toBe('Faith');
    });

    it('editing a built-in mark saves a copy and hides the original', async () => {
      const { useStore } = setup();
      const builtin = useStore.getState().sets.find((s) => s.builtIn)!;
      const original = builtin.marks[0];
      const saved = await useStore.getState().saveMark('tab-1', { ...original, label: 'Mine' }, builtin.id);
      expect(saved.id).not.toBe(original.id);
      expect(useStore.getState().getTabState('tab-1').hiddenMarkIds).toContain(original.id);
      expect(useStore.getState().sets.find((s) => !s.builtIn)!.marks.map((m) => m.label)).toContain('Mine');
    });

    it('deleteMark, duplicateSet, removeSet, exportSet and importSet', async () => {
      const { useStore } = setup();
      await useStore.getState().saveMark('tab-1', mark('a', 'grace'));
      await useStore.getState().saveMark('tab-1', mark('b', 'peace'));
      const mine = useStore.getState().sets.find((s) => !s.builtIn)!;
      await useStore.getState().deleteMark(mine.id, 'a');
      expect(useStore.getState().sets.find((s) => s.id === mine.id)!.marks.map((m) => m.id)).toEqual(['b']);

      const copy = await useStore.getState().duplicateSet(mine.id);
      expect(copy.id).not.toBe(mine.id);
      const json = useStore.getState().exportSet(mine.id);
      const imported = await useStore.getState().importSet(json);
      expect(Array.isArray(imported)).toBe(false);
      expect(await useStore.getState().importSet('not json')).toSatisfy((r: unknown) => Array.isArray(r));

      await useStore.getState().removeSet(copy.id);
      expect(useStore.getState().sets.some((s) => s.id === copy.id)).toBe(false);
      await expect(useStore.getState().removeSet('builtin:connectives-en')).rejects.toThrow();
    });
  });
});

