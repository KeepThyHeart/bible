/**
 * Seam for daily plan reminders. The notifications/reminders engine (task 0083, `api.reminders`)
 * is not merged yet, so the service talks to this small port; the app plugs 0083's engine in
 * behind it later. Until then `NO_REMINDERS` is used and the UI hides the reminder setting.
 */
import type { Weekday } from './types';

export interface PlanReminderRule {
  enrollmentId: string;
  planName: string;
  /** Local time `HH:MM`. */
  time: string;
  /** The reader's reading days. */
  days: Weekday[];
}

export interface ReadingPlanReminderPort {
  /** False when the platform has no reminder engine; the UI then hides reminder settings. */
  readonly available: boolean;
  /** Replace every reading-plan reminder with these rules. */
  sync(rules: PlanReminderRule[]): Promise<void>;
}

export const NO_REMINDERS: ReadingPlanReminderPort = {
  available: false,
  sync: async () => {},
};

/** Test double / in-memory port: records the last rules it was given. */
export class RecordingReminderPort implements ReadingPlanReminderPort {
  readonly available = true;
  rules: PlanReminderRule[] = [];
  calls = 0;
  async sync(rules: PlanReminderRule[]): Promise<void> {
    this.calls++;
    this.rules = rules.map((r) => ({ ...r, days: [...r.days] }));
  }
}
