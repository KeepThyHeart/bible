import { describe, it, expect } from 'vitest';
import { extractWordsWithFormatting } from '../Services/WordIndexing';
import { resolveVerseDecorations } from '../Annotations/DecorationResolver';
import { resolveThemeColor } from '../Annotations/ThemeColorResolver';
import {
  BUILT_IN_KEYWORD_SETS, KeywordSetService, MemoryKeywordSetStore, StorageKeywordSetStore, exportKeywordSet,
  importKeywordSet, isValidationErrors, matchKeywordMarks, nextFreeColor, normalizeStrongs, occurrencesOf,
  suggestKeywords, toDecorationLayer, validateKeywordSet,
  type ChapterInput, type KeywordSet,
} from './index';

const ROM = 45005000;
const verse = (n: number, html: string) => ({ verseId: ROM + n, words: extractWordsWithFormatting(html) });

const KJV: ChapterInput = {
  moduleId: 1, language: 'en',
  verses: [
    verse(1, 'Therefore being justified by faith, we have peace with God'),
    verse(2, 'By whom also we have access by faith into this grace'),
    verse(3, 'And not only so, but we glory in tribulations also: knowing that tribulation worketh patience;'),
    verse(5, 'And hope maketh not ashamed; because the love of God is shed abroad'),
  ],
};

function set(marks: KeywordSet['marks'], extra: Partial<KeywordSet> = {}): KeywordSet {
  return { schema: 1, id: 's1', name: 'T', scope: { kind: 'everywhere' }, marks, updatedAt: '2026-01-01T00:00:00Z', ...extra };
}
const wordMark = (id: string, forms: string[], extra = {}) => ({
  id, label: id, rule: { kind: 'word' as const, forms, ...extra }, style: { color: 'mark.1' as const, line: 'solid' as const }, enabled: true,
});

