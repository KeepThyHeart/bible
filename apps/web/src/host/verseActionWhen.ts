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
