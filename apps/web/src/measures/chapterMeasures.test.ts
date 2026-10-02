import { describe, it, expect } from 'vitest';
import type { KeywordSet, MeasureOccurrence } from '@bible/core/browser';
import type { VerseData } from '../types';
import { buildChapterInput, computeChapterMarks, resolveChapterDecorations } from '../keywordMarks/chapterMarks';
import {
  computeWebChapterMeasures, mergeChapterDecorations, webMeasurePreferences, wordAddress, measureVerseInputs,
} from './chapterMeasures';

function verse(n: number, html: string): VerseData {
  return {
    verse_id: 1006015000 + n, book_number: 1, chapter: 6, verse: n, text: html, text_html: html,
    is_paragraph_start: false, words_of_christ: false,
  };
}
const VERSES = [verse(15, 'The length of the ark shall be three hundred cubits, the breadth of it fifty cubits')];

const OCC: MeasureOccurrence = {
  id: '1006015015.1', verseId: 1006015015, parts: [{ unit: 'cubit', quantity: { value: 300 } }],
  usage: 'literal', review: { status: 'approved' },
};

const GOD: KeywordSet = {
  schema: 1, id: 's1', name: 'S', scope: { kind: 'everywhere' }, updatedAt: '2026-01-01T00:00:00Z',
  marks: [{ id: 'm1', label: 'ark', rule: { kind: 'word', forms: ['ark'] }, style: { color: 'mark.1', line: 'solid' }, enabled: true }],
};

const prefs = webMeasurePreferences({ measuresDisplay: 'marker' }, 'en-US', false);

describe('webMeasurePreferences', () => {
  it('fills defaults and takes drafts from the flag argument', () => {
    expect(webMeasurePreferences({}, 'en-US', false)).toMatchObject({ enabled: true, display: 'off', showInReading: false, includeDrafts: false });
    expect(prefs).toMatchObject({ enabled: true, display: 'marker', showInReading: false, includeDrafts: false });
    expect(webMeasurePreferences({ measuresDisplay: 'inline' }, 'en', true)).toMatchObject({ display: 'inline', includeDrafts: true });
  });
});

describe('computeWebChapterMeasures', () => {
  it('words agree with the verse word index space', () => {
    expect(measureVerseInputs(VERSES)[0].words.map((w) => w.text).slice(0, 3)).toEqual(['The', 'length', 'of']);
  });

  it('anchors "three hundred cubits" and indexes its word', () => {
    const m = computeWebChapterMeasures({
      occurrences: [OCC], verses: VERSES, moduleLanguage: 'en', uiLocale: 'en-US', prefs, surface: 'standard',
    });
    const words = measureVerseInputs(VERSES)[0].words;
    const cubitIdx = words.findIndex((w) => /cubits/i.test(w.text));
    expect(m.index.at(OCC.verseId, cubitIdx)).toEqual([OCC.id]);
    expect(m.models.get(OCC.id)?.title).toContain('300');
    expect(m.layer.decorations.length).toBeGreaterThan(0);
  });

  it('paints nothing in Reading mode unless opted in', () => {
    const base = { occurrences: [OCC], verses: VERSES, moduleLanguage: 'en', uiLocale: 'en-US', surface: 'reading' as const };
    expect(computeWebChapterMeasures({ ...base, prefs }).layer.decorations).toHaveLength(0);
    const optIn = webMeasurePreferences({ measuresDisplay: 'marker', measuresShowInReading: true }, 'en-US', false);
    expect(computeWebChapterMeasures({ ...base, prefs: optIn }).layer.decorations.length).toBeGreaterThan(0);
  });
});

describe('mergeChapterDecorations', () => {
  const measures = computeWebChapterMeasures({
    occurrences: [OCC], verses: VERSES, moduleLanguage: 'en', uiLocale: 'en-US', prefs, surface: 'standard',
  });
  const marks = computeChapterMarks(buildChapterInput(1, 'en', VERSES), [GOD], { colorSafe: true, hiddenMarkIds: new Set() });
  const keywordResolved = resolveChapterDecorations(VERSES, marks.layer, 'standard');

  it('returns the keyword map untouched when there is no measure paint', () => {
    expect(mergeChapterDecorations(VERSES, marks.layer, keywordResolved, undefined, 'standard')).toBe(keywordResolved);
    expect(mergeChapterDecorations(VERSES, marks.layer, keywordResolved, null, 'standard')).toBe(keywordResolved);
  });

  it('one verse carries keyword and measure paint together', () => {
    const merged = mergeChapterDecorations(VERSES, marks.layer, keywordResolved, measures.layer, 'standard')!;
    const r = merged.get(VERSES[0].verse_id)!;
    const kw = keywordResolved.get(VERSES[0].verse_id)!;
    const only = resolveChapterDecorations(VERSES, measures.layer, 'standard').get(VERSES[0].verse_id)!;
    const words = measureVerseInputs(VERSES)[0].words;
    const ark = words.findIndex((w) => /^ark$/i.test(w.text));
    const cubits = words.findIndex((w) => /cubits/i.test(w.text));
    expect(r.words.get(ark)).toEqual(kw.words.get(ark));
    expect(r.words.get(cubits)).toEqual(only.words.get(cubits));
    expect(r.words.size).toBeGreaterThan(kw.words.size);
  });

  it('measures alone still resolve', () => {
    const merged = mergeChapterDecorations(VERSES, null, null, measures.layer, 'standard');
    expect(merged?.get(VERSES[0].verse_id)?.words.size).toBeGreaterThan(0);
  });
});

describe('wordAddress', () => {
  it('reads verse id and word index from the DOM, null outside a verse', () => {
    document.body.innerHTML = '<div data-verse-id="42"><span class="word" data-word-index="7"><b id="in">x</b></span></div><span data-word-index="1" id="stray"></span>';
    const a = wordAddress(document.getElementById('in'));
    expect(a).toMatchObject({ verseId: 42, wordIndex: 7 });
    expect(wordAddress(document.getElementById('stray'))).toBeNull();
    expect(wordAddress(null)).toBeNull();
  });
});
