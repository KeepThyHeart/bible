/**
 * Typed settings store over a `SettingsRegistry`, with persistence behind a small
 * `SettingsStoragePort`.
 *
 * The store is framework-free and satisfies the `ReadableStore` contract
 * (`subscribe` + `getSnapshot`; the snapshot is a new frozen object per change), so it
 * plugs into `useReadable` (`@bible/ui`), `useSyncExternalStore`, or an app store
 * adapter without a wrapper.
 *
 * Storage port: the only thing an app supplies. Today the web app backs it with its
 * existing `localStorage` settings blob; when the web user-data store (0084) lands it
 * implements the same port, routing `synced` settings there. The store never touches
 * storage directly, so swapping is a one-line change where the store is created.
 */

import type { SettingScope, SettingsRegistry, SettingValue } from './SettingsRegistry';

export interface SettingChange {
  key: string;
  value: SettingValue;
  scope: SettingScope;
}

export interface SettingsStoragePort {
  /** Everything stored so far, as a raw object (unknown keys and bad values are tolerated). */
  read(): Record<string, unknown> | Promise<Record<string, unknown>>;
  /**
   * Persist changed values. The port merges them into what it holds: it must not
   * drop keys it was not given. Scope tells it where a value belongs (device storage
   * or the synced user-data store).
   */
  write(changes: readonly SettingChange[]): void | Promise<void>;
}

export type SettingsSnapshot = Readonly<Record<string, SettingValue>>;

export type SetResult = { ok: true } | { ok: false; error: string };

export interface SettingsStore {
  readonly registry: SettingsRegistry;
  /** Resolves once the port's initial read has been applied (immediately for sync ports). */
  readonly ready: Promise<void>;
  get<T extends SettingValue = SettingValue>(key: string): T;
  getAll(): SettingsSnapshot;
  set(key: string, value: unknown): SetResult;
  setMany(values: Record<string, unknown>): SetResult;
  /**
   * Re-read the port and replace every value with what it holds (defaults for anything
   * missing or invalid). For hosts whose storage changed underneath the store: a sync
   * arriving, or a legacy loader re-reading the same blob. Notifies when anything changed.
   */
  reload(): Promise<void>;
  /** Restore defaults for the given keys (all keys when omitted). */
  reset(keys?: readonly string[]): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): SettingsSnapshot;
}

/** In-memory port: the default for tests and for hosts with nothing to persist to. */
export function createMemoryPort(initial: Record<string, unknown> = {}): SettingsStoragePort & {
  readonly data: Record<string, unknown>;
} {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    read: () => ({ ...data }),
    write: (changes) => {
      for (const c of changes) data[c.key] = c.value;
    },
  };
}

export function createSettingsStore(
  registry: SettingsRegistry,
  port: SettingsStoragePort = createMemoryPort(),
): SettingsStore {
  let values: SettingsSnapshot = Object.freeze(registry.defaults());
  const listeners = new Set<() => void>();
  // Keys changed locally before an async read resolved win over the stored value.
  const touched = new Set<string>();

  const emit = () => listeners.forEach((fn) => fn());

  const persist = (changes: SettingChange[]) => {
    if (changes.length === 0) return;
    try {
      const pending = port.write(changes);
      if (pending) pending.catch(() => undefined);
    } catch {
      // Storage being unavailable must never break the running app.
    }
  };

  const change = (keys: string[], next: Record<string, SettingValue>): void => {
    const changes: SettingChange[] = [];
    const merged: Record<string, SettingValue> = { ...values };
    for (const key of keys) {
      if (sameValue(merged[key], next[key])) continue;
      merged[key] = next[key];
      touched.add(key);
      changes.push({ key, value: next[key], scope: registry.get(key)!.scope });
    }
    if (changes.length === 0) return;
    values = Object.freeze(merged);
    persist(changes);
    emit();
  };

  const apply = (raw: Record<string, unknown>) => {
    const stored = registry.sanitize(raw);
    const merged: Record<string, SettingValue> = { ...stored };
    for (const key of touched) merged[key] = values[key];
    values = Object.freeze(merged);
    emit();
  };

  const replaceAll = (raw: Record<string, unknown>) => {
    const next = registry.sanitize(raw);
    const changed = registry.definitions.some((d) => !sameValue(values[d.key], next[d.key]));
    touched.clear();
    if (!changed) return;
    values = Object.freeze(next);
    emit();
  };

  let ready: Promise<void> = Promise.resolve();
  try {
    const initial = port.read();
    if (initial && typeof (initial as Promise<unknown>).then === 'function') {
      ready = (initial as Promise<Record<string, unknown>>).then(apply, () => undefined);
    } else {
      values = Object.freeze(registry.sanitize(initial));
    }
  } catch {
    // Unreadable storage: run on defaults.
  }

  return {
    registry,
    ready,
    get: <T extends SettingValue>(key: string) => {
      if (!registry.has(key)) throw new Error(`Unknown setting '${key}'`);
      return values[key] as T;
    },
    reload: () => {
      try {
        const raw = port.read();
        if (raw && typeof (raw as Promise<unknown>).then === 'function') {
          return (raw as Promise<Record<string, unknown>>).then(replaceAll, () => undefined);
        }
        replaceAll(raw as Record<string, unknown>); // sync ports apply before this returns
      } catch {
        // Unreadable storage: keep what we have.
      }
      return Promise.resolve();
    },
    getAll: () => values,
    getSnapshot: () => values,
    set(key, value) {
      const checked = registry.validate(key, value);
      if (!checked.ok) return checked;
      change([key], { [key]: checked.value });
      return { ok: true };
    },
    setMany(input) {
      const next: Record<string, SettingValue> = {};
      for (const [key, value] of Object.entries(input)) {
        const checked = registry.validate(key, value);
        if (!checked.ok) return checked; // all or nothing
        next[key] = checked.value;
      }
      change(Object.keys(next), next);
      return { ok: true };
    },
    reset(keys) {
      const targets = keys ? keys.filter((k) => registry.has(k)) : registry.definitions.map((d) => d.key);
      const next: Record<string, SettingValue> = {};
      for (const key of targets) next[key] = registry.defaultFor(key)!;
      change(targets, next);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function sameValue(a: SettingValue | undefined, b: SettingValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}
