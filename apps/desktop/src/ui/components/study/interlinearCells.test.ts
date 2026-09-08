/**
 * Cell assembly for the interlinear view.
 *
 * All fixtures except the synthetic overlap case are taken verbatim from
 * `apps/desktop/data/modules/bible_kjv.db`, so a change in the shipped
 * data's shape shows up here rather than as a mis-painted highlight.
 *
 * The load-bearing assertion in every case is the partition postcondition:
 * the cells must cover `[0, wordCount)` contiguously, in order, exactly once.
 * That single check catches dropped words, duplicated words and off-by-ones
 * at the same time.
 */
import { describe, it, expect } from 'vitest';
import {
  buildInterlinearCells,
  cellsPartitionWordSpace,
  type InterlinearCell,
  type InterlinearWord,
} from './interlinearCells';
import { extractWordsWithFormatting, type WordInfo } from '../../utils/wordIndexing';

function words(text: string): WordInfo[] {
  return extractWordsWithFormatting(text);
}

function row(
  start: number,
  end: number,
  gloss: string | null,
  strongs = 'G0000',
  originalWord = ''
): InterlinearWord {
  return {
    wordPositionStart: start,
    wordPositionEnd: end,
    originalWord,
    strongsNumber: strongs,
    gloss: gloss ?? undefined,
  };
}

/** Every index in [0, total), in document order, as the cells lay them out. */
function renderedIndices(cells: InterlinearCell[]): number[] {
  const out: number[] = [];
  for (const cell of cells) {
    for (let i = cell.wordStart; i <= cell.wordEnd; i++) out.push(i);
  }
  return out;
}

function englishOf(cell: InterlinearCell): string[] {
  return cell.englishWords.map(w => w.displayText);
}

// ---------------------------------------------------------------------------
// John 3:16 (verse_id 43003016, word_count 25)
// ---------------------------------------------------------------------------
const JOHN_3_16 =
  'For God so loved the world, that he gave his only begotten Son, that whosoever ' +
  'believeth in him should not perish, but have everlasting life.';

const JOHN_3_16_ROWS: InterlinearWord[] = [
  row(0, 0, null, 'G3588', 'ο'),
  row(0, 0, null, 'G3588', 'τον'),
  row(0, 0, 'For', 'G1063', 'γαρ'),
  row(1, 1, 'God', 'G3588', 'ο'),
  row(2, 2, 'so', 'G3779', 'ουτως'),
  row(3, 3, 'loved', 'G25', 'ηγαπησεν'),
  row(4, 5, 'the world,', 'G3588', 'τον'),
  row(6, 6, 'that', 'G5620', 'ωστε'),
  row(7, 8, 'he gave', 'G1325', 'εδωκεν'),
  row(9, 9, 'his', 'G846', 'αυτου'),
  row(10, 11, 'only begotten', 'G3439', 'μονογενη'),
  row(12, 12, 'Son,', 'G3588', 'τον'),
  row(13, 13, 'that', 'G2443', 'ινα'),
  row(14, 14, 'whosoever', 'G3956', 'πας'),
  row(15, 15, 'believeth', 'G4100', 'πιστευων'),
  row(16, 16, 'in', 'G1519', 'εις'),
  row(17, 17, 'him', 'G846', 'αυτον'),
  row(18, 18, 'should', 'G622', 'αποληται'),
  row(19, 19, 'not', 'G3361', 'μη'),
  row(20, 20, 'perish,', 'G622', 'αποληται'),
  row(21, 21, 'but', 'G235', 'αλλ'),
  row(22, 22, 'have', 'G2192', 'εχη'),
  row(23, 23, 'everlasting', 'G166', 'αιωνιον'),
  row(24, 24, 'life.', 'G2222', 'ζωην'),
];

describe('buildInterlinearCells — John 3:16 (KJV)', () => {
  const english = words(JOHN_3_16);
  const cells = buildInterlinearCells(english, JOHN_3_16_ROWS);

  it('has 25 English tokens to begin with', () => {
    expect(english.length).toBe(25);
  });

  it('partitions indices 0..24 contiguously and completely', () => {
    expect(cellsPartitionWordSpace(cells, 25)).toBe(true);
    expect(renderedIndices(cells)).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });

  it('collapses the three [0,0] rows into one cell holding only "For"', () => {
    const first = cells[0];
    expect(englishOf(first)).toEqual(['For']);
    expect(first.source?.strongsNumber).toBe('G1063');
    expect(first.extraSources.length).toBe(2);
    expect(first.extraSources.map(r => r.originalWord)).toEqual(['ο', 'τον']);
  });

  it('splits the [4,5] "the world," cell into two individually indexed tokens', () => {
    const cell = cells.find(c => c.wordStart === 4);
    expect(cell).toBeDefined();
    expect(cell!.wordEnd).toBe(5);
    expect(englishOf(cell!)).toEqual(['the', 'world,']);
    expect(cell!.source?.strongsNumber).toBe('G3588');
  });

  it('backs every cell with an interlinear row (John 3:16 is fully covered)', () => {
    expect(cells.every(c => c.source !== null)).toBe(true);
    // 24 rows, 2 of which carry no gloss and become extra sources on cell 0.
    expect(cells.length).toBe(22);
  });

  it('reproduces each gloss from the English tokens it claims', () => {
    // The invariant the whole design rests on, asserted on real data.
    for (const cell of cells) {
      if (!cell.source?.gloss) continue;
      expect(englishOf(cell).join(' ')).toBe(cell.source.gloss);
    }
  });
});

