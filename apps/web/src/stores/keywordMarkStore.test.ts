import { describe, it, expect, vi } from 'vitest';
import { BUILT_IN_KEYWORD_SETS, type StringStorage } from '@bible/core/browser';
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
  return { storage, store: new KeywordMarkStore({ storage }) };
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
    const reborn = new KeywordMarkStore({ storage });
    expect(reborn.isEnabled('bible')).toBe(true);
    expect(reborn.isEnabled('other')).toBe(false);
  });

  it('survives corrupt or throwing storage', () => {
    const bad = new KeywordMarkStore({ storage: memStorage({ 'bible-keyword-marks': '{nope' }) });
    expect(bad.isEnabled('bible')).toBe(false);
    const throwing: StringStorage = {
      getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); }, removeItem: () => {},
    };
    const s = new KeywordMarkStore({ storage: throwing });
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

  it('recomputes when a mark is hidden, and lists its occurrences', () => {
    const { store } = make();
    store.togglePane('bible');
    const a = store.getChapterMarks('bible', ctx())!;
    const row = a.legend.find((r) => r.hits > 0)!;
    const markId = row.markId;
    expect(store.occurrencesOf('bible', markId)).toHaveLength(row.hits);
    store.toggleMark('bible', markId);
    const b = store.getChapterMarks('bible', ctx())!;
    expect(b).not.toBe(a);
    expect(b.layer.decorations.some((d) => (d.data as { markId?: string } | undefined)?.markId === markId)).toBe(false);
    expect(b.legend.find((r) => r.markId === markId)?.hidden).toBe(true);
  });

  it('offers only the built-in sets, and no way to create or edit custom ones', () => {
    const { store } = make();
    expect(store.sets.length).toBeGreaterThan(0);
    expect(store.sets.every((s) => s.builtIn)).toBe(true);
  });

  it('keeps the built-in sets when saved state also lists a custom set and mark from an older build', () => {
    const ids = BUILT_IN_KEYWORD_SETS.map((x) => x.id);
    const storage = memStorage({ 'bible-keyword-marks': JSON.stringify({
      panes: { bible: { enabled: true, activeSetIds: [...ids, 'old-custom'], hiddenMarkIds: ['old-mark'] } },
    }) });
    const { store } = make(storage);
    expect(store.activeSets('bible').map((x) => x.id)).toEqual(expect.arrayContaining(ids));
    expect(store.activeSets('bible').every((x) => x.builtIn)).toBe(true);
    expect(store.getChapterMarks('bible', ctx())!.legend.length).toBeGreaterThan(0);
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

  it('seeding rows (Study) recomputes the match, and caller-supplied rows win over the cache', () => {
    const { store } = make();
    store.togglePane('bible');
    const before = store.getChapterMarks('bible', ctx())!;
    store.seedInterlinear('KJV:43:3', rows);
    const after = store.getChapterMarks('bible', ctx())!;
    expect(after).not.toBe(before);
    const own = store.getChapterMarks('bible', { ...ctx(), interlinear: [] })!;
    expect(own).not.toBe(after);
  });
});
