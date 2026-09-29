import { describe, it, expect, vi } from 'vitest';
import { MemoryKeywordSetStore, type StringStorage } from '@bible/core/browser';
import { KeywordMarkStore, defaultPaneState } from './keywordMarkStore';
import type { InterlinearWordData, VerseData } from '../types';

function memStorage(initial: Record<string, string> = {}): StringStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

function verse(n: number, html: string): VerseData {
  return {
    verse_id: 43003000 + n, book_number: 43, chapter: 3, verse: n, text: html, text_html: html,
    is_paragraph_start: false, words_of_christ: false,
  };
}
const VERSES = [verse(16, 'For God so loved the world, therefore God gave'), verse(17, 'God sent his Son')];
const ctx = (verses = VERSES) => ({ chapterKey: 'KJV:43:3', moduleId: 1, language: 'en', verses });

function make(storage = memStorage()) {
  return { storage, store: new KeywordMarkStore({ storage, setStore: new MemoryKeywordSetStore() }) };
}

describe('KeywordMarkStore pane state', () => {
  it('is off by default, with the built-in sets active and nothing hidden', () => {
    const { store } = make();
    expect(store.isEnabled('bible')).toBe(false);
    expect(store.getPaneState('bible')).toEqual(defaultPaneState());
    expect(store.getChapterMarks('bible', ctx())).toBeNull();
  });

  it('toggles a pane, and persists it per pane', () => {
    const { store, storage } = make();
    store.togglePane('bible');
    expect(store.isEnabled('bible')).toBe(true);
    expect(store.isEnabled('other')).toBe(false);
    const reborn = new KeywordMarkStore({ storage, setStore: new MemoryKeywordSetStore() });
    expect(reborn.isEnabled('bible')).toBe(true);
    expect(reborn.isEnabled('other')).toBe(false);
  });

  it('survives corrupt or throwing storage', () => {
    const bad = new KeywordMarkStore({ storage: memStorage({ 'bible-keyword-marks': '{nope' }), setStore: new MemoryKeywordSetStore() });
    expect(bad.isEnabled('bible')).toBe(false);
    const throwing: StringStorage = {
      getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => {},
    };
    const s = new KeywordMarkStore({ storage: throwing, setStore: new MemoryKeywordSetStore() });
    expect(() => s.togglePane('bible')).not.toThrow();
    expect(s.isEnabled('bible')).toBe(true);
  });

  it('toggles a mark hidden and back, and colour-safe mode', () => {
    const { store } = make();
    store.toggleMark('bible', 'm1');
    expect(store.getPaneState('bible').hiddenMarkIds).toEqual(['m1']);
    store.toggleMark('bible', 'm1');
    expect(store.getPaneState('bible').hiddenMarkIds).toEqual([]);
    expect(store.colorSafe).toBe(true);
    store.setColorSafe(false);
    expect(store.colorSafe).toBe(false);
  });
});

describe('KeywordMarkStore matching', () => {
  it('matches the built-in connectives once enabled, and memoises per chapter', () => {
    const { store } = make();
    store.togglePane('bible');
    const a = store.getChapterMarks('bible', ctx())!;
    expect(a.legend.some((r) => r.label.toLowerCase().includes('infer') || r.hits > 0)).toBe(true);
    expect(store.getChapterMarks('bible', ctx())).toBe(a);
    expect(store.getChapterMarks('bible', ctx([...VERSES]))).not.toBe(a);
    const c = store.getChapterMarks('bible', ctx([...VERSES]))!;
    expect(store.legend('bible')).toBe(c.legend);
  });

  it('recomputes when a mark is hidden, and lists its occurrences', async () => {
    const { store } = make();
    const markId = (await store.addMarkFromWord('bible', { text: 'God' }, 'word'))!;
    const a = store.getChapterMarks('bible', ctx())!;
    expect(store.occurrencesOf('bible', markId)).toHaveLength(3);
    store.toggleMark('bible', markId);
    const b = store.getChapterMarks('bible', ctx())!;
    expect(b).not.toBe(a);
    expect(b.layer.decorations.some((d) => (d.data as { markId?: string } | undefined)?.markId === markId)).toBe(false);
    expect(b.legend.find((r) => r.markId === markId)?.hidden).toBe(true);
  });

  it('offers suggestions from a chapter input', () => {
    const { store } = make();
    const marks = (() => { store.togglePane('bible'); return store.getChapterMarks('bible', ctx())!; })();
    expect(Array.isArray(store.suggestKeywords(marks.input))).toBe(true);
    expect(store.suggestKeywords(null)).toEqual([]);
  });
});

