/**
 * Ready-made ports for {@link ReminderScheduler}, and the host contract each
 * app implements around it.
 */
import type { ReminderState, ReminderStatePort, ReminderTimer } from './ReminderScheduler';
import type { ReminderCapabilities, ReminderPermission } from './types';

/** Longest delay `setTimeout` takes before it overflows and fires at once. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** A {@link ReminderTimer} over the global `setTimeout` (main process, tab, worker). */
export function createTimeoutTimer(): ReminderTimer {
  let handle: ReturnType<typeof setTimeout> | null = null;
  return {
    set(delayMs, cb) {
      if (handle !== null) clearTimeout(handle);
      handle = setTimeout(() => {
        handle = null;
        cb();
      }, Math.min(Math.max(0, delayMs), MAX_TIMER_DELAY_MS));
      // Do not keep a Node process alive just for a reminder.
      (handle as { unref?: () => void }).unref?.();
    },
    clear() {
      if (handle !== null) clearTimeout(handle);
      handle = null;
    },
  };
}

/** State kept in memory only (tests, or a host that cannot persist). */
export function createMemoryStatePort(initial: ReminderState | null = null): ReminderStatePort & { current: ReminderState | null } {
  const port = {
    current: initial,
    load: () => port.current,
    save: (s: ReminderState) => {
      port.current = s;
    },
  };
  return port;
}

/** Minimal synchronous string storage (`localStorage` fits). */
export interface StringStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** State as one JSON string under `key` (web: `localStorage`; it is per device by design). */
export function createStringStatePort(storage: StringStoragePort, key: string): ReminderStatePort {
  return {
    load() {
      try {
        const raw = storage.getItem(key);
        return raw ? (JSON.parse(raw) as ReminderState) : null;
      } catch {
        return null;
      }
    },
    save(state) {
      try {
        storage.setItem(key, JSON.stringify(state));
      } catch {
        /* storage full or blocked: the engine still works for this session */
      }
    },
  };
}

/**
 * What each app provides around the engine: platform capability and the
 * permission prompt. Desktop: Electron `Notification` plus tray state. Web:
 * the Notifications API (tier 1, while a tab is open).
 */
export interface ReminderPlatform {
  capabilities(): Promise<ReminderCapabilities>;
  /** Web: must run from a user gesture. Desktop: resolves at once. */
  requestPermission(): Promise<ReminderPermission>;
}
