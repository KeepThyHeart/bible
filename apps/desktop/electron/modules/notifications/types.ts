/**
 * The Notifications module's main-process API, shared by `./index.ts` (implements it through
 * `ipc.handle`) and the renderer's `createModuleClient<NotificationsApi, NotificationsEvents>('notifications')`.
 *
 * Events are sent by the engine itself (`electron/notifications/channels.ts`), on the module's
 * event channels.
 */
import type { NotificationsViewState, ReminderPermission, ReminderTarget } from '@bible/core/browser';

export interface NotificationsApi {
  getState(): NotificationsViewState;
  setSettings(settings: unknown): NotificationsViewState;
  setDevice(patch: unknown): NotificationsViewState;
  sendTest(): void;
  requestPermission(): ReminderPermission;
  /** A click-through that arrived before the renderer subscribed (null when none). */
  takeOpenTarget(): ReminderTarget | null;
}

export interface NotificationsEvents {
  'state-changed': [state: NotificationsViewState];
  'open-target': [target: ReminderTarget];
}
