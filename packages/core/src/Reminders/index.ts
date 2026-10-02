/**
 * Notifications and reminders engine (task 0083). Pure TypeScript: the rule
 * model and its time-zone-safe expansion, missed-run reconciliation, the
 * settings document, and the scheduler both apps run behind small ports.
 * See `docs/features/notifications.md`.
 */
export * from './types';
export {
  isValidTimeZone,
  systemTimeZone,
  zonedParts,
  zoneOffset,
  parseWallTime,
  formatWallTime,
  parseCivilDate,
  formatCivilDate,
  addCivilDays,
  civilDateOf,
  civilWeekday,
  minuteOfDay,
  wallToInstant,
} from './time';
export type { ZonedParts, Civil } from './time';
export {
  expandPlan,
  nextFireAt,
  firesBetween,
  isQuietMinute,
  isInQuietHours,
  endOfQuietHours,
  spreadInWindow,
  MAX_HORIZON_MS,
  DEFAULT_WINDOW_GAP_MINUTES,
} from './plan';
export type { ExpandOptions } from './plan';
export { reconcileMissed } from './reconcile';
export type { ReconcileResult } from './reconcile';
export {
  NotificationSettingsStore,
  NOTIFICATIONS_OWNER,
  NOTIFICATIONS_COLLECTION,
  NOTIFICATIONS_SETTINGS_KEY,
  DEFAULT_NOTIFICATION_SETTINGS,
  normalizeNotificationSettings,
  normalizeReminderPlan,
  normalizeQuietHours,
  isSourceEnabled,
} from './settings';
export type { NotificationSettings, SourcePreference } from './settings';
export { ReminderScheduler, sanitizeReminderItems } from './ReminderScheduler';
export type {
  ReminderClock,
  ReminderTimer,
  ReminderPresenter,
  PresentedNotification,
  ReminderState,
  ReminderStatePort,
  ReminderStrings,
  ReminderSource,
  RuleSource,
  ItemSource,
  FireContext,
  ReminderActivation,
  ReminderSourceInfo,
  ReminderSchedulerOptions,
} from './ReminderScheduler';
export {
  createTimeoutTimer,
  createMemoryStatePort,
  createStringStatePort,
  MAX_TIMER_DELAY_MS,
} from './ports';
export type { StringStoragePort, ReminderPlatform } from './ports';
export { DEFAULT_NOTIFICATION_DEVICE_SETTINGS } from './view';
export type { NotificationDeviceSettings, NotificationsViewState } from './view';
