/**
 * Keyword marks and weights/measures paint together (task 0127): each module builds its own
 * layer; the host's `resolveChapterLayers` merges them per verse. These are the cases the
 * old `mergeChapterDecorations` covered, now through the host function the reader uses.
 */
import { describe, it, expect } from 'vitest';
import type { KeywordSet, MeasureOccurrence } from '@bible/core/browser';
import type { VerseData } from '../types';
import { resolveChapterLayers } from '../host/chapterLayers';
import { buildChapterInput, computeChapterMarks } from './keyword-marks/chapterMarks';
import { computeWebChapterMeasures, measureVerseInputs, webMeasurePreferences } from './measures/chapterMeasures';

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
const ARK: KeywordSet = {
  schema: 1, id: 's1', name: 'S', scope: { kind: 'everywhere' }, updatedAt: '2026-01-01T00:00:00Z',
  marks: [{ id: 'm1', label: 'ark', rule: { kind: 'word', forms: ['ark'] }, style: { color: 'mark.1', line: 'solid' }, enabled: true }],
};
const prefs = webMeasurePreferences({ measuresDisplay: 'marker' }, 'en-US', false);

describe('resolveChapterLayers with the keyword and measure layers', () => {
  const measures = computeWebChapterMeasures({
    occurrences: [OCC], verses: VERSES, moduleLanguage: 'en', uiLocale: 'en-US', prefs, surface: 'standard',
  });
  const marks = computeChapterMarks(buildChapterInput(1, 'en', VERSES), [ARK], { colorSafe: true, hiddenMarkIds: new Set() });
  const keywordOnly = resolveChapterLayers(VERSES, [marks.layer], 'standard');

  it('without measure paint, the keyword paint is exactly what it was alone', () => {
    expect(resolveChapterLayers(VERSES, [marks.layer, undefined], 'standard')).toEqual(keywordOnly);
    expect(resolveChapterLayers(VERSES, [marks.layer, null], 'standard')).toEqual(keywordOnly);
  });

  it('one verse carries keyword and measure paint together', () => {
    const merged = resolveChapterLayers(VERSES, [marks.layer, measures.layer], 'standard');
    const r = merged.get(VERSES[0].verse_id)!;
    const kw = keywordOnly.get(VERSES[0].verse_id)!;
    const only = resolveChapterLayers(VERSES, [measures.layer], 'standard').get(VERSES[0].verse_id)!;
    const words = measureVerseInputs(VERSES)[0].words;
    const ark = words.findIndex((w) => /^ark$/i.test(w.text));
    const cubits = words.findIndex((w) => /cubits/i.test(w.text));
    expect(r.words.get(ark)).toEqual(kw.words.get(ark));
    expect(r.words.get(cubits)).toEqual(only.words.get(cubits));
    expect(r.words.size).toBeGreaterThan(kw.words.size);
  });

  it('measures alone still resolve', () => {
    const merged = resolveChapterLayers(VERSES, [null, measures.layer], 'standard');
    expect(merged.get(VERSES[0].verse_id)?.words.size).toBeGreaterThan(0);
  });
});
