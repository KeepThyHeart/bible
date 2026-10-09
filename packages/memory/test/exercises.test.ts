/**
 * Exercise-logic tests.
 *
 * The fixtures are real KJV verses rather than `['a','b','c']`, because every
 * bug this code can have is a bug about real text: punctuation welded to
 * words, poetry split across lines at different indents, archaic function
 * words, a possessive apostrophe. A synthetic fixture passes happily while the
 * feature is broken for Psalm 1.
 *
 * Word offsets in the `lines` below are 0-based and INCLUSIVE at both ends,
 * matching `PoetryLine` in @bible/core, which is the convention `Line` in
 * `src/types.ts` inherits.
 */

import { describe, it, expect } from 'vitest';
import type { VerseText } from '../src/core/types';
import { normalizeWord, wordsMatch, stripEdgePunctuation } from '../src/core/exercises/normalize';
import {
  buildCandidates,
  gradeOrdering,
  preview,
  emptyTally,
  recordStepAttempt,
  tallyScore,
  PREVIEW_MAX_WORDS,
} from '../src/core/exercises/ordering';
import {
  selectBlanks,
  gradeBlanks,
  MAX_BLANK_RUN,
  MIN_BLANK_FRACTION,
  MAX_BLANK_FRACTION,
} from '../src/core/exercises/blanks';
import { initials, gradeFirstLetters } from '../src/core/exercises/firstLetters';
import { mulberry32 } from '../src/core/exercises/rng';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const words = (text: string): string[] => text.split(' ');

/**
 * Psalm 1:1, KJV. 28 words over three poetic lines at three different indent
 * levels - the shape the design cites as the reason `Line.level` exists.
 */
const PSALM_1_1: VerseText = {
  verseId: 19001001,
  label: '1:1',
  words: words(
    'Blessed is the man that walketh not in the counsel of the ungodly, ' +
      'nor standeth in the way of sinners, nor sitteth in the seat of the scornful.',
  ),
  lines: [
    { start: 0, end: 12, level: 1 },
    { start: 13, end: 19, level: 2 },
    { start: 20, end: 27, level: 3 },
  ],
  psalmTitle: null,
  paragraphStart: true,
};

/**
 * Psalm 24:7, KJV. 23 words over FOUR short lines - the case where the
 * three-line cut fires before the 25-word cap does.
 */
const PSALM_24_7: VerseText = {
  verseId: 19024007,
  label: '24:7',
  words: words(
    'Lift up your heads, O ye gates; and be ye lift up, ye everlasting doors; ' +
      'and the King of glory shall come in.',
  ),
  lines: [
    { start: 0, end: 6, level: 1 },
    { start: 7, end: 11, level: 2 },
    { start: 12, end: 14, level: 1 },
    { start: 15, end: 22, level: 2 },
  ],
  psalmTitle: null,
  paragraphStart: false,
};

/** John 3:16, KJV. Prose, and exactly 25 words - the cap's boundary. */
const JOHN_3_16: VerseText = {
  verseId: 43003016,
  label: '3:16',
  words: words(
    'For God so loved the world, that he gave his only begotten Son, ' +
      'that whosoever believeth in him should not perish, but have everlasting life.',
  ),
  lines: null,
  psalmTitle: null,
  paragraphStart: true,
};

/** John 11:35. Two words. Nothing to truncate. */
const JOHN_11_35: VerseText = {
  verseId: 43011035,
  label: '11:35',
  words: words('Jesus wept.'),
  lines: null,
  psalmTitle: null,
  paragraphStart: false,
};

/** Psalm 23:3, KJV - carries the possessive `name's`. */
const PSALM_23_3: VerseText = {
  verseId: 19023003,
  label: '23:3',
  words: words(
    "He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake.",
  ),
  lines: null,
  psalmTitle: null,
  paragraphStart: false,
};

/** John 3:17 and 3:18, so the picker has real same-passage distractors. */
const JOHN_3_17: VerseText = {
  verseId: 43003017,
  label: '3:17',
  words: words(
    'For God sent not his Son into the world to condemn the world; ' +
      'but that the world through him might be saved.',
  ),
  lines: null,
  psalmTitle: null,
  paragraphStart: false,
};