// ---------------------------------------------------------------------------
// Genesis 1:9 (verse_id 1001009, word_count 25). Interlinear stops at index 20
// and skips index 19 ("land", a `supplied` word).
// ---------------------------------------------------------------------------
const GEN_1_9 =
  'And God said, Let the waters under the heaven be gathered together unto one ' +
  'place, and let the dry land appear: and it was so.';

const GEN_1_9_ROWS: InterlinearWord[] = [
  row(0, 1, 'And God', 'H0430'),
  row(2, 2, 'said,', 'H0559'),
  row(3, 5, 'Let the waters', 'H04325'),
  row(6, 8, 'under the heaven', 'H08064'),
  row(9, 11, 'be gathered together', 'H06960'),
  row(12, 12, 'unto', 'H0413'),
  row(13, 13, 'one', 'H0259'),
  row(14, 14, 'place,', 'H04725'),
  row(15, 18, 'and let the dry', 'H03004'),
  row(20, 20, 'appear:', 'H07200'),
];

describe('buildInterlinearCells — Genesis 1:9 (unclaimed gap and tail)', () => {
  const english = words(GEN_1_9);
  const cells = buildInterlinearCells(english, GEN_1_9_ROWS);

  it('has 25 English tokens', () => {
    expect(english.length).toBe(25);
  });

  it('partitions indices 0..24 even though 10 rows cover only 20 of them', () => {
    expect(cellsPartitionWordSpace(cells, 25)).toBe(true);
    expect(renderedIndices(cells)).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });

  it('renders the skipped supplied word "land" in its own unbacked cell', () => {
    const gap = cells.find(c => c.wordStart === 19);
    expect(gap).toBeDefined();
    expect(gap!.wordEnd).toBe(19);
    expect(gap!.source).toBeNull();
    expect(englishOf(gap!)).toEqual(['land']);
  });

  it('renders the trailing "and it was so." the old view dropped entirely', () => {
    const tail = cells[cells.length - 1];
    expect(tail.wordStart).toBe(21);
    expect(tail.wordEnd).toBe(24);
    expect(tail.source).toBeNull();
    expect(englishOf(tail)).toEqual(['and', 'it', 'was', 'so.']);
  });
});

// ---------------------------------------------------------------------------
// Genesis 1:2 (verse_id 1001002, word_count 29). Gap at index 10 ("was",
// a `supplied` word).
// ---------------------------------------------------------------------------
const GEN_1_2 =
  'And the earth was without form and void; and darkness was upon the face of the ' +
  'deep. And the Spirit of God moved upon the face of the waters.';

const GEN_1_2_ROWS: InterlinearWord[] = [
  row(0, 2, 'And the earth', 'H0776'),
  row(3, 3, 'was', 'H01961'),
  row(4, 5, 'without form', 'H08414'),
  row(6, 7, 'and void;', 'H0922'),
  row(8, 9, 'and darkness', 'H02822'),
  row(11, 13, 'upon the face', 'H06440'),
  row(14, 16, 'of the deep.', 'H08415'),
  row(17, 19, 'And the Spirit', 'H07307'),
  row(20, 21, 'of God', 'H0430'),
  row(22, 22, 'moved', 'H07363'),
  row(23, 23, 'upon', 'H05921'),
  row(24, 25, 'the face', 'H06440'),
  row(26, 28, 'of the waters.', 'H04325'),
];

describe('buildInterlinearCells — Genesis 1:2 (interior gap)', () => {
  const english = words(GEN_1_2);
  const cells = buildInterlinearCells(english, GEN_1_2_ROWS);

  it('has 29 English tokens', () => {
    expect(english.length).toBe(29);
  });

  it('partitions indices 0..28', () => {
    expect(cellsPartitionWordSpace(cells, 29)).toBe(true);
    expect(renderedIndices(cells)).toEqual(Array.from({ length: 29 }, (_, i) => i));
  });

  it('renders the supplied word at index 10 in an unbacked cell', () => {
    const gap = cells.find(c => c.wordStart === 10);
    expect(gap).toBeDefined();
    expect(gap!.source).toBeNull();
    expect(englishOf(gap!)).toEqual(['was']);
  });
});

