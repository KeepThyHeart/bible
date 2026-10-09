/**
 * Domain types and the panel <-> worker protocol.
 *
 * This file is the contract between the two halves of the extension and is
 * deliberately the first thing written. The worker owns all state, all
 * persistence and all scoring; the panel owns pixels and nothing else. Every
 * message below crosses `api.panels.postMessage` / `BibleExtUI.postToWorker`,
 * which means two hard constraints:
 *
 *   1. Everything here must be structured-cloneable JSON. No class instances,
 *      no functions, no `Date` (epoch milliseconds instead), no `undefined`
 *      inside arrays.
 *   2. Messages are capped at 256 KB each way. A whole book of verse text
 *      would blow that, so the panel asks for one passage's context at a time
 *      and never for a book.
 *
 * ## v1: nothing is locked
 *
 * The original design gated a rung behind two consecutive passes of the one
 * before it (`CardState.locked`, `shouldPromote`). The human review of that
 * design (task 0004) asked for it to be dropped entirely: every activity is
 * always practisable, every attempt counts and reschedules, and a harder
 * activity's level simply carries over into the passage's overall "well
 * learned" status. There is therefore no `locked` state and no `replay`
 * concept any more - see `ladder.ts` for the five-level scale that replaced
 * the four-state one.
 */

import type {
  CardStackView,
  PushCardSettings,
  PushSettingsView,
  RecallGrade,
} from './pushTypes';

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

/**
 * One rung of a mastery ladder.
 *
 * There are two ladders, not one, and they converge after the first rung. Which
 * first rung applies is a property of the *material*, not of the user:
 *
 *   - `ordering`  - a multi-verse passage. "Which verse comes next?"
 *   - `refmatch`  - given the words, choose the reference. Needs a big enough
 *                   scope to draw plausible distractors from.
 *   - `blanks`    - shared second rung. Type the missing words.
 *   - `firstletters` - shared third rung. Every word is a blank.
 *   - `refprovide` - given the words, *supply* the reference from memory. The
 *                    hardest reference activity, and the only single-tier one.
 *
 * Reordering a single verse is meaningless and the two reference activities
 * need enough material in scope to be more than a formality, so a lone single
 * verse in a collection can do none of them and starts at `blanks`. That edge
 * case is why `firstRungFor` exists rather than a constant.
 *
 * Which rungs a passage has *cards* for is a property of the material alone
 * (`ladder.ts#materialRungs`); which of those *apply* right now is recomputed
 * on every read (`ladder.ts#applicableRungs`), because it depends on facts -
 * how many verses are in scope, how many sibling passages exist - that change
 * under a card without the card itself changing.
 */
export type Rung = 'ordering' | 'refmatch' | 'blanks' | 'firstletters' | 'refprovide' | 'recite';

/**
 * Every rung in ladder order, easiest first.
 *
 * "Later in this array is harder" is load-bearing: `ui/format.ts#carriesDownFrom`
 * and `ladder.ts#TEXT_RECALL_CHAIN` both read the direction off it, so a
 * reordering here silently changes what "a harder activity has been mastered"
 * means.
 */
export const RUNG_ORDER: readonly Rung[] = [
  'ordering',
  'refmatch',
  'blanks',
  'firstletters',
  'refprovide',
  /** Optional and spoken; last, but never required for mastery (`ladder.ts#OPTIONAL_RUNGS`). */
  'recite',
];

/**
 * How a hidden word is answered - a setting, not a property of the exercise.
 *
 * `firstLetter` (the default) asks for one letter per hidden word and reveals
 * the whole word the moment it is right; `fullWord` asks for the whole word,
 * spelled out, and is graded leniently on punctuation and case but strictly on
 * letters. It applies identically to `blanks` and `firstletters` - the two
 * activities differ only in *how many* words are hidden, never in how a hidden
 * word is answered.
 */
export type AnswerMode = 'firstLetter' | 'fullWord';

/**
 * A named group of passages - a "list". v0 shipped exactly one, and named it
 * "My plan"; T5 lets the user have several, so a fresh install now names the
 * first one "Default" instead (see `main.ts#DEFAULT_COLLECTION_NAME`, and the
 * one-time activation rename for a database that predates this task).
 */
export interface Collection {
  id: number;
  name: string;
  createdAt: number;
}

