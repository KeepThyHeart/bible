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
  countLabel,
  firstLetterOf,
  formatDue,
  formatScore,
  formatStepProgress,
  inLadderOrder,
  isDue,
  matchesFirstLetter,
  pickDueTarget,
  sortPassagesByNeed,
  suggestedRungFor,
  wordCore,
} from '../src/ui/format';
import { blankWidthFor, estimateTextWidth, MIN_BLANK_WIDTH_PX } from '../src/ui/measure';
import { ACTIVITY_TILES } from '../src/ui/activities';
import { INITIAL_NAV, navReduce, sameView } from '../src/ui/state';
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

  it('does not print "of 0" when the worker sends no total', () => {
    expect(formatStepProgress(3, 7)).toBe('Step 3 of 7');
    expect(formatStepProgress(3, 0)).toBe('Step 3');
  });

  it('pluralises with the count', () => {
    expect(countLabel(1, 'verse')).toBe('1 verse');
    expect(countLabel(6, 'verse')).toBe('6 verses');
    expect(countLabel(2, 'pass', 'passes')).toBe('2 passes');
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

describe('pickDueTarget', () => {
  const now = Date.UTC(2026, 5, 1, 12, 0, 0);

  it('starts the card that has been waiting longest', () => {
    const target = pickDueTarget(plan(now), now);
    expect(target).not.toBeNull();
    expect(target?.passageId).toBe(20);
    expect(target?.rung).toBe('ordering');
    expect(target?.reference).toBe('John 3:16-18');
  });

  it('breaks a tie by ladder position, not by passage order', () => {
    const p = plan(now);
    // Make a late passage's first-letters card due at exactly the same instant
    // as an earlier passage's ordering card.
    const at = now - DAY;
    p.passages[0]!.rungs = [rung({ rung: 'firstletters', level: 3, dueAt: at })];
    p.passages[1]!.rungs = [rung({ rung: 'ordering', level: 3, dueAt: at })];

    // Passage 10 comes first in the list, but `ordering` is the lower rung and
    // is what is holding its own passage up.
    expect(pickDueTarget(p, now)?.rung).toBe('ordering');
    expect(pickDueTarget(p, now)?.passageId).toBe(20);
  });

  it('returns null when nothing is due rather than picking arbitrarily', () => {
    const p = plan(now);
    for (const pv of p.passages) {
      pv.rungs = pv.rungs.map((r) => rung({ ...r, dueAt: now + 5 * DAY }));
    }
    expect(pickDueTarget(p, now)).toBeNull();
  });

  it('ignores rungs that do not apply even when their date has passed', () => {
    const p = plan(now);
    p.passages[0]!.rungs = [
      rung({ rung: 'refmatch', applicable: false, dueAt: now - 99 * DAY }),
    ];
    p.passages[1]!.rungs = [];
    expect(pickDueTarget(p, now)).toBeNull();
  });
});

describe('suggestedRungFor', () => {
  const now = Date.UTC(2026, 5, 1, 12, 0, 0);

  it('prefers a due rung', () => {
    const rungs = [
      rung({ rung: 'ordering', level: 5, dueAt: now + DAY }),
      rung({ rung: 'blanks', level: 3, dueAt: now - DAY }),
    ];
    expect(suggestedRungFor(rungs, now)).toBe('blanks');
  });

  it('otherwise offers the lowest rung that has not reached level 4', () => {
    const rungs = [
      rung({ rung: 'ordering', level: 5, dueAt: now + DAY }),
      rung({ rung: 'blanks', level: 1, dueAt: now + 2 * DAY }),
      rung({ rung: 'firstletters', level: 0 }),
    ];
    expect(suggestedRungFor(rungs, now)).toBe('blanks');
  });

  it('skips a rung that does not apply', () => {
    const rungs = [
      rung({ rung: 'ordering', applicable: false, level: 0 }),
      rung({ rung: 'blanks', level: 1, dueAt: now + DAY }),
    ];
    expect(suggestedRungFor(rungs, now)).toBe('blanks');
  });

  it('suggests the hardest applicable rung once everything is well learned, rather than nothing', () => {
    // Task 0004 dropped the v0 dead end where a fully mastered, not-yet-due
    // passage had no suggestion at all. Something practisable should always
    // be offered, even if it is only upkeep.
    const rungs = [
      rung({ rung: 'ordering', level: 5, dueAt: now + DAY }),
      rung({ rung: 'blanks', level: 4, dueAt: now + DAY }),
      rung({ rung: 'refmatch', applicable: false, level: 0 }),
      rung({ rung: 'firstletters', level: 5, dueAt: now + DAY }),
    ];
    expect(suggestedRungFor(rungs, now)).toBe('firstletters');
  });

  it('returns null only when nothing on the passage applies at all', () => {
    expect(suggestedRungFor([rung({ rung: 'refmatch', applicable: false })], now)).toBeNull();
  });
});

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
// Navigation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Passage ordering and the activity catalogue
// ---------------------------------------------------------------------------

function passage(over: Partial<Passage> & Pick<Passage, 'id'>): Passage {
  return {
    collectionId: 1,
    moduleId: 'kjv',
    startVerseId: 1,
    endVerseId: 1,
    reference: `Passage ${over.id}`,
    verseCount: 1,
    addedAt: 0,
    answerMode: null,
    reciteOn: false,
    ...over,
  };
}

function passageView(
  over: Partial<Omit<PassageView, 'passage'>> & { passage: Partial<Passage> & Pick<Passage, 'id'> },
): PassageView {
  return {
    dueCount: 0,
    bestLevel: 0,
    wellLearned: false,
    rungs: [],
    ...over,
    passage: passage(over.passage),
  };
}

describe('sortPassagesByNeed', () => {
  const now = Date.UTC(2026, 5, 1, 12, 0, 0);

  it('orders by earliest dueAt, then never-attempted, then level, then dueCount, then addedAt', () => {
    // Due one day ago - overdue, but less so than the next one.
    const dueOneDayAgo = passageView({
      passage: { id: 1, addedAt: 900 },
      dueCount: 1,
      bestLevel: 3,
      rungs: [rung({ rung: 'blanks', dueAt: now - DAY, level: 3 })],
    });
    // Due five days ago - the smallest (earliest) dueAt of the two, so this
    // one sorts first despite its lower bestLevel: due status and recency
    // outrank level entirely.
    const dueFiveDaysAgo = passageView({
      passage: { id: 2, addedAt: 800 },
      dueCount: 1,
      bestLevel: 2,
      rungs: [rung({ rung: 'blanks', dueAt: now - 5 * DAY, level: 2 })],
    });
    const neverAttempted = passageView({
      passage: { id: 3, addedAt: 700 },
      dueCount: 0,
      bestLevel: 0,
      rungs: [rung({ rung: 'blanks', dueAt: null, level: 0 })],
    });
    const lowLevel = passageView({
      passage: { id: 4, addedAt: 600 },
      dueCount: 0,
      bestLevel: 1,
      rungs: [rung({ rung: 'blanks', dueAt: now + DAY, level: 1 })],
    });
    const higherLevel = passageView({
      passage: { id: 5, addedAt: 500 },
      dueCount: 0,
      bestLevel: 2,
      rungs: [rung({ rung: 'blanks', dueAt: now + DAY, level: 2 })],
    });

    // Not due, not never-attempted, same bestLevel (2) as `higherLevel` -
    // tiebreak on dueCount (higher first).
    const sameLevelMoreDue = passageView({
      passage: { id: 6, addedAt: 400 },
      dueCount: 3,
      bestLevel: 2,
      rungs: [rung({ rung: 'blanks', dueAt: now + DAY, level: 2 })],
    });

    const sorted = sortPassagesByNeed(
      [higherLevel, dueOneDayAgo, lowLevel, neverAttempted, sameLevelMoreDue, dueFiveDaysAgo],
      now,
    );

    expect(sorted.map((pv) => pv.passage.id)).toEqual([
      // Due, earliest dueAt first: id 2 (five days ago) before id 1 (one day ago).
      2, 1,
      // Never attempted.
      3,
      // Ascending bestLevel among the rest.
      4,
      // bestLevel ties at 2 between `sameLevelMoreDue` (dueCount 3) and
      // `higherLevel` (dueCount 0) - descending dueCount wins.
      6, 5,
    ]);
  });

  it('breaks a full tie by oldest addedAt', () => {
    const a = passageView({ passage: { id: 1, addedAt: 200 }, dueCount: 0, bestLevel: 2 });
    const b = passageView({ passage: { id: 2, addedAt: 100 }, dueCount: 0, bestLevel: 2 });
    expect(sortPassagesByNeed([a, b], now).map((pv) => pv.passage.id)).toEqual([2, 1]);
  });

  it('does not mutate its argument', () => {
    const a = passageView({ passage: { id: 1, addedAt: 200 }, bestLevel: 2 });
    const b = passageView({ passage: { id: 2, addedAt: 100 }, bestLevel: 1 });
    const original = [a, b];
    sortPassagesByNeed(original, now);
    expect(original.map((pv) => pv.passage.id)).toEqual([1, 2]);
  });
});


describe('ACTIVITY_TILES', () => {
  it('lists the six tiles in the design doc order, with verbatim copy', () => {
    expect(ACTIVITY_TILES.map((t) => t.id)).toEqual([
      'variety',
      'refmatch',
      'ordering',
      'blanks',
      'firstletters',
      'refprovide',
    ]);

    const byId = Object.fromEntries(ACTIVITY_TILES.map((t) => [t.id, t]));

    expect(byId.variety).toMatchObject({
      rung: null,
      title: 'Variety',
      subtext: "A mix of activities based on what's next in better learning your verse list.",
    });
    expect(byId.refmatch).toMatchObject({
      rung: 'refmatch',
      title: 'Match References',
      subtext: "Match a passage's text to its reference.",
    });
    expect(byId.ordering).toMatchObject({
      rung: 'ordering',
      title: 'Put in Order',
      subtext: 'A passage has its verses shuffled, and you put them in order.',
    });
    expect(byId.blanks).toMatchObject({
      rung: 'blanks',
      title: 'Fill in the Blanks',
      subtext: 'A passage is shown with blanks, and you provide the first letter or the entire word for each blank.',
    });
    expect(byId.firstletters).toMatchObject({
      rung: 'firstletters',
      title: 'First Letters',
      subtext: 'A passage reference is given, and you type the first letter of each word, in order.',
    });
    expect(byId.refprovide).toMatchObject({
      // M7 landed the exercise: unlike `variety`, `refprovide` names a real
      // `Rung` now.
      rung: 'refprovide',
      title: 'Provide Reference',
      subtext: 'The passage text is shown, and you type its reference.',
    });
  });
});


// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe('navReduce', () => {
  it('returns a session started from the plan to the plan', () => {
    let state = INITIAL_NAV;
    state = navReduce(state, {
      type: 'sessionStarted',
      sessionId: 's1',
      passageId: 1,
      rung: 'blanks',
      flow: { kind: 'passage', passageId: 1 },
    });
    expect(state.view).toEqual({ name: 'practice', sessionId: 's1' });

    state = navReduce(state, { type: 'sessionEnded' });
    expect(state.view).toEqual({ name: 'plan' });
  });

  it('returns a session started from a passage screen to THAT passage screen', () => {
    // The user was working through one passage's activities. Dropping them at
    // the top level afterwards loses their place, which is the whole reason
    // this reducer holds a `returnTo` at all.
    let state = navReduce(INITIAL_NAV, { type: 'goPassage', passageId: 42 });
    state = navReduce(state, {
      type: 'sessionStarted',
      sessionId: 's2',
      passageId: 42,
      rung: 'ordering',
      flow: { kind: 'passage', passageId: 42 },
    });
    state = navReduce(state, { type: 'sessionEnded' });

    expect(state.view).toEqual({ name: 'passage', passageId: 42, rung: 'ordering' });
  });

  it('remembers the tab (rung) the session was on, not the tab the passage screen last showed', () => {
    // The passage screen was showing "suggested" (no explicit rung), but the
    // activity actually practiced was `blanks` - `sessionEnded` should land
    // back on `blanks`, not on `null`/suggested again.
    let state = navReduce(INITIAL_NAV, { type: 'goPassage', passageId: 42 });
    expect(state.view).toEqual({ name: 'passage', passageId: 42, rung: null });

    state = navReduce(state, {
      type: 'sessionStarted',
      sessionId: 's3',
      passageId: 42,
      rung: 'blanks',
      flow: { kind: 'passage', passageId: 42 },
    });
    expect(state.returnTo).toEqual({ name: 'passage', passageId: 42, rung: 'blanks' });

    state = navReduce(state, { type: 'sessionEnded' });
    expect(state.view).toEqual({ name: 'passage', passageId: 42, rung: 'blanks' });
  });

  it('does not let practice become its own return target', () => {
    let state = navReduce(INITIAL_NAV, { type: 'goPassage', passageId: 7 });
    state = navReduce(state, {
      type: 'sessionStarted',
      sessionId: 'a',
      passageId: 7,
      rung: 'ordering',
      flow: { kind: 'passage', passageId: 7 },
    });
    // A second session started without ending the first - "Practice again".
    state = navReduce(state, {
      type: 'sessionStarted',
      sessionId: 'b',
      passageId: 7,
      rung: 'ordering',
      flow: { kind: 'passage', passageId: 7 },
    });

    expect(state.view).toEqual({ name: 'practice', sessionId: 'b' });
    expect(state.returnTo).toEqual({ name: 'passage', passageId: 7, rung: 'ordering' });
  });

  it('keeps the original return target when a later session (mid-practice) switches rung or passage', () => {
    // "Next due" from the summary screen can start a session for a different
    // passage and rung entirely, without ever leaving practice. `returnTo`
    // must still point at wherever the *first* session in the chain was
    // launched from - not be overwritten with the second session's passage
    // or rung, and not become practice itself either.
    let state = navReduce(INITIAL_NAV, { type: 'goPassage', passageId: 7 });
    state = navReduce(state, {
      type: 'sessionStarted',
      sessionId: 'a',
      passageId: 7,
      rung: 'ordering',
      flow: { kind: 'passage', passageId: 7 },
    });
    expect(state.returnTo).toEqual({ name: 'passage', passageId: 7, rung: 'ordering' });

    // Switch rung mid-flow on the same passage.
    state = navReduce(state, {
      type: 'sessionStarted',
      sessionId: 'b',
      passageId: 7,
      rung: 'blanks',
      flow: { kind: 'passage', passageId: 7 },
    });
    expect(state.view).toEqual({ name: 'practice', sessionId: 'b' });
    expect(state.returnTo).toEqual({ name: 'passage', passageId: 7, rung: 'ordering' });

    // "Next due" moves to an entirely different passage.
    state = navReduce(state, {
      type: 'sessionStarted',
      sessionId: 'c',
      passageId: 99,
      rung: 'refmatch',
      flow: { kind: 'variety' },
    });
    expect(state.view).toEqual({ name: 'practice', sessionId: 'c' });
    expect(state.returnTo).toEqual({ name: 'passage', passageId: 7, rung: 'ordering' });
    // Unlike `returnTo`, `flow` is NOT pinned to the chain's first session -
    // it names what the *current* session belongs to, so the third session's
    // own flow replaces the first two's.
    expect(state.flow).toEqual({ kind: 'variety' });
  });

  it('clears a stale return target when Analytics is opened', () => {
    let state = navReduce(INITIAL_NAV, { type: 'goPassage', passageId: 7 });
    state = navReduce(state, { type: 'goAnalytics' });
    expect(state.returnTo).toEqual({ name: 'plan' });
  });

  it('clears a stale return target when Settings is opened', () => {
    let state = navReduce(INITIAL_NAV, { type: 'goPassage', passageId: 7 });
    state = navReduce(state, { type: 'goSettings' });
    expect(state.returnTo).toEqual({ name: 'plan' });
  });

  it('clears a stale return target when Manage Passages is opened', () => {
    let state = navReduce(INITIAL_NAV, { type: 'goPassage', passageId: 7 });
    state = navReduce(state, { type: 'goManagePassages' });
    expect(state.view).toEqual({ name: 'managePassages' });
    expect(state.returnTo).toEqual({ name: 'plan' });
  });

  it('carries flow forward unchanged through goManagePassages, like every other leaf', () => {
    let state = navReduce(INITIAL_NAV, { type: 'goPassage', passageId: 7 });
    state = navReduce(state, {
      type: 'sessionStarted',
      sessionId: 'a',
      passageId: 7,
      rung: 'ordering',
      flow: { kind: 'passage', passageId: 7 },
    });
    state = navReduce(state, { type: 'sessionEnded' });
    state = navReduce(state, { type: 'goManagePassages' });
    expect(state.flow).toEqual({ kind: 'passage', passageId: 7 });
  });

  it('leaves a passage screen for a removed passage', () => {
    let state = navReduce(INITIAL_NAV, { type: 'goPassage', passageId: 7 });
    state = navReduce(state, { type: 'passageRemoved', passageId: 7 });
    expect(state.view).toEqual({ name: 'plan' });
  });

  it('ignores the removal of some other passage', () => {
    const state = navReduce(INITIAL_NAV, { type: 'goPassage', passageId: 7 });
    expect(navReduce(state, { type: 'passageRemoved', passageId: 9 })).toBe(state);
  });

  it('does not yank a live session off the screen when its passage is removed', () => {
    // Mid-answer is the worst possible moment to replace the screen. Only the
    // destination is repaired.
    let state = navReduce(INITIAL_NAV, { type: 'goPassage', passageId: 7 });
    state = navReduce(state, {
      type: 'sessionStarted',
      sessionId: 's',
      passageId: 7,
      rung: 'ordering',
      flow: { kind: 'passage', passageId: 7 },
    });
    state = navReduce(state, { type: 'passageRemoved', passageId: 7 });

    expect(state.view).toEqual({ name: 'practice', sessionId: 's' });
    expect(state.returnTo).toEqual({ name: 'plan' });
  });

  it('ignores sessionEnded when no session is running', () => {
    expect(navReduce(INITIAL_NAV, { type: 'sessionEnded' })).toBe(INITIAL_NAV);
  });

  it('goPassage with an explicit rung sets the view to that rung', () => {
    const state = navReduce(INITIAL_NAV, { type: 'goPassage', passageId: 7, rung: 'firstletters' });
    expect(state.view).toEqual({ name: 'passage', passageId: 7, rung: 'firstletters' });
    expect(state.returnTo).toEqual({ name: 'passage', passageId: 7, rung: 'firstletters' });
  });

  it('goPassage without a rung sets it to null (suggested)', () => {
    const state = navReduce(INITIAL_NAV, { type: 'goPassage', passageId: 7 });
    expect(state.view).toEqual({ name: 'passage', passageId: 7, rung: null });
  });

  // -------------------------------------------------------------------------
  // flow (N6, Decision 4)
  // -------------------------------------------------------------------------

  it('has no flow before any session has started', () => {
    expect(INITIAL_NAV.flow).toBeNull();
  });

  it('records the flow a session started with', () => {
    const activity: Flow = { kind: 'activity', rung: 'blanks' };
    const state = navReduce(INITIAL_NAV, {
      type: 'sessionStarted',
      sessionId: 's1',
      passageId: 1,
      rung: 'blanks',
      flow: activity,
    });
    expect(state.flow).toEqual(activity);
  });

  it('carries flow forward, unreset, through actions that are not sessionStarted', () => {
    // Only `sessionStarted` is documented as writing `flow`; every other
    // action - even ones that reset `view`/`returnTo` outright, like
    // `goAnalytics` - carries whatever flow was already there forward
    // unchanged. It is only ever read while `view.name === 'practice'`, so a
    // stale value sitting here between sessions is harmless.
    const variety: Flow = { kind: 'variety' };
    let state = navReduce(INITIAL_NAV, {
      type: 'sessionStarted',
      sessionId: 's1',
      passageId: 1,
      rung: 'blanks',
      flow: variety,
    });
    state = navReduce(state, { type: 'sessionEnded' });
    expect(state.flow).toEqual(variety);

    state = navReduce(state, { type: 'goAnalytics' });
    expect(state.flow).toEqual(variety);

    state = navReduce(state, { type: 'goSettings' });
    expect(state.flow).toEqual(variety);

    state = navReduce(state, { type: 'goPlan' });
    expect(state.flow).toEqual(variety);

    state = navReduce(state, { type: 'goPassage', passageId: 5 });
    expect(state.flow).toEqual(variety);
  });

  it('carries flow forward through passageRemoved, on both the stranded and untouched paths', () => {
    const activity: Flow = { kind: 'activity', rung: 'ordering' };
    let state = navReduce(INITIAL_NAV, {
      type: 'sessionStarted',
      sessionId: 's1',
      passageId: 1,
      rung: 'ordering',
      flow: activity,
    });
    state = navReduce(state, { type: 'sessionEnded' }); // back to plan, flow persists
    state = navReduce(state, { type: 'goPassage', passageId: 7 });

    // Stranded: the current passage screen is the one removed.
    const stranded = navReduce(state, { type: 'passageRemoved', passageId: 7 });
    expect(stranded.flow).toEqual(activity);

    // Untouched: some other passage is removed - the `default`-like early
    // return in `passageRemoved` still has to carry `flow`, not drop it.
    const untouched = navReduce(state, { type: 'passageRemoved', passageId: 999 });
    expect(untouched.flow).toEqual(activity);
  });
});

describe('sameView', () => {
  it('distinguishes passage screens for different passages', () => {
    expect(
      sameView({ name: 'passage', passageId: 1, rung: null }, { name: 'passage', passageId: 1, rung: null }),
    ).toBe(true);
    expect(
      sameView({ name: 'passage', passageId: 1, rung: null }, { name: 'passage', passageId: 2, rung: null }),
    ).toBe(false);
    expect(sameView({ name: 'plan' }, { name: 'analytics' })).toBe(false);
  });

  it('distinguishes passage screens for the same passage on different rungs', () => {
    expect(
      sameView(
        { name: 'passage', passageId: 1, rung: 'blanks' },
        { name: 'passage', passageId: 1, rung: 'ordering' },
      ),
    ).toBe(false);
    expect(
      sameView({ name: 'passage', passageId: 1, rung: null }, { name: 'passage', passageId: 1, rung: 'blanks' }),
    ).toBe(false);
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
