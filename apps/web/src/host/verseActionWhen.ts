/**
 * The tiny `when` evaluators of the web host. Both are synchronous and cheap
 * (called per menu open or per render), over a fixed map of keys:
 *
 * - `<appId>.live`: that app reports busy (e.g. `present.live`: a Presenter
 *   session is live). Generic, so a module's `when` needs no host entry.
 *
 * `evalVerseWhen` is strict: an unknown key is false (a verse action stays out
 * of the menu). `evalAppWhen` is permissive: apps' own `when` (e.g.
 * `server.present`) is true for every built-in today, so a key it does not know
 * never hides an app.
 */
import { appRegistry } from './appHost';

const getters: Record<string, () => boolean> = {};
const keyListeners = new Set<() => void>();
let keyVersion = 0;

/**
 * Let an ACTIVE module define a `when` key (`similar.available`). Dispose the
 * handle to remove it (push it to `ctx.subscriptions`); `whenKeys.invalidate()`
 * tells readers (the verse menu, the pane tabs) that a value changed.
 */
export function registerWhenKey(key: string, get: () => boolean): { dispose(): void } {
  getters[key] = get;
  whenKeys.invalidate();
  return {
    dispose() {
      if (getters[key] !== get) return;
      delete getters[key];
      whenKeys.invalidate();
    },
  };
}

/** A readable that changes whenever a registered key is added, removed or invalidated. */
export const whenKeys = {
  getSnapshot: () => keyVersion,
  subscribe(listener: () => void): () => void {
    keyListeners.add(listener);
    return () => {
      keyListeners.delete(listener);
    };
  },
  invalidate(): void {
    keyVersion++;
    for (const fn of [...keyListeners]) fn();
  },
};

const LIVE_KEY = /^([a-z][a-z0-9-]*)\.live$/;

function getter(key: string): (() => boolean) | undefined {
  const own = getters[key];
  if (own) return own;
  const m = LIVE_KEY.exec(key);
  if (!m) return undefined;
  const appId = m[1];
  return () => appRegistry.state.getSnapshot().apps.some((a) => a.item.id === appId && a.busy);
}

function parse(expr: string): { key: string; negate: boolean } {
  const e = expr.trim();
  return e.startsWith('!') ? { key: e.slice(1).trim(), negate: true } : { key: e, negate: false };
}

/** `key` or `!key`; an unknown key is false. */
export function evalVerseWhen(expr: string): boolean {
  const { key, negate } = parse(expr);
  const get = getter(key);
  if (!get) return false;
  return negate ? !get() : get();
}

/** `key` or `!key`; an unknown key is true (never hides an app). */
export function evalAppWhen(expr: string): boolean {
  const { key, negate } = parse(expr);
  const get = getter(key);
  if (!get) return true;
  return negate ? !get() : get();
}
