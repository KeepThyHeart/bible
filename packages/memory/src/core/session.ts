/**
 * The exercise session: what the user is doing right now.
 *
 * Sessions live in worker memory and are never persisted wholesale. That is
 * deliberate: a half-finished session is not a fact about the user's memory
 * of a passage, it is a fact about a window they had open. What survives a
 * restart is the *resume point* - `cursor`, and the running tally - written to
 * the `resume_state` table after each verse (see `main.ts#submitStep`), not
 * every keystroke. Reconstructing a session from that point does not need to
 * reproduce the exact randomness of steps already graded, only the position
 * and the tally, so a resumed session simply seeds a fresh RNG for whatever
 * comes next.
 *
 * The worker owning the session (rather than the panel) is what makes the
 * pop-out window work at all: a popped-out panel is a fresh document with a
 * fresh iframe, so any state the panel held would be gone. The worker is a
 * long-lived process, so the session survives the panel being moved, closed
 * and reopened.
 *
 * ## Scoring
 *
 * One number, everywhere: **correct first attempts over graded units**. The
 * unit differs by rung - a pick, a blank, a word - but the meaning does not,
 * and a user can be told it in one sentence. Retries after a wrong answer are
 * still recorded but can never earn back the credit, which is what makes a
 * blocking picker honest: you always finish, and finishing is not the same as
 * being right.
 *
 * ## v1: every attempt counts
 *
 * There is no `replay` flag any more. Nothing is locked, so there is no
 * distinction left to draw between "the scheduled attempt" and "practising
 * ahead" - see the task 0004 review, point 4. Every finished session reaches
 * `main.ts#finishSession` and reschedules its card.
 */

import { tc } from './messages';
import type {
  AnswerMode,
  PickerCandidate,
  Rung,
  SessionView,
  Step,
  StepAnswer,
  StepResult,
  VerseText,
} from './types';
import { buildCandidates } from './exercises/ordering';
import { selectBlanks, gradeBlanks } from './exercises/blanks';
import { gradeFirstLetters } from './exercises/firstLetters';
import {
  buildReferenceDistractors,
  formatReference,
  truncateForProvide,
  type BookInfo,
  type ChapterInfo,
  type ReferencePoint,
} from './exercises/references';
import { TIERS } from './ladder';

/** How many options a picker offers, including the correct one. */
const PICKER_CHOICES = 4;

/**
 * How many questions one `refmatch` or `refprovide` session asks.
 *
 * One per verse of the passage, capped at 5 - a 25-verse passage (the
 * smallest that unlocks these activities, `ladder.ts#MIN_VERSES_FOR_REFERENCE_ACTIVITIES`)
 * asking 25 reference questions in a row would be a slog with no extra
 * benefit over a handful of them, so this is a session length, not a scan of
 * the whole passage.
 */
export const MAX_REFERENCE_STEPS = 5;

/**
 * The pre-fetched, cached data `refmatch`'s distractor generation needs.
 *
 * Nothing here does I/O - see `exercises/references.ts`'s header - so this is
 * built once by `main.ts` (which owns the host API and the cross-session
 * cache for `listChapters`, one host call per book) and handed to the
 * `Session` whole, the same way `verses` already is.
 */
export interface ReferenceCatalog {
  books: readonly BookInfo[];
  chapters: Readonly<Record<number, readonly ChapterInfo[]>>;
  bookNames: Readonly<Record<number, string>>;
}

/**
 * A parsed reference, in exactly the shape `refprovide`'s grading needs -
 * structurally compatible with `@bible/core`'s `ParsedReferenceDto`, declared
 * locally so this file does not have to import it just to read three fields.
 */
export interface ParsedReferenceLike {
  bookNumber: number;
  chapter: number;
  startVerse?: number;
  endVerse?: number;
  startVerseId?: number;
  endVerseId?: number;
}

/**
 * Fraction of words blanked, tier 0 (`ladder.ts#TIERS.blanks` is 2).
 *
 * Fixed for v0 rather than adaptive. An adaptive difficulty that moves with
 * performance is easy to write and very hard to evaluate - the user cannot
 * tell whether a session felt harder because they were worse or because the
 * software decided so. A constant is legible, and the interval ladder already
 * supplies the escalation.
 */
