/**
 * Pure formatting and selection helpers for the panel.
 *
 * Nothing in this file touches the DOM. That is deliberate and load-bearing:
 * the panel bundle is built for a browser realm, but `vitest.config.ts` runs
 * the suite under `environment: 'node'`, so anything that reaches for
 * `document` at import time cannot be unit tested without dragging in a DOM
 * shim. Keeping the decisions - which card is next, what a due date reads as,
 * how a score is phrased - in a DOM-free module means the interesting logic is
 * testable and the untestable part is reduced to "put this string in that
 * element".
 *
 * Every function that depends on the clock takes `now` as an argument for the
 * same reason. A helper that calls `Date.now()` internally can only be tested
 * by freezing time globally, which makes the test order-dependent.
 */

import type { AnalyticsView, PassageView, PlanView, Rung, RungView } from '../core/types';
import { RUNG_ORDER } from '../core/types';
import { TEXT_RECALL_CHAIN, isOptionalRung } from '../core/ladder';
import { tr, uiLocale } from './i18n';

/**
 * The level at and above which an activity counts as mastered.
 *
 * Shared by `components.ts#levelBoxes` (green fill) and `carriesDownFrom`
 * below (the "harder carries down" rule) so the two never quietly disagree
 * about what "mastered" means.
 */
export const MASTERED_LEVEL = 4;

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Human names for the rungs, now called "activities" everywhere the user
 * reads them - "rung" and "ladder" are this codebase's internal vocabulary
 * for the mechanism, not words a learner needs.
 */
export const RUNG_LABEL: Readonly<Record<Rung, string>> = {
  // Getters, so the label follows a language change instead of being fixed at import.
  get ordering() {
    return tr('memory.ui.common.rungOrdering', 'Put in order');
  },
  get refmatch() {
    return tr('memory.ui.common.rungRefmatch', 'Match the reference');
  },
  get blanks() {
    return tr('memory.ui.common.rungBlanks', 'Fill in the blanks');
  },
  get firstletters() {
    return tr('memory.ui.common.rungFirstletters', 'First letters only');
  },
  get refprovide() {
    return tr('memory.ui.common.rungRefprovide', 'Name the reference');
  },
  get recite() {
    return tr('memory.ui.common.rungRecite', 'Recite aloud');
  },
};

/** What each activity asks of the user, in one line. */
export const RUNG_BLURB: Readonly<Record<Rung, string>> = {
  get ordering() {
    return tr('memory.ui.common.blurbOrdering', 'Choose which verse comes next, with the earlier verses in view.');
  },
  get refmatch() {
    return tr('memory.ui.common.blurbRefmatch', 'Given the words, choose the reference they belong to.');
  },
  get blanks() {
    return tr('memory.ui.common.blurbBlanks', 'Type the words that have been removed from the passage.');
  },
  get firstletters() {
    return tr('memory.ui.common.blurbFirstletters', 'Every word is hidden. Recall the whole verse.');
  },
  get refprovide() {
    return tr('memory.ui.common.blurbRefprovide', 'Given the words, say which reference they come from.');
  },
  get recite() {
    return tr('memory.ui.common.blurbRecite', 'Say the passage aloud from memory. Optional; needs a microphone.');
  },
};

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/**
 * Midnight local time for the day containing `ms`.
 *
 * "Due tomorrow" is a *calendar* claim, not an arithmetic one: something due
 * in 20 hours is due tomorrow if it is currently 9pm and later today if it is
 * currently 1am. Subtracting epoch milliseconds and dividing by 86 400 000
 * gets that wrong roughly half the time, so days are compared as days.
 */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole calendar days from the day of `from` to the day of `to`. */
export function calendarDaysBetween(from: number, to: number): number {
  return Math.round((startOfLocalDay(to) - startOfLocalDay(from)) / MS_PER_DAY);
}

