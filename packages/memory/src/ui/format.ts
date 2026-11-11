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

import type { AnalyticsView, Rung, RungView } from '../core/types';
import { RUNG_ORDER } from '../core/types';
import { tr, uiLocale } from './i18n';
import { startOfLocalDay } from '../core/today';
import { WELL_LEARNED_LEVEL } from '../core/ladder';

/**
 * The level at and above which an activity counts as mastered.
 *
 * Shared by `components.ts#levelBoxes` (green fill) and `carriesDownFrom`
 * below (the "harder carries down" rule) so the two never quietly disagree
 * about what "mastered" means. The same number as core's `WELL_LEARNED_LEVEL`.
 */
export const MASTERED_LEVEL = WELL_LEARNED_LEVEL;

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
    return tr('memory.ui.common.rungFirstLetters', 'First letters');
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
    return tr('memory.ui.common.blurbBlanks', 'Type the words that have been removed from the verse.');
  },
  get firstletters() {
    return tr('memory.ui.common.blurbFirstletters', 'Every word is hidden. Recall the whole verse.');
  },
  get refprovide() {
    return tr('memory.ui.common.blurbRefprovide', 'Given the words, say which reference they come from.');
  },
  get recite() {
    return tr('memory.ui.common.blurbRecite', 'Say the verse aloud from memory. Optional; needs a microphone.');
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
export { startOfLocalDay };

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

/** A 0..1 fraction as a percentage clamped to the bar's range. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value * 100));
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
// Choosing what to practice
// ---------------------------------------------------------------------------

/** What a "Start practicing" button will start, if anything. */
export interface PracticeTarget {
  passageId: number;
  rung: Rung;
  reference: string;
  dueAt: number | null;
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
