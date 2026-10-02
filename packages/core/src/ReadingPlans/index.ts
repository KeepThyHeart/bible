/** Reading plans (task 0073): plan engine, stock library, builder, scheduler, store and service. Browser-safe. */
export * from './types';
export { VERSE_COUNTS } from './versificationData';
export {
  TOTAL_VERSES, vid, splitVid, chapterCount, versesInChapter, isValidVerseId, bookStart, bookEnd, booksRange,
  nextVerse, countVerses, readingVerseCount, splitByBook, isWholeChapters, formatReading, estimateMinutes, MINUTES_PER_VERSE,
} from './versification';
export { parseIsoDate, isIsoDate, addDays, daysBetween, weekdayOf, readingDate, DEFAULT_ROLLOVER_HOUR } from './dates';
export {
  buildPlanDays, previewPlan, mergeRanges, countReadingDays, versesToReadings, PlanBuildError, MAX_PLAN_DAYS,
} from './builder';
export type { BuildOptions, PlanPreview } from './builder';
export {
  indexCompletions, isDayDone, firstUnreadDay, isReadingDay, scheduledDay, dateForDay, todayView, planStats,
  shiftedStartDate, catchUpSuggestion, dayStatuses,
} from './scheduler';
export type { ProgressIndex, TodayView, TodayReading, PlanStats, DayStatus } from './scheduler';
export {
  STOCK_PREFIX, CHRONOLOGICAL_ORDER, CHRONOLOGICAL_BASIS, stockPlanKey, isStockPlanKey, stockPlanIds, getStockPlan,
  summarizePlan, listStockPlans,
} from './stock';
export {
  validatePlanDefinition, validateBuilderSpec, validateEnrollment, validateCompletion, validateWeekdays, ReadingPlanDataError,
} from './validate';
export {
  UserDataReadingPlanStore, READING_PLANS_OWNER, PLANS_COLLECTION, SNAPSHOTS_COLLECTION, ENROLLMENTS_COLLECTION,
  COMPLETIONS_COLLECTION, snapshotKey,
} from './store';
export type { IReadingPlanStore, CompletionChange } from './store';
export { ReadingPlanService } from './service';
export type {
  ReadingPlanEvent, ReadingPlanListener, ReadingScope, IReadingScopeProvider, StartPlanOptions, EnrollmentPatch,
  EnrollmentDetail, ReadingPlanServiceOptions,
} from './service';
export { NO_REMINDERS, RecordingReminderPort } from './reminders';
export type { ReadingPlanReminderPort, PlanReminderRule } from './reminders';
export { planToIcs } from './ics';
export type { IcsOptions } from './ics';