/**
 * One row of `MemoryStore#listCollections` / `PlanView.lists` - a list plus
 * the totals the "switch list" UI needs without a second round trip.
 *
 * `verseCount` sums `Passage.verseCount` across the list's passages - it is a
 * verse total, not a passage count, which matters the moment a list holds
 * anything longer than a single verse.
 */
export interface ListSummary {
  id: number;
  name: string;
  passageCount: number;
  verseCount: number;
}

/**
 * What the plan list and the due/next-due queries are filtered to: either
 * everything across every list, or one specific list.
 *
 * Resolved decision D2(i): a passage belongs to exactly one list. Scope is
 * what lets the *read* side act as if lists were independent plans while the
 * schema stays a single `passage` table - see `store.ts#getScope` for where a
 * scope naming a list that no longer exists is caught and treated as `'all'`.
 */
export type Scope = { kind: 'all' } | { kind: 'list'; id: number };

/**
 * A passage under memorisation: an inclusive verse-id range in one module.
 *
 * `moduleId` is stored because the same reference in two translations is two
 * different memorisation tasks - the words differ, so the cards differ.
 */
export interface Passage {
  id: number;
  collectionId: number;
  moduleId: string;
  startVerseId: number;
  endVerseId: number;
  /** Display reference, e.g. "John 3:16-18". Resolved once at add time. */
  reference: string;
  /** Verse count, cached so the plan list does not need the text. */
  verseCount: number;
  addedAt: number;
  /** This passage's own answer-mode override, or `null` to use the default. */
  answerMode: AnswerMode | null;
  /** Include this passage in "Recite what's due" before its first recitation. */
  reciteOn: boolean;
}

/** A schedulable unit: one passage at one rung. Never locked; always practisable. */
export interface Card {
  id: number;
  passageId: number;
  rung: Rung;
  /** Index into the interval ladder. -1 while the card has never passed. */
  intervalStep: number;
  /** Epoch ms. `null` until the first attempt sets a schedule. */
  dueAt: number | null;
  /** Consecutive passing attempts. Reset to 0 by a failure. */
  streak: number;
  /** Score of the most recent attempt, 0..1. `null` if never tried. */
  lastScore: number | null;
}

/**
 * One recorded attempt. These rows are never pruned.
 *
 * That is a stated rule rather than an accident: the user asked to keep the
 * data even where the UI does not surface it, so that a statistic they decide
 * they want later can be computed over real history instead of starting from
 * the day it was added.
 */
export interface AttemptRow {
  id: number;
  cardId: number;
  at: number;
  /** 0..1. Correct-first-attempts over steps. */
  score: number;
  correctFirst: number;
  totalSteps: number;
  /**
   * Which difficulty tier of the activity this attempt answered, 0-based.
   *
   * 0 for every row recorded before tiers existed - see the v3 migration's
   * `DEFAULT 0`, which is what makes the upgrade lossless.
   */
  tier: number;
  /**
   * Wall-clock length of the session that produced this row, in milliseconds.
   * `null` for older rows recorded before this column existed. Not shown
   * anywhere in the UI yet - stored now so a future Analytics screen does not
   * have to start counting from the day someone asks for it.
   */
  durationMs: number | null;
}

// ---------------------------------------------------------------------------
// Views - what the panel actually renders
// ---------------------------------------------------------------------------

/** How far along a paused activity is, so "Resume" can say where it left off. */
export interface ResumeState {
  /** Verses (or ordering steps) already completed. */
  stepsDone: number;
  totalSteps: number;
}

export interface RungView {
  rung: Rung;
  /**
   * 0 (never tried) to 5 (basically perfect). See `ladder.ts#levelForActivity`
   * for the exact formula - it is derived from per-tier bests, not from the
   * last score, and it never decreases except through an explicit
   * "Reset progress" (`resetPassageProgress`).
   */
  level: number;
  dueAt: number | null;
  streak: number;
  lastScore: number | null;
  /** False when this rung does not apply to this passage at all. */
  applicable: boolean;
  /** Set when this activity was left mid-way and can be resumed. */
  resume: ResumeState | null;
  /** How many difficulty tiers this activity has. See `ladder.ts#TIERS`. */
  tiers: number;
  /** How many of them have ever been passed (best score >= `PASS_THRESHOLD`). */
  tiersPassed: number;
  /**
   * Best score ever recorded on this activity since the last reset, 0..1.
   * `null` when it has never been attempted - which is different from 0.
   */
  bestScore: number | null;
  /** Attempts recorded since the last reset. 0 means "never tried". */
  attempts: number;
  /**
   * The tier the next session should serve: the lowest tier not yet passed,
   * or the hardest tier once every tier has been passed. 0-based.
   */
  nextTier: number;
  /** True for an optional rung (recite): it never blocks mastery and is hidden when unavailable. */
  optional?: true;
}

