import { describe, it, expect } from 'vitest';
import { matchKeywordMarks, toDecorationLayer, type KeywordSet, type LayerDecorations } from '@bible/core/browser';
import type { InterlinearWordData, VerseData } from '../types';
import { interlinearToSpans, resolveChapterLayers, verseWordTexts } from './chapterLayers';

function verse(n: number, html: string): VerseData {
  return {
    verse_id: 43003000 + n, book_number: 43, chapter: 3, verse: n, text: html, text_html: html,
    is_paragraph_start: false, words_of_christ: false,
  };
}

describe('interlinearToSpans', () => {
  const row = (o: Partial<InterlinearWordData>): InterlinearWordData => ({
    verseId: 1, position: 2, positionEnd: 3, originalWord: '', transliteration: '', strongsNumber: 'strong:G25',
    morphology: '', language: 'greek', gloss: '', ...o,
  });
  it('normalises Strong\'s numbers and keeps spans', () => {
    expect(interlinearToSpans([row({})])).toEqual([{ verseId: 1, start: 2, end: 3, strongs: 'G25' }]);
  });
  it('drops rows without an end position or a Strong\'s number', () => {
    expect(interlinearToSpans([row({ positionEnd: undefined }), row({ strongsNumber: '' })])).toEqual([]);
    expect(interlinearToSpans(undefined)).toEqual([]);
  });
});

/** A layer that marks every occurrence of one word, built with core's matcher (what a module does). */
function layer(id: string, vs: readonly VerseData[], form: string, color: 'mark.1' | 'mark.2'): LayerDecorations {
  const set: KeywordSet = {
    schema: 1, id, name: id, scope: { kind: 'everywhere' }, updatedAt: '2026-01-01T00:00:00Z',
    marks: [{ id: `${id}-m`, label: form, rule: { kind: 'word', forms: [form] }, style: { color, line: 'solid' }, enabled: true }],
  };
  const input = { moduleId: 1, language: 'en', verses: vs.map((v) => ({ verseId: v.verse_id, words: verseWordTexts(v) })) };
  return toDecorationLayer(matchKeywordMarks(input, [set]), [set], { colorSafe: true, hiddenMarkIds: new Set() });
}

describe('resolveChapterLayers (the host merge of module layers)', () => {
  const verses = [verse(16, 'For God so loved the world'), verse(17, 'God sent not his Son')];

  it('is empty with no layers, or only empty ones', () => {
    expect(resolveChapterLayers(verses, [], 'standard').size).toBe(0);
    expect(resolveChapterLayers(verses, [null, undefined, layer('none', verses, 'zzz', 'mark.1')], 'standard').size).toBe(0);
  });

  it('paints only the verses a layer targets, keyed by word index', () => {
    const out = resolveChapterLayers(verses, [layer('a', verses, 'loved', 'mark.1')], 'standard');
    expect([...out.keys()]).toEqual([verses[0].verse_id]);
    expect(out.get(verses[0].verse_id)!.words.has(3)).toBe(true);
  });

  it('one verse carries the paint of two layers together', () => {
    const id = verses[0].verse_id;
    const both = resolveChapterLayers(verses, [layer('a', verses, 'god', 'mark.1'), layer('b', verses, 'loved', 'mark.2')], 'standard').get(id)!;
    expect(both.words.has(1)).toBe(true);
    expect(both.words.has(3)).toBe(true);
  });

  it('verseWordTexts uses the shared word index space', () => {
    expect(verseWordTexts(verses[0]).map((w) => w.text).slice(0, 3)).toEqual(['For', 'God', 'so']);
  });
});