const BLANK_DIFFICULTY = 0.3;

/**
 * Fraction of words blanked, tier 1 - the whole-passage step.
 *
 * T6's own judgement call, since the plan asked for "a higher difficulty"
 * without naming one: 0.5 sits roughly at the midpoint of
 * `selectBlanks`'s documented 0.15..0.6 fraction band (`MIN_BLANK_FRACTION`..
 * `MAX_BLANK_FRACTION` in `exercises/blanks.ts`), noticeably harder than
 * tier 0's 0.3 - about a third more of each verse's words are hidden - while
 * stopping well short of the ceiling, so a whole passage of verses blanked at
 * once is not also blanked at the hardest possible rate on top of covering
 * more material at once.
 */
const BLANK_DIFFICULTY_HARD = 0.5;

interface StepState {
  /** Whether the current step has already been answered wrongly once. */
  spoiled: boolean;
}

/** One verse's chosen blanks, in the order `BlanksStep.blanks` will carry. */
interface BlanksSelection {
  verseId: number;
  /** Indices into that verse's own `words`, ascending. */
  indices: number[];
}

/** Where a resumed session picks back up. See the file header. */
export interface SessionResume {
  /** Verse index (or, for `ordering`, the number of verses already placed). */
  cursor: number;
  correctFirstUnits: number;
  gradedUnits: number;
}

export interface SessionOpts {
  sessionId: string;
  passageId: number;
  cardId: number;
  rung: Rung;
  /**
   * Which difficulty tier of the activity this session is serving, 0-based.
   *
   * Carried so the attempt row can record it (`main.ts#finishSession`).
   * Defaults to 0, the only tier that existed before `ladder.ts#TIERS`.
   * `main.ts#startSession` is responsible for validating this against
   * `ladder.ts#TIERS[rung]` before constructing a `Session` - this class
   * trusts the value it is given. `ordering` and `blanks` render a genuinely
   * harder step at tier 1 (see `prepareStep`); `refmatch`, `firstletters` and
   * `refprovide` currently pass the tier straight through with no grading
   * change (first letters' two tiers differ only in panel presentation - T14;
   * `refmatch`/`refprovide` tiering is T8's work).
   */
  tier?: number;
  verses: VerseText[];
  /**
   * `refmatch` only: each `verses` entry's own book/chapter/verse, same
   * order, same length. Needed because `VerseText` carries only `verseId`
   * and a display `label` (which can be a BARE verse number for a
   * single-chapter passage - see `main.ts#makeLabeller` - so it cannot be
   * parsed back into a chapter). `main.ts` decodes this once, off the same
   * trusted verse-id encoding `labelFor` uses, and it costs no host call.
   */
  referencePoints?: ReferencePoint[];
  /** `refmatch` only: the pre-fetched pool its distractors are drawn from. */
  referenceCatalog?: ReferenceCatalog;
  /**
   * `refprovide` only: parses the user's typed text via the host
   * (`api.bible.parseReference`). Injected, exactly like `rng`, so grading
   * authority stays with whatever the WORKER's host connection resolves -
   * never something the panel could forge or a unit test would have to fake
   * a whole extension host to exercise. A rejection (no recognised book)
   * resolves to `null`, matching `parseReference`'s own contract; a thrown
   * error is not caught here and propagates out of `submit` - see
   * `main.ts#handlePanelMessage`'s top-level catch, which is what turns it
   * into a readable `{ ok: false }` reply without losing the session.
   */
  parseReference?: (input: string) => Promise<ParsedReferenceLike | null>;
  /** How hidden words in `blanks` / `firstletters` are answered. */
  answerMode: AnswerMode;
  rng: () => number;
  /** Continues a previously paused activity. Omit to start from the top. */
  resume?: SessionResume;
}

export class Session {
  readonly sessionId: string;
  readonly passageId: number;
  readonly cardId: number;
  readonly rung: Rung;
  /** The difficulty tier being served. See `SessionOpts.tier`. */
  readonly tier: number;
  readonly answerMode: AnswerMode;

  private readonly verses: VerseText[];
  private readonly referencePoints: ReferencePoint[] | undefined;
  private readonly referenceCatalog: ReferenceCatalog | undefined;
  private readonly parseReferenceFn:
    | ((input: string) => Promise<ParsedReferenceLike | null>)
    | undefined;
  private readonly rng: () => number;