/** A passage plus its ladder, as the plan list and passage screen need it. */
export interface PassageView {
  passage: Passage;
  rungs: RungView[];
  /** Number of applicable rungs due now. Drives the badge on the plan row. */
  dueCount: number;
  /**
   * The highest level reached by any applicable rung.
   *
   * A level reached on a harder activity counts for the whole passage without
   * implying the easier ones were themselves practised to that level - see the
   * task 0004 review, point 10. It is a headline number for the plan row; it
   * is NOT what decides `wellLearned` any more (see below).
   */
  bestLevel: number;
  /**
   * True when **every applicable activity is satisfied**.
   *
   * An activity is satisfied when either its own level has reached
   * `WELL_LEARNED_LEVEL` (4), or a *harder* activity in the text-recall chain
   * (`ladder.ts#TEXT_RECALL_CHAIN`, easiest first) has - recalling a passage
   * from first letters alone demonstrates the ordering and the missing words
   * as a by-product, so it carries down, while the reverse does not.
   *
   * This is stricter than the old "`bestLevel >= 4`" rule, which let one
   * mastered activity speak for a passage whose other activities had never
   * been opened. It is also never vacuously true: a passage with zero
   * applicable activities - every reference activity gated out by the
   * 25-verse scope rule, say - is not well learned, it is untested.
   */
  wellLearned: boolean;
}

/** How the passage list orders its rows - see `ui/format.ts#sortPassagesByNeed`. */
export type PassageSortOrder = 'bible' | 'need';

export interface PlanView {
  /** Push cards waiting to be recalled (task 0072). 0 when the feature is off. */
  cardsWaiting: number;
  /**
   * The list new passages would land in right now: the scoped list's id, or
   * (scope `'all'`) the Default list's id. Kept - rather than dropped - for
   * T9/T10, which have not run yet; it no longer has any title role (see
   * `collectionName` below and `ui/planView.ts`, whose title T10 replaces
   * with the literal string "Bible Memory").
   */
  collectionId: number;
  /**
   * The name of the list `collectionId` refers to, or `'All lists'` when
   * `scope` is `'all'`. T5 drops this field's role as the panel title -
   * `ui/planView.ts` still reads it that way today, and T10 is the task that
   * changes the title to the literal string "Bible Memory"; until then this
   * keeps that screen rendering something sensible rather than blank.
   */
  collectionName: string;
  lists: ListSummary[];
  /** The scope this view was built from - `'all'`, or one list's id. */
  scope: 'all' | number;
  /**
   * Verses across the current scope: every list when `scope` is `'all'`,
   * otherwise just the scoped list. Drives `referenceActivitiesUnlocked` and
   * is exposed separately because a "N verses to go" message needs the raw
   * number, not just the boolean.
   */
  scopeVerseCount: number;
  /** `scopeVerseCount >= ladder.ts#MIN_VERSES_FOR_REFERENCE_ACTIVITIES`. */
  referenceActivitiesUnlocked: boolean;
  passages: PassageView[];
  totalDue: number;
  /** The panel's current answer-mode default, so "Start practicing" etc. need no second fetch. */
  defaultAnswerMode: AnswerMode;
  /** The passage list's persisted sort choice, so the list needs no second fetch. */
  sortOrder: PassageSortOrder;
  /** Whether reciting aloud is available right now. */
  speech: SpeechAvailability;
  /** Recite cards due (or untried and switched on); kept apart from `totalDue`. */
  reciteDueCount: number;
}

/** The user's answer-mode preference, and how it applies. */
export interface SettingsView {
  defaultAnswerMode: AnswerMode;
  recite: ReciteSettings;
  speech: SpeechAvailability;
}

// ---------------------------------------------------------------------------
// Recite aloud
// ---------------------------------------------------------------------------

export type SpeechPermission = 'speech:listen' | 'speech:speak';