/** A short absolute date - "12 Mar" this year, "12 Mar 2027" beyond it. */
export function formatShortDate(ms: number, now: number): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(uiLocale(), {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/**
 * How a `dueAt` reads on screen.
 *
 * `null` means the activity has never been attempted, which is the normal
 * state for something the user has not gotten to yet and must not read like
 * an error.
 */
export function formatDue(dueAt: number | null, now: number): string {
  if (dueAt === null) return tr('memory.ui.common.notTriedYet', 'Not tried yet');
  if (dueAt <= now) return tr('memory.ui.common.dueNow', 'Due now');

  const days = calendarDaysBetween(now, dueAt);
  if (days <= 0) return tr('memory.ui.common.dueLaterToday', 'Due later today');
  if (days === 1) return tr('memory.ui.common.dueTomorrow', 'Due tomorrow');
  if (days < 7) return tr('memory.ui.common.dueInDays', '{days, plural, one {Due in # day} other {Due in # days}}', { days });
  return tr('memory.ui.common.dueOnDate', 'Due {date}', { date: formatShortDate(dueAt, now) });
}

/** True when an activity is scheduled and its time has come. */
export function isDue(rung: RungView, now: number): boolean {
  return rung.applicable && rung.dueAt !== null && rung.dueAt <= now;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/**
 * A 0..1 score as a percentage.
 *
 * `null` is "never attempted", which is different from zero and has to look
 * different: an activity the user has never tried is not one they failed.
 */
export function formatScore(score: number | null): string {
  if (score === null) return '—';
  return `${Math.round(score * 100)}%`;
}

/** "Step 3 of 7". Defensive about a zero total so the header never reads "of 0". */
export function formatStepProgress(stepNumber: number, totalSteps: number): string {
  if (totalSteps <= 0) return tr('memory.ui.common.stepNumber', 'Step {step}', { step: stepNumber });
  return tr('memory.ui.common.stepOfTotal', 'Step {step} of {total}', { step: stepNumber, total: totalSteps });
}

/** A 0..1 fraction as a percentage clamped to the bar's range. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value * 100));
}

/** Pluralises a count and its noun together: "1 verse", "3 verses". */
export function countLabel(n: number, singular: string, plural?: string): string {
  return `${n} ${n === 1 ? singular : (plural ?? `${singular}s`)}`;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/**
 * The comparable core of a word: letters and digits, case-folded.
 *
 * Used by the letter-reveal renderer to decide whether the key that was just
 * pressed is the right initial. Scoring itself stays in the worker - the panel
 * must never be the authority on whether an answer was right, because the two
 * halves would then have two definitions of correct. This is only the local
 * affordance that lets a keystroke reveal a word without a round trip.
 *
 * Apostrophes are stripped along with the rest of the punctuation so that
 * "'tis" answers to `t`; a leading quotation mark must not swallow the letter
 * the user is being asked for.
 */
export function wordCore(word: string): string {
  return word.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase();
}

/** The initial a letter-reveal box tests a keystroke against. */
export function firstLetterOf(word: string): string {
  return wordCore(word).slice(0, 1);
}

/** True when `typed` is the initial `word` is asking for. */
export function matchesFirstLetter(typed: string, word: string): boolean {
  const want = firstLetterOf(word);
  if (want === '') return true;
  return wordCore(typed).slice(0, 1) === want;
}

// ---------------------------------------------------------------------------
// Choosing what to practise
// ---------------------------------------------------------------------------

/** What a "Start practicing" button will start, if anything. */
export interface PracticeTarget {
  passageId: number;
  rung: Rung;
  reference: string;
  dueAt: number | null;
}

/**
 * The single highest-priority due activity across the whole plan.
 *
 * The order is: longest overdue first, then lowest rung, then oldest passage.
 *
 * Rung order breaks the tie rather than passage order because the ladder is a
 * dependency chain - there is no point drilling first-letters on one passage
 * while an ordering card on another has been waiting the same number of days,
 * since the ordering card is the one holding up its own passage's progress.
 * The passage id is the final tiebreak purely so the button is deterministic;
 * a "random due card" button is one the user cannot form a habit around.
 */
export function pickDueTarget(plan: PlanView, now: number): PracticeTarget | null {
  let best: PracticeTarget | null = null;

  for (const pv of plan.passages) {
    for (const rv of pv.rungs) {
      if (isOptionalRung(rv.rung)) continue; // recite has its own "Recite what's due"
      if (!isDue(rv, now)) continue;
      const candidate: PracticeTarget = {
        passageId: pv.passage.id,
        rung: rv.rung,
        reference: pv.passage.reference,
        dueAt: rv.dueAt,
      };
      if (best === null || comparePriority(candidate, best) < 0) best = candidate;
    }
  }

  return best;
}

function comparePriority(a: PracticeTarget, b: PracticeTarget): number {
  if (a.dueAt !== b.dueAt) return (a.dueAt ?? 0) - (b.dueAt ?? 0);
  const rungDelta = RUNG_ORDER.indexOf(a.rung) - RUNG_ORDER.indexOf(b.rung);
  if (rungDelta !== 0) return rungDelta;
  return a.passageId - b.passageId;
}

/**
 * The activity a passage's own "Practice" button should start, and the one
 * badged "Suggested" on the passage screen: whichever applicable activity is
 * due soonest; failing that, the first applicable activity that has not
 * reached "well learned" (level 4); failing that (everything mastered), the
 * hardest one, as an upkeep suggestion.
 *
 * Unlike v0's `pickRungForPassage`, this never returns null: nothing is
 * locked or exempt from suggestion any more, so there is always something to
 * offer. `main.ts#suggestedRungForPassage` implements the same rule
 * worker-side for the "Start practicing" button, which does not have a
 * `RungView[]` to hand.
 */
export function suggestedRungFor(rungs: RungView[], now: number): Rung | null {
  const applicable = rungs.filter((r) => r.applicable && !isOptionalRung(r.rung));
  if (applicable.length === 0) return null;

  const due = applicable.filter((r) => isDue(r, now));
  if (due.length > 0) {
    due.sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
    return due[0]!.rung;
  }

  for (const rung of RUNG_ORDER) {
    const rv = applicable.find((r) => r.rung === rung);
    if (rv && rv.level < 4) return rv.rung;
  }
  return applicable[applicable.length - 1]!.rung;
}

/**
 * What "Start practicing" on the home screen offers: the plan's highest-
 * priority due activity, or - when nothing is due - the suggested activity of
 * the most recently added passage, so the button always does something.
 */
export function pickStartTarget(plan: PlanView, now: number): PracticeTarget | null {
  const due = pickDueTarget(plan, now);
  if (due) return due;
  if (plan.passages.length === 0) return null;

  const latest = [...plan.passages].sort((a, b) => b.passage.addedAt - a.passage.addedAt)[0]!;
  const rung = suggestedRungFor(latest.rungs, now);
  if (!rung) return null;
  const rv = latest.rungs.find((r) => r.rung === rung);
  return { passageId: latest.passage.id, rung, reference: latest.passage.reference, dueAt: rv?.dueAt ?? null };
}

/**
 * True when `rung` itself has not been mastered, but a harder rung (later in
 * `RUNG_ORDER`) has - the "harder activity carries down" rule from task
 * 0004's review, point 10. `bestLevel`/`wellLearned` already apply this at
 * the whole-passage level; this is the per-activity version the plan row's
 * compact squares need, so an activity that was never directly practised to
 * mastery can still be drawn as "passed" rather than "not started".
 */
export function carriesDownFrom(rungs: RungView[], rung: Rung): boolean {
  // Same chain as ladder.ts (the worker's rule), so the panel and worker agree:
  // recite carries down to the three text rungs, never to refmatch/refprovide.
  const index = TEXT_RECALL_CHAIN.indexOf(rung);
  if (index < 0) return false;
  return rungs.some(
    (r) =>
      (r.applicable || r.optional === true) &&
      TEXT_RECALL_CHAIN.indexOf(r.rung) > index &&
      r.level >= MASTERED_LEVEL,
  );
}

/**
 * Orders a rung list into ladder order regardless of what the worker sent.
 *
 * The protocol does not promise an order for `PassageView.rungs`, and the
 * passage screen's whole claim is that it shows the ladder *linearly*.
 * Sorting here rather than trusting the array means a worker change cannot
 * silently turn the screen into a shuffled list.
 */
export function inLadderOrder(rungs: RungView[]): RungView[] {
  return [...rungs].sort((a, b) => RUNG_ORDER.indexOf(a.rung) - RUNG_ORDER.indexOf(b.rung));
}

/**
 * Sorts passages by how much they need practice: due first by earliest
 * `dueAt`, then never-attempted (`bestLevel === 0`), then ascending
 * `bestLevel`, then descending `dueCount`, then ascending `addedAt` as the
 * deterministic tiebreak.
 *
 * Pure - returns a new array, per the file's convention (`inLadderOrder`
 * above does the same). Wiring this into an actual sort `<select>` is left to the caller; this is only the
 * ordering function.
 */
export function sortPassagesByNeed(passages: PassageView[], now: number): PassageView[] {
  return [...passages].sort((a, b) => comparePassageNeed(a, b, now));
}

function comparePassageNeed(a: PassageView, b: PassageView, now: number): number {
  const dueDelta = compareEarliestDueAt(earliestDueAt(a, now), earliestDueAt(b, now));
  if (dueDelta !== 0) return dueDelta;

  const aNeverAttempted = a.bestLevel === 0;
  const bNeverAttempted = b.bestLevel === 0;
  if (aNeverAttempted !== bNeverAttempted) return aNeverAttempted ? -1 : 1;

  if (a.bestLevel !== b.bestLevel) return a.bestLevel - b.bestLevel;
  if (a.dueCount !== b.dueCount) return b.dueCount - a.dueCount;
  return a.passage.addedAt - b.passage.addedAt;
}

/** The soonest `dueAt` among a passage's due rungs, or `null` if none is due. */
function earliestDueAt(pv: PassageView, now: number): number | null {
  let best: number | null = null;
  for (const rv of pv.rungs) {
    if (!isDue(rv, now)) continue;
    if (best === null || (rv.dueAt ?? 0) < best) best = rv.dueAt ?? 0;
  }
  return best;
}

/** `null` (not due) always sorts after any due timestamp; earlier timestamps sort first. */
function compareEarliestDueAt(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/** "5 weeks" of a practice calendar, as ISO weekday columns (Mon..Sun). */
export function calendarWeeks(analytics: AnalyticsView): AnalyticsView['calendar'][] {
  const days = analytics.calendar;
  const weeks: AnalyticsView['calendar'][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/** "Tue", "Wed", ... for a calendar day, in the viewer's locale. */
export function weekdayLabel(dateMs: number): string {
  return new Date(dateMs).toLocaleDateString(uiLocale(), { weekday: 'short' });
}
