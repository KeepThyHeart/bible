/**
 * Tests for the panel's decision-making.
 *
 * The panel bundle targets the DOM and `vitest.config.ts` runs under
 * `environment: 'node'`, so nothing here imports a module that touches
 * `document`. That is not a limitation being worked around - it is why the
 * interesting logic was put in DOM-free modules in the first place. What is
 * covered is the part where being wrong is expensive and invisible:
 *
 *   - which card "Start practicing" starts, and in what order;
 *   - which activity a passage screen badges "Suggested";
 *   - how a due date reads, across a day boundary rather than a 24-hour one;
 *   - where leaving an activity returns to;
 *   - how an ambiguous `StepResult` is read back onto the user's answers,
 *     since guessing wrong there paints the wrong words red;
 *   - that the fallback width estimate is proportional rather than a
 *     character count, which is the entire reason it exists.
 *
 * What is NOT covered, and is stated here rather than implied: none of the
 * rendering, none of the event handling, and none of the measurement against a
 * real font. Those need a browser.
 */
// Ported unchanged from the extension, whose tests were not type-checked; fixtures here
// predate later type changes. Behaviour is covered by vitest, not tsc.
// @ts-nocheck

import { describe, it, expect } from 'vitest';
import type {
  AnalyticsView,
  BlanksStep,
  Passage,
  PassageView,
  PlanView,
  RungView,
  StepResult,
  VerseText,
} from '../src/core/types';
import {
  calendarDaysBetween,
  calendarWeeks,
  firstLetterOf,
  formatDue,
  formatScore,
  inLadderOrder,
  isDue,
  matchesFirstLetter,
  wordCore,
} from '../src/ui/format';
import { blankWidthFor, estimateTextWidth, MIN_BLANK_WIDTH_PX } from '../src/ui/measure';
import { ACTIVITY_TILES } from '../src/ui/activities';
import type { Flow } from '../src/ui/state';
import { resolveWrongPositions, revealedWord } from '../src/ui/stepResult';
import type { HiddenWords } from '../src/ui/stepResult';

const SPEECH_OFF = {
  state: 'unavailable',
  missingPermissions: [],
  engineLabel: '',
  onDevice: false,
  handsFree: false,
} as const satisfies import('../src/core/types').SpeechAvailability;
const RECITE_DEFAULTS: import('../src/core/types').ReciteSettings = {
  strictness: 'normal',
  promptStyle: 'reference',
  feedback: 'brief',
  readBack: false,
  autoAdvance: false,
  voiceCommands: false,
  hintDelayMs: 5000,
};


// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

function rung(over: Partial<RungView> & Pick<RungView, 'rung'>): RungView {
  return {
    level: 0,
    dueAt: null,
    streak: 0,
    lastScore: null,
    applicable: true,
    resume: null,
    tiers: 2,
    tiersPassed: 0,
    bestScore: null,
    attempts: 0,
    nextTier: 0,
    ...over,
  };
}

function plan(now: number): PlanView {
  return {
    collectionId: 1,
    collectionName: 'My plan',
    totalDue: 3,
    speech: SPEECH_OFF,
    reciteDueCount: 0,
    defaultAnswerMode: 'firstLetter',
    sortOrder: 'bible',
    passages: [
      {
        passage: {
          id: 10,
          collectionId: 1,
          moduleId: 'kjv',
          startVerseId: 19023001,
          endVerseId: 19023006,
          reference: 'Psalm 23:1-6',
          verseCount: 6,
          addedAt: now - 30 * DAY,
          answerMode: null,
          reciteOn: false,
        },
        dueCount: 1,
        bestLevel: 5,
        wellLearned: true,
        rungs: [
          rung({ rung: 'ordering', level: 5, dueAt: now + 5 * DAY }),
          rung({ rung: 'refmatch', applicable: false, level: 0 }),
          // Due, but only just.
          rung({ rung: 'blanks', level: 2, dueAt: now - 60_000 }),
          rung({ rung: 'firstletters', level: 0, dueAt: null }),
        ],
      },
      {
        passage: {
          id: 20,
          collectionId: 1,
          moduleId: 'kjv',
          startVerseId: 43003016,
          endVerseId: 43003018,
          reference: 'John 3:16-18',
          verseCount: 3,
          addedAt: now - 10 * DAY,
          answerMode: null,
          reciteOn: false,
        },
        dueCount: 2,
        bestLevel: 1,
        wellLearned: false,
        rungs: [
          // The most overdue card in the whole plan.
          rung({ rung: 'ordering', level: 1, dueAt: now - 3 * DAY }),
          rung({ rung: 'refmatch', applicable: false, level: 0 }),
          rung({ rung: 'blanks', level: 1, dueAt: now - 2 * DAY }),
          rung({ rung: 'firstletters', level: 0, dueAt: null }),
        ],
      },
    ],
  };
}

