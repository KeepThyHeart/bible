/**
 * Reminder and notification engine: shared types (task 0083).
 *
 * One engine serves every app feature that wants to remind the user at a time
 * of day (verse of the day, reading plans, prayer reminders) and every
 * extension that schedules its own reminders (memory push cards). Pure types:
 * no DOM, no Node, no framework. See `docs/features/notifications.md`.
 */

/** Day of the week, 0 = Sunday (as `Date.prototype.getDay`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** All seven days, Sunday first. */
export const ALL_WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** A local wall-clock time, `"HH:MM"` in 24-hour form ("07:30", "21:05"). */
export type WallTime = string;

/** A local calendar date, `"YYYY-MM-DD"`. */
export type LocalDateString = string;

/**
 * One rule inside a {@link ReminderPlan}.
 *
 * - `fixed`: at `time` on each of `days` (daily = all seven days, weekly = one).
 * - `window`: `count` times spread between `start` and `end` on each of `days`,
 *   at least `minGapMinutes` (default 45) apart. The spread is random but
 *   deterministic per plan seed, slot and date, so recomputing never moves a
 *   time that was already announced. `end` before `start` wraps past midnight.
 * - `date`: once, at `time` on `date` (a one-off reminder).
 *
 * Times are local wall-clock times in the plan's time zone. A time that does
 * not exist on a day (skipped by a DST change) fires at the first valid minute
 * after the gap; a time that happens twice (DST ends) fires at the first one.
 */
export type ReminderSlot =
  | { id: string; kind: 'fixed'; time: WallTime; days: Weekday[] }
  | {
      id: string;
      kind: 'window';
      start: WallTime;
      end: WallTime;
      count: number;
      days: Weekday[];
      minGapMinutes?: number;
    }
  | { id: string; kind: 'date'; date: LocalDateString; time: WallTime };

/**
 * Quiet hours: `[start, end)` in local wall-clock time. `end` before `start`
 * wraps past midnight ("21:30"-"07:00"); `start === end` means no quiet hours.
 */
export interface QuietHours {
  start: WallTime;
  end: WallTime;
}

/** A source's schedule: what {@link expandPlan} turns into fire times. */
export interface ReminderPlan {
  slots: ReminderSlot[];
  /** Fires that fall inside these hours are dropped (not deferred) for this plan. */
  quiet?: QuietHours;
  /** Hard cap on fires per local day across all slots (earliest kept). Absent = no cap. */
  maxPerDay?: number;
}

/** One expanded fire of a plan. */
export interface FireTime {
  /** Epoch milliseconds. */
  at: number;
  slotId: string;
  /** The local date (in the plan's time zone) the fire belongs to. */
  date: LocalDateString;
}

/** JSON-compatible value (what may travel through `data`). */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Where a click on a notification leads. The host routes it:
 * - `verse`: open the verse (and optional end of range) in the reader;
 * - `route`: an app route the host knows (`'reading-plan/today'`, `'settings/notifications'`);
 * - `extension`: wake the extension (activation event `onReminder`) and open its panel.
 */
export type ReminderTarget =
  | { kind: 'verse'; verseId: number; endVerseId?: number }
  | { kind: 'route'; route: string; data?: JsonValue }
  | { kind: 'extension'; extensionId: string; panelId?: string };

/** What a notification shows. Titles and bodies are plain text, never HTML. */
export interface NotificationContent {
  title: string;
  body: string;
  /** Same tag replaces an unread notification with the same tag (where the OS supports it). */
  tag?: string;
  /** Click-through. Absent: the click just focuses the app. */
  target?: ReminderTarget;
  silent?: boolean;
}

/**
 * A reminder an item source (an extension) schedules itself, with its content
 * bound at scheduling time. The host persists it and fires it even while the
 * extension is not running.
 */
export interface ReminderItem {
  /** Unique within the source, e.g. `"card:42:1759046400000"`. */
  key: string;
  /** Epoch milliseconds. */
  fireAt: number;
  title: string;
  body: string;
  tag?: string;
  /** Handed back on activation. At most {@link REMINDER_LIMITS.dataBytes} as JSON. */
  data?: JsonValue;
}

/** Limits the engine enforces on item sources. */
export const REMINDER_LIMITS = {
  /** Pending items per source; later ones are dropped (earliest kept). */
  itemsPerSource: 64,
  titleChars: 120,
  bodyChars: 500,
  keyChars: 200,
  dataBytes: 1024,
} as const;

/** How the platform can deliver notifications right now. */
export type ReminderPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface ReminderCapabilities {
  /** Whether the app may show OS/browser notifications. */
  permission: ReminderPermission;
  /**
   * What happens when the app window is closed:
   * `fires` (a tray/background process keeps firing), `background-only`
   * (fires while the app runs in the background, e.g. a hidden tab),
   * `never` (only while the app is open).
   */
  whenClosed: 'fires' | 'background-only' | 'never';
  /** Notification action buttons supported (not relied on today). */
  actions: boolean;
}

/** Policy for reminders whose time passed while the app was closed or asleep. */
export interface MissedPolicy {
  /** Overdue by at most this much: collapsed into one notification per source. Older: dropped. */
  collapseWithinMs: number;
  /** Overdue by at most this much counts as on time (timer jitter, short sleeps). */
  lateToleranceMs: number;
}

export const DEFAULT_MISSED_POLICY: MissedPolicy = {
  collapseWithinMs: 12 * 60 * 60 * 1000,
  lateToleranceMs: 5 * 60 * 1000,
};
