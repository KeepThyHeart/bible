/**
 * Memory push cards on the desktop notification scheduler (task 0114).
 *
 * The extension reached the scheduler through `api.reminders`; the built-in
 * module registers its own item source, `app:memory`, and hands the core an
 * `IRemindersApi` over it. Light on purpose: registered when the main module
 * registers (startup), so reminders restored from the state file keep their
 * click target and their clicks reach the core even before it has started
 * (they are queued until it subscribes, as `takeActivations` describes).
 *
 * Clicks: the scheduler calls `onActivated` (the core records which card was
 * asked for) and sends the renderer the route `app:memory/cards`, which opens
 * the Memory app on its card stack.
 */

import type { ItemSource } from '@bible/core/browser';
import type { IRemindersApi } from '@bible/memory/core';
import type { ModuleReminderHost } from '../FeatureMainModule';
import { memoryMainT } from './mainT';

export const MEMORY_REMINDER_SOURCE = 'app:memory';
export const MEMORY_CARDS_ROUTE = 'app:memory/cards';
/** Shown in the notification settings; looked up each time, so it follows the UI language. */
const label = (): string => memoryMainT('memory.reminderSource.label', 'Scripture memory');

type Activation = Parameters<Parameters<IRemindersApi['onActivated']>[0]>[0];
type Missed = Parameters<Parameters<IRemindersApi['onMissed']>[0]>[0];

export interface MemoryReminderBridge {
  /** The core's `reminders` port. */
  readonly api: IRemindersApi;
  dispose(): void;
}

export function createMemoryReminderBridge(host: ModuleReminderHost): MemoryReminderBridge {
  let onActivated: ((e: Activation) => void) | null = null;
  let onMissed: ((e: Missed) => void) | null = null;
  const queued: Activation[] = [];

  const source: ItemSource = {
    id: MEMORY_REMINDER_SOURCE,
    kind: 'items',
    label: label(),
    // Push cards are opt-in inside Memory's own settings; the scheduler switch must not hide them twice.
    defaultEnabled: true,
    target: { kind: 'route', route: MEMORY_CARDS_ROUTE },
    onActivated: (a) => {
      const event: Activation = { key: a.keys[0] ?? '', keys: a.keys, firedAt: a.dueAt, ...(a.data !== undefined ? { data: a.data as never } : {}) };
      if (onActivated) onActivated(event);
      else queued.push(event);
    },
    onMissed: (e) => onMissed?.({ keys: e.summarized, dropped: e.dropped }),
  };
  const unregister = host.registerSource(source);

  const api: IRemindersApi = {
    replaceAll: (items) => host.scheduler.replaceItems(MEMORY_REMINDER_SOURCE, items, label()),
    list: async () => host.scheduler.listItems(MEMORY_REMINDER_SOURCE) as never,
    capabilities: async () => host.capabilities() as never,
    requestPermission: async () => (await host.requestPermission()) as never,
    takeActivations: async () => queued.splice(0),
    onActivated: async (handler) => {
      onActivated = handler;
      for (const e of queued.splice(0)) handler(e);
      return {
        dispose: async () => {
          if (onActivated === handler) onActivated = null;
        },
      };
    },
    onMissed: async (handler) => {
      onMissed = handler;
      return {
        dispose: async () => {
          if (onMissed === handler) onMissed = null;
        },
      };
    },
  };

  return { api, dispose: unregister };
}
