/**
 * Reading plans (task 0073): plans are data. A plan is a list of days; a day is a list of
 * readings; a reading is an inclusive verse range (`start`..`end`, KJV verse ids), so a day
 * can be a few verses, a split chapter or several books. Browser-safe, no platform deps.
 */

/** `book * 1_000_000 + chapter * 1_000 + verse` (see verse-identity.md). */
export type VerseIdNumber = number;

/** A local calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/** Weekdays as in `Date.getDay()`: 0 = Sunday ... 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const ALL_WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** One reading: an inclusive verse range inside one book, optionally on a named track. */
export interface Reading {
  start: VerseIdNumber;
  end: VerseIdNumber;
  /** Track id (M'Cheyne's four columns, an OT/NT/Psalms plan); absent for single-track plans. */
  track?: string;
}

/** One day of a plan. Day numbers are 1-based: `days[0]` is day 1. */
export interface PlanDay {
  readings: Reading[];
}

export interface PlanTrack {
  id: string;
  name: string;
}

export type PlanSource = 'stock' | 'user' | 'extension';

/** A complete plan: always materialised as days. */
export interface PlanDefinition {
  /** `stock:<id>`, `user:<uuid>` or `ext:<extId>/<id>`. Stable forever. */
  key: string;
  /** Bumped whenever the days of a stock plan change. Enrollments keep a snapshot, so a bump never moves a reader. */
  version: number;
  /** English name (stock plans are localized by the app via `readingPlans.stock.<id>.name`). */
  name: string;
  description?: string;
  source: PlanSource;
  tracks?: PlanTrack[];
  days: PlanDay[];
  /** The builder input for user plans ("edit and rebuild"). */
  spec?: BuilderSpec;
}

/** A plan in a list: no days. */
export interface PlanSummary {
  key: string;
  version: number;
  name: string;
  description?: string;
  source: PlanSource;
  dayCount: number;
  /** Total verses in the plan, for "about N minutes a day". */
  verseCount: number;
  trackCount: number;
}

/** A passage the builder reads from, in order. Inclusive; may span books (it is split at book ends). */
export interface ScopeRange {
  start: VerseIdNumber;
  end: VerseIdNumber;
}

export type BuilderPace =
  | { by: 'days'; days: number }
  | { by: 'endDate'; startDate: IsoDate; endDate: IsoDate }
  | { by: 'chaptersPerDay'; chapters: number }
  | { by: 'versesPerDay'; verses: number };

/**
 * `chapter`: whole chapters per day where possible (a range that starts or ends mid-chapter keeps
 * its partial chapter as one unit). `verse`: days balanced by verse count, cutting inside chapters
 * when that is closer to the target (Psalm 119, a three-day Jude).
 */
export type BuilderSplit = 'chapter' | 'verse';

export type BuilderOrder = 'as-listed' | 'canonical' | 'chronological';

export interface BuilderTrackSpec {
  id: string;
  name: string;
  scope: ScopeRange[];
}

export interface BuilderSpec {
  name: string;
  description?: string;
  /** What to read, in order (ignored when `tracks` is given). */
  scope: ScopeRange[];
  order: BuilderOrder;
  pace: BuilderPace;
  split: BuilderSplit;
  /** Parallel tracks (each built to the same number of days and zipped). */
  tracks?: BuilderTrackSpec[];
  /** Used to resolve an `endDate` pace into a number of reading days. Default: every day. */
  readingDays?: Weekday[];
}

/**
 * `flexible`: today is the first unfinished day; nothing is ever overdue.
 * `fixed`: each reading day of the calendar has its plan day; missed days show as "behind".
 */
export type Pacing = 'flexible' | 'fixed';

export type EnrollmentStatus = 'active' | 'paused' | 'completed';

/** One reader's run through a plan. */
export interface Enrollment {
  id: string;
  /** Key of the stored plan snapshot (see IReadingPlanStore). */
  planKey: string;
  planVersion: number;
  /** Display name at the time the plan was started. */
  planName: string;
  startDate: IsoDate;
  pacing: Pacing;
  /** Days of the week the reader reads on (fixed pacing counts only these). Default all seven. */
  readingDays: Weekday[];
  status: EnrollmentStatus;
  createdAt: string;
  completedAt?: string;
  /** Daily reminder (needs a reminder port; see ReadingPlanReminders). */
  reminder?: { time: string } | null;
}

export type CompletionVia = 'manual' | 'reader' | 'audio';

/** One ticked reading. A day is done when every reading in it is ticked. */
export interface Completion {
  enrollmentId: string;
  day: number;
  reading: number;
  at: string;
  via: CompletionVia;
}