const JOHN_3_18: VerseText = {
  verseId: 43003018,
  label: '3:18',
  words: words(
    'He that believeth on him is not condemned: but he that believeth not is ' +
      'condemned already, because he hath not believed in the name of the only ' +
      'begotten Son of God.',
  ),
  lines: null,
  psalmTitle: null,
  paragraphStart: false,
};

const JOHN_3_PASSAGE = [JOHN_3_16, JOHN_3_17, JOHN_3_18];

// ---------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------

describe('wordsMatch - punctuation', () => {
  it('accepts a word typed without the punctuation welded to the token', () => {
    // These are the literal tokens a whitespace split produces from the KJV.
    expect(wordsMatch('ungodly', 'ungodly,')).toBe(true);
    expect(wordsMatch('scornful', 'scornful.')).toBe(true);
    expect(wordsMatch('gates', 'gates;')).toBe(true);
    expect(wordsMatch('soul', 'soul:')).toBe(true);
    expect(wordsMatch('world', 'world?')).toBe(true);
    expect(wordsMatch('Behold', 'Behold!')).toBe(true);
  });

  it('accepts the punctuation being typed as well', () => {
    expect(wordsMatch('ungodly,', 'ungodly,')).toBe(true);
    expect(wordsMatch('ungodly.', 'ungodly,')).toBe(true);
  });

  it('ignores quotation marks around a word', () => {
    expect(wordsMatch('"Go"', 'Go')).toBe(true);
    expect(wordsMatch('Go', '"Go')).toBe(true);
    expect(wordsMatch('(Selah)', 'Selah')).toBe(true);
  });

  it('folds curly quotes and the several dashes to their ASCII forms', () => {
    expect(wordsMatch('“world”', 'world')).toBe(true);
    expect(wordsMatch('word', 'word—')).toBe(true); // em dash
    expect(wordsMatch('word', 'word–')).toBe(true); // en dash
  });

  it('ignores whitespace, including the invisible kinds', () => {
    // Written as code points rather than literals: a no-break space and a soft
    // hyphen are indistinguishable from a space and from nothing in an editor,
    // so a literal here is one careless reformat away from asserting nothing.
    const NBSP = String.fromCharCode(0x00a0);
    const SOFT_HYPHEN = String.fromCharCode(0x00ad);

    expect(wordsMatch('  the  ', 'the')).toBe(true);
    expect(wordsMatch(NBSP + 'the' + NBSP, 'the')).toBe(true);
    expect(wordsMatch('the' + String.fromCharCode(0x09), 'the')).toBe(true);
    // A soft hyphen renders as nothing at all, so a user cannot know to type it.
    expect(wordsMatch('everlasting', 'ever' + SOFT_HYPHEN + 'lasting')).toBe(true);
    // ...and it must not be quietly deciding the answer either way.
    expect(wordsMatch('everlasting', 'ever' + SOFT_HYPHEN + 'la')).toBe(false);
  });
});

describe('wordsMatch - case', () => {
  it('is case-insensitive, including for the divine name', () => {
    // Small-caps LORD is typography, not spelling, and no keyboard produces it.
    expect(wordsMatch('lord', 'LORD')).toBe(true);
    expect(wordsMatch('LORD', 'Lord')).toBe(true);
    expect(wordsMatch('BLESSED', 'Blessed')).toBe(true);
  });
});

describe('wordsMatch - apostrophes', () => {
  it('treats an internal apostrophe as meaningful', () => {
    // The documented strictness: dropping the apostrophe would merge a
    // possessive with a plural and mark a real recall failure correct.
    expect(wordsMatch("name's", "name's")).toBe(true);
    expect(wordsMatch('names', "name's")).toBe(false);
    expect(wordsMatch("LORD's", "LORD's")).toBe(true);
    expect(wordsMatch('LORDs', "LORD's")).toBe(false);
  });

  it('round-trips a possessive through case and a typographic apostrophe', () => {
    expect(wordsMatch("NAME'S", "name's")).toBe(true);
    expect(wordsMatch('name’s', "name's")).toBe(true);
    expect(wordsMatch("name's", 'name’s')).toBe(true);
    // And through the real verse token, which also carries a full stop.
    const token = PSALM_23_3.words[14];
    expect(token).toBe("name's");
    expect(wordsMatch('Name’s', token)).toBe(true);
  });

  it('strips an apostrophe at either edge, symmetrically', () => {
    // Documented leniency: a trailing apostrophe is far more often a closing
    // quote than a plural possessive, and the token cannot tell us which.
    expect(wordsMatch('sons', "sons'")).toBe(true);
    expect(wordsMatch("'tis", 'tis')).toBe(true);
    expect(wordsMatch('tis', "'tis")).toBe(true);
  });
});

