/**
 * Tests for the interlinear row → cell decision shared by the Bible pane and
 * the Study pane.
 *
 * Two things are load-bearing here:
 *
 * 1. The English always comes from the translation's own `text_html`. A row's
 *    gloss is the module's wording and may differ from it ("only born" for the
 *    KJV's "only begotten"), so it must never reach the screen as the verse.
 * 2. A response with no `positionEnd` is unusable, not "one word per row".
 *    `/api/interlinear` is HTTP-cacheable for an hour with a day of
 *    stale-while-revalidate, so a browser really can hold a pre-`positionEnd`
 *    response across a deploy — and collapsing every multi-word row onto its
 *    first token still partitions the word space, so nothing downstream would
 *    catch it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildVerseInterlinearCells,
  normalizeStrongsNumber,
  resetInterlinearWarnings,
  rowsHaveEndPositions,
  toCellRow,
} from './interlinearRows';
import type { InterlinearWordData } from '../types';

const JOHN_3_16 = 'For God so loved the world, that he gave his only begotten Son';

function row(overrides: Partial<InterlinearWordData>): InterlinearWordData {
  return {
    verseId: 43003016,
    position: 0,
    positionEnd: 0,
    originalWord: '',
    transliteration: '',
    strongsNumber: '',
    morphology: '',
    gloss: '',
    language: 'greek',
    ...overrides,
  };
}

describe('rowsHaveEndPositions', () => {
  it('accepts rows that all carry an end index', () => {
    expect(rowsHaveEndPositions([row({ position: 1, positionEnd: 2 })])).toBe(true);
  });

  it('accepts an end index equal to the start', () => {
    expect(rowsHaveEndPositions([row({ position: 3, positionEnd: 3 })])).toBe(true);
  });

  it('rejects the shape of a response cached before positionEnd existed', () => {
    expect(rowsHaveEndPositions([
      row({ position: 1, positionEnd: 1 }),
      row({ position: 2, positionEnd: undefined }),
    ])).toBe(false);
  });
});

describe('normalizeStrongsNumber', () => {
  it('strips a strong: prefix', () => {
    expect(normalizeStrongsNumber('strong:G2316')).toBe('G2316');
  });

  it('leaves a bare number alone', () => {
    expect(normalizeStrongsNumber('G2316')).toBe('G2316');
  });
});

describe('toCellRow', () => {
  it('carries the span across', () => {
    const cell = toCellRow(row({ position: 10, positionEnd: 11, gloss: 'only born' }));
    expect(cell.wordPositionStart).toBe(10);
    expect(cell.wordPositionEnd).toBe(11);
  });

  it('normalizes the Strong\'s number', () => {
    expect(toCellRow(row({ strongsNumber: 'strong:G25' })).strongsNumber).toBe('G25');
  });
});

describe('buildVerseInterlinearCells', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetInterlinearWarnings();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("renders the translation's words, not the module's glosses", () => {
    const cells = buildVerseInterlinearCells('Test', 43003016, JOHN_3_16, [
      row({ position: 10, positionEnd: 11, gloss: 'only born', originalWord: 'μονογενη' }),
    ]);
    const claimed = cells!.find(c => c.source);
    expect(claimed!.englishWords.map(w => w.displayText)).toEqual(['only', 'begotten']);
  });

  it('covers every English word exactly once', () => {
    const cells = buildVerseInterlinearCells('Test', 43003016, JOHN_3_16, [
      row({ position: 1, positionEnd: 1, gloss: 'God', originalWord: 'θεος' }),
    ]);
    const words = cells!.flatMap(c => c.englishWords.map(w => w.displayText));
    expect(words.join(' ')).toBe(JOHN_3_16);
  });

  it('demotes a null-gloss row to an extra chip rather than an English-less cell', () => {
    const cells = buildVerseInterlinearCells('Test', 43003016, JOHN_3_16, [
      row({ position: 0, positionEnd: 0, gloss: 'For', originalWord: 'γαρ', strongsNumber: 'G1063' }),
      row({ position: 0, positionEnd: 0, gloss: '', originalWord: 'ὁ', strongsNumber: 'G3588' }),
    ]);
    expect(cells!.every(c => c.englishWords.length > 0)).toBe(true);
    expect(cells![0].extraSources.map(e => e.strongsNumber)).toEqual(['G3588']);
  });

  it('refuses rows with no positionEnd, and says so', () => {
    const cells = buildVerseInterlinearCells('Test', 43003016, JOHN_3_16, [
      row({ position: 10, positionEnd: undefined, gloss: 'only born' }),
    ]);
    expect(cells).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('positionEnd'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('43003016'));
  });

  it('warns once per verse and reason, not once per render', () => {
    const rows = [row({ position: 0, positionEnd: undefined })];
    buildVerseInterlinearCells('Test', 43003016, JOHN_3_16, rows);
    buildVerseInterlinearCells('Test', 43003016, JOHN_3_16, rows);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('returns null when there are no rows', () => {
    expect(buildVerseInterlinearCells('Test', 43003016, JOHN_3_16, [])).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns null when the verse tokenises to nothing to annotate', () => {
    expect(buildVerseInterlinearCells('Test', 43003016, '', [row({})])).toBeNull();
  });
});
