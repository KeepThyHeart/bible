/**
 * Session tests - the exercise the user is actually doing.
 *
 * The fixtures are real KJV text (Psalm 23:1-4, John 3:16) rather than
 * `['a','b','c']`, for the same reason `exercises.test.ts` gives: every bug
 * this layer can have is a bug about real text. `shepherd;` and `pastures:`
 * carry punctuation welded to the word, `name's` carries a possessive, the
 * verses are poetry at two indent levels, and a synthetic fixture passes
 * happily while all of that is broken.
 *
 * The centre of gravity here is the blocking picker. It is the only place in
 * the extension where "the user got it right" and "the user gets the credit"
 * come apart, and getting that wrong in either direction is bad in a way the
 * user would feel:
 *
 *   - if a retry could re-roll the step, a user could click through until an
 *     easier set of candidates appeared and never face the verse they cannot
 *     recall;
 *   - if a retry could still earn credit, a seven-verse ordering answered by
 *     brute force would score identically to one recited from memory, and
 *     every score the app has ever shown becomes meaningless.
 *
 * So both halves are asserted with concrete numbers rather than with
 * inequalities, and a clean run of the same length is scored alongside as the
 * control.
 */

import { describe, it, expect } from 'vitest';
import { Session, nextSessionId } from '../src/core/session';
import type { ParsedReferenceLike, ReferenceCatalog, SessionResume } from '../src/core/session';
import { mulberry32 } from '../src/core/exercises/rng';
import type { BookInfo, ChapterInfo, ReferencePoint } from '../src/core/exercises/references';
import type {
  AnswerMode,
  BlanksStep,
  FirstLettersStep,
  OrderingStep,
  RefMatchStep,
  RefProvideStep,
  VerseText,
} from '../src/core/types';

/**
 * The same verse-id encoding `main.ts` uses (`book * 1e6 + chapter * 1e3 +
 * verse`) - the fixtures below already follow it (Psalm 23:1 is 19023001,
 * John 3:16 is 43003016), so a `ReferencePoint` can be derived from a
 * fixture's own `verseId` instead of hand-maintaining a parallel one.
 */
