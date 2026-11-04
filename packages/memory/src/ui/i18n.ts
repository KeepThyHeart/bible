/**
 * The UI's translator (task 0114 M3). Views call `tr(key, 'English', params?)` at render time;
 * the host wires its catalog through `MemoryUiOptions.t` and `mountMemoryUi` installs it here.
 * Without one, the English fallback is formatted, so the package renders standalone and in tests.
 *
 * Module-level on purpose: the views are plain functions with no shared context object, and the
 * app mounts one Memory UI at a time. Anything that must follow a language change (labels held in
 * constants) has to be looked up at render time, never cached at import.
 */
import { englishTranslate, setCoreTranslator } from '../core/messages';
import type { MessageParams, Translate } from '../core/messages';

export type { MessageParams, Translate } from '../core/messages';

let current: Translate = englishTranslate;
let currentLocale: string | undefined;

/** Install the host's translator (and the locale for dates and numbers). No argument restores English. */
export function setUiTranslator(t?: Translate, locale?: string): void {
  current = t ?? englishTranslate;
  // Core helpers the UI calls directly (tier labels, suggested lists) look up through the same catalog.
  setCoreTranslator(t);
  currentLocale = locale;
}

/** Translate a message; `fallback` is the English text and must equal the `en` catalog entry. */
export function tr(key: string, fallback: string, params?: MessageParams): string {
  return current(key, fallback, params);
}

/** BCP-47 tag for `Intl` formatting, or `undefined` for the runtime default. */
export function uiLocale(): string | undefined {
  return currentLocale;
}