describe('matchKeywordMarks', () => {
  it('matches word forms case-insensitively and ignores punctuation', () => {
    const r = matchKeywordMarks(KJV, [set([wordMark('faith', ['faith'])])]);
    expect(r.counts.get('faith')).toEqual({ hits: 2, verses: [ROM + 1, ROM + 2] });
    expect(r.byVerse.get(ROM + 1)![0]).toMatchObject({ start: 4, end: 4 });
    expect(matchKeywordMarks(KJV, [set([wordMark('g', ['GOD'], { matchCase: true })])]).counts.get('g')!.hits).toBe(0);
    expect(matchKeywordMarks(KJV, [set([wordMark('g', ['GOD'])])]).counts.get('g')!.hits).toBe(2);
  });

  it('matches phrases across consecutive tokens within a verse', () => {
    const m = { ...wordMark('p', []), rule: { kind: 'phrase' as const, text: 'we have' } };
    const r = matchKeywordMarks(KJV, [set([m])]);
    expect(r.counts.get('p')!.hits).toBe(2);
    expect(r.byVerse.get(ROM + 1)![0]).toMatchObject({ start: 5, end: 6 });
  });

  it('matches Strong\'s via interlinear rows and flags missing rows', () => {
    const m = { ...wordMark('faith', []), rule: { kind: 'strongs' as const, numbers: ['G4102'] } };
    expect(matchKeywordMarks(KJV, [set([m])]).needsInterlinear).toBe(true);
    const r = matchKeywordMarks({ ...KJV, interlinear: [{ verseId: ROM + 1, start: 4, end: 4, strongs: 'strong:G04102' }] }, [set([m])]);
    expect(r.needsInterlinear).toBe(false);
    expect(r.counts.get('faith')!.hits).toBe(1);
    expect(normalizeStrongs('G2316 h430')).toEqual(['G2316', 'H430']);
  });

  it('skips disabled marks, other-language sets and out-of-scope verses', () => {
    const off = { ...wordMark('faith', ['faith']), enabled: false };
    expect(matchKeywordMarks(KJV, [set([off])]).counts.has('faith')).toBe(false);
    expect(matchKeywordMarks(KJV, [set([wordMark('f', ['faith'])], { language: 'es' })]).counts.has('f')).toBe(false);
    expect(matchKeywordMarks(KJV, [set([wordMark('f', ['faith'])], { scope: { kind: 'books', books: [43] } })]).counts.get('f')!.hits).toBe(0);
    expect(matchKeywordMarks(KJV, [set([wordMark('f', ['faith'])], { scope: { kind: 'passage', start: ROM + 2, end: ROM + 3 } })]).counts.get('f')!.hits).toBe(1);
  });

  it('gives every built-in mark a unique id, so a second language never shares counts', () => {
    const ids = BUILT_IN_KEYWORD_SETS.flatMap((s) => s.marks.map((m) => m.id));
    expect(new Set(ids).size).toBe(ids.length);
    const r = matchKeywordMarks(KJV, [...BUILT_IN_KEYWORD_SETS]);
    expect(r.counts.has('es:contrast')).toBe(false); // the Spanish set does not apply to English text
  });

  it('marks connectives loosely without interlinear rows', () => {
    const r = matchKeywordMarks(KJV, [BUILT_IN_KEYWORD_SETS[0]]);
    expect(r.wantsInterlinear).toBe(true);
    expect(r.counts.get('en:inference')!.hits).toBe(1);
    expect(r.counts.get('en:contrast')!.hits).toBe(1);
    expect(r.counts.get('en:reason')!.hits).toBe(1); // "because"
    expect(r.byVerse.get(ROM + 1)!.every((h) => h.loose)).toBe(true);
  });

  it('anchors connectives to interlinear rows when present', () => {
    const input: ChapterInput = {
      ...KJV,
      verses: [verse(1, 'for God so loved for the world'), verse(2, 'For he is good')],
      interlinear: [
        { verseId: ROM + 1, start: 0, end: 0, strongs: 'G1063' }, // "for" = gar (reason)
        { verseId: ROM + 1, start: 4, end: 4, strongs: 'G1519' }, // "for" = eis (preposition)
      ],
    };
    const r = matchKeywordMarks(input, [BUILT_IN_KEYWORD_SETS[0]]);
    expect(r.counts.get('en:reason')!.hits).toBe(1);
    expect(r.byVerse.get(ROM + 1)![0]).toMatchObject({ start: 0 });
    expect(r.byVerse.get(ROM + 1)![0].loose).toBeUndefined();
  });

  it('lists occurrences in reading order', () => {
    const r = matchKeywordMarks(KJV, [set([wordMark('a', ['and', 'also'])])]);
    const occ = occurrencesOf(r, 'a');
    expect(occ.map((o) => o.verseId)).toEqual([...occ.map((o) => o.verseId)].sort((a, b) => a - b));
    expect(occ.length).toBe(r.counts.get('a')!.hits);
  });
});

describe('toDecorationLayer', () => {
  it('composes through resolveVerseDecorations with underline + badge and hover', () => {
    const s = set([{ ...wordMark('faith', ['faith']), style: { color: 'mark.2' as const, line: 'dashed' as const, symbol: '✚' as const } }]);
    const words = KJV.verses[0].words;
    const layer = toDecorationLayer(matchKeywordMarks(KJV, [s]), [s]);
    const resolved = resolveVerseDecorations({
      verseId: ROM + 1, wordCount: words.length, words, layers: [layer], surface: 'standard', resolveColor: resolveThemeColor,
    });
    const paint = resolved.words.get(4)!;
    expect(paint.underlines[0]).toMatchObject({ style: 'dashed', color: 'rgb(var(--theme-mark-2-rgb))' });
    expect(paint.badges[0].label).toBe('✚');
    expect(paint.hovers?.[0].content).toEqual({ kind: 'text', text: 'faith (2)' });
    expect(resolved.words.has(3)).toBe(false);
  });

  it('adds a default symbol in colour-safe mode, and honours hidden marks', () => {
    const s = set([wordMark('faith', ['faith'])]);
    const result = matchKeywordMarks(KJV, [s]);
    const safe = toDecorationLayer(result, [s], { colorSafe: true });
    expect(safe.decorations.some((d) => d.appearance.kind === 'badge')).toBe(true);
    expect(toDecorationLayer(result, [s], { colorSafe: false }).decorations.some((d) => d.appearance.kind === 'badge')).toBe(false);
    expect(toDecorationLayer(result, [s], { hiddenMarkIds: new Set(['faith']) }).decorations).toHaveLength(0);
  });

  it('draws loose connective hits dotted and chunks large target lists', () => {
    const layer = toDecorationLayer(matchKeywordMarks(KJV, [BUILT_IN_KEYWORD_SETS[0]]), [BUILT_IN_KEYWORD_SETS[0]]);
    const dotted = layer.decorations.filter((d) => d.appearance.kind === 'underline' && d.appearance.style === 'dotted');
    expect(dotted.length).toBeGreaterThan(0);
    const big: ChapterInput = { ...KJV, verses: [{ verseId: ROM + 1, words: Array.from({ length: 200 }, () => ({ text: 'go' })) }] };
    const s = set([wordMark('go', ['go'])]);
    const l = toDecorationLayer(matchKeywordMarks(big, [s]), [s], { colorSafe: false });
    expect(l.decorations.every((d) => (Array.isArray(d.target) ? d.target.length : 1) <= 64)).toBe(true);
  });
});

