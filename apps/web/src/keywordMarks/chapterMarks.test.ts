import { describe, it, expect } from 'vitest';
import type { KeywordSet } from '@bible/core/browser';
import type { InterlinearWordData, VerseData } from '../types';
import {
  buildChapterInput, computeChapterMarks, findMarkByRule, interlinearToSpans, legendRows,
  newMark, resolveChapterDecorations, ruleForPick, ruleKey,
} from './chapterMarks';

function verse(n: number, html: string): VerseData {
  return {
    verse_id: 43003000 + n, book_number: 43, chapter: 3, verse: n, text: html, text_html: html,
    is_paragraph_start: false, words_of_christ: false,
  };
}

const VERSES = [verse(16, 'For God so loved the world'), verse(17, 'God sent not his Son, but that the world might be saved')];

function set(marks: KeywordSet['marks']): KeywordSet {
  return { schema: 1, id: 's1', name: 'S', scope: { kind: 'everywhere' }, marks, updatedAt: '2026-01-01T00:00:00Z' };
}
const GOD = newMark({ kind: 'word', forms: ['god'] }, 'God', []);

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

describe('computeChapterMarks', () => {
  it('matches, layers and builds a legend for the chapter', () => {
    const input = buildChapterInput(1, 'en', VERSES);
    const marks = computeChapterMarks(input, [set([GOD])], { colorSafe: true, hiddenMarkIds: new Set() });
    expect(marks.result.counts.get(GOD.id)?.hits).toBe(2);
    expect(marks.legend).toHaveLength(1);
    expect(marks.legend[0]).toMatchObject({ label: 'God', hits: 2, hidden: false });
    expect(marks.layer.decorations.length).toBeGreaterThan(0);
  });

  it('a hidden mark stays in the legend but paints nothing', () => {
    const input = buildChapterInput(1, 'en', VERSES);
    const marks = computeChapterMarks(input, [set([GOD])], { colorSafe: true, hiddenMarkIds: new Set([GOD.id]) });
    expect(marks.legend[0].hidden).toBe(true);
    expect(marks.layer.decorations).toHaveLength(0);
  });

  it('lists nothing for a mark that never hits and orders rows by count', () => {
    const world = newMark({ kind: 'word', forms: ['world'] }, 'world', []);
    const said = newMark({ kind: 'word', forms: ['said'] }, 'said', []);
    const input = buildChapterInput(1, 'en', VERSES);
    const rows = legendRows(
      computeChapterMarks(input, [set([world, said, GOD])], { colorSafe: true, hiddenMarkIds: new Set() }).result,
      [set([world, said, GOD])], new Set(),
    );
    expect(rows.map((r) => r.label)).toEqual(['God', 'world']);
  });
});

describe('resolveChapterDecorations', () => {
  it('resolves paint only for verses that have hits, keyed by word index', () => {
    const input = buildChapterInput(1, 'en', [VERSES[0], verse(18, 'Nothing here')]);
    const marks = computeChapterMarks(input, [set([GOD])], { colorSafe: true, hiddenMarkIds: new Set() });
    const resolved = resolveChapterDecorations([VERSES[0], verse(18, 'Nothing here')], marks.layer, 'standard');
    expect([...resolved.keys()]).toEqual([43003016]);
    expect([...resolved.get(43003016)!.words.keys()]).toEqual([1]);
  });

  it('resolves colours to theme variables, so a theme switch needs no recompute', () => {
    const input = buildChapterInput(1, 'en', VERSES);
    const marks = computeChapterMarks(input, [set([GOD])], { colorSafe: true, hiddenMarkIds: new Set() });
    const paint = resolveChapterDecorations(VERSES, marks.layer, 'reading').get(43003016)!.words.get(1)!;
    expect(paint.underlines[0].color).toMatch(/^rgb\(var\(--theme-mark-\d-rgb\)/);
  });

  it('paints nothing on an empty layer', () => {
    const marks = computeChapterMarks(buildChapterInput(1, 'en', VERSES), [], { colorSafe: true, hiddenMarkIds: new Set() });
    expect(resolveChapterDecorations(VERSES, marks.layer, 'standard').size).toBe(0);
  });
});

describe('picking a word', () => {
  it('builds word, phrase and Strong\'s rules', () => {
    expect(ruleForPick({ text: 'Loved,' }, 'word')).toEqual({ kind: 'word', forms: ['loved'] });
    expect(ruleForPick({ text: 'so that' }, 'word')).toEqual({ kind: 'phrase', text: 'so that' });
    expect(ruleForPick({ text: 'loved', strongs: 'strong:g25' }, 'strongs')).toEqual({ kind: 'strongs', numbers: ['G25'] });
    expect(ruleForPick({ text: 'loved' }, 'strongs')).toBeNull();
    expect(ruleForPick({ text: '...' }, 'word')).toBeNull();
  });

  it('finds an existing mark for the same rule regardless of case', () => {
    const s = set([GOD]);
    expect(findMarkByRule([s], { kind: 'word', forms: ['GOD'] })?.id).toBe(GOD.id);
    expect(findMarkByRule([s], { kind: 'word', forms: ['lord'] })).toBeUndefined();
    expect(ruleKey({ kind: 'strongs', numbers: ['g25'] })).toBe(ruleKey({ kind: 'strongs', numbers: ['G25'] }));
  });

  it('gives a new mark the first least-used colour', () => {
    const first = newMark({ kind: 'word', forms: ['a'] }, 'a', []);
    const second = newMark({ kind: 'word', forms: ['b'] }, 'b', [set([first])]);
    expect(first.style.color).toBe('mark.1');
    expect(second.style.color).toBe('mark.2');
  });
});