describe('wordsMatch - what stays significant', () => {
  it('keeps an internal hyphen', () => {
    expect(wordsMatch('beer-sheba', 'Beer-sheba')).toBe(true);
    expect(wordsMatch('Beersheba', 'Beer-sheba')).toBe(false);
  });

  it('never accepts an empty answer for a real word', () => {
    expect(wordsMatch('', 'God')).toBe(false);
    expect(wordsMatch('   ', 'God')).toBe(false);
    expect(wordsMatch(',', 'God')).toBe(false);
  });

  it('does not accept a different word', () => {
    expect(wordsMatch('ungodly', 'godly')).toBe(false);
    expect(wordsMatch('in', 'into')).toBe(false);
    expect(wordsMatch('and', 'nor')).toBe(false);
  });
});

describe('normalizeWord', () => {
  it('produces the canonical comparison form', () => {
    expect(normalizeWord('"Ungodly,"')).toBe('ungodly');
    expect(normalizeWord('  scornful.  ')).toBe('scornful');
    expect(normalizeWord("name’s")).toBe("name's");
    expect(normalizeWord('--')).toBe('');
  });

  it('preserves case in stripEdgePunctuation, which is the display form', () => {
    expect(stripEdgePunctuation('"Blessed')).toBe('Blessed');
    expect(stripEdgePunctuation('scornful.')).toBe('scornful');
  });
});

// ---------------------------------------------------------------------------
// ordering - preview
// ---------------------------------------------------------------------------

