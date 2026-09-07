/**
 * Unit tests for the interlinear cell builder.
 *
 * The invariant under test is the one the renderer relies on: the cells
 * partition the English word space exactly, so every word of the translation
 * is shown once, in the translation's own order.
 */
import { describe, it, expect } from 'vitest';
import { buildInterlinearCells, cellsPartitionWordSpace, cellStrongsNumbers, type InterlinearWord } from './interlinearCells';
import { extractWordsWithFormatting } from './wordIndexing';

const VERSE = 'For God so loved the world';

function words(html = VERSE) {
  return extractWordsWithFormatting(html);
}

function row(overrides: Partial<InterlinearWord> = {}): InterlinearWord {
  return {
    wordPositionStart: 0,
    wordPositionEnd: 0,
    originalWord: 'θεός',
    transliteration: 'theos',
    strongsNumber: 'G2316',
    gloss: 'God',
    ...overrides,
  };
}

describe('buildInterlinearCells', () => {
  it('covers every English word exactly once', () => {
    const english = words();
    const cells = buildInterlinearCells(english, [
      row({ wordPositionStart: 1, wordPositionEnd: 1 }),
    ]);
    expect(cellsPartitionWordSpace(cells, english.length)).toBe(true);
    expect(cells.flatMap(c => c.englishWords.map(w => w.text)))
      .toEqual(['For', 'God', 'so', 'loved', 'the', 'world']);
  });

  it('emits unbacked cells for words no row claims', () => {
    const english = words();
    const cells = buildInterlinearCells(english, [
      row({ wordPositionStart: 1, wordPositionEnd: 1 }),
    ]);
    // "For" before it, "so loved the world" after it
    expect(cells.map(c => c.source === null)).toEqual([true, false, true]);
  });

  it('orders cells by the English text, not by row order', () => {
    const english = words();
    const cells = buildInterlinearCells(english, [
      row({ wordPositionStart: 3, wordPositionEnd: 3, gloss: 'loved', strongsNumber: 'G25' }),
      row({ wordPositionStart: 1, wordPositionEnd: 1 }),
    ]);
    const backed = cells.filter(c => c.source);
    expect(backed.map(c => c.source?.strongsNumber)).toEqual(['G2316', 'G25']);
  });

  it('groups a multi-word gloss into one cell', () => {
    const english = words();
    const cells = buildInterlinearCells(english, [
      row({ wordPositionStart: 2, wordPositionEnd: 3, gloss: 'so loved' }),
    ]);
    const backed = cells.find(c => c.source);
    expect(backed?.englishWords.map(w => w.text)).toEqual(['so', 'loved']);
  });

  it('pins gloss-less rows to the cell owning their position as extra Strongs', () => {
    // John 3:16's spare Greek articles all sit at index 0; they must add chips,
    // not extra copies of the English word.
    const english = words();
    const cells = buildInterlinearCells(english, [
      row({ wordPositionStart: 0, wordPositionEnd: 0, gloss: 'For', strongsNumber: 'G1063' }),
      row({ wordPositionStart: 0, wordPositionEnd: 0, gloss: '', strongsNumber: 'G3588' }),
    ]);
    expect(cells[0].englishWords.map(w => w.text)).toEqual(['For']);
    expect(cellStrongsNumbers(cells[0])).toEqual(['G1063', 'G3588']);
  });

  it('demotes out-of-range rows instead of dropping their Strongs number', () => {
    const english = words();
    const cells = buildInterlinearCells(english, [
      row({ wordPositionStart: 99, wordPositionEnd: 99, strongsNumber: 'G9999' }),
    ]);
    expect(cellsPartitionWordSpace(cells, english.length)).toBe(true);
    expect(cells.flatMap(cellStrongsNumbers)).toContain('G9999');
  });

  it('falls back to claiming by position when no row has a gloss', () => {
    const english = words();
    const cells = buildInterlinearCells(english, [
      row({ wordPositionStart: 0, wordPositionEnd: 1, gloss: '', strongsNumber: 'G1' }),
      row({ wordPositionStart: 2, wordPositionEnd: 5, gloss: '', strongsNumber: 'G2' }),
    ]);
    expect(cells.map(c => c.source?.strongsNumber)).toEqual(['G1', 'G2']);
  });

  it('carries christ-words and divine-name formatting onto the tokens', () => {
    const english = words('<span class="christ-words">For God</span> so <span class="divine-name">Lord</span>');
    const cells = buildInterlinearCells(english, [row({ wordPositionStart: 1, wordPositionEnd: 1 })]);
    const tokens = cells.flatMap(c => c.englishWords);
    expect(tokens[0].isChristWords).toBe(true);
    expect(tokens[2].isChristWords).toBe(false);
    expect(tokens[3].isDivineName).toBe(true);
  });

  it('returns no cells for an empty verse', () => {
    expect(buildInterlinearCells([], [row()])).toEqual([]);
  });
});