/** Whether reciting aloud can run, and why not. */
export interface SpeechAvailability {
  state:
    | 'ready'
    | 'needs-download'
    | 'unavailable'
    | 'permission-missing'
    | 'unsupported-language'
    | 'host-too-old';
  missingPermissions: SpeechPermission[];
  engineLabel: string;
  onDevice: boolean;
  /** Spoken prompts and feedback are possible (speech:speak granted and a speaker exists). */
  handsFree: boolean;
}

export type ReciteStrictness = 'lenient' | 'normal' | 'strict';

export interface ReciteSettings {
  strictness: ReciteStrictness;
  promptStyle: 'reference' | 'reference+opening';
  feedback: 'brief' | 'full';
  readBack: boolean;
  autoAdvance: boolean;
  voiceCommands: boolean;
  hintDelayMs: number;
}

export type LoopPhase =
  | 'announcing'
  | 'ready'
  | 'listening'
  | 'hinting'
  | 'scoring'
  | 'feedback'
  | 'paused'
  | 'summary'
  | 'done'
  | 'error';

export type ReciteVerdict = 'correct' | 'variant' | 'near' | 'swapped' | 'wrong' | 'missed' | 'hinted';

export interface ReciteResultView {
  score: number;
  level: number;
  nextDueAt: number | null;
  words: { index: number; verdict: ReciteVerdict; heard?: string }[];
  extras: { afterIndex: number; heard: string }[];
  missedQuote: string[];
  passageWellLearned: boolean;
}

export interface ReciteStateView {
  reciteId: string;
  mode: 'tap' | 'handsfree';
  source: 'passage' | 'due';
  phase: LoopPhase;
  passageId: number | null;
  reference: string;
  /** Shown only after scoring or on a hint; otherwise null. */
  verses: VerseText[] | null;
  /** Heard words, in memory only. */
  heard: string[];
  /** Last matched expected word index, -1 at the start. */
  position: number;
  hinted: number[];
  result: ReciteResultView | null;
  done: number;
  remaining: number;
  /** Live-region text. */
  message: string;
  error: { code: string; message: string } | null;
}

export type ReciteAction =
  | 'listen'
  | 'hint'
  | 'repeat'
  | 'skip'
  | 'again'
  | 'next'
  | 'pause'
  | 'resume'
  | 'stop';

/** One calendar day on the Analytics practice calendar. */
export interface CalendarDay {
  /** Epoch ms for local midnight that day. */
  date: number;
  practiced: boolean;
}

/** One recent level-up, for "Recently reached". */
export interface Milestone {
  passageId: number;
  reference: string;
  rung: Rung;
  level: number;
  at: number;
}

/** Aggregate, encouragement-oriented counts for the Analytics screen. */
export interface AnalyticsView {
  /** Consecutive days, ending today, with at least one attempt. */
  streakDays: number;
  /** Verses in passages that are "well learned" (`bestLevel >= 4`). */
  versesLearned: number;
  passagesWellLearned: number;
  /** The last 35 days, oldest first. */
  calendar: CalendarDay[];
  /** Most recent "reached level 4 or 5" events, newest first. */
  recentlyReached: Milestone[];
  /** The next round number of verses learned, and how far off it is. */
  nextMilestone: { versesLearned: number; toGo: number };
}

// ---------------------------------------------------------------------------
// Verse text and context
// ---------------------------------------------------------------------------

/**
 * One poetic line inside a verse, mirroring `@bible/core`'s `PoetryLine`.
 *
 * Carried through because the layout has to honour indentation, and because a
 * verse is routinely several lines at different levels - Psalm 1:1 is three.
 * `level` 1 is the outermost.
 */
export interface Line {
  /** First word this line covers. 0-based index into `VerseText.words`. */
  start: number;
  /**
   * Last word this line covers - 0-based and **INCLUSIVE**, matching
   * `PoetryLine` in `@bible/core`.
   *
   * Stated rather than inherited because the cost of guessing wrong is
   * invisible: treating it as exclusive silently drops the last word of every
   * poetic line, which looks like a plausible line break rather than a bug.
   * A slice is `words.slice(start, end + 1)`.
   */
  end: number;
  /** 1 is the outermost indent, 3 the deepest. */
  level: 1 | 2 | 3;
}

