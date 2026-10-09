/**
 * A fake of the `api.reminders` host contract (task 0083 is not built yet).
 *
 * Records every call so tests can assert on what the worker sent, and lets a
 * test fire the activation/missed events the host would deliver.
 */

import type {
  JsonValue,
  ReminderCapabilities,
  ReminderItem,
} from '../src/core/pushTypes';

export interface FakeRemindersOptions {
  permission?: ReminderCapabilities['permission'];
  whenClosed?: ReminderCapabilities['whenClosed'];
  /** capabilities() rejects. */
  throwOnCapabilities?: boolean;
  /** capabilities() never settles. */
  hang?: boolean;
  /** replaceAll resolves after this many ms of real time (for serialization tests). */
  replaceAllDelayMs?: number;
}

type ActivatedListener = (e: { key: string; data?: JsonValue; firedAt: number }) => void | Promise<void>;
type MissedListener = (e: { keys: string[] }) => void | Promise<void>;

export function createFakeReminders(opts: FakeRemindersOptions = {}) {
  let permission: ReminderCapabilities['permission'] = opts.permission ?? 'granted';
  const activated: ActivatedListener[] = [];
  const missed: MissedListener[] = [];
  const calls = {
    replaceAll: [] as ReminderItem[][],
    capabilities: 0,
    requestPermission: 0,
  };
  let inFlight = 0;
  let maxInFlight = 0;

  const api = {
    async replaceAll(items: ReminderItem[]) {
      calls.replaceAll.push(items.map((i) => ({ ...i })));
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (opts.replaceAllDelayMs) {
        await new Promise((r) => setTimeout(r, opts.replaceAllDelayMs));
      }
      inFlight -= 1;
      return { accepted: items.length };
    },
    async capabilities(): Promise<ReminderCapabilities> {
      calls.capabilities += 1;
      if (opts.hang) return new Promise<ReminderCapabilities>(() => {});
      if (opts.throwOnCapabilities) throw new Error('capabilities unavailable');
      return { permission, whenClosed: opts.whenClosed ?? 'fires', actions: false };
    },
    async requestPermission() {
      calls.requestPermission += 1;
      if (permission === 'prompt') permission = 'granted';
      return permission;
    },
    onActivated(l: ActivatedListener) {
      activated.push(l);
      return { dispose: () => void activated.splice(activated.indexOf(l), 1) };
    },
    onMissed(l: MissedListener) {
      missed.push(l);
      return { dispose: () => void missed.splice(missed.indexOf(l), 1) };
    },
  };

  return {
    api,
    calls,
    get lastItems(): ReminderItem[] | undefined {
      return calls.replaceAll[calls.replaceAll.length - 1];
    },
    get maxInFlight() {
      return maxInFlight;
    },
    get listenerCount() {
      return { activated: activated.length, missed: missed.length };
    },
    async fireActivated(e: { key: string; data?: JsonValue; firedAt?: number }) {
      for (const l of [...activated]) await l({ firedAt: Date.now(), ...e });
    },
    async fireMissed(keys: string[]) {
      for (const l of [...missed]) await l({ keys });
    },
    setPermission(p: ReminderCapabilities['permission']) {
      permission = p;
    },
  };
}
