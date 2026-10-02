/**
 * Bidirectional-text helpers for plain-text sinks (task 0076).
 *
 * ## Where these belong, and where they do not
 *
 * - **DOM sinks use markup**: a `<bdi>` element (`<Bdi>` in `@bible/ui`) or
 *   `unicode-bidi: isolate` (`.bidi-isolate` in KTH CSS). Never put FSI/PDI
 *   characters into text that is rendered as DOM: markup is invisible to copy,
 *   search and screen readers, control characters are not.
 * - **Plain-text sinks use {@link isolate}**: window titles, native menus,
 *   notifications, `aria-label`, `title` attributes and interpolated `t()`
 *   parameters (via {@link isolateParams}). These cannot carry markup, so an
 *   isolate is the only way to stop "يوحنا 3:16" or "KJV" reordering the
 *   sentence around it.
 * - **Anything that leaves the app or is parsed goes through
 *   {@link stripBidiControls}**: clipboard text, search input, reference
 *   parser input, file names.
 *
 * Everything here is pure string code (no DOM), so it lives in the
 * `@bible/core/browser` barrel and is safe in the Electron main process too.
 */

import type { LocaleDirection } from '../Data/Locales/LocaleRegistry';

/** FIRST STRONG ISOLATE: direction taken from the first strong character. */
export const FSI = '⁨';
/** LEFT-TO-RIGHT ISOLATE. */
export const LRI = '⁦';
/** RIGHT-TO-LEFT ISOLATE. */
export const RLI = '⁧';
/** POP DIRECTIONAL ISOLATE: closes FSI, LRI or RLI. */
export const PDI = '⁩';

/**
 * Every Unicode bidi control: the isolates above, the older embeddings and
 * overrides (LRE, RLE, PDF, LRO, RLO) and the implicit marks (LRM, RLM, ALM).
 */
const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/g;

/** True when `text` contains any bidi control character. */
export function hasBidiControls(text: string): boolean {
  BIDI_CONTROLS.lastIndex = 0;
  return BIDI_CONTROLS.test(text);
}

/**
 * Wrap `text` in an isolate so it cannot reorder the text around it.
 *
 * `dir` picks the isolate: `'auto'` (the default) uses FSI, so the run takes
 * its direction from its own first strong character, which is right for user
 * content and module abbreviations of unknown script. An empty string is
 * returned unchanged (an empty isolate is pointless noise), and an already
 * isolated string is not wrapped twice.
 */
export function isolate(text: string, dir: LocaleDirection | 'auto' = 'auto'): string {
  if (text.length === 0) return text;
  const open = dir === 'ltr' ? LRI : dir === 'rtl' ? RLI : FSI;
  if (text.startsWith(open) && text.endsWith(PDI)) return text;
  return `${open}${text}${PDI}`;
}

/**
 * Remove every bidi control character. Use on clipboard text, search and
 * reference-box input, and anything handed to a parser, so an isolate added
 * for display never leaks into data.
 */
export function stripBidiControls(text: string): string {
  return text.replace(BIDI_CONTROLS, '');
}

/**
 * Isolate every string-valued parameter of a `t()` call when the UI is RTL.
 *
 * Interpolated values (module abbreviations, book names, note titles, search
 * terms) are the classic source of bidi bugs in an RTL sentence: "KJV" or
 * "John 3:16" at the end of an Arabic sentence drags punctuation to the wrong
 * side. Isolating them in the one `t()` wrapper each app has fixes all such
 * strings at once.
 *
 * - In an LTR UI the params are returned untouched (same object), so English
 *   output is byte-for-byte what it was.
 * - Numbers, booleans and objects are left alone: ICU formats numbers itself
 *   and they are weak characters the bidi algorithm handles.
 * - Strings that are empty or already contain bidi controls are left alone.
 * - Keys listed in `skip` are left alone (for a param that is itself markup or
 *   a nested, already-localized phrase in the UI language).
 */
export function isolateParams<T extends Record<string, unknown>>(
  params: T,
  uiDir: LocaleDirection,
  skip: readonly string[] = [],
): T {
  if (uiDir !== 'rtl') return params;
  let out: Record<string, unknown> | undefined;
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (typeof value !== 'string' || value.length === 0) continue;
    if (skip.includes(key) || hasBidiControls(value)) continue;
    out ??= { ...params };
    out[key] = isolate(value);
  }
  return (out as T | undefined) ?? params;
}

/**
 * Hook point for reference display (task 0076, Q8).
 *
 * Reference *formatting* - book names, chapter:verse separator, numerals - is
 * owned by the per-language reference engine (`@bible/reference`, task 0077),
 * where each language may define its own separator and inherit the `:` default
 * from a base. This task only owns the bidi side: a formatted reference is ONE
 * isolated unit, so "3:16-18" can never reorder inside an RTL sentence.
 *
 * Wrap the engine's output with this before putting it in a plain-text sink;
 * in DOM, wrap it in `<Bdi>` instead. When 0077 lands, its formatter can call
 * this (or accept `{ isolate: true }`) without either module knowing the
 * other's internals.
 */
export function isolateReference(formatted: string, contentDir: LocaleDirection | 'auto' = 'auto'): string {
  return isolate(formatted, contentDir);
}

/** `{name}` simple-argument placeholders (not `{n, plural, …}` / `{g, select, …}`, whose values must stay raw). */
const SIMPLE_ARG = /\{\s*([A-Za-z_][\w]*)\s*\}/g;

/**
 * The names of the simple-argument placeholders in an ICU message
 * (`{name}`), which are the only params it is safe to isolate: a `select`
 * argument must keep its exact value to match a branch, and `plural`/`number`
 * arguments are numbers.
 */
export function simpleMessageArgs(message: string): Set<string> {
  const out = new Set<string>();
  SIMPLE_ARG.lastIndex = 0;
  for (let m = SIMPLE_ARG.exec(message); m; m = SIMPLE_ARG.exec(message)) out.add(m[1]);
  return out;
}

/**
 * {@link isolateParams} for one ICU message: in an RTL UI, isolates only the
 * string params the message interpolates as `{name}`. This is what both apps'
 * `t()` wrappers call. Returns `params` itself when nothing changes.
 */
export function isolateMessageParams<T extends Record<string, unknown>>(
  message: string,
  params: T,
  uiDir: LocaleDirection,
): T {
  if (uiDir !== 'rtl' || message.indexOf('{') === -1) return params;
  const used = simpleMessageArgs(message);
  if (used.size === 0) return params;
  const skip = Object.keys(params).filter((k) => !used.has(k));
  return isolateParams(params, uiDir, skip);
}