/** A verse as the panel renders it. */
export interface VerseText {
  verseId: number;
  /** Chapter:verse, for the margin. */
  label: string;
  /** Words, already split. The panel never re-tokenises - scoring depends on
   *  the worker and the panel agreeing exactly on word boundaries. */
  words: string[];
  /** Poetic lines, or `null` for prose. */
  lines: Line[] | null;
  /** A psalm superscription attached to this verse, if any. */
  psalmTitle: string | null;
  /** True when this verse starts a new paragraph. */
  paragraphStart: boolean;
}

/**
 * A passage plus the verses around it.
 *
 * Context is rendered as real, readable text with the working verse
 * highlighted - not blurred and not reduced to shapes. The one exception is
 * enforced here rather than in the panel: during an exercise the worker
 * withholds the verses *after* the working point, because for the ordering
 * picker and any recite-from-the-start step those verses are the answer.
 */
export interface PassageContext {
  passageId: number;
  reference: string;
  /** Verses before the passage. May be empty at a book boundary. */
  before: VerseText[];
  /** The passage itself. */
  verses: VerseText[];
  /** Verses after the passage. Empty while an exercise is in progress. */
  after: VerseText[];
}

// ---------------------------------------------------------------------------
// Exercise steps
// ---------------------------------------------------------------------------

/**
 * One candidate in the next-verse picker.
 *
 * `preview` is about 25 words or three lines, whichever comes first: the user
 * asked to see a good portion of the verse rather than a bare reference, since
 * recognising the opening words is the skill being trained.
 */
export interface PickerCandidate {
  verseId: number;
  preview: string;
  truncated: boolean;
}

/** "Which verse comes next?" - the first rung for a multi-verse passage. */
export interface OrderingStep {
  kind: 'ordering';
  /** Verses already placed, in order, shown as real text above the choice. */
  placed: VerseText[];
  candidates: PickerCandidate[];
  /** 1-based, for "step 3 of 7". */
  stepNumber: number;
  totalSteps: number;
}

/**
 * "Which reference is this?" - the first rung for a lone single verse.
 *
 * One question per verse of the passage (capped at 5 - see `session.ts`'s
 * `MAX_REFERENCE_STEPS`), not one question about the passage as a whole: T8
 * replaced the old "match this passage to its reference, among its plan
 * siblings" design with distractors generated from the Bible's own structure
 * (`exercises/references.ts#buildReferenceDistractors`), which scales to as
 * many questions as the passage has verses instead of running out after one.
 *
 * `candidates[].id` is OPAQUE - a token with no relationship to the
 * reference it names (not derived from the reference text, not a database
 * id), specifically so the panel cannot infer which candidate is correct from
 * the id's own shape. The worker matches the submitted id against the one it
 * knows is correct; see `StepAnswer`'s `refmatch` case.
 */
export interface RefMatchStep {
  kind: 'refmatch';
  verse: VerseText;
  candidates: { id: string; reference: string }[];
  /** Which difficulty tier this step is serving, 0-based - any book (0), same genre (1), same book (2). */
  tier: number;
  stepNumber: number;
  totalSteps: number;
}

/**
 * "Given the words, supply the reference from memory" - the hardest reference
 * activity, and the only single-tier one (`ladder.ts#TIERS.refprovide`).
 *
 * The verse is shown in full - the words are the given, not the question -
 * except when it is unusually long, in which case the WORKER truncates it
 * (`exercises/references.ts#truncateForProvide`) and sets `truncatedPreview`,
 * rather than sending the full verse and asking the panel to decide where to
 * cut. That follows the same discipline `VerseText.words`'s own doc comment
 * states for scoring - "the panel never re-tokenises" - even though nothing
 * here is actually scored from `verse.words`: `refprovide` is graded from the
 * typed reference (see `StepAnswer`), so this truncation is a pure display
 * decision, not a correctness one, but the decision itself still belongs to
 * the worker for consistency with every other step's previews.
 */
export interface RefProvideStep {
  kind: 'refprovide';
  verse: VerseText;
  /** True when `verse` was cut for display - see the class doc comment above. */
  truncatedPreview: boolean;
  stepNumber: number;
  totalSteps: number;
}

/**
 * Type the missing words.
 *
 * v2 (T6) generalises this from "one verse, some of its words hidden" to "one
 * or more verses, each with its own blanked words" - the shape tier 0 (today's
 * one-verse-per-step behaviour) and tier 1 (one step for the WHOLE passage,
 * every verse blanked at once) both use, rather than forking into two step
 * kinds. Tier 0 is simply the one-verse case of this same shape: `verses` has
 * one entry and `blanks` has one entry.
 *
 * The panel renders an input sized to each hidden word's measured width so
 * that revealing it does not repaginate the passage; overtyping grows the
 * line, never the page.
 */
