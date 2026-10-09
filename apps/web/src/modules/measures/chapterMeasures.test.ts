import { describe, it, expect } from 'vitest';
import type { MeasureOccurrence } from '@bible/core/browser';
import type { VerseData } from '../../types';
import {
  computeWebChapterMeasures, webMeasurePreferences, wordAddress, measureVerseInputs,
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

describe('wordAddress', () => {
  it('reads verse id and word index from the DOM, null outside a verse', () => {
    document.body.innerHTML = '<div data-verse-id="42"><span class="word" data-word-index="7"><b id="in">x</b></span></div><span data-word-index="1" id="stray"></span>';
    const a = wordAddress(document.getElementById('in'));
    expect(a).toMatchObject({ verseId: 42, wordIndex: 7 });
    expect(wordAddress(document.getElementById('stray'))).toBeNull();
    expect(wordAddress(null)).toBeNull();
  });
});
