/**
 * Seam for daily plan reminders. The service talks to this small port; an app plugs the
 * notifications/reminders engine (task 0083, `Reminders` in core) in behind it. No app does yet
 * (the engine is merged, the adapter is not built): `NO_REMINDERS` is used and the UI hides the
 * reminder setting.
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