// ---------------------------------------------------------------------------
// Defensive cases
// ---------------------------------------------------------------------------
describe('buildInterlinearCells — degenerate and hostile inputs', () => {
  it('never double-claims an index when rows overlap (ASV/Darby shape)', () => {
    const english = words('one two three four five six');
    const cells = buildInterlinearCells(english, [
      row(0, 2, 'one two three', 'H1'),
      row(1, 3, 'two three four', 'H2'), // overlaps the first
      row(4, 5, 'five six', 'H3'),
    ]);

    expect(cellsPartitionWordSpace(cells, 6)).toBe(true);
    expect(renderedIndices(cells)).toEqual([0, 1, 2, 3, 4, 5]);
    // First row wins [0..2]; the overlapping row is trimmed to [3..3].
    expect(cells[0].source?.strongsNumber).toBe('H1');
    expect(cells[1].wordStart).toBe(3);
    expect(cells[1].source?.strongsNumber).toBe('H2');
    expect(englishOf(cells[1])).toEqual(['four']);
  });

  it('demotes a row fully swallowed by an earlier one to an extra source', () => {
    const english = words('one two three');
    const cells = buildInterlinearCells(english, [
      row(0, 2, 'one two three', 'H1'),
      row(1, 2, 'two three', 'H2'),
    ]);

    expect(cellsPartitionWordSpace(cells, 3)).toBe(true);
    expect(cells.length).toBe(1);
    expect(cells[0].extraSources.map(r => r.strongsNumber)).toEqual(['H2']);
  });

  it('demotes an out-of-range row rather than rendering past the verse', () => {
    const english = words('one two');
    const cells = buildInterlinearCells(english, [
      row(0, 0, 'one', 'H1'),
      row(1, 9, 'two and then some', 'H2'),
    ]);

    expect(cellsPartitionWordSpace(cells, 2)).toBe(true);
    expect(renderedIndices(cells)).toEqual([0, 1]);
    // Its Strong's number stays reachable instead of vanishing.
    const withExtra = cells.find(c => c.extraSources.length > 0);
    expect(withExtra?.extraSources[0].strongsNumber).toBe('H2');
  });

  it('renders the whole verse as one unbacked cell when there are no rows', () => {
    const english = words('one two three');
    const cells = buildInterlinearCells(english, []);
    expect(cellsPartitionWordSpace(cells, 3)).toBe(true);
    expect(cells.length).toBe(1);
    expect(cells[0].source).toBeNull();
    expect(englishOf(cells[0])).toEqual(['one', 'two', 'three']);
  });

  it('lets rows claim by position when the module ships no glosses at all', () => {
    const english = words('alpha beta gamma');
    const cells = buildInterlinearCells(english, [
      row(0, 0, null, 'H1'),
      row(1, 2, null, 'H2'),
    ]);
    expect(cellsPartitionWordSpace(cells, 3)).toBe(true);
    expect(cells.map(c => c.source?.strongsNumber)).toEqual(['H1', 'H2']);
  });

  it('returns no cells for an empty verse', () => {
    expect(buildInterlinearCells([], [row(0, 0, 'x')])).toEqual([]);
  });

  it('carries the christ-words flag through onto the cell tokens', () => {
    const english = words('<span class="christ-words">I am</span> he');
    const cells = buildInterlinearCells(english, [row(0, 1, 'I am', 'G1473')]);
    expect(cells[0].englishWords.map(w => w.isChristWords)).toEqual([true, true]);
    expect(cells[1].englishWords.map(w => w.isChristWords)).toEqual([false]);
  });
});

describe('cellsPartitionWordSpace', () => {
  const token: WordInfo = {
    text: 'x',
    displayText: 'x',
    isChristWords: false,
    isDivineName: false,
    hasTrailingSpace: false,
  };

  it('rejects a gap', () => {
    expect(
      cellsPartitionWordSpace(
        [{ wordStart: 0, wordEnd: 0, englishWords: [token], source: null, extraSources: [] }],
        2
      )
    ).toBe(false);
  });

  it('rejects an overlap', () => {
    expect(
      cellsPartitionWordSpace(
        [
          { wordStart: 0, wordEnd: 1, englishWords: [token, token], source: null, extraSources: [] },
          { wordStart: 1, wordEnd: 1, englishWords: [token], source: null, extraSources: [] },
        ],
        2
      )
    ).toBe(false);
  });

  it('rejects a cell whose token count disagrees with its range', () => {
    expect(
      cellsPartitionWordSpace(
        [{ wordStart: 0, wordEnd: 1, englishWords: [token], source: null, extraSources: [] }],
        2
      )
    ).toBe(false);
  });
});