describe('preview', () => {
  it('cuts a three-line poetic verse at the word cap, not the line cap', () => {
    // Psalm 1:1 has exactly three lines, so the line rule cannot fire; the
    // 25-word cap is what truncates its 28 words.
    const result = preview(PSALM_1_1);
    const previewWords = result.preview.split(' ');
    expect(previewWords).toHaveLength(PREVIEW_MAX_WORDS);
    expect(result.preview.startsWith('Blessed is the man that walketh not')).toBe(true);
    expect(previewWords[previewWords.length - 1]).toBe('seat');
    expect(result.truncated).toBe(true);
  });

  it('cuts a four-line poetic verse at the end of the third line', () => {
    // Three lines is 15 words here, well under the 25-word cap, so the line
    // rule is what fires - and it lands on a line boundary, not mid-phrase.
    const result = preview(PSALM_24_7);
    expect(result.preview).toBe(
      'Lift up your heads, O ye gates; and be ye lift up, ye everlasting doors;',
    );
    expect(result.preview.split(' ')).toHaveLength(15);
    expect(result.truncated).toBe(true);
  });

  it('does not truncate a verse that fits exactly', () => {
    expect(JOHN_3_16.words).toHaveLength(PREVIEW_MAX_WORDS);
    const result = preview(JOHN_3_16);
    expect(result.truncated).toBe(false);
    expect(result.preview).toBe(JOHN_3_16.words.join(' '));
  });

  it('returns a short verse whole', () => {
    expect(preview(JOHN_11_35)).toEqual({ preview: 'Jesus wept.', truncated: false });
  });

  it('appends no ellipsis - truncation is a flag for the panel to render', () => {
    expect(preview(PSALM_1_1).preview).not.toContain('…');
    expect(preview(PSALM_1_1).preview.endsWith('...')).toBe(false);
  });

  it('survives a verse with no words', () => {
    const empty: VerseText = { ...JOHN_11_35, words: [], lines: null };
    expect(preview(empty)).toEqual({ preview: '', truncated: false });
  });

  it('is unchanged when no options are given - the default caps still apply', () => {
    // Guards the "defaults matching current behaviour" contract of the new
    // options argument: an omitted second argument must not silently loosen
    // the cap for every existing caller (`refmatch` included).
    expect(preview(PSALM_1_1)).toEqual(preview(PSALM_1_1, {}));
    expect(preview(PSALM_1_1).truncated).toBe(true);
  });

  it('honours a wider word cap, and no cap at all via Infinity', () => {
    const wider = preview(PSALM_1_1, { maxWords: 100 });
    expect(wider.truncated).toBe(false);
    expect(wider.preview).toBe(PSALM_1_1.words.join(' '));

    const uncapped = preview(JOHN_3_18, { maxWords: Infinity, maxLines: Infinity });
    expect(uncapped.truncated).toBe(false);
    expect(uncapped.preview).toBe(JOHN_3_18.words.join(' '));
    // JOHN_3_18 is well past the normal 25-word cap, so this only passes if
    // the option actually suppressed truncation rather than being ignored.
    expect(JOHN_3_18.words.length).toBeGreaterThan(PREVIEW_MAX_WORDS);
  });

  it('honours a tighter word cap than the default', () => {
    const tighter = preview(JOHN_3_16, { maxWords: 5 });
    expect(tighter.preview).toBe('For God so loved the');
    expect(tighter.truncated).toBe(true);
  });

  it('honours a tighter line cap than the default', () => {
    // Psalm 24:7 normally cuts at 3 lines (15 words); a 2-line cap cuts sooner.
    const tighter = preview(PSALM_24_7, { maxLines: 2 });
    expect(tighter.preview).toBe('Lift up your heads, O ye gates; and be ye lift up,');
    expect(tighter.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ordering - candidates
// ---------------------------------------------------------------------------

describe('buildCandidates', () => {
  it('includes the correct verse and draws distractors from the same passage', () => {
    const candidates = buildCandidates(JOHN_3_PASSAGE, 43003017, 3, mulberry32(7));
    expect(candidates).toHaveLength(3);
    const ids = candidates.map((c) => c.verseId);
    expect(ids).toContain(43003017);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) {
      expect(JOHN_3_PASSAGE.some((v) => v.verseId === id)).toBe(true);
    }
  });

  it('shows a real portion of each verse, not a bare reference', () => {
    const candidates = buildCandidates(JOHN_3_PASSAGE, 43003016, 3, mulberry32(7));
    const correct = candidates.find((c) => c.verseId === 43003016);
    expect(correct).toBeDefined();
    expect(correct!.preview.startsWith('For God so loved the world,')).toBe(true);
    // Nothing that looks like a reference leaked into the preview.
    for (const candidate of candidates) {
      expect(candidate.preview).not.toMatch(/^\d+:\d+$/);
      expect(candidate.preview.split(' ').length).toBeGreaterThan(5);
    }
  });

  it('is reproducible, so a re-served step is the identical step', () => {
    // This is what makes the blocking retry honest: the same candidates in the
    // same order, so the user's "not that one" mark still points at the same
    // verse.
    const a = buildCandidates(JOHN_3_PASSAGE, 43003018, 3, mulberry32(42));
    const b = buildCandidates(JOHN_3_PASSAGE, 43003018, 3, mulberry32(42));
    expect(a).toEqual(b);

    // And with the default (seeded) rng, which takes no caller state at all.
    const c = buildCandidates(JOHN_3_PASSAGE, 43003018, 3);
    const d = buildCandidates(JOHN_3_PASSAGE, 43003018, 3);
    expect(c).toEqual(d);
  });

  it('does not park the answer in the same slot every time', () => {
    const positions = new Set<number>();
    for (let seed = 1; seed <= 20; seed += 1) {
      const candidates = buildCandidates(JOHN_3_PASSAGE, 43003016, 3, mulberry32(seed));
      positions.add(candidates.findIndex((c) => c.verseId === 43003016));
    }
    expect(positions.size).toBeGreaterThan(1);
  });

  it('returns what it can when fewer verses remain than requested', () => {
    const candidates = buildCandidates([JOHN_3_18], 43003018, 4, mulberry32(1));
    expect(candidates).toHaveLength(1);
    expect(candidates[0].verseId).toBe(43003018);
  });

  it('throws when the correct verse is not among the remaining ones', () => {
    expect(() => buildCandidates(JOHN_3_PASSAGE, 99999999, 3, mulberry32(1))).toThrow(
      /not in the remaining verses/,
    );
  });

  it('passes preview options through, so the caller can ask for untruncated candidates', () => {
    // JOHN_3_18 is longer than PREVIEW_MAX_WORDS, so a plain call truncates it
    // and the full-text option must be what suppresses that - this is the
    // shape `Session.prepareStep` relies on for the ordering rung, per the
    // task that added it.
    const capped = buildCandidates(JOHN_3_PASSAGE, 43003018, 3, mulberry32(7));
    const cappedCorrect = capped.find((c) => c.verseId === 43003018)!;
    expect(cappedCorrect.truncated).toBe(true);

    const full = buildCandidates(JOHN_3_PASSAGE, 43003018, 3, mulberry32(7), {
      maxWords: Infinity,
      maxLines: Infinity,
    });
    const fullCorrect = full.find((c) => c.verseId === 43003018)!;
    expect(fullCorrect.truncated).toBe(false);
    expect(fullCorrect.preview).toBe(JOHN_3_18.words.join(' '));

    // Every candidate, not only the correct one, is untruncated.
    for (const candidate of full) expect(candidate.truncated).toBe(false);
  });

  it('keeps a 25-verse passage of untruncated candidates comfortably under the 256 KB protocol cap', () => {
    // `types.ts` documents the 256 KB panel-message cap the whole protocol is
    // built around. Asking `buildCandidates` for full, uncapped verse text
    // (as `Session.prepareStep` now does for `ordering` - see `session.ts`)
    // must not be able to blow that budget even for a long, many-verse
    // passage, since only `count` candidates (never the whole passage) are
    // ever serialized in one step. This measures the actual byte size rather
    // than eyeballing it.
    const LONG_WORD = 'begotten'; // a real, representatively long KJV word
    const longPassage: VerseText[] = Array.from({ length: 25 }, (_, i) => ({
      verseId: 43003001 + i,
      label: `3:${i + 1}`,
      // 60 words is a long verse by KJV standards (most run 15-30), so this
      // is already a pessimistic per-verse size, not a typical one.
      words: Array.from({ length: 60 }, () => LONG_WORD),
      lines: null,
      psalmTitle: null,
      paragraphStart: false,
    }));

    const candidates = buildCandidates(longPassage, 43003013, 4, mulberry32(3), {
      maxWords: Infinity,
      maxLines: Infinity,
    });
    expect(candidates.every((c) => !c.truncated)).toBe(true);

    const serializedBytes = new TextEncoder().encode(JSON.stringify(candidates)).length;
    const PANEL_MESSAGE_CAP_BYTES = 256 * 1024;
    expect(serializedBytes).toBeLessThan(PANEL_MESSAGE_CAP_BYTES);
  });
});

// ---------------------------------------------------------------------------
// ordering - blocking grade
// ---------------------------------------------------------------------------

describe('gradeOrdering', () => {
  it('blocks on a wrong pick and marks only that pick', () => {
    const result = gradeOrdering(43003018, 43003017);
    expect(result.correct).toBe(false);
    expect(result.blocking).toBe(true);
    expect(result.wrong).toEqual([43003018]);
  });

  it('does not reveal the answer on a miss', () => {
    expect(gradeOrdering(43003018, 43003017).reveal).toBeUndefined();
  });

  it('does not block on a correct pick, and reveals', () => {
    const result = gradeOrdering(43003017, 43003017);
    expect(result.correct).toBe(true);
    expect(result.blocking).toBe(false);
    expect(result.wrong).toEqual([]);
    expect(result.reveal).toEqual({ verseId: 43003017 });
  });

  it('never accumulates a wrong-list across retries of the same step', () => {
    // Drive the retry loop the way the session runner will: same step, served
    // again unchanged, until the pick is right.
    const correctId = 43003016;
    const step = buildCandidates(JOHN_3_PASSAGE, correctId, 3, mulberry32(5));
    const misses = [43003017, 43003018, 43003017];

    for (const picked of misses) {
      const result = gradeOrdering(picked, correctId);
      expect(result.blocking).toBe(true);
      // The mark is transient: exactly one entry, this submission's pick.
      expect(result.wrong).toEqual([picked]);
      expect(result.wrong).toHaveLength(1);
      // The step itself is unchanged, so the mark points where the user clicked.
      expect(buildCandidates(JOHN_3_PASSAGE, correctId, 3, mulberry32(5))).toEqual(step);
    }

    const finally_ = gradeOrdering(correctId, correctId);
    expect(finally_.correct).toBe(true);
    expect(finally_.wrong).toEqual([]);
  });
});

describe('ordering score - correct first attempts over steps', () => {
  it('gives no credit for a step that was retried', () => {
    let tally = emptyTally();
    // Step 1: right first time.
    tally = recordStepAttempt(tally, true, true);
    // Step 2: wrong first, then right on two retries.
    tally = recordStepAttempt(tally, true, false);
    tally = recordStepAttempt(tally, false, false);
    tally = recordStepAttempt(tally, false, true);
    // Step 3: right first time.
    tally = recordStepAttempt(tally, true, true);

    expect(tally).toEqual({ correctFirst: 2, stepsTaken: 3 });
    expect(tallyScore(tally)).toBeCloseTo(2 / 3, 10);
  });

  it('scores an empty attempt 0 rather than NaN', () => {
    expect(tallyScore(emptyTally())).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// blanks - selection
// ---------------------------------------------------------------------------

/** Longest run of consecutive indices in an ascending list. */
function longestRun(indices: number[]): number {
  let best = 0;
  let run = 0;
  let previous = Number.NaN;
  for (const index of indices) {
    run = index === previous + 1 ? run + 1 : 1;
    previous = index;
    if (run > best) best = run;
  }
  return best;
}

describe('selectBlanks - difficulty', () => {
  it('maps difficulty 0..1 onto the documented fraction band', () => {
    const total = PSALM_1_1.words.length; // 28, all blankable
    const easy = selectBlanks(PSALM_1_1, 0, mulberry32(3));
    const hard = selectBlanks(PSALM_1_1, 1, mulberry32(3));

    expect(easy.length).toBeGreaterThanOrEqual(1);
    expect(easy.length).toBeLessThanOrEqual(Math.round(total * MIN_BLANK_FRACTION));
    expect(hard.length).toBeLessThanOrEqual(Math.round(total * MAX_BLANK_FRACTION));
    expect(hard.length).toBeGreaterThan(easy.length);
  });

  it('always asks for at least one word, even at difficulty 0', () => {
    // A step with no blanks is a non-exercise.
    for (let seed = 1; seed <= 10; seed += 1) {
      expect(selectBlanks(JOHN_11_35, 0, mulberry32(seed)).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('clamps a difficulty outside 0..1 instead of throwing', () => {
    expect(selectBlanks(PSALM_1_1, -5, mulberry32(1))).toEqual(
      selectBlanks(PSALM_1_1, 0, mulberry32(1)),
    );
    expect(selectBlanks(PSALM_1_1, 9, mulberry32(1))).toEqual(
      selectBlanks(PSALM_1_1, 1, mulberry32(1)),
    );
    expect(selectBlanks(PSALM_1_1, Number.NaN, mulberry32(1))).toEqual(
      selectBlanks(PSALM_1_1, 0, mulberry32(1)),
    );
  });
});

describe('selectBlanks - adjacency', () => {
  it('never blanks more than two words in a row, at any difficulty', () => {
    // The rule that keeps `blanks` from collapsing into the firstletters rung.
    for (const verse of [PSALM_1_1, PSALM_24_7, JOHN_3_18, PSALM_23_3]) {
      for (let seed = 1; seed <= 30; seed += 1) {
        for (const difficulty of [0, 0.25, 0.5, 0.75, 1]) {
          const chosen = selectBlanks(verse, difficulty, mulberry32(seed));
          expect(longestRun(chosen)).toBeLessThanOrEqual(MAX_BLANK_RUN);
        }
      }
    }
  });

  it('does allow a pair, so the rung is not merely a one-word cloze', () => {
    let sawAPair = false;
    for (let seed = 1; seed <= 30 && !sawAPair; seed += 1) {
      if (longestRun(selectBlanks(PSALM_1_1, 1, mulberry32(seed))) === 2) sawAPair = true;
    }
    expect(sawAPair).toBe(true);
  });
});

describe('selectBlanks - determinism', () => {
  it('returns the same blanks for the same seed', () => {
    expect(selectBlanks(PSALM_1_1, 0.5, mulberry32(11))).toEqual(
      selectBlanks(PSALM_1_1, 0.5, mulberry32(11)),
    );
  });

  it('is stable with no rng supplied, so re-practising does not reshuffle', () => {
    // The user submits, sees what they missed, practises the same card again -
    // and gets the same gaps, which is the only way to close them.
    const first = selectBlanks(PSALM_1_1, 0.5);
    const second = selectBlanks(PSALM_1_1, 0.5);
    const third = selectBlanks(PSALM_1_1, 0.5);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('gives different verses different shapes', () => {
    const a = selectBlanks(PSALM_1_1, 0.5);
    const b = selectBlanks(PSALM_24_7, 0.5);
    expect(a).not.toEqual(b);
  });

  it('returns ascending, unique indices in range', () => {
    const chosen = selectBlanks(PSALM_1_1, 0.75, mulberry32(4));
    expect(new Set(chosen).size).toBe(chosen.length);
    expect([...chosen].sort((x, y) => x - y)).toEqual(chosen);
    for (const index of chosen) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(PSALM_1_1.words.length);
    }
  });
});

describe('selectBlanks - which words', () => {
  /** Indices of Psalm 1:1's content words, by inspection of the verse. */
  const CONTENT_INDICES = new Set([0, 3, 5, 9, 12, 14, 17, 19, 21, 24, 27]);

  it('is biased toward content words without excluding function words', () => {
    let content = 0;
    let functionWords = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      for (const index of selectBlanks(PSALM_1_1, 0.5, mulberry32(seed))) {
        if (CONTENT_INDICES.has(index)) content += 1;
        else functionWords += 1;
      }
    }
    // Content words are 11 of 28 tokens (39%) but should take the clear
    // majority of blanks - "the" and "of" are grammar, not recall.
    expect(content / (content + functionWords)).toBeGreaterThan(0.6);
    // ...and function words are rare, not banned: "nor" versus "and" is a real
    // thing to get wrong.
    expect(functionWords).toBeGreaterThan(0);
  });

  it('never blanks a token with nothing to type in it', () => {
    const withStrayToken: VerseText = {
      ...PSALM_1_1,
      verseId: 19001999,
      words: ['The', 'LORD', '--', 'is', 'good.'],
      lines: null,
    };
    for (let seed = 1; seed <= 25; seed += 1) {
      for (const difficulty of [0, 0.5, 1]) {
        expect(selectBlanks(withStrayToken, difficulty, mulberry32(seed))).not.toContain(2);
      }
    }
  });

  it('returns nothing for a verse with no words', () => {
    const empty: VerseText = { ...JOHN_11_35, words: [] };
    expect(selectBlanks(empty, 0.5)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// blanks - grading
// ---------------------------------------------------------------------------

describe('gradeBlanks', () => {
  const blanks = [9, 12, 19]; // counsel, ungodly, sinners

  it('passes a fully correct submission and is never blocking', () => {
    const result = gradeBlanks(PSALM_1_1, blanks, ['counsel', 'ungodly', 'sinners']);
    expect(result.correct).toBe(true);
    expect(result.wrong).toEqual([]);
    // Unlike the picker: the user sees what they missed and moves on.
    expect(result.blocking).toBe(false);
  });

  it('accepts the words without the punctuation welded to the token', () => {
    // verse.words[12] is literally 'ungodly,' and words[19] is 'sinners,'.
    expect(PSALM_1_1.words[12]).toBe('ungodly,');
    expect(gradeBlanks(PSALM_1_1, blanks, ['Counsel', 'UNGODLY', 'sinners.']).correct).toBe(
      true,
    );
  });

  it('reports wrong answers as indices into verse.words, not positions in typed', () => {
    const result = gradeBlanks(PSALM_1_1, blanks, ['counsel', 'godly', 'saints']);
    expect(result.correct).toBe(false);
    expect(result.wrong).toEqual([12, 19]);
    expect(result.blocking).toBe(false);
  });

  it('counts skipped and missing answers as wrong', () => {
    expect(gradeBlanks(PSALM_1_1, blanks, ['counsel', '', 'sinners']).wrong).toEqual([12]);
    // Short array: the user stopped typing.
    expect(gradeBlanks(PSALM_1_1, blanks, ['counsel']).wrong).toEqual([12, 19]);
    expect(gradeBlanks(PSALM_1_1, blanks, []).wrong).toEqual([9, 12, 19]);
  });

  it('reveals the answers in blank order so the panel can pair them up', () => {
    const result = gradeBlanks(PSALM_1_1, blanks, ['x', 'y', 'z']);
    expect(result.reveal).toEqual({ words: ['counsel', 'ungodly,', 'sinners,'] });
  });

  it('grades a possessive strictly', () => {
    // name's is index 14 in Psalm 23:3.
    expect(gradeBlanks(PSALM_23_3, [14], ["name's"]).correct).toBe(true);
    expect(gradeBlanks(PSALM_23_3, [14], ['names']).correct).toBe(false);
  });

  it('ignores a blank index outside the verse rather than failing the user', () => {
    const result = gradeBlanks(PSALM_1_1, [9, 999], ['counsel']);
    expect(result.correct).toBe(true);
    expect(result.wrong).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// firstLetters
// ---------------------------------------------------------------------------

describe('initials', () => {
  it("gives one initial per word, in the text's own capitalisation", () => {
    const cues = initials(PSALM_24_7);
    expect(cues).toHaveLength(PSALM_24_7.words.length);
    expect(cues.join('')).toBe('LuyhOygabyluyedatKogsci');
    for (const cue of cues) expect(cue.length).toBe(1);
  });

  it('takes the initial of the word, not of its leading punctuation', () => {
    const quoted: VerseText = {
      ...JOHN_11_35,
      verseId: 19001998,
      words: ['“Go', '(Selah)', '—and', '"Blessed'],
    };
    expect(initials(quoted)).toEqual(['G', 'S', 'a', 'B']);
  });

  it('yields an empty cue for a token with no word content', () => {
    const stray: VerseText = { ...JOHN_11_35, verseId: 19001997, words: ['The', '--', 'LORD'] };
    expect(initials(stray)).toEqual(['T', '', 'L']);
  });
});

describe('gradeFirstLetters', () => {
  it('requires the whole word - the initial was already given', () => {
    // A correct answer reveals the whole word; typing the cue back is not one.
    const cues = initials(JOHN_11_35);
    const result = gradeFirstLetters(JOHN_11_35, cues);
    expect(result.correct).toBe(false);
    expect(result.wrong).toEqual([0, 1]);
  });

  it('passes when every word is typed out in full', () => {
    const result = gradeFirstLetters(PSALM_24_7, PSALM_24_7.words.slice());
    expect(result.correct).toBe(true);
    expect(result.wrong).toEqual([]);
    expect(result.blocking).toBe(false);
  });

  it('applies the same punctuation and case rules as every other exercise', () => {
    const typed = PSALM_1_1.words.map((w) => w.replace(/[,.]/g, '').toUpperCase());
    expect(gradeFirstLetters(PSALM_1_1, typed).correct).toBe(true);
  });

  it('reports each missed word by its index and reveals the whole verse', () => {
    const typed = PSALM_24_7.words.slice();
    typed[13] = 'eternal'; // everlasting
    typed[17] = 'king'; // King - case is fine, so this must still pass
    typed[19] = 'gory'; // glory
    const result = gradeFirstLetters(PSALM_24_7, typed);
    expect(result.wrong).toEqual([13, 19]);
    expect(result.reveal).toEqual({ words: PSALM_24_7.words });
  });

  it('counts an abandoned recitation wrong for every remaining word', () => {
    const result = gradeFirstLetters(JOHN_11_35, ['Jesus']);
    expect(result.wrong).toEqual([1]);
  });

  it('has no tiers: no staged reveal, no capitalisation level, no hidden state', () => {
    // The signatures take a verse and an answer and nothing else - there is
    // nowhere for a tier to be passed in...
    expect(gradeFirstLetters.length).toBe(2);
    expect(initials.length).toBe(1);

    // ...and nothing accumulates between calls, so the tenth attempt at a verse
    // is graded exactly like the first.
    const typed = PSALM_1_1.words.slice();
    typed[5] = 'walked';
    const first = gradeFirstLetters(PSALM_1_1, typed);
    for (let i = 0; i < 10; i += 1) {
      expect(gradeFirstLetters(PSALM_1_1, typed)).toEqual(first);
      expect(initials(PSALM_1_1)).toEqual(initials(PSALM_1_1));
    }
    expect(first.wrong).toEqual([5]);
  });
});