export interface BlanksStep {
  kind: 'blanks';
  /** The verse(s) this step covers - one at tier 0, every verse of the passage at tier 1. */
  verses: VerseText[];
  /**
   * One entry per verse in `verses`, **in the same order**.
   *
   * `indices` are indices into THAT verse's own `words`, and are guaranteed
   * ascending **within each entry** - not globally ascending across the
   * flattened list, which would be a meaningless property once more than one
   * verse is involved. `Session.prepareStep` sorts each verse's own indices
   * before sending, so this holds no matter what `selectBlanks` returns.
   *
   * Flattening this array - iterate `blanks` in order, and within each entry
   * iterate `indices` in order - is the exact order `StepAnswer`'s `words`
   * array for `blanks` must match position-for-position. See `StepAnswer`.
   */
  blanks: { verseId: number; indices: number[] }[];
  /** How the panel should collect the answer for each hidden word. */
  answerMode: AnswerMode;
  stepNumber: number;
  totalSteps: number;
}

/**
 * Every word is hidden - the closest thing to unaided recitation.
 *
 * There are no reveal tiers: a correct answer (a letter, in `firstLetter`
 * mode; the whole word, in `fullWord` mode) reveals the whole word, always.
 */
export interface FirstLettersStep {
  kind: 'firstletters';
  verse: VerseText;
  answerMode: AnswerMode;
  /**
   * Which difficulty tier this step is serving, 0-based.
   *
   * First letters has no grading difference between tiers (see
   * `ladder.ts#TIERS` and `firstLetters.ts`'s own header) - the two tiers
   * differ only in how the panel *presents* the step, which is T14's work.
   * This field exists purely so the panel has something to key that
   * presentation off; nothing in the worker branches on it.
   */
  tier: number;
  stepNumber: number;
  totalSteps: number;
}

export type Step = OrderingStep | RefMatchStep | BlanksStep | FirstLettersStep | RefProvideStep;

/**
 * The verdict on one submitted step.
 *
 * `blocking` is what the picker needs: a wrong choice is reported, marked so
 * the user can see which one they clicked, and the same step is served again
 * until it is right. The mark is transient - it exists to say "not that one",
 * not to keep a tally on screen.
 */
export interface StepResult {
  correct: boolean;
  /**
   * What the user got wrong on this submission. **The meaning depends on the
   * step kind that asked**, and both are small integers, so a consumer must
   * key off the step rather than guess:
   *
   *   - `ordering`      - the verse id that was picked
   *   - `refmatch`      - the INDEX into that step's own `candidates` array
   *                       that was picked - not the candidate's `id`, which
   *                       is an opaque string, and not any identifier drawn
   *                       from the reference itself
   *   - `blanks`        - POSITIONS in the flattened answer array
   *                       (`StepAnswer.words`' own space, per its doc comment),
   *                       not indices into any one verse's `words` - a step
   *                       can cover more than one verse (tier 1), so a word
   *                       index alone would be ambiguous about which verse it
   *                       belongs to
   *   - `firstletters`  - indices into `VerseText.words`
   *
   * Always the current submission only. It does not accumulate across the
   * retries of a blocked step: the mark exists to say "not that one", not to
   * keep a tally on screen.
   */
  wrong: number[];
  /** True when the step must be retried before the session can advance. */
  blocking: boolean;
  /** The correct answer, revealed once the step is finally resolved. */
  reveal?: { words?: string[]; verseId?: number };
  /**
   * `refprovide` only: the typed text did not resolve to a recognised book at
   * all - `api.bible.parseReference` could not even identify which book was
   * meant. Per resolved decision D5 this is NOT a wrong answer: it does not
   * spoil the step's first-attempt credit and the same step is re-served
   * (`blocking` is always `true` alongside this) rather than advancing. A
   * reference that DOES resolve to a book - even the wrong book, or the right
   * book with the wrong chapter/verse - is graded as an ordinary wrong answer
   * instead and never sets this.
   */
  unrecognized?: boolean;
}