describe('suggestKeywords', () => {
  it('returns repeated content words and skips stopwords', () => {
    const input: ChapterInput = { moduleId: 1, language: 'en', verses: [
      verse(1, 'patience and experience and patience'), verse(2, 'the patience of the saints and the law'),
    ] };
    const out = suggestKeywords(input, { minCount: 3 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ label: 'patience', count: 3 });
  });
  it('groups by Strong\'s when rows exist', () => {
    const input: ChapterInput = { moduleId: 1, language: 'en', verses: [verse(1, 'loved loveth love'), verse(2, 'faith')],
      interlinear: [0, 1, 2].map((i) => ({ verseId: ROM + 1, start: i, end: i, strongs: 'G25' })) };
    const out = suggestKeywords(input);
    expect(out[0].rule).toEqual({ kind: 'strongs', numbers: ['G25'] });
    expect(out[0].count).toBe(3);
  });
});

describe('validation, import/export', () => {
  const good = set([wordMark('a', ['faith'])]);
  it('round-trips and rejects bad data', () => {
    expect(validateKeywordSet(JSON.parse(JSON.stringify(good)))).toMatchObject({ id: 's1' });
    expect(isValidationErrors(validateKeywordSet({ ...good, marks: [{ ...good.marks[0], style: { color: 'red', line: 'solid' } }] }))).toBe(true);
    expect(isValidationErrors(validateKeywordSet({ ...good, schema: 2 }))).toBe(true);
    expect(isValidationErrors(validateKeywordSet(null))).toBe(true);
    const back = importKeywordSet(exportKeywordSet({ ...good, builtIn: 'x' }));
    expect(isValidationErrors(back)).toBe(false);
    expect((back as KeywordSet).builtIn).toBeUndefined();
    expect(isValidationErrors(importKeywordSet('{nope'))).toBe(true);
  });
});

describe('KeywordSetService', () => {
  it('lists built-ins, saves, duplicates, imports and protects built-ins', async () => {
    const svc = new KeywordSetService(new MemoryKeywordSetStore());
    const seen: number[] = [];
    svc.subscribe((s) => seen.push(s.length));
    await svc.load();
    expect(svc.all().length).toBe(BUILT_IN_KEYWORD_SETS.length);
    const mine = await svc.create('Mine', { language: 'en', marks: [wordMark('a', ['faith'])] });
    const dup = await svc.duplicate(BUILT_IN_KEYWORD_SETS[0].id);
    expect(dup.builtIn).toBeUndefined();
    await expect(svc.save({ ...BUILT_IN_KEYWORD_SETS[0] })).rejects.toThrow(/read-only/);
    await expect(svc.remove(BUILT_IN_KEYWORD_SETS[0].id)).rejects.toThrow();
    const imported = await svc.import(svc.export(mine.id));
    expect(isValidationErrors(imported)).toBe(false);
    await svc.remove(mine.id);
    expect(svc.get(mine.id)).toBeUndefined();
    expect(seen.length).toBeGreaterThan(3);
  });

  it('persists through a storage-backed store and picks free colours', async () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    const a = new KeywordSetService(new StorageKeywordSetStore(storage));
    const s = await a.create('Persisted', { marks: [wordMark('a', ['x'])] });
    const b = new KeywordSetService(new StorageKeywordSetStore(storage));
    await b.load();
    expect(b.get(s.id)?.name).toBe('Persisted');
    expect(nextFreeColor([s])).not.toBe('mark.1');
  });
});