  /** Index of the verse currently being worked. */
  private cursor = 0;
  private readonly stepState: StepState = { spoiled: false };

  /**
   * Blanks chosen for the current step, held so a retry asks the same ones.
   *
   * One entry at tier 0 (a single verse); one entry per verse of the passage
   * at tier 1 - see `prepareStep`.
   */
  private currentBlanks: BlanksSelection[] = [];
  private currentCandidates: PickerCandidate[] = [];
  /** `refmatch`'s candidates for the CURRENT verse, built once in `prepareStep`. */
  private currentRefCandidates: { id: string; reference: string }[] = [];
  /** Which of `currentRefCandidates` is actually right, for grading `submit`. */
  private currentRefCorrectId = '';

  private correctFirstUnits = 0;
  private gradedUnits = 0;
  private finished = false;

  constructor(opts: SessionOpts) {
    this.sessionId = opts.sessionId;
    this.passageId = opts.passageId;
    this.cardId = opts.cardId;
    this.rung = opts.rung;
    this.tier = opts.tier ?? 0;
    this.verses = opts.verses;
    this.referencePoints = opts.referencePoints;
    this.referenceCatalog = opts.referenceCatalog;
    this.parseReferenceFn = opts.parseReference;
    this.answerMode = opts.answerMode;
    this.rng = opts.rng;

    if (opts.resume && opts.resume.cursor > 0 && opts.resume.cursor < this.verseSteps()) {
      this.cursor = opts.resume.cursor;
      this.correctFirstUnits = opts.resume.correctFirstUnits;
      this.gradedUnits = opts.resume.gradedUnits;
    }
    this.prepareStep();
  }

  /**
   * How many verses (or ordering placements) this rung walks through.
   *
   * Also the bound the constructor checks a resume `cursor` against, so this
   * has to reflect the CURRENT tier's step count, not just the rung's -
   * `blanks` tier 1 is one step regardless of how many verses the passage
   * has, and `advanceVerse` below relies on this to know when tier 1's single
   * step is done.
   */
  private verseSteps(): number {
    if (this.rung === 'ordering') return Math.max(1, this.verses.length - 1);
    if (this.rung === 'blanks' && this.tier >= 1) return 1;
    if (this.rung === 'refmatch' || this.rung === 'refprovide') {
      return Math.min(this.verses.length, MAX_REFERENCE_STEPS);
    }
    return this.verses.length;
  }

  // -- presentation ---------------------------------------------------------