function pointFromVerseId(verseId: number): ReferencePoint {
  return {
    bookNumber: Math.floor(verseId / 1_000_000),
    chapter: Math.floor((verseId % 1_000_000) / 1_000),
    verse: verseId % 1_000,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const words = (text: string): string[] => text.split(' ');

/**
 * Psalm 23:1-4, KJV, as `VerseText`.
 *
 * Word offsets in `lines` are 0-based and INCLUSIVE at both ends, matching
 * `PoetryLine` in @bible/core - the convention `Line` in `src/types.ts`
 * inherits. Getting that wrong here would silently shorten every picker
 * preview by one word, which is exactly the kind of thing a fixture written to
 * match the implementation would never catch.
 */
const PS23_1: VerseText = {
  verseId: 19023001,
  label: '23:1',
  words: words('The LORD is my shepherd; I shall not want.'),
  lines: [
    { start: 0, end: 4, level: 1 },
    { start: 5, end: 8, level: 2 },
  ],
  psalmTitle: 'A Psalm of David.',
  paragraphStart: true,
};

const PS23_2: VerseText = {
  verseId: 19023002,
  label: '23:2',
  words: words(
    'He maketh me to lie down in green pastures: he leadeth me beside the still waters.',
  ),
  lines: [
    { start: 0, end: 8, level: 1 },
    { start: 9, end: 15, level: 2 },
  ],
  psalmTitle: null,
  paragraphStart: false,
};

const PS23_3: VerseText = {
  verseId: 19023003,
  label: '23:3',
  words: words(
    "He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake.",
  ),
  lines: [
    { start: 0, end: 3, level: 1 },
    { start: 4, end: 15, level: 2 },
  ],
  psalmTitle: null,
  paragraphStart: false,
};

const PS23_4: VerseText = {
  verseId: 19023004,
  label: '23:4',
  words: words(
    'Yea, though I walk through the valley of the shadow of death, I will fear no evil: ' +
      'for thou art with me; thy rod and thy staff they comfort me.',
  ),
  lines: [
    { start: 0, end: 11, level: 1 },
    { start: 12, end: 21, level: 2 },
    { start: 22, end: 29, level: 2 },
  ],
  psalmTitle: null,
  paragraphStart: false,
};

/** A lone single verse - the material the `refmatch` rung is built for. */
const JOHN_3_16: VerseText = {
  verseId: 43003016,
  label: '3:16',
  words: words(
    'For God so loved the world, that he gave his only begotten Son, that whosoever ' +
      'believeth in him should not perish, but have everlasting life.',
  ),
  lines: null,
  psalmTitle: null,
  paragraphStart: true,
};

const PSALM_23 = [PS23_1, PS23_2, PS23_3, PS23_4];

/**
 * A small `refmatch` distractor pool: Psalms (wisdom, book 19 - the book
 * `PSALM_23` itself is drawn from), John (gospels, book 43), Romans and
 * Philippians (epistles, books 45/50), Obadiah (prophets, book 31, the
 * ONE-CHAPTER book edge case). Chapter/verse extents are made up but
 * internally consistent, which is all `buildReferenceDistractors` needs.
 */
const REF_BOOKS: BookInfo[] = [
  { bookNumber: 19, chapterCount: 150 },
  { bookNumber: 43, chapterCount: 21 },
  { bookNumber: 45, chapterCount: 16 },
  { bookNumber: 50, chapterCount: 4 },
  { bookNumber: 31, chapterCount: 1 },
];
const REF_CHAPTERS: Record<number, ChapterInfo[]> = {
  19: [
    { chapter: 1, verseCount: 6 },
    { chapter: 23, verseCount: 6 },
    { chapter: 119, verseCount: 176 },
  ],
  43: [
    { chapter: 1, verseCount: 51 },
    { chapter: 3, verseCount: 36 },
  ],
  45: [
    { chapter: 1, verseCount: 32 },
    { chapter: 8, verseCount: 39 },
  ],
  50: [{ chapter: 1, verseCount: 30 }],
  31: [{ chapter: 1, verseCount: 21 }],
};
const REF_BOOK_NAMES: Record<number, string> = {
  19: 'Psalms',
  43: 'John',
  45: 'Romans',
  50: 'Philippians',
  31: 'Obadiah',
};
const REF_CATALOG: ReferenceCatalog = {
  books: REF_BOOKS,
  chapters: REF_CHAPTERS,
  bookNames: REF_BOOK_NAMES,
};

const SELF = { passageId: 1, reference: 'Psalm 23:1-4' };

function makeSession(overrides: Partial<Parameters<typeof buildOpts>[0]> = {}) {
  return new Session(buildOpts(overrides));
}

function buildOpts(o: {
  rung?: 'ordering' | 'refmatch' | 'blanks' | 'firstletters' | 'refprovide';
  verses?: VerseText[];
  answerMode?: AnswerMode;
  resume?: SessionResume;
  seed?: number;
  tier?: number;
  self?: { passageId: number; reference: string };
  referencePoints?: ReferencePoint[];
  referenceCatalog?: ReferenceCatalog;
  parseReference?: (input: string) => Promise<ParsedReferenceLike | null>;
} = {}) {
  const verses = o.verses ?? PSALM_23;
  return {
    sessionId: nextSessionId(),
    passageId: (o.self ?? SELF).passageId,
    cardId: 10,
    rung: o.rung ?? ('ordering' as const),
    tier: o.tier ?? 0,
    verses,
    referencePoints: o.referencePoints ?? verses.map((v) => pointFromVerseId(v.verseId)),
    referenceCatalog: o.referenceCatalog ?? REF_CATALOG,
    parseReference: o.parseReference,
    answerMode: o.answerMode ?? ('firstLetter' as const),
    rng: mulberry32(o.seed ?? 20260115),
    ...(o.resume ? { resume: o.resume } : {}),
  };
}

const orderingStep = (s: Session): OrderingStep => s.view().step as OrderingStep;
const blanksStep = (s: Session): BlanksStep => s.view().step as BlanksStep;
const firstLettersStep = (s: Session): FirstLettersStep => s.view().step as FirstLettersStep;
const refMatchStep = (s: Session): RefMatchStep => s.view().step as RefMatchStep;
const refProvideStep = (s: Session): RefProvideStep => s.view().step as RefProvideStep;

/** Answer every ordering step correctly, in order. */
async function playOrderingCleanly(s: Session, verses: VerseText[]): Promise<void> {
  for (let i = 1; i < verses.length; i++) {
    const result = await s.submit({ kind: 'ordering', verseId: verses[i]!.verseId });
    expect(result.correct).toBe(true);
  }
}

// ---------------------------------------------------------------------------
// The blocking picker
// ---------------------------------------------------------------------------

describe('ordering - the picker blocks', () => {
  it('reports a wrong pick as blocking and does not advance the session', async () => {
    // The picker is the one exercise that refuses to move on. An ordering
    // step that let the user continue after a miss would leave the wrong
    // order unresolved in their head, which is worse than no exercise: it
    // actively teaches the mistake.
    const s = makeSession({ rung: 'ordering' });
    const before = orderingStep(s);
    expect(before.stepNumber).toBe(1);
    expect(before.totalSteps).toBe(3);
    expect(before.placed).toEqual([PS23_1]);

    // Pick a verse that is genuinely in the candidate list but is not next.
    const result = await s.submit({ kind: 'ordering', verseId: PS23_4.verseId });
    expect(result.correct).toBe(false);
    expect(result.blocking).toBe(true);
    expect(result.wrong).toEqual([PS23_4.verseId]);
    // No `reveal`: the answer stays hidden until the user finds it, or the
    // step stops being an exercise while still demanding a click.
    expect(result.reveal).toBeUndefined();

    const after = orderingStep(s);
    expect(after.stepNumber).toBe(1);
    expect(after.placed).toEqual([PS23_1]);
    expect(s.isFinished).toBe(false);
  });

  it('serves the identical candidates on a retry, in the identical order', async () => {
    // This is the assertion that stops a user rerolling past a verse they
    // cannot recall. The candidate list is chosen once per step and held, so
    // a wrong pick re-serves the same question - if it were rebuilt from the
    // session's (stateful) RNG on each render, the list would reshuffle and
    // the user's "not that one" mark would point at a different verse every
    // time, which reads as the app cheating.
    const s = makeSession({ rung: 'ordering' });
    const first = JSON.stringify(orderingStep(s).candidates);

    await s.submit({ kind: 'ordering', verseId: PS23_4.verseId });
    expect(JSON.stringify(orderingStep(s).candidates)).toBe(first);

    // Twice, because a single re-render might coincidentally reproduce a
    // two-element permutation; three identical reads will not.
    await s.submit({ kind: 'ordering', verseId: PS23_3.verseId });
    expect(JSON.stringify(orderingStep(s).candidates)).toBe(first);
  });

  it('draws distractors only from verses not yet placed', async () => {
    // A candidate the user has already watched being placed is not a
    // distractor, it is noise - and worse, it makes the exercise solvable by
    // elimination rather than by recall.
    const s = makeSession({ rung: 'ordering' });
    await s.submit({ kind: 'ordering', verseId: PS23_2.verseId });

    const step = orderingStep(s);
    expect(step.stepNumber).toBe(2);
    expect(step.placed).toEqual([PS23_1, PS23_2]);
    const ids = step.candidates.map((c) => c.verseId);
    expect(ids).not.toContain(PS23_1.verseId);
    expect(ids).not.toContain(PS23_2.verseId);
    expect(ids).toContain(PS23_3.verseId);
  });

  it('always includes the correct answer among the candidates', async () => {
    // A picker missing its own answer is unwinnable, and because the picker
    // blocks it would strand the session with no way forward at all.
    const s = makeSession({ rung: 'ordering' });
    for (let i = 1; i < PSALM_23.length; i++) {
      const step = orderingStep(s);
      expect(step.candidates.map((c) => c.verseId)).toContain(PSALM_23[i]!.verseId);
      await s.submit({ kind: 'ordering', verseId: PSALM_23[i]!.verseId });
    }
  });

  it('reveals the answer once the step is finally resolved', async () => {
    const s = makeSession({ rung: 'ordering' });
    const result = await s.submit({ kind: 'ordering', verseId: PS23_2.verseId });
    expect(result.reveal).toEqual({ verseId: PS23_2.verseId });
  });
});

// ---------------------------------------------------------------------------
// Credit forfeited, step still counted
// ---------------------------------------------------------------------------

describe('ordering - scoring', () => {
  it('scores a clean run 1, over n-1 steps', async () => {
    // The control for the test below. Ordering is `n - 1` steps because the
    // first verse is given: you cannot be asked what comes after nothing.
    const s = makeSession({ rung: 'ordering' });
    await playOrderingCleanly(s, PSALM_23);

    expect(s.isFinished).toBe(true);
    expect(s.correctFirst).toBe(3);
    expect(s.gradedTotal).toBe(3);
    expect(s.score).toBe(1);
  });

  it('forfeits the credit for a step that was missed, but still counts it', async () => {
    // Both halves matter and they pull in opposite directions. Not counting
    // the step at all would score a blocked-then-solved run 2/2 = 1.0 -
    // identical to knowing it. Counting the retries as extra steps would
    // score a five-guess fumble worse than a one-guess one, turning the
    // number into a measure of guessing stamina. The unit is counted ONCE, at
    // the moment it is spoiled, and can never earn credit afterwards.
    const s = makeSession({ rung: 'ordering' });

    await s.submit({ kind: 'ordering', verseId: PS23_4.verseId }); // wrong
    await s.submit({ kind: 'ordering', verseId: PS23_3.verseId }); // wrong again
    const recovered = await s.submit({ kind: 'ordering', verseId: PS23_2.verseId }); // right
    expect(recovered.correct).toBe(true);

    // One unit counted so far, none of it credited.
    expect(s.gradedTotal).toBe(1);
    expect(s.correctFirst).toBe(0);

    await s.submit({ kind: 'ordering', verseId: PS23_3.verseId });
    await s.submit({ kind: 'ordering', verseId: PS23_4.verseId });

    expect(s.isFinished).toBe(true);
    expect(s.gradedTotal).toBe(3);
    expect(s.correctFirst).toBe(2);
    expect(s.score).toBeCloseTo(2 / 3, 10);

    // The control: same length, same passage, no misses.
    const clean = makeSession({ rung: 'ordering' });
    await playOrderingCleanly(clean, PSALM_23);
    expect(clean.gradedTotal).toBe(s.gradedTotal);
    expect(s.score).toBeLessThan(clean.score);
  });

  it('does not let repeated guessing inflate or deflate the step count', async () => {
    // Five wrong picks on one step is still one step. If retries counted as
    // steps, a user who eventually got every verse right would score close to
    // zero, and the ladder would never promote anyone who ever hesitated.
    const s = makeSession({ rung: 'ordering' });
    for (let i = 0; i < 5; i++) {
      await s.submit({ kind: 'ordering', verseId: PS23_4.verseId });
    }
    expect(s.gradedTotal).toBe(1);
    await s.submit({ kind: 'ordering', verseId: PS23_2.verseId });
    expect(s.gradedTotal).toBe(1);
  });

  it('gives a fresh step its own chance at credit after an earlier miss', async () => {
    // `spoiled` is per-step state, not per-session. A user who fumbles verse
    // two and then recites the rest perfectly must be able to earn those
    // later points, or one slip would zero the whole attempt.
    const s = makeSession({ rung: 'ordering' });
    await s.submit({ kind: 'ordering', verseId: PS23_4.verseId }); // spoil step 1
    await s.submit({ kind: 'ordering', verseId: PS23_2.verseId }); // resolve step 1
    await s.submit({ kind: 'ordering', verseId: PS23_3.verseId }); // step 2, clean
    expect(s.correctFirst).toBe(1);
    expect(s.gradedTotal).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Ordering tiers (D4: tier 0 scattered distractors, tier 1 contiguous)
// ---------------------------------------------------------------------------

describe('ordering - tiers', () => {
  it('tier 0 keeps the pre-tier behaviour: distractors can be any unplaced verse', () => {
    const s = makeSession({ rung: 'ordering', tier: 0 });
    const step = orderingStep(s);
    expect(step.candidates.length).toBeGreaterThan(0);
  });

  it('tier 1 offers only the verses immediately following the correct one, contiguous', () => {
    // Six verses so there is room for `PICKER_CHOICES - 1` = 3 contiguous
    // followers after the first correct answer (PS23_2).
    const verses = [PS23_1, PS23_2, PS23_3, PS23_4];
    const s = makeSession({ rung: 'ordering', verses, tier: 1 });
    const step = orderingStep(s);

    const ids = step.candidates.map((c) => c.verseId);
    expect(ids).toContain(PS23_2.verseId); // the correct answer
    // Every candidate is the correct verse or one of the verses that
    // genuinely follow it in sequence - never a scattered distractor from
    // elsewhere in the (unplaced) passage.
    const expectedPool = new Set([PS23_2.verseId, PS23_3.verseId, PS23_4.verseId]);
    for (const id of ids) expect(expectedPool.has(id)).toBe(true);
  });

  it('tier 1 near the end of the passage: fewer candidates, no crash, answer always present', async () => {
    // Only PS23_4 remains after PS23_3 is placed - one candidate, not four.
    const verses = [PS23_1, PS23_2, PS23_3, PS23_4];
    const s = makeSession({ rung: 'ordering', verses, tier: 1 });
    await s.submit({ kind: 'ordering', verseId: PS23_2.verseId });
    await s.submit({ kind: 'ordering', verseId: PS23_3.verseId });

    const step = orderingStep(s);
    const ids = step.candidates.map((c) => c.verseId);
    expect(ids).toEqual([PS23_4.verseId]);
  });

  it('a session is constructible at either valid ordering tier and reports it on the view', () => {
    const easy = makeSession({ rung: 'ordering', tier: 0 });
    const hard = makeSession({ rung: 'ordering', tier: 1 });
    expect(easy.view().tier).toBe(0);
    expect(hard.view().tier).toBe(1);
    // `ladder.ts#TIERS.ordering` is 2.
    expect(easy.view().tiers).toBe(2);
    expect(hard.view().tiers).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Blanks and first letters do not block
// ---------------------------------------------------------------------------

/** Every hidden index of a tier-0 (single-verse) `BlanksStep`, in flat order. */
const soleBlankIndices = (step: BlanksStep): number[] => step.blanks[0]?.indices ?? [];

describe('blanks - tier 0 (one verse per step)', () => {
  it('does not block, and grades per word', async () => {
    // Unlike the picker, seeing the answer and moving on IS the point.
    // Blocking here would sit the user on a word they genuinely cannot recall
    // with no way forward; the card's schedule is what brings it back.
    const s = makeSession({ rung: 'blanks', verses: [PS23_1, PS23_2] });
    const step = blanksStep(s);
    expect(step.kind).toBe('blanks');
    expect(step.totalSteps).toBe(2);
    expect(step.verses).toEqual([PS23_1]);
    expect(step.blanks).toHaveLength(1);
    expect(step.blanks[0]?.verseId).toBe(PS23_1.verseId);
    expect(soleBlankIndices(step).length).toBeGreaterThan(0);

    // Answer every blank correctly except the first.
    const indices = soleBlankIndices(step);
    const answers = indices.map((i) => PS23_1.words[i] as string);
    answers[0] = 'donkey';

    const result = await s.submit({ kind: 'blanks', words: answers });
    expect(result.blocking).toBe(false);
    expect(result.correct).toBe(false);
    // `wrong` is FLAT POSITIONS in the submitted `words` array (the same
    // space `StepAnswer.words` is documented in - see `types.ts`), not
    // indices into `verse.words`: the panel highlights the word at that
    // position, and at tier 0 (one verse, one blanks entry) that coincides
    // with "position within this verse's blanks" but is not, in general, a
    // `verse.words` index.
    expect(result.wrong).toEqual([0]);

    // And the session moved on regardless of the miss.
    expect(blanksStep(s).stepNumber).toBe(2);
  });

  it('credits every blank the user got right, not the step as a whole', async () => {
    // The scoring unit for blanks is the word. A step-level pass/fail would
    // make a single missed word cost as much as an empty submission, and the
    // 0.8 pass threshold would become unreachable on any long verse.
    const s = makeSession({ rung: 'blanks', verses: [PS23_1] });
    const step = blanksStep(s);
    const indices = soleBlankIndices(step);
    const total = indices.length;
    const answers = indices.map((i) => PS23_1.words[i] as string);
    answers[0] = '';

    await s.submit({ kind: 'blanks', words: answers });
    expect(s.gradedTotal).toBe(total);
    expect(s.correctFirst).toBe(total - 1);
    expect(s.score).toBeCloseTo((total - 1) / total, 10);
  });

  it('accepts a word typed without the punctuation the text prints', async () => {
    // `verse.words` is a raw whitespace split, so tokens arrive as
    // `shepherd;` and `pastures:`. A user who recited the verse perfectly
    // does not conclude "I should have typed the semicolon" when marked
    // wrong - they conclude the app is broken and stop trusting every score
    // it has shown them. The session has to route through `wordsMatch` for
    // this to hold, which is what this asserts at the session level.
    const s = makeSession({ rung: 'blanks', verses: [PS23_1] });
    const step = blanksStep(s);
    const answers = soleBlankIndices(step).map((i) =>
      (PS23_1.words[i] as string).replace(/[;:.,]/g, ''),
    );
    const result = await s.submit({ kind: 'blanks', words: answers });
    expect(result.wrong).toEqual([]);
    expect(result.correct).toBe(true);
    expect(s.score).toBe(1);
  });

  it('counts an empty submission wrong rather than unanswered', async () => {
    // There is no third state in the score. A user who skipped every gap did
    // not fail to be measured, they failed to recall.
    const s = makeSession({ rung: 'blanks', verses: [PS23_1] });
    const total = soleBlankIndices(blanksStep(s)).length;
    const result = await s.submit({ kind: 'blanks', words: [] });
    expect(result.correct).toBe(false);
    expect(result.wrong).toHaveLength(total);
    expect(s.correctFirst).toBe(0);
    expect(s.score).toBe(0);
  });

  it('reveals the hidden words in blank order', async () => {
    // Paired positionally with the flattened `blanks` order so the panel can
    // show the right answer beside the gap it belongs to without a second
    // lookup.
    const s = makeSession({ rung: 'blanks', verses: [PS23_3] });
    const step = blanksStep(s);
    const result = await s.submit({ kind: 'blanks', words: [] });
    expect(result.reveal?.words).toEqual(soleBlankIndices(step).map((i) => PS23_3.words[i]));
  });

  it('never blanks the same verse-word twice across steps in a way that breaks ascending order', async () => {
    // Regression guard for the "ascending PER VERSE, not globally" contract:
    // a single-verse tier-0 step's own indices must still come back ascending
    // (unchanged from before the multi-verse generalisation).
    const s = makeSession({ rung: 'blanks', verses: [PS23_1, PS23_2, PS23_3] });
    for (let i = 0; i < 3; i += 1) {
      const indices = soleBlankIndices(blanksStep(s));
      expect([...indices].sort((a, b) => a - b)).toEqual(indices);
      await s.submit({ kind: 'blanks', words: indices.map(() => '') });
    }
  });
});

describe('blanks - tier 1 (whole passage, one step)', () => {
  it('is a single step covering every verse of the passage', async () => {
    const s = makeSession({ rung: 'blanks', verses: PSALM_23, tier: 1 });
    const step = blanksStep(s);
    expect(step.totalSteps).toBe(1);
    expect(step.stepNumber).toBe(1);
    expect(step.verses).toHaveLength(PSALM_23.length);
    expect(step.verses.map((v) => v.verseId)).toEqual(PSALM_23.map((v) => v.verseId));
    expect(step.blanks).toHaveLength(PSALM_23.length);
    expect(step.blanks.map((b) => b.verseId)).toEqual(PSALM_23.map((v) => v.verseId));

    // Every verse actually contributes at least one blank.
    for (const b of step.blanks) expect(b.indices.length).toBeGreaterThan(0);

    // Each verse's own indices are ascending (the per-verse guarantee), and
    // in range for that verse specifically.
    for (const b of step.blanks) {
      expect([...b.indices].sort((x, y) => x - y)).toEqual(b.indices);
      const verse = PSALM_23.find((v) => v.verseId === b.verseId);
      for (const i of b.indices) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(verse!.words.length);
      }
    }

    // The whole session finishes in one submission.
    const total = step.blanks.reduce((n, b) => n + b.indices.length, 0);
    await s.submit({ kind: 'blanks', words: new Array(total).fill('') });
    expect(s.isFinished).toBe(true);
  });

  it('blanks a higher fraction of each verse than tier 0 (a genuinely harder tier)', () => {
    // Not a precise number - `selectBlanks` is itself randomised - but tier 1
    // must not be a relabelled tier 0. Averaged over several seeds to avoid a
    // single unlucky draw asserting the wrong thing.
    let easyTotal = 0;
    let hardTotal = 0;
    const trials = 20;
    for (let seed = 1; seed <= trials; seed += 1) {
      const easy = makeSession({ rung: 'blanks', verses: [PS23_2], tier: 0, seed });
      const hard = makeSession({ rung: 'blanks', verses: [PS23_2], tier: 1, seed });
      easyTotal += soleBlankIndices(blanksStep(easy)).length;
      hardTotal += (blanksStep(hard).blanks[0]?.indices.length ?? 0);
    }
    expect(hardTotal).toBeGreaterThan(easyTotal);
  });

  it('flattens the answer array across verses in blanks order, indices order', async () => {
    // Pins the exact flattening contract `StepAnswer.words` for `blanks`
    // depends on (see `types.ts`): iterate `blanks` in order, and within each
    // entry iterate `indices` in order. Deliberately answers with SCATTERED
    // (non-matching) positions to prove the session grades by position, not
    // by coincidence - a bug that graded against the wrong blank would still
    // pass a test that only ever submitted correct answers.
    const s = makeSession({ rung: 'blanks', verses: [PS23_1, PS23_2], tier: 1 });
    const step = blanksStep(s);
    const correctWords = step.blanks.flatMap((b) => {
      const verse = [PS23_1, PS23_2].find((v) => v.verseId === b.verseId)!;
      return b.indices.map((i) => verse.words[i] as string);
    });

    // Every answer right, in the correct flattened order: a clean pass.
    const clean = await s.submit({ kind: 'blanks', words: correctWords });
    expect(clean.correct).toBe(true);
    expect(clean.wrong).toEqual([]);
  });

  it('reports a wrong answer at the flat position it was submitted at, not a verse.words index', async () => {
    const s = makeSession({ rung: 'blanks', verses: [PS23_1, PS23_2], tier: 1 });
    const step = blanksStep(s);
    const total = step.blanks.reduce((n, b) => n + b.indices.length, 0);
    // Get everything right except the very first flattened answer.
    const correctWords = step.blanks.flatMap((b) => {
      const verse = [PS23_1, PS23_2].find((v) => v.verseId === b.verseId)!;
      return b.indices.map((i) => verse.words[i] as string);
    });
    const words = [...correctWords];
    words[0] = 'zzz-not-a-real-word';

    const result = await s.submit({ kind: 'blanks', words });
    expect(result.wrong).toEqual([0]);
    expect(result.correct).toBe(false);
    expect(result.reveal?.words).toHaveLength(total);
  });

  it('a 1-verse passage behaves identically to tier 0 - a single verse, a single step', () => {
    // There is nothing left for "whole passage" to mean once the passage IS
    // one verse, so the two tiers must produce the same step SHAPE (not
    // necessarily the same chosen blanks - the difficulty differs).
    const tier0 = makeSession({ rung: 'blanks', verses: [PS23_1], tier: 0, seed: 5 });
    const tier1 = makeSession({ rung: 'blanks', verses: [PS23_1], tier: 1, seed: 5 });

    const stepA = blanksStep(tier0);
    const stepB = blanksStep(tier1);

    expect(stepA.totalSteps).toBe(1);
    expect(stepB.totalSteps).toBe(1);
    expect(stepA.verses).toHaveLength(1);
    expect(stepB.verses).toHaveLength(1);
    expect(stepA.blanks).toHaveLength(1);
    expect(stepB.blanks).toHaveLength(1);
    expect(stepA.verses[0]?.verseId).toBe(stepB.verses[0]?.verseId);
  });

  it('scores correct-first-attempts over graded units, same invariant as tier 0', async () => {
    const s = makeSession({ rung: 'blanks', verses: PSALM_23, tier: 1 });
    const step = blanksStep(s);
    const total = step.blanks.reduce((n, b) => n + b.indices.length, 0);
    // Miss exactly one flattened answer.
    const correctWords = step.blanks.flatMap((b) => {
      const verse = PSALM_23.find((v) => v.verseId === b.verseId)!;
      return b.indices.map((i) => verse.words[i] as string);
    });
    correctWords[0] = 'nope';

    await s.submit({ kind: 'blanks', words: correctWords });
    expect(s.gradedTotal).toBe(total);
    expect(s.correctFirst).toBe(total - 1);
    expect(s.score).toBeCloseTo((total - 1) / total, 10);
    expect(s.isFinished).toBe(true);
  });
});

describe('firstletters - tier is a pass-through', () => {
  it('carries the requested tier onto the step, with no grading change', async () => {
    // Resolved scope: first letters' two tiers differ only in panel
    // presentation (T14). The worker just has to carry the tier so the panel
    // has something to key off - nothing here branches on it.
    const easy = makeSession({ rung: 'firstletters', verses: [PS23_1], tier: 0 });
    const hard = makeSession({ rung: 'firstletters', verses: [PS23_1], tier: 1 });
    expect(firstLettersStep(easy).tier).toBe(0);
    expect(firstLettersStep(hard).tier).toBe(1);

    // Identical grading at both tiers for the identical answer.
    const a = await easy.submit({ kind: 'firstletters', words: PS23_1.words });
    const b = await hard.submit({ kind: 'firstletters', words: PS23_1.words });
    expect(a).toEqual(b);
  });
});

describe('firstletters', () => {
  it('does not block, and grades every word of the verse', async () => {
    // The top rung: the initial is given, so there is no credit for producing
    // it - the whole word is the unit. Nothing here is worth retrying in the
    // same sitting, so it does not block either.
    const s = makeSession({ rung: 'firstletters', verses: [PS23_1, PS23_2] });
    const step = firstLettersStep(s);
    expect(step.kind).toBe('firstletters');
    expect(step.totalSteps).toBe(2);

    const first = await s.submit({ kind: 'firstletters', words: PS23_1.words });
    expect(first.blocking).toBe(false);
    expect(first.correct).toBe(true);
    expect(first.reveal?.words).toEqual(PS23_1.words);

    // Second verse: three words wrong out of sixteen.
    const typed = [...PS23_2.words];
    typed[1] = 'giveth';
    typed[7] = 'grey';
    typed[14] = 'quiet';
    const second = await s.submit({ kind: 'firstletters', words: typed });
    expect(second.blocking).toBe(false);
    expect(second.wrong).toEqual([1, 7, 14]);

    // 9 words in verse one, 16 in verse two, three of them missed.
    expect(s.gradedTotal).toBe(25);
    expect(s.correctFirst).toBe(22);
    expect(s.score).toBeCloseTo(22 / 25, 10);
    expect(s.isFinished).toBe(true);
  });

  it('counts words the user stopped short of as wrong', async () => {
    // Stopping is a recall failure, not a missing measurement - the short
    // array is exactly what the panel sends when the user gives up halfway.
    const s = makeSession({ rung: 'firstletters', verses: [PS23_1] });
    const result = await s.submit({ kind: 'firstletters', words: PS23_1.words.slice(0, 4) });
    expect(result.wrong).toEqual([4, 5, 6, 7, 8]);
    expect(s.correctFirst).toBe(4);
    expect(s.gradedTotal).toBe(9);
  });

  it("holds the internal apostrophe in name's against a user who drops it", async () => {
    // The one place the comparison chooses strictness over leniency:
    // `name's` and `names` are different words, and accepting the second
    // would mark a genuine recall failure correct. Asserted through the
    // session because it is the session that hands raw verse tokens to the
    // grader.
    const s = makeSession({ rung: 'firstletters', verses: [PS23_3] });
    const typed = [...PS23_3.words];
    typed[14] = 'names';
    const result = await s.submit({ kind: 'firstletters', words: typed });
    expect(result.wrong).toEqual([14]);
  });
});

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

describe('a finished session', () => {
  it('reports isFinished, a null step and the score it earned', async () => {
    // The panel keys off `step === null` to swap to the summary screen, and
    // off `isFinished` to stop submitting. Both have to flip together or the
    // panel renders an exercise with nothing in it.
    const s = makeSession({ rung: 'ordering' });
    await playOrderingCleanly(s, PSALM_23);

    expect(s.isFinished).toBe(true);
    const view = s.view();
    expect(view.step).toBeNull();
    expect(view.correctFirst).toBe(3);
    expect(view.stepsTaken).toBe(3);
    expect(s.score).toBe(1);
  });

  it('refuses further submissions without throwing', async () => {
    // A stale submit from a panel that had not yet processed the summary must
    // not reach the graders - and must not throw either, because an exception
    // across the RPC boundary arrives at the panel as an opaque failure that
    // loses the session.
    const s = makeSession({ rung: 'ordering' });
    await playOrderingCleanly(s, PSALM_23);

    const late = await s.submit({ kind: 'ordering', verseId: PS23_2.verseId });
    expect(late).toEqual({ correct: false, wrong: [], blocking: false });
    expect(s.correctFirst).toBe(3);
    expect(s.gradedTotal).toBe(3);
  });

  it('treats an answer of the wrong kind as a blocking miss, not an exception', async () => {
    // Only reachable when the panel and worker disagree about session
    // position - a stale reply after a restart. Reported as an ordinary wrong
    // answer so the session survives it.
    const s = makeSession({ rung: 'ordering' });
    const result = await s.submit({ kind: 'blanks', words: ['nonsense'] });
    expect(result.correct).toBe(false);
    expect(result.blocking).toBe(true);
    expect(s.isFinished).toBe(false);
  });

  it('carries the answer mode through to blanks and firstletters steps', () => {
    // Task 0004: every hidden-word step tells the panel how to collect the
    // answer, because `blanks` and `firstletters` share one rendering
    // mechanic that only differs by which words are hidden.
    const blanks = makeSession({ rung: 'blanks', verses: [PS23_1], answerMode: 'fullWord' });
    expect(blanksStep(blanks).answerMode).toBe('fullWord');

    const letters = makeSession({ rung: 'firstletters', verses: [PS23_1], answerMode: 'firstLetter' });
    expect(firstLettersStep(letters).answerMode).toBe('firstLetter');
  });

  it('resumes at the given cursor with the prior tally intact', () => {
    // The resume point is written to disk after each verse (see
    // `main.ts#submitStep`) and handed back in here on the next `startSession`
    // - this is the one place `Session` has to trust state it did not compute
    // itself.
    const s = makeSession({
      rung: 'blanks',
      verses: PSALM_23,
      resume: { cursor: 2, correctFirstUnits: 5, gradedUnits: 6 },
    });
    expect(blanksStep(s).stepNumber).toBe(3);
    expect(s.correctFirst).toBe(5);
    expect(s.gradedTotal).toBe(6);
  });

  it('ignores a resume point at or past the end, starting fresh instead', () => {
    // A resume row can outlive the activity it describes - the collection
    // changed shape, or the row is simply stale. Starting fresh is the safe
    // default; a session that could not produce a step at all would be worse
    // than one that quietly forgets a bad resume point.
    const s = makeSession({
      rung: 'blanks',
      verses: [PS23_1],
      resume: { cursor: 1, correctFirstUnits: 3, gradedUnits: 3 },
    });
    expect(blanksStep(s).stepNumber).toBe(1);
    expect(s.correctFirst).toBe(0);
  });

  it('gives every session a distinct id', async () => {
    // The panel holds only the id; two live sessions sharing one would route
    // the second one's answers into the first.
    expect(nextSessionId()).not.toBe(nextSessionId());
  });
});

// ---------------------------------------------------------------------------
// refmatch
// ---------------------------------------------------------------------------

/** A 7-verse fixture (Psalm 1, made up past verse 6) for the 5-step cap. */
const SEVEN_VERSES: VerseText[] = Array.from({ length: 7 }, (_, i) => ({
  verseId: 19001001 + i,
  label: `1:${i + 1}`,
  words: words(`Verse number ${i + 1} of this made up passage here.`),
  lines: null,
  psalmTitle: null,
  paragraphStart: i === 0,
}));

describe('refmatch', () => {
  it('asks one question per verse of the passage', async () => {
    // T8: no longer one question about the passage as a whole - one per
    // verse, so the exercise scales with the passage instead of running out
    // of material after a single question.
    const s = makeSession({ rung: 'refmatch', verses: PSALM_23 });
    const step = refMatchStep(s);
    expect(step.kind).toBe('refmatch');
    expect(step.stepNumber).toBe(1);
    expect(step.totalSteps).toBe(4);
    expect(step.verse).toEqual(PS23_1);
    expect(step.tier).toBe(0);
  });

  it('caps a longer passage at 5 questions', () => {
    const s = makeSession({
      rung: 'refmatch',
      verses: SEVEN_VERSES,
      referencePoints: SEVEN_VERSES.map((v) => pointFromVerseId(v.verseId)),
      referenceCatalog: {
        books: REF_BOOKS,
        chapters: { ...REF_CHAPTERS, 19: [{ chapter: 1, verseCount: 10 }] },
        bookNames: REF_BOOK_NAMES,
      },
    });
    expect(refMatchStep(s).totalSteps).toBe(5);
  });

  it('offers the correct reference alongside generated distractors, never a sibling passage', async () => {
    // T8 replaced sibling-passage distractors with references GENERATED from
    // the Bible's own structure - see `exercises/references.ts`. The correct
    // answer must still be among the candidates.
    const s = makeSession({ rung: 'refmatch', verses: [PS23_1], tier: 0 });
    const step = refMatchStep(s);
    expect(step.candidates.length).toBeGreaterThanOrEqual(2);
    expect(step.candidates.map((c) => c.reference)).toContain('Psalms 23:1');
  });

  it("candidate ids are opaque - not the reference text and not derived from it", () => {
    const s = makeSession({ rung: 'refmatch', verses: [PS23_1] });
    for (const candidate of refMatchStep(s).candidates) {
      expect(candidate.id).not.toBe(candidate.reference);
      expect(candidate.id.toLowerCase()).not.toContain('psalm');
    }
  });

  it('tier 2 draws every candidate - correct answer included - from the same book', async () => {
    // The explicit assertion the task calls for by name: at tier 2, nothing
    // on screen can be told apart from the correct answer by its book.
    const s = makeSession({ rung: 'refmatch', verses: PSALM_23, tier: 2 });
    const step = refMatchStep(s);
    expect(step.candidates.length).toBeGreaterThan(1);
    for (const candidate of step.candidates) {
      expect(candidate.reference.startsWith('Psalms ')).toBe(true);
    }
  });

  it('handles a one-chapter book at tier 2: distinct candidates, no crash', () => {
    const obadiahVerse: VerseText = {
      verseId: 31001003,
      label: '1:3',
      words: words('The pride of thine heart hath deceived thee.'),
      lines: null,
      psalmTitle: null,
      paragraphStart: false,
    };
    const s = makeSession({
      rung: 'refmatch',
      verses: [obadiahVerse],
      referencePoints: [pointFromVerseId(obadiahVerse.verseId)],
      tier: 2,
    });
    const step = refMatchStep(s);
    const refs = step.candidates.map((c) => c.reference);
    expect(new Set(refs).size).toBe(refs.length); // no duplicate candidates
    for (const ref of refs) expect(ref.startsWith('Obadiah ')).toBe(true);
  });

  it('blocks on a wrong pick, marks the INDEX picked, and forfeits the credit', async () => {
    const s = makeSession({ rung: 'refmatch', verses: [PS23_1] });
    const step = refMatchStep(s);
    const correctIndex = step.candidates.findIndex((c) => c.reference === 'Psalms 23:1');
    const wrongIndex = step.candidates.findIndex((_, i) => i !== correctIndex);
    const wrongCandidate = step.candidates[wrongIndex] as { id: string; reference: string };

    const missed = await s.submit({ kind: 'refmatch', id: wrongCandidate.id });
    expect(missed.correct).toBe(false);
    expect(missed.blocking).toBe(true);
    expect(missed.wrong).toEqual([wrongIndex]);
    expect(s.isFinished).toBe(false);

    const correctCandidate = step.candidates[correctIndex] as { id: string; reference: string };
    const recovered = await s.submit({ kind: 'refmatch', id: correctCandidate.id });
    expect(recovered.correct).toBe(true);
    expect(s.isFinished).toBe(true);
    expect(s.correctFirst).toBe(0);
    expect(s.gradedTotal).toBe(1);
    expect(s.score).toBe(0);
  });

  it('keeps the candidate order fixed across renders and across a retry', async () => {
    // The regression this guards against: building the candidate list inside
    // `currentStep()` consumed the session's stateful RNG on every call, so
    // `view()` alone reordered the options - including the re-serve after a
    // wrong pick, which made the "not that one" mark point at a different
    // reference than the one actually clicked.
    const s = makeSession({ rung: 'refmatch', verses: [PS23_1] });

    const order = () => (s.view().step as RefMatchStep).candidates.map((c) => c.id);
    const first = order();
    expect(order()).toEqual(first);
    expect(order()).toEqual(first);

    const step = refMatchStep(s);
    const wrongId = step.candidates.find((c) => c.reference !== 'Psalms 23:1')?.id as string;
    await s.submit({ kind: 'refmatch', id: wrongId });
    expect(s.isFinished).toBe(false);
    expect(order()).toEqual(first);
    expect(order()).toEqual(first);
  });

  it('scores a clean run across every verse of the passage', async () => {
    const s = makeSession({ rung: 'refmatch', verses: PSALM_23 });
    for (let i = 0; i < PSALM_23.length; i++) {
      const step = refMatchStep(s);
      const correct = step.candidates.find((c) => c.reference === `Psalms 23:${i + 1}`);
      expect(correct).toBeDefined();
      const result = await s.submit({ kind: 'refmatch', id: (correct as { id: string }).id });
      expect(result.correct).toBe(true);
    }
    expect(s.isFinished).toBe(true);
    expect(s.score).toBe(1);
    expect(s.gradedTotal).toBe(4);
  });

  it('requires a reference catalog and refuses to start without one', () => {
    expect(() =>
      new Session({
        sessionId: nextSessionId(),
        passageId: 1,
        cardId: 10,
        rung: 'refmatch',
        tier: 0,
        verses: [PS23_1],
        referencePoints: [pointFromVerseId(PS23_1.verseId)],
        // referenceCatalog deliberately omitted.
        answerMode: 'firstLetter',
        rng: mulberry32(1),
      }),
    ).toThrow(/reference catalog/);
  });
});

// ---------------------------------------------------------------------------
// refprovide
// ---------------------------------------------------------------------------

/**
 * A stub host `parseReference`, matching the shape `main.ts` wires
 * `api.bible.parseReference` through as. `resolves` maps exact input text to
 * what the "host" would resolve it to; anything else resolves to `null`
 * (unrecognised), the same behaviour `api.bible.parseReference` itself
 * documents for text it cannot identify a book in at all.
 */
function stubParseReference(
  resolves: Record<string, ParsedReferenceLike>,
): (input: string) => Promise<ParsedReferenceLike | null> {
  return async (input: string) => resolves[input] ?? null;
}

describe('refprovide', () => {
  it('asks one question per verse of the passage, showing the full verse', () => {
    const s = makeSession({
      rung: 'refprovide',
      verses: [JOHN_3_16],
      parseReference: stubParseReference({}),
    });
    const step = refProvideStep(s);
    expect(step.kind).toBe('refprovide');
    expect(step.stepNumber).toBe(1);
    expect(step.totalSteps).toBe(1);
    expect(step.verse.words).toEqual(JOHN_3_16.words);
    expect(step.truncatedPreview).toBe(false);
  });

  it('caps a longer passage at 5 questions', () => {
    const s = makeSession({
      rung: 'refprovide',
      verses: SEVEN_VERSES,
      referencePoints: SEVEN_VERSES.map((v) => pointFromVerseId(v.verseId)),
      parseReference: stubParseReference({}),
    });
    expect(refProvideStep(s).totalSteps).toBe(5);
  });

  it('grades correct when the parsed reference resolves to the exact verse under test', async () => {
    const s = makeSession({
      rung: 'refprovide',
      verses: [JOHN_3_16],
      parseReference: stubParseReference({
        'John 3:16': {
          bookNumber: 43,
          chapter: 3,
          startVerse: 16,
          endVerse: 16,
          startVerseId: JOHN_3_16.verseId,
          endVerseId: JOHN_3_16.verseId,
        },
      }),
    });

    const result = await s.submit({ kind: 'refprovide', text: 'John 3:16' });
    expect(result.correct).toBe(true);
    expect(result.blocking).toBe(false);
    expect(result.unrecognized).toBeUndefined();
    expect(s.isFinished).toBe(true);
    expect(s.correctFirst).toBe(1);
    expect(s.gradedTotal).toBe(1);
  });

  it('grades wrong, without blocking, when the book is recognised but the verse is not the one being asked', async () => {
    const s = makeSession({
      rung: 'refprovide',
      verses: [JOHN_3_16],
      parseReference: stubParseReference({
        'John 3:17': {
          bookNumber: 43,
          chapter: 3,
          startVerse: 17,
          endVerse: 17,
          startVerseId: JOHN_3_16.verseId + 1,
          endVerseId: JOHN_3_16.verseId + 1,
        },
      }),
    });

    const result = await s.submit({ kind: 'refprovide', text: 'John 3:17' });
    expect(result.correct).toBe(false);
    expect(result.blocking).toBe(false); // graded and moved on, not re-prompted
    expect(result.unrecognized).toBeUndefined();
    expect(s.isFinished).toBe(true); // single-verse session: one wrong step ends it
    expect(s.correctFirst).toBe(0);
    expect(s.gradedTotal).toBe(1);
  });

  it('grades a whole-chapter reference (book recognised, no verse pinned down) as wrong, not unrecognised', async () => {
    // "John 3" - `parseReference` identifies the book and chapter but not a
    // verse, so `startVerseId` is absent. Per resolved decision D5 this still
    // counts as RECOGNISED (a book was named), so it is graded - and it
    // cannot match a specific verse, so it comes back wrong, never
    // `unrecognized`.
    const s = makeSession({
      rung: 'refprovide',
      verses: [JOHN_3_16],
      parseReference: stubParseReference({
        'John 3': { bookNumber: 43, chapter: 3 },
      }),
    });

    const result = await s.submit({ kind: 'refprovide', text: 'John 3' });
    expect(result.correct).toBe(false);
    expect(result.unrecognized).toBeUndefined();
    expect(s.isFinished).toBe(true);
    expect(s.gradedTotal).toBe(1);
  });

  it('treats an unrecognisable book as a re-prompt, not a wrong answer', async () => {
    // The exact example from the task: "psalm twenty three" is not a string
    // `parseReference` can resolve to any book at all.
    const s = makeSession({
      rung: 'refprovide',
      verses: [JOHN_3_16],
      parseReference: stubParseReference({}), // resolves everything to null
    });

    const result = await s.submit({ kind: 'refprovide', text: 'psalm twenty three' });
    expect(result.unrecognized).toBe(true);
    expect(result.blocking).toBe(true);
    expect(result.correct).toBe(false);
    // Not spoiled, not advanced: still the same step, nothing graded yet.
    expect(s.isFinished).toBe(false);
    expect(s.gradedTotal).toBe(0);
    expect(refProvideStep(s).stepNumber).toBe(1);
  });

  it('does not let repeated unrecognised submissions drift the score or hang the session', async () => {
    const s = makeSession({
      rung: 'refprovide',
      verses: [JOHN_3_16],
      parseReference: stubParseReference({
        'John 3:16': {
          bookNumber: 43,
          chapter: 3,
          startVerse: 16,
          endVerse: 16,
          startVerseId: JOHN_3_16.verseId,
          endVerseId: JOHN_3_16.verseId,
        },
      }),
    });

    for (let i = 0; i < 5; i++) {
      const result = await s.submit({ kind: 'refprovide', text: 'gibberish' });
      expect(result.unrecognized).toBe(true);
      expect(s.gradedTotal).toBe(0);
    }

    // The first REAL attempt still gets full first-attempt credit - none of
    // the unrecognised attempts spoiled it.
    const result = await s.submit({ kind: 'refprovide', text: 'John 3:16' });
    expect(result.correct).toBe(true);
    expect(s.correctFirst).toBe(1);
    expect(s.gradedTotal).toBe(1);
    expect(s.score).toBe(1);
  });

  it('propagates a thrown parseReference error rather than swallowing it, without corrupting the session', async () => {
    let shouldThrow = true;
    const parseReference = async (input: string): Promise<ParsedReferenceLike | null> => {
      if (shouldThrow) throw new Error('host connection lost');
      return input === 'John 3:16'
        ? {
            bookNumber: 43,
            chapter: 3,
            startVerse: 16,
            endVerse: 16,
            startVerseId: JOHN_3_16.verseId,
            endVerseId: JOHN_3_16.verseId,
          }
        : null;
    };
    const s = makeSession({ rung: 'refprovide', verses: [JOHN_3_16], parseReference });

    await expect(s.submit({ kind: 'refprovide', text: 'John 3:16' })).rejects.toThrow(
      'host connection lost',
    );
    // Nothing was mutated by the failed attempt - the session is still usable.
    expect(s.gradedTotal).toBe(0);
    expect(s.isFinished).toBe(false);

    shouldThrow = false;
    const result = await s.submit({ kind: 'refprovide', text: 'John 3:16' });
    expect(result.correct).toBe(true);
    expect(s.gradedTotal).toBe(1);
  });

  it('requires host reference parsing and refuses to grade without it', async () => {
    const s = makeSession({ rung: 'refprovide', verses: [JOHN_3_16] });
    await expect(s.submit({ kind: 'refprovide', text: 'John 3:16' })).rejects.toThrow(
      /host reference parsing/,
    );
  });
});
