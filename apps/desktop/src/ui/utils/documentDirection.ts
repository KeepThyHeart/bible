/**
 * Binds the active UI locale to the document element.
 *
 * Two attributes are driven from `II18nService`:
 *
 *  - `<html dir>` - from `i18n.currentDirection` (`ltr` | `rtl`), which the
 *    service resolves from the locale's own `meta.json` (`locale.direction`).
 *    Every direction-sensitive style in the app keys off this attribute, either
 *    implicitly (Tailwind logical utilities: `ps-*`, `me-*`, `text-start`,
 *    `border-s`, ...) or explicitly (`[dir='rtl'] ...` rules in `globals.css` and
 *    `dockview-overrides.css`).
 *  - `<html lang>` - the BCP-47 code. Needed for correct font fallback,
 *    hyphenation, spellcheck and screen-reader pronunciation.
 *
 * This must be called from EVERY renderer entry point. The main window and each
 * detached pane window are separate renderer contexts with their own `document`
 * and their own `I18nService` instance; wiring only `main.tsx` would leave
 * popped-out panes stuck in LTR.
 *
 * Locale persistence lives here too, deliberately: the chosen locale is stored
 * in `localStorage`, which is shared across every window of the same origin, so
 * a language change in Preferences reaches detached windows on their next load
 * without any main-process round trip.
 */

import type { II18nService, LocaleCode } from '../services/II18nService';

/** `localStorage` key holding the user's chosen UI locale. */
export const LOCALE_STORAGE_KEY = 'bible.ui.locale';

/**
 * Apply the service's current locale + direction to `document.documentElement`.
 * Safe to call when `document` is unavailable (SSR-style unit tests).
 */
export function applyDocumentDirection(i18n: II18nService): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.setAttribute('dir', i18n.currentDirection);
  el.setAttribute('lang', i18n.currentLocale);
}

/**
 * Apply now and re-apply on every locale change.
 *
 * @returns a disposer. Callers at renderer top level normally leak it on
 *          purpose - the subscription's lifetime is the renderer's lifetime.
 */
export function bindDocumentDirection(i18n: II18nService): () => void {
  applyDocumentDirection(i18n);
  const sub = i18n.onDidChangeLocale(() => applyDocumentDirection(i18n));
  return () => sub.dispose();
}

/** Read the persisted locale, or `undefined` if none/unavailable. */
export function readStoredLocale(): LocaleCode | undefined {
  try {
    const v = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return v && v.length > 0 ? v : undefined;
  } catch {
    // localStorage can throw in hardened/private contexts - never fatal.
    return undefined;
  }
}

/** Persist the chosen locale. Failures are ignored; the app still switches. */
export function writeStoredLocale(locale: LocaleCode): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

/**
 * Restore the persisted locale, and keep `localStorage` in sync from then on.
 *
 * Call this AFTER `LocaleCatalogLoader.loadAll()` resolves. Switching locale
 * before its catalog is loaded would leave the UI showing English strings until
 * something unrelated re-rendered, because `loadCatalog()` fires no event.
 */
export function restorePersistedLocale(i18n: II18nService): void {
  i18n.onDidChangeLocale((locale) => {
    writeStoredLocale(locale);
    reportLocaleToMain(locale);
  });
  const stored = readStoredLocale();
  if (stored && stored !== i18n.currentLocale) {
    void i18n.setLocale(stored);
  }
  // Report the starting locale too: the event only fires on a *change*, and
  // main builds its menus and dialogs before the user touches anything.
  reportLocaleToMain(i18n.currentLocale);
}

/**
 * Hand the active locale to the main process, which needs it for the menu bar,
 * native dialogs and detached-window titles.
 *
 * Failures are swallowed: the locale is a display preference, and main falls
 * back to English on its own.
 */
function reportLocaleToMain(locale: LocaleCode): void {
  if (typeof window === 'undefined') return;
  const bridge = (window as unknown as {
    electron?: { i18n?: { setLocale?: (locale: string) => Promise<void> } };
  }).electron?.i18n;
  void bridge?.setLocale?.(locale)?.catch(() => {});
}