describe('KeywordMarkStore addMarkFromWord', () => {
  it('creates "My keywords" once, enables the pane and activates the set', async () => {
    const { store } = make();
    const a = (await store.addMarkFromWord('bible', { text: 'God,' }, 'word'))!;
    const b = (await store.addMarkFromWord('bible', { text: 'world' }, 'word'))!;
    const mine = store.sets.filter((s) => s.name === 'My keywords');
    expect(mine).toHaveLength(1);
    expect(mine[0].marks.map((m) => m.label)).toEqual(['God', 'world']);
    // Colours are least-used-first across every set, built-ins included.
    expect(mine[0].marks[0].style.color).toMatch(/^mark\.[1-8]$/);
    expect(store.isEnabled('bible')).toBe(true);
    expect(store.getPaneState('bible').activeSetIds).toContain(mine[0].id);
    expect(a).not.toBe(b);
  });

  it('reuses the mark for the same word and un-hides it', async () => {
    const { store } = make();
    const a = (await store.addMarkFromWord('bible', { text: 'God' }, 'word'))!;
    store.toggleMark('bible', a);
    const again = (await store.addMarkFromWord('bible', { text: 'god' }, 'word'))!;
    expect(again).toBe(a);
    expect(store.getPaneState('bible').hiddenMarkIds).toEqual([]);
    expect(store.sets.find((s) => s.name === 'My keywords')!.marks).toHaveLength(1);
  });

  it('marks by Strong\'s number, and refuses a pick with none', async () => {
    const { store } = make();
    expect(await store.addMarkFromWord('bible', { text: 'loved' }, 'strongs')).toBeNull();
    const id = (await store.addMarkFromWord('bible', { text: 'loved', strongs: 'G25' }, 'strongs'))!;
    const mark = store.sets.flatMap((s) => s.marks).find((m) => m.id === id)!;
    expect(mark.rule).toEqual({ kind: 'strongs', numbers: ['G25'] });
    expect(mark.label).toBe('loved (G25)');
  });

  it('keeps the user set across a new store on the same storage', async () => {
    const storage = memStorage();
    const first = new KeywordMarkStore({ storage });
    await first.addMarkFromWord('bible', { text: 'God' }, 'word');
    const second = new KeywordMarkStore({ storage });
    await second.init();
    expect(second.sets.some((s) => s.name === 'My keywords' && s.marks.length === 1)).toBe(true);
  });
});

describe('KeywordMarkStore interlinear', () => {
  const rows: InterlinearWordData[] = [
    { verseId: 43003016, position: 2, positionEnd: 3, originalWord: 'x', transliteration: '', strongsNumber: 'G25', morphology: '', language: 'greek', gloss: 'loved' },
  ];

  it('fetches rows once per chapter, only when asked, and notifies', async () => {
    const { store } = make();
    const fetchRows = vi.fn().mockResolvedValue(rows);
    const listener = vi.fn();
    store.subscribe(listener);
    store.ensureInterlinear('KJV:43:3', fetchRows);
    store.ensureInterlinear('KJV:43:3', fetchRows);
    expect(fetchRows).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(store.getInterlinear('KJV:43:3')).toHaveLength(1));
    expect(listener).toHaveBeenCalled();
    store.ensureInterlinear('KJV:43:3', fetchRows);
    expect(fetchRows).toHaveBeenCalledTimes(1);
  });

  it('caches an empty result when the fetch fails (word rules only, no retry loop)', async () => {
    const { store } = make();
    const fetchRows = vi.fn().mockRejectedValue(new Error('offline'));
    store.ensureInterlinear('K:1:1', fetchRows);
    await vi.waitFor(() => expect(store.getInterlinear('K:1:1')).toEqual([]));
    store.ensureInterlinear('K:1:1', fetchRows);
    expect(fetchRows).toHaveBeenCalledTimes(1);
  });

  it('a Strong\'s mark needs interlinear, then matches once the rows are cached', async () => {
    const { store } = make();
    await store.addMarkFromWord('bible', { text: 'loved', strongs: 'G25' }, 'strongs');
    const before = store.getChapterMarks('bible', ctx())!;
    expect(before.result.needsInterlinear).toBe(true);
    expect(store.wantsInterlinear(before)).toBe(true);
    store.seedInterlinear('KJV:43:3', rows);
    const after = store.getChapterMarks('bible', ctx())!;
    expect(after).not.toBe(before);
    expect(after.result.needsInterlinear).toBe(false);
    expect(after.legend.find((r) => r.label === 'loved (G25)')?.hits).toBe(1);
  });

  it('caller-supplied rows (Study) win over the cache', async () => {
    const { store } = make();
    await store.addMarkFromWord('bible', { text: 'loved', strongs: 'G25' }, 'strongs');
    const marks = store.getChapterMarks('bible', {
      ...ctx(), interlinear: [{ verseId: 43003016, start: 2, end: 3, strongs: 'G25' }],
    })!;
    expect(marks.result.needsInterlinear).toBe(false);
  });
});

describe('KeywordMarkStore mark editing', () => {
  it('saves a new mark to My keywords, edits it, and deletes it', async () => {
    const { store } = make();
    const mark = {
      id: 'mk-1', label: 'grace', rule: { kind: 'word' as const, forms: ['grace'] },
      style: { color: 'mark.3' as const, line: 'solid' as const }, enabled: true,
    };
    await store.saveMark('bible', mark);
    expect(store.findMark('mk-1')?.set.name).toBe('My keywords');
    expect(store.isEnabled('bible')).toBe(true);
    await store.saveMark('bible', { ...mark, label: 'grace!' });
    expect(store.findMark('mk-1')?.mark.label).toBe('grace!');
    await store.deleteMark('mk-1');
    expect(store.findMark('mk-1')).toBeUndefined();
  });

  it('refuses to edit or delete a built-in mark', async () => {
    const { store } = make();
    const builtin = store.sets.find((s) => s.builtIn)!;
    const mark = builtin.marks[0];
    await expect(store.saveMark('bible', { ...mark, label: 'x' })).rejects.toThrow();
    await store.deleteMark(mark.id);
    expect(store.findMark(mark.id)).toBeDefined();
  });
});