/** A session in progress. The worker owns it; the panel holds only the id. */
export interface SessionView {
  sessionId: string;
  passageId: number;
  rung: Rung;
  /** Which difficulty tier this session is serving, 0-based. See `ladder.ts#TIERS`. */
  tier: number;
  /** How many tiers this activity has in total - `ladder.ts#TIERS[rung]`. */
  tiers: number;
  step: Step | null;
  /** Running tally, shown in the session header. */
  correctFirst: number;
  stepsTaken: number;
}

export interface SessionSummary {
  passageId: number;
  rung: Rung;
  /** Which difficulty tier this attempt answered, 0-based. See `ladder.ts#TIERS`. */
  tier: number;
  /** How many tiers this activity has in total - `ladder.ts#TIERS[rung]`. */
  tiers: number;
  score: number;
  correctFirst: number;
  totalSteps: number;
  nextDueAt: number | null;
  /** This activity's level (0-5) after this attempt. */
  level: number;
  /** Whether the passage as a whole is now "well learned" (see `bestLevel`). */
  passageWellLearned: boolean;
}

// ---------------------------------------------------------------------------
// Panel -> worker requests
// ---------------------------------------------------------------------------

export type PanelRequest =
  | { type: 'getPlan' }
  | { type: 'getAnalytics' }
  | { type: 'getSettings' }
  | { type: 'setDefaultAnswerMode'; mode: AnswerMode }
  | { type: 'setPassageSortOrder'; order: PassageSortOrder }
  | { type: 'setPassageAnswerMode'; passageId: number; mode: AnswerMode | null }
  | { type: 'getContext'; passageId: number }
  | { type: 'addPassage'; reference: string }
  | { type: 'removePassage'; passageId: number }
  /**
   * "Reset progress for this passage": the ONLY way a level ever goes down.
   * Every card of the passage has its progress reset point moved to now, so
   * attempts before it stop counting, and its schedule returns to untouched.
   */
  | { type: 'resetPassageProgress'; passageId: number }
  /**
   * `tier` starts a specific difficulty tier of `rung`, per resolved decision
   * D4: omitted, the worker auto-selects the lowest tier not yet passed (or
   * the hardest tier once every tier has been passed) - the same computation
   * `RungView.nextTier` already exposes for display. An out-of-range tier is
   * rejected with a readable error rather than clamped - see
   * `main.ts#startSession`.
   */
  | { type: 'startSession'; passageId: number; rung?: Rung; restart?: boolean; tier?: number }
  | { type: 'submitStep'; sessionId: string; answer: StepAnswer }
  | { type: 'endSession'; sessionId: string }
  | { type: 'navigateTo'; verseId: number }
  /** One passage's own view, without fetching the whole plan for it - see `getPassageView` below. */
  | { type: 'getPassageView'; passageId: number }
  | { type: 'createList'; name: string }
  | { type: 'renameList'; id: number; name: string }
  /**
   * Delete a list. Refused (a readable error, not a silent no-op) if `id` is
   * the only list left - see `store.ts#deleteCollection`. `movePassagesTo`
   * is required here: T5 builds the store method and the protocol only,
   * asking the user which list to move to is T11's job.
   */
  | { type: 'deleteList'; id: number; movePassagesTo: number }
  | { type: 'getListPracticeStats'; id: number }
  | { type: 'movePassage'; passageId: number; collectionId: number }
  | { type: 'setScope'; scope: Scope }
  | {
      type: 'startRecite';
      source: { kind: 'passage'; passageId: number } | { kind: 'due' };
      mode: 'tap' | 'handsfree';
    }
  | { type: 'reciteControl'; reciteId: string; action: ReciteAction }
  | { type: 'getReciteState' }
  | { type: 'setReciteSettings'; patch: Partial<ReciteSettings> }
  | { type: 'setPassageRecite'; passageId: number; on: boolean }
  /** Opens the host's Extensions preferences page on this extension (api.ui.openSettings). */
  | { type: 'openHostSettings' }
  /** Deletes stored per-word recitation detail only; attempts, scores and schedule stay. */
  | { type: 'deleteReciteHistory' }
  // --- push cards (task 0072) ---
  | { type: 'getPushSettings' }
  | { type: 'setPushSettings'; settings: PushCardSettings }
  | { type: 'requestReminderPermission' }
  | { type: 'getCardStack' }
  | { type: 'gradeRecall'; passageId: number; grade: RecallGrade; key?: string; durationMs?: number }
  | { type: 'snoozeCard'; passageId: number; key?: string }
  | { type: 'consumeLaunchIntent' };

