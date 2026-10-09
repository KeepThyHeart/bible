/**
 * Where the notifications engine is published for the feature module (task 0128).
 *
 * `main.ts` builds the `ElectronReminderHost` early (extensions' `api.reminders` and other reminder
 * sources need it whether or not the Notifications module is on) and calls `setActiveReminderHost`.
 * The module's IPC handlers (`modules/notifications`) read it through `getActiveReminderHost` at call
 * time, so they work whichever order the two start in. The engine itself never imports the module.
 */
import type { ElectronReminderHost } from './ElectronReminderHost';

let active: ElectronReminderHost | null = null;

export function setActiveReminderHost(host: ElectronReminderHost | null): void {
  active = host;
}

export function getActiveReminderHost(): ElectronReminderHost | null {
  return active;
}