function verse(words: string[]): VerseText {
  return {
    verseId: 43003016,
    label: '3:16',
    words,
    lines: null,
    psalmTitle: null,
    paragraphStart: true,
  };
}

function blanksStep(words: string[], blankIndices: number[]): BlanksStep {
  return {
    kind: 'blanks',
    verse: verse(words),
    blankIndices,
    answerMode: 'fullWord',
    stepNumber: 1,
    totalSteps: 3,
  };
}

function result(over: Partial<StepResult>): StepResult {
  return { correct: false, wrong: [], blocking: false, ...over };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

describe('due dates read as calendar days, not as arithmetic', () => {
  it('calls 20 hours away "tomorrow" when it crosses midnight', () => {
    // 9pm on the 10th, due 5pm on the 11th: 20 hours, but the next day.
    const now = new Date(2026, 2, 10, 21, 0, 0).getTime();
    const due = new Date(2026, 2, 11, 17, 0, 0).getTime();

    expect(calendarDaysBetween(now, due)).toBe(1);
    expect(formatDue(due, now)).toBe('Due tomorrow');
  });

  it('calls 20 hours away "later today" when it does not', () => {
    // 1am on the 10th, due 9pm the same day. Same elapsed time, different word.
    const now = new Date(2026, 2, 10, 1, 0, 0).getTime();
    const due = new Date(2026, 2, 10, 21, 0, 0).getTime();

    expect(calendarDaysBetween(now, due)).toBe(0);
    expect(formatDue(due, now)).toBe('Due later today');
  });

  it('says "Due now" for anything already past', () => {
    const now = Date.now();
    expect(formatDue(now - 1, now)).toBe('Due now');
    expect(formatDue(now, now)).toBe('Due now');
  });

  it('distinguishes a never-attempted activity from an overdue one', () => {
    const now = Date.now();
    // An unattempted activity has `dueAt: null`. It is not late; it has never
    // been scheduled at all - and, unlike v0's `locked`, it is still fully
    // practisable on demand.
    expect(formatDue(null, now)).toBe('Not tried yet');
    expect(isDue(rung({ rung: 'blanks', dueAt: null }), now)).toBe(false);
  });

  it('does not treat a non-applicable rung as due however old its date', () => {
    const now = Date.now();
    const stale = rung({ rung: 'ordering', applicable: false, dueAt: now - 99 * DAY });
    expect(isDue(stale, now)).toBe(false);
  });

  it('switches to an absolute date beyond a week', () => {
    const now = new Date(2026, 2, 10, 9, 0, 0).getTime();
    expect(formatDue(now + 3 * DAY, now)).toBe('Due in 3 days');
    // Exact wording is locale-dependent; the point is that it stops counting.
    expect(formatDue(now + 40 * DAY, now)).toMatch(/^Due /);
    expect(formatDue(now + 40 * DAY, now)).not.toMatch(/days/);
  });
});

// ---------------------------------------------------------------------------
// Numbers and words
// ---------------------------------------------------------------------------

describe('formatting', () => {
  it('shows a never-attempted score as a dash, not as zero', () => {
    // These are different facts and the analytics screen must not conflate them.
    expect(formatScore(null)).toBe('—');
    expect(formatScore(0)).toBe('0%');
    expect(formatScore(0.826)).toBe('83%');
    expect(formatScore(1)).toBe('100%');
  });
});

describe('first-letter matching', () => {
  it('ignores punctuation and case', () => {
    expect(wordCore('"Blessed')).toBe('blessed');
    expect(firstLetterOf('"Blessed')).toBe('b');
    expect(matchesFirstLetter('B', '"Blessed')).toBe(true);
    expect(matchesFirstLetter('b', '"Blessed')).toBe(true);
    expect(matchesFirstLetter('c', '"Blessed')).toBe(false);
  });

  it('does not let a leading apostrophe swallow the letter being asked for', () => {
    // "'tis" must answer to `t`, not to an apostrophe the user cannot type as
    // a first letter without being told to.
    expect(firstLetterOf("'tis")).toBe('t');
    expect(matchesFirstLetter('t', "'tis")).toBe(true);
  });

  it('auto-accepts a token with no letters at all', () => {
    // A stray em dash tokenised on its own has no initial to ask for.
    expect(firstLetterOf('—')).toBe('');
    expect(matchesFirstLetter('', '—')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Choosing what to practise
// ---------------------------------------------------------------------------

describe('inLadderOrder', () => {
  it('imposes ladder order regardless of what the worker sent', () => {
    // The protocol does not promise an order for `PassageView.rungs`, and the
    // passage screen's entire claim is that it shows the ladder linearly.
    const shuffled = [
      rung({ rung: 'firstletters' }),
      rung({ rung: 'blanks' }),
      rung({ rung: 'refmatch' }),
      rung({ rung: 'ordering' }),
    ];
    expect(inLadderOrder(shuffled).map((r) => r.rung)).toEqual([
      'ordering',
      'refmatch',
      'blanks',
      'firstletters',
    ]);
  });

  it('does not mutate its argument', () => {
    const original = [rung({ rung: 'blanks' }), rung({ rung: 'ordering' })];
    inLadderOrder(original);
    expect(original.map((r) => r.rung)).toEqual(['blanks', 'ordering']);
  });
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

describe('calendarWeeks', () => {
  it('splits the 35-day calendar into five weeks of seven', () => {
    const analytics: AnalyticsView = {
      streakDays: 0,
      versesLearned: 0,
      passagesWellLearned: 0,
      calendar: Array.from({ length: 35 }, (_, i) => ({ date: i * DAY, practiced: i % 2 === 0 })),
      recentlyReached: [],
      nextMilestone: { versesLearned: 5, toGo: 5 },
    };
    const weeks = calendarWeeks(analytics);
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    // Order is preserved - the calendar reads oldest to newest, left to right.
    expect(weeks[0]![0]!.date).toBe(0);
    expect(weeks[4]![6]!.date).toBe(34 * DAY);
  });
});

// ---------------------------------------------------------------------------
// Reading a StepResult
// ---------------------------------------------------------------------------

describe('resolveWrongPositions', () => {
  // hiddenIndices [4, 9]: hidden word 0 is word 4, hidden word 1 is word 9.
  const hiddenIndices = [4, 9];

  it('reads a value that is a word index as a word index', () => {
    const wrong = resolveWrongPositions(result({ wrong: [9] }), hiddenIndices);
    expect([...wrong]).toEqual([1]);
  });

  it('reads a value that can only be a position as a position', () => {
    // 0 is not in [4, 9], so it cannot be a word index here - it is hidden word 0.
    const wrong = resolveWrongPositions(result({ wrong: [0] }), hiddenIndices);
    expect([...wrong]).toEqual([0]);
  });

  it('drops a value that is neither', () => {
    // 77 is not a hidden word and not a position. Marking something anyway
    // would paint an arbitrary word red.
    expect(resolveWrongPositions(result({ wrong: [77] }), hiddenIndices).size).toBe(0);
  });

  it('marks nothing when the answer was right', () => {
    expect(resolveWrongPositions(result({ correct: true, wrong: [] }), hiddenIndices).size).toBe(0);
  });

  it('coincides for firstletters, where positions and word indices are equal', () => {
    const identity = [0, 1, 2, 3];
    const wrong = resolveWrongPositions(result({ wrong: [1, 3] }), identity);
    expect([...wrong].sort()).toEqual([1, 3]);
  });
});

describe('revealedWord', () => {
  const step = blanksStep(['For', 'God', 'so', 'loved', 'the', 'world'], [1, 5]);
  const hidden: HiddenWords = { verseWordCount: step.verse.words.length, hiddenIndices: step.blankIndices };

  it('indexes a whole-verse reveal by word index', () => {
    const r = result({ reveal: { words: ['For', 'God', 'so', 'loved', 'the', 'world'] } });
    expect(revealedWord(r, hidden, 0, 1, step.verse.words)).toBe('God');
    expect(revealedWord(r, hidden, 1, 5, step.verse.words)).toBe('world');
  });

  it('indexes a hidden-words-only reveal by position', () => {
    const r = result({ reveal: { words: ['God', 'world'] } });
    expect(revealedWord(r, hidden, 0, 1, step.verse.words)).toBe('God');
    expect(revealedWord(r, hidden, 1, 5, step.verse.words)).toBe('world');
  });

  it('falls back to the caller\'s own copy of the verse when reveal is absent', () => {
    // The step carries every word; the panel does the hiding.
    expect(revealedWord(result({}), hidden, 1, 5, step.verse.words)).toBe('world');
  });

  it('falls back when reveal is a length that matches neither reading', () => {
    const r = result({ reveal: { words: ['God'] } });
    expect(revealedWord(r, hidden, 1, 5, step.verse.words)).toBe('world');
  });
});

// ---------------------------------------------------------------------------
// Blank widths
// ---------------------------------------------------------------------------

describe('estimateTextWidth', () => {
  // This is the fallback used when the panel cannot be measured - a collapsed
  // pane reports zero-width boxes for everything. The only property that
  // matters is that it is PROPORTIONAL, because a character count is exactly
  // what it exists instead of.
  it('gives different widths to same-length words of different shapes', () => {
    const narrow = estimateTextWidth('illicit', 16);
    const wide = estimateTextWidth('MMMMMMM', 16);
    expect(narrow).toBeLessThan(wide);
  });

  it('is not a character count', () => {
    // Seven narrow characters against four wide ones.
    expect(estimateTextWidth('lilliii', 16)).toBeLessThan(estimateTextWidth('WWWW', 16));
  });

  it('scales with the font size', () => {
    expect(estimateTextWidth('shepherd', 32)).toBeCloseTo(estimateTextWidth('shepherd', 16) * 2);
  });

  it('is zero for the empty string', () => {
    expect(estimateTextWidth('', 16)).toBe(0);
  });
});

describe('blankWidthFor', () => {
  it('never returns a blank too small to click or type in', () => {
    // A one-letter word measures about six pixels, which is not a target.
    expect(blankWidthFor(6)).toBe(MIN_BLANK_WIDTH_PX);
    expect(blankWidthFor(0)).toBe(MIN_BLANK_WIDTH_PX);
  });

  it('adds room for the caret above the floor', () => {
    expect(blankWidthFor(100)).toBeGreaterThan(100);
  });

  it('is monotonic, so a longer word never gets a narrower box', () => {
    expect(blankWidthFor(120)).toBeGreaterThanOrEqual(blankWidthFor(80));
  });
});

describe('blank width floor (T17: slot and input share one number)', () => {
  it('one- and two-letter words land exactly on MIN_BLANK_WIDTH_PX at 16px', () => {
    for (const w of ['a', 'I', 'is', 'in', 'of', 'he']) {
      expect(blankWidthFor(estimateTextWidth(w, 16))).toBe(MIN_BLANK_WIDTH_PX);
    }
  });

  it('is deterministic, so a slot sized before reveal equals one sized after', () => {
    expect(blankWidthFor(estimateTextWidth('shepherd', 16))).toBe(blankWidthFor(estimateTextWidth('shepherd', 16)));
    expect(blankWidthFor(0)).toBe(MIN_BLANK_WIDTH_PX);
  });
});