/**
 * What the user did, keyed to the step kind that asked.
 *
 * For `blanks`, `words` is FLATTENED across every verse the step covers, in
 * the exact order `BlanksStep.blanks` declares: iterate the `blanks` array in
 * order, and within each entry iterate its `indices` in order - that is the
 * order `words[k]` must match. At tier 0 (`blanks` has one entry) this is
 * indistinguishable from the old single-verse contract; tier 1's whole-passage
 * step is where the flattening actually matters. Grading depends on this
 * exactly, and a later task's UI code must build `words` this way.
 */
export type StepAnswer =
  | { kind: 'ordering'; verseId: number }
  /** `id` is the opaque token from the candidate the user picked - see `RefMatchStep`. */
  | { kind: 'refmatch'; id: string }
  | { kind: 'blanks'; words: string[] }
  | { kind: 'firstletters'; words: string[] }
  /** Raw typed text, parsed and graded worker-side - see `RefProvideStep`. */
  | { kind: 'refprovide'; text: string };

/**
 * Every reply is discriminated by `ok` rather than by throwing across the
 * boundary. An exception in `api.panels.onMessage` reaches the panel as an
 * opaque RPC failure with no useful message, so failures that the user should
 * see - "that reference does not parse" - travel as data.
 */
export type PanelReply<T> = { ok: true; data: T } | { ok: false; error: string };

export interface RequestMap {
  getPlan: PlanView;
  getAnalytics: AnalyticsView;
  getSettings: SettingsView;
  setDefaultAnswerMode: Record<string, never>;
  setPassageSortOrder: Record<string, never>;
  setPassageAnswerMode: Record<string, never>;
  getContext: PassageContext;
  addPassage: { passage: Passage };
  removePassage: Record<string, never>;
  /**
   * The rebuilt plan, so the screen that asked for the reset can redraw from
   * the reply. `removePassage` answers `{}` and leans on the `planChanged`
   * push; a reset changes the levels the *current* screen is showing, so it
   * hands the new view back directly as well as pushing.
   */
  resetPassageProgress: PlanView;
  startSession: SessionView;
  submitStep: { result: StepResult; session: SessionView; summary: SessionSummary | null };
  endSession: { summary: SessionSummary | null };
  navigateTo: Record<string, never>;
  getPassageView: PassageView;
  /**
   * Every list-mutating request answers with the rebuilt plan, the same
   * choice `resetPassageProgress` made: the screen driving list management is
   * showing the very thing that just changed (the list picker, the plan
   * rows), and waiting for the `planChanged` push to come back round would
   * flash stale state. Each of these also sends that push, for any other
   * open panel.
   */
  createList: PlanView;
  renameList: PlanView;
  deleteList: PlanView;
  /** `total` non-deleted passages in the list; `practiced` have at least one attempt. */
  getListPracticeStats: { total: number; practiced: number };
  movePassage: PlanView;
  setScope: PlanView;
  startRecite: ReciteStateView;
  reciteControl: ReciteStateView;
  getReciteState: ReciteStateView | null;
  setReciteSettings: Record<string, never>;
  setPassageRecite: PassageView;
  openHostSettings: Record<string, never>;
  deleteReciteHistory: Record<string, never>;
  getPushSettings: PushSettingsView;
  setPushSettings: PushSettingsView;
  requestReminderPermission: PushSettingsView;
  getCardStack: CardStackView;
  gradeRecall: { nextDueAt: number | null; stack: CardStackView };
  snoozeCard: { snoozedUntil: number };
  consumeLaunchIntent: { showCard: boolean; key?: string };
}

// ---------------------------------------------------------------------------
// Worker -> panel pushes
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget notifications. A panel that is not open simply is not
 * there, so nothing here may carry state the panel would otherwise miss - the
 * panel re-reads on open.
 */
export type WorkerPush =
  | { type: 'planChanged' }
  | { type: 'dueCountChanged'; count: number }
  /** A notification was clicked: open the card stack (task 0072). */
  | { type: 'showCard'; key: string | null }
  | { type: 'cardsWaitingChanged'; count: number }
  /** The host's active verse moved. Used to prefill the add-passage field. */
  | { type: 'activeVerse'; verseId: number; reference: string }
  | { type: 'reciteState'; state: ReciteStateView };