  /**
   * How many steps the user will be asked to do, in presentation units.
   *
   * Ordering is `n - 1` because the first verse is given: you cannot be asked
   * what comes after nothing.
   */
  get totalSteps(): number {
    switch (this.rung) {
      case 'ordering':
        return Math.max(1, this.verses.length - 1);
      case 'refmatch':
      case 'refprovide':
        // One question per verse of the passage, capped - see `verseSteps`.
        return this.verseSteps();
      case 'blanks':
        // Tier 1 is one step covering the whole passage; tier 0 is one step
        // per verse, same as every other tier-less rung below.
        return this.tier >= 1 ? 1 : this.verses.length;
      default:
        return this.verses.length;
    }
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /** Correct-first-attempts over graded units, 0..1. */
  get score(): number {
    if (this.gradedUnits === 0) return 0;
    return this.correctFirstUnits / this.gradedUnits;
  }

  get correctFirst(): number {
    return this.correctFirstUnits;
  }

  get gradedTotal(): number {
    return this.gradedUnits;
  }

  /** How far through the session this is, for persisting a resume point. */
  get cursorIndex(): number {
    return this.cursor;
  }

  view(): SessionView {
    return {
      sessionId: this.sessionId,
      passageId: this.passageId,
      rung: this.rung,
      tier: this.tier,
      tiers: TIERS[this.rung],
      step: this.finished ? null : this.currentStep(),
      correctFirst: this.correctFirstUnits,
      stepsTaken: this.gradedUnits,
    };
  }

  // -- step construction ----------------------------------------------------

  /**
   * Choose the material for the step at `cursor`.
   *
   * Called once per step, not per render: a retry must ask exactly the same
   * question. Re-selecting blanks or reshuffling candidates on a retry would
   * let a user reroll their way past a word they could not remember.
   */
  private prepareStep(): void {
    this.stepState.spoiled = false;
    if (this.finished) return;

    if (this.rung === 'ordering') {
      // The verse to find is the one after everything already placed. The
      // distractors are drawn from the verses NOT yet placed, so a candidate
      // the user has already seen placed cannot reappear as a decoy.
      const remaining = this.verses.slice(this.cursor + 1);
      const correct = remaining[0];
      if (!correct) {
        this.finished = true;
        return;
      }
      // Full verse text, uncapped: the ordering rung's own candidates never
      // truncate (`PickerCandidate.truncated` is always `false` here), unlike
      // `refmatch`'s references below, which are not previews at all, or a
      // hypothetical future caller that wants the ~25-word capped preview.
      // Keyboard-letter selection needs the candidate's full text on screen so
      // a user reading it can find the letter it maps to; capping it would
      // reintroduce the truncation this rung deliberately opts out of.
      this.currentCandidates = buildCandidates(
        remaining,
        correct.verseId,
        PICKER_CHOICES,
        this.rng,
        { maxWords: Infinity, maxLines: Infinity },
        // Tier 0: distractors from anywhere unplaced. Tier 1: distractors are
        // the verses immediately following the correct one - see
        // `ordering.ts#CandidateMode`.
        this.tier >= 1 ? 'contiguous' : 'scattered',
      );
      return;
    }

    if (this.rung === 'refmatch') {
      // Shuffled HERE, once, and not in `currentStep()`. Building the list on
      // each render consumed the session's stateful RNG every time, so the
      // options reordered on every `view()` - including the re-serve after a
      // wrong pick, which made the user's "not that one" mark point at a
      // different reference than the one they had clicked, and let them reroll
      // positions by retrying.
      const verse = this.verses[this.cursor];
      const point = this.referencePoints?.[this.cursor];
      if (!verse || !point) {
        this.finished = true;
        return;
      }
      if (!this.referenceCatalog) {
        throw new Error('refmatch requires a reference catalog to build distractors.');
      }
      const { books, chapters, bookNames } = this.referenceCatalog;
      const correctReference = formatReference(
        bookNames[point.bookNumber] ?? tc('memory.core.bookN', 'Book {n}', { n: point.bookNumber }),
        point.chapter,
        point.verse,
      );
      const distractors = buildReferenceDistractors({
        correct: point,
        tier: this.tier,
        books,
        chapters,
        bookNames,
        count: PICKER_CHOICES - 1,
        rng: this.rng,
      });

      const items: { reference: string; correct: boolean }[] = [
        { reference: correctReference, correct: true },
        ...distractors.map((d) => ({ reference: d.reference, correct: false })),
      ];
      shuffle(items, this.rng);

      // Ids are opaque and assigned AFTER the shuffle, from their final
      // position - not from anything about the reference itself - so nothing
      // about an id's shape can tell the panel which one is correct. See
      // `RefMatchStep.candidates` in `types.ts`.
      this.currentRefCandidates = items.map((item, index) => ({
        id: `c${index}`,
        reference: item.reference,
      }));
      const correctIndex = items.findIndex((item) => item.correct);
      this.currentRefCorrectId = this.currentRefCandidates[correctIndex]?.id ?? '';
      return;
    }

    if (this.rung === 'blanks') {
      if (this.tier >= 1) {
        // Tier 1: one step, every verse of the passage blanked at once. There
        // is exactly one such step (cursor 0..0 - see `verseSteps`), so a
        // cursor past that means this rung is already finished.
        if (this.cursor > 0 || this.verses.length === 0) {
          this.finished = true;
          return;
        }
        this.currentBlanks = this.verses.map((verse) => ({
          verseId: verse.verseId,
          // Sorted here, at the boundary, because `BlanksStep.blanks[i].indices`
          // is documented as ascending PER VERSE and the panel relies on it:
          // it renders inputs in word order and submits them positionally, so
          // an unsorted list would grade an answer against the wrong blank.
          // `selectBlanks` happens to sort today; this makes the guarantee
          // independent of that.
          indices: [...selectBlanks(verse, BLANK_DIFFICULTY_HARD, this.rng)].sort(
            (a, b) => a - b,
          ),
        }));
        return;
      }

      const verse = this.verses[this.cursor];
      if (!verse) {
        this.finished = true;
        return;
      }
      this.currentBlanks = [
        {
          verseId: verse.verseId,
          indices: [...selectBlanks(verse, BLANK_DIFFICULTY, this.rng)].sort((a, b) => a - b),
        },
      ];
    }
  }

  private currentStep(): Step {
    switch (this.rung) {
      case 'ordering': {
        return {
          kind: 'ordering',
          placed: this.verses.slice(0, this.cursor + 1),
          candidates: this.currentCandidates,
          stepNumber: this.cursor + 1,
          totalSteps: this.totalSteps,
        };
      }
      case 'refmatch': {
        // One verse of the passage is shown; the user picks its reference.
        // Distractors are generated from the Bible's own structure, not drawn
        // from sibling passages - see `exercises/references.ts`'s header. The
        // list was built and shuffled once in `prepareStep`; rendering must
        // not disturb it.
        return {
          kind: 'refmatch',
          verse: this.verses[this.cursor] as VerseText,
          candidates: this.currentRefCandidates,
          tier: this.tier,
          stepNumber: this.cursor + 1,
          totalSteps: this.totalSteps,
        };
      }
      case 'blanks': {
        const byId = new Map(this.verses.map((v) => [v.verseId, v] as const));
        const verses = this.currentBlanks
          .map((b) => byId.get(b.verseId))
          .filter((v): v is VerseText => v !== undefined);
        return {
          kind: 'blanks',
          verses,
          blanks: this.currentBlanks.map((b) => ({ verseId: b.verseId, indices: b.indices })),
          answerMode: this.answerMode,
          stepNumber: this.cursor + 1,
          totalSteps: this.totalSteps,
        };
      }
      case 'firstletters': {
        return {
          kind: 'firstletters',
          verse: this.verses[this.cursor] as VerseText,
          answerMode: this.answerMode,
          tier: this.tier,
          stepNumber: this.cursor + 1,
          totalSteps: this.totalSteps,
        };
      }
      case 'refprovide': {
        const verse = this.verses[this.cursor] as VerseText;
        const { verse: shown, truncated } = truncateForProvide(verse);
        return {
          kind: 'refprovide',
          verse: shown,
          truncatedPreview: truncated,
          stepNumber: this.cursor + 1,
          totalSteps: this.totalSteps,
        };
      }
      case 'recite':
        // Recite runs through src/recite (startRecite), never as a session.
        throw new Error('Recite is not a practice-session activity; use startRecite.');
    }
  }

  // -- grading --------------------------------------------------------------

  /**
   * Grade one submission.
   *
   * The pickers block: a wrong answer is reported and the same step is served
   * again until it is right. The wrong choice comes back in `wrong` so the
   * panel can mark it, but the mark is transient by design - it says "not that
   * one", it does not keep a tally on screen. The credit, however, is already
   * gone: `spoiled` makes sure a step can only earn a point once.
   *
   * `async` because `refprovide` is the one rung whose grading needs a host
   * round trip (`api.bible.parseReference`, injected as `parseReferenceFn`).
   * Every other rung's grading is pure and synchronous internally; wrapping
   * them in a resolved promise here costs nothing observable and keeps one
   * signature for every caller (`main.ts#submitStep` always awaits it) rather
   * than a union of sync and async return types.
   */
  async submit(answer: StepAnswer): Promise<StepResult> {
    if (this.finished) {
      return { correct: false, wrong: [], blocking: false };
    }

    switch (this.rung) {
      case 'ordering':
        return this.submitOrdering(answer);
      case 'refmatch':
        return this.submitRefMatch(answer);
      case 'blanks':
        return this.submitBlanks(answer);
      case 'firstletters':
        return this.submitFirstLetters(answer);
      case 'refprovide':
        return this.submitRefProvide(answer);
      case 'recite':
        throw new Error('Recite is not a practice-session activity; use startRecite.');
    }
  }

  private submitOrdering(answer: StepAnswer): StepResult {
    if (answer.kind !== 'ordering') return mismatch();
    const expected = this.verses[this.cursor + 1];
    if (!expected) return mismatch();

    if (answer.verseId !== expected.verseId) {
      this.spoil();
      return { correct: false, wrong: [answer.verseId], blocking: true };
    }

    this.creditAndAdvanceUnit();
    this.cursor++;
    if (this.cursor >= this.verses.length - 1) this.finished = true;
    this.prepareStep();
    return {
      correct: true,
      wrong: [],
      blocking: false,
      reveal: { verseId: expected.verseId },
    };
  }

  /**
   * Blocking, same as `ordering`: a wrong pick is marked and the same verse
   * is asked again until it is right, so a lucky guess can never earn the
   * credit a genuine recall would.
   */
  private submitRefMatch(answer: StepAnswer): StepResult {
    if (answer.kind !== 'refmatch') return mismatch();

    const pickedIndex = this.currentRefCandidates.findIndex((c) => c.id === answer.id);
    if (pickedIndex === -1) return mismatch();

    if (answer.id !== this.currentRefCorrectId) {
      this.spoil();
      return { correct: false, wrong: [pickedIndex], blocking: true };
    }

    const verseId = this.verses[this.cursor]?.verseId;
    this.creditAndAdvanceUnit();
    this.cursor++;
    if (this.cursor >= this.verseSteps()) this.finished = true;
    this.prepareStep();
    return { correct: true, wrong: [], blocking: false, reveal: { verseId } };
  }

  /**
   * `refprovide`: parse the typed text via the host and grade against the
   * ACTUAL verse under test, never against anything the panel asserted.
   *
   * Per resolved decision D5, two very different outcomes share this method:
   *
   *   - `parseReference` returns `null` - no book recognised at all. This is
   *     NOT a wrong answer: it does not spoil first-attempt credit (no
   *     `spoil()`, no unit graded at all) and the same step is re-served, as
   *     many times as it takes, with `unrecognized: true` telling the panel
   *     to say so rather than mark it wrong.
   *   - `parseReference` returns a book - even the wrong one, even a book
   *     with no verse pinned down ("John 3") - counts as RECOGNISED and is
   *     graded immediately, right or wrong, like `blanks`/`firstletters`:
   *     single attempt, credit awarded or lost right away, no retry.
   *
   * `parsed.startVerseId`/`endVerseId` - the host's OWN resolved absolute
   * verse ids, not anything decoded here - are what correctness is compared
   * against, so this needs no book/chapter/verse decoding of its own. When
   * the parse names a book but not a specific verse (a whole-chapter
   * reference such as "John 3"), `startVerseId` is absent and the answer is
   * graded wrong: it does not pin down the one verse being asked about, and
   * this module has no way to learn that chapter's verse count without a
   * second host call it has no reason to make just to detect the one-verse
   * chapter edge case, which the standard canon does not contain anyway.
   */
  private async submitRefProvide(answer: StepAnswer): Promise<StepResult> {
    if (answer.kind !== 'refprovide') return mismatch();
    if (!this.parseReferenceFn) {
      throw new Error('refprovide requires host reference parsing.');
    }

    const verse = this.verses[this.cursor];
    if (!verse) return mismatch();

    const parsed = await this.parseReferenceFn(answer.text);
    if (parsed === null) {
      return { correct: false, wrong: [], blocking: true, unrecognized: true };
    }

    const correct =
      parsed.startVerseId !== undefined &&
      parsed.startVerseId <= verse.verseId &&
      (parsed.endVerseId ?? parsed.startVerseId) >= verse.verseId;

    this.creditUnits(1, correct ? 1 : 0);
    this.advanceVerse();
    return { correct, wrong: [], blocking: false, reveal: { verseId: verse.verseId } };
  }

  /**
   * Blanks and first letters are graded per word and do NOT block.
   *
   * The user submits, sees which words were missed in red with a "missed"
   * marker beside them, and moves on. Blocking here would mean sitting on a
   * word you genuinely cannot recall with no way forward, which is a worse
   * experience than being told and shown the answer.
   */
  /**
   * Grade one blanks step, possibly covering several verses (tier 1).
   *
   * `answer.words` is flattened across every verse in `this.currentBlanks`,
   * in that same order - the contract `StepAnswer` documents. Grading stays
   * per-verse (`gradeBlanks` still takes one verse and its own blank
   * indices), and results are stitched back together here: each verse's
   * `wrong` (word indices, `gradeBlanks`'s own space) is translated to its
   * POSITION in the flattened answer, because a bare word index is ambiguous
   * the moment more than one verse is in play - see `StepResult.wrong`'s doc
   * comment in `types.ts`.
   */
  private submitBlanks(answer: StepAnswer): StepResult {
    if (answer.kind !== 'blanks') return mismatch();
    if (this.currentBlanks.length === 0) return mismatch();

    const byId = new Map(this.verses.map((v) => [v.verseId, v] as const));
    let offset = 0;
    let totalBlanks = 0;
    let totalWrong = 0;
    const wrongPositions: number[] = [];
    const revealWords: string[] = [];

    for (const selection of this.currentBlanks) {
      const verse = byId.get(selection.verseId);
      if (!verse) continue;

      const typed = answer.words.slice(offset, offset + selection.indices.length);
      const result = gradeBlanks(verse, selection.indices, typed);
      for (const wordIndex of result.wrong) {
        const localPosition = selection.indices.indexOf(wordIndex);
        if (localPosition >= 0) wrongPositions.push(offset + localPosition);
      }
      if (result.reveal?.words) revealWords.push(...result.reveal.words);

      totalBlanks += selection.indices.length;
      totalWrong += result.wrong.length;
      offset += selection.indices.length;
    }

    this.creditUnits(totalBlanks, totalBlanks - totalWrong);
    this.advanceVerse();
    return {
      correct: wrongPositions.length === 0,
      wrong: wrongPositions,
      blocking: false,
      reveal: { words: revealWords },
    };
  }

  private submitFirstLetters(answer: StepAnswer): StepResult {
    if (answer.kind !== 'firstletters') return mismatch();
    const verse = this.verses[this.cursor];
    if (!verse) return mismatch();

    const result = gradeFirstLetters(verse, answer.words);
    this.creditUnits(verse.words.length, verse.words.length - result.wrong.length);
    this.advanceVerse();
    return { ...result, blocking: false, reveal: { words: verse.words } };
  }

  // -- bookkeeping ----------------------------------------------------------

  /** Mark the current step as no longer eligible for first-attempt credit. */
  private spoil(): void {
    if (!this.stepState.spoiled) {
      this.stepState.spoiled = true;
      // The unit is counted now, unscored. Counting it only on the eventual
      // success would make a blocking step that took five guesses score the
      // same as one answered immediately.
      this.gradedUnits++;
    }
  }

  private creditAndAdvanceUnit(): void {
    if (this.stepState.spoiled) return; // already counted, credit forfeited
    this.gradedUnits++;
    this.correctFirstUnits++;
  }

  private creditUnits(total: number, correct: number): void {
    this.gradedUnits += total;
    this.correctFirstUnits += correct;
  }

  /**
   * Advances past the just-graded step (`blanks` or `firstletters`).
   *
   * Bounded by `verseSteps()`, not `this.verses.length` directly, so this
   * generalises correctly to `blanks` tier 1: one step regardless of how many
   * verses the passage has.
   */
  private advanceVerse(): void {
    this.cursor++;
    if (this.cursor >= this.verseSteps()) {
      this.finished = true;
      return;
    }
    this.prepareStep();
  }
}

/**
 * A step answer whose kind does not match the step that was asked.
 *
 * Only reachable if the panel and worker disagree about session position -
 * a stale reply after the user restarted, say. Reported as an ordinary wrong
 * answer rather than thrown: an exception here would surface in the panel as
 * an opaque RPC failure and lose the session.
 */
function mismatch(): StepResult {
  return { correct: false, wrong: [], blocking: true };
}

/** Fisher-Yates, using the injected RNG so sessions are reproducible in test. */
function shuffle<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = items[i] as T;
    items[i] = items[j] as T;
    items[j] = a;
  }
}

/** Ids are opaque to the panel; a counter is enough and needs no crypto. */
let sessionCounter = 0;
export function nextSessionId(): string {
  sessionCounter += 1;
  return `s${sessionCounter}`;
}
