/**
 * The real `locales/en` catalogs, for tests that assert on user-visible text.
 *
 * **Test-only**, though it contains nothing that would break in the renderer:
 * the namespaces are imported as JSON so Vite bundles them like any other
 * module. Reading the directory with `fs` instead would work under Vitest but
 * makes esbuild complain on every run, and would hide a missing namespace until
 * runtime; a static import list fails to compile instead. Add a line here when
 * a new namespace file appears under `locales/en/`.
 *
 * Before the English lived in the catalogs, component tests stubbed `t()` with
 * a key-echo and asserted against the inline `tf()` fallback beside each call
 * site. Those fallbacks are gone: the catalog is the only copy of the text now,
 * so a test that wants to assert what a user reads has to read the catalog.
 * Doing it through the real {@link I18nService} rather than a hand-rolled
 * lookup means ICU parameters, missing-key behaviour (`[key]`) and namespace
 * merging all behave in the test exactly as they do in the app.
 *
 * As a side effect these assertions now guard the shipped English: rewording a
 * catalog entry that a test names will fail that test, which is the point -
 * the wording is a deliberate choice, not an implementation detail.
 */

import commands from '../../../locales/en/commands.json';
import layout from '../../../locales/en/layout.json';
import mainProcess from '../../../locales/en/main.json';
import menu from '../../../locales/en/menu.json';
import meta from '../../../locales/en/meta.json';
import searchBar from '../../../locales/en/searchBar.json';
import ui from '../../../locales/en/ui.json';
import { I18nService } from '../services/I18nService';
import type { II18nService } from '../services/II18nService';

/**
 * Every English namespace merged into one flat key -> string map, the same
 * shape `I18nService` holds at runtime.
 */
export function loadEnCatalog(): Record<string, string> {
  return {
    ...(commands as Record<string, string>),
    ...(layout as Record<string, string>),
    ...(mainProcess as Record<string, string>),
    ...(menu as Record<string, string>),
    ...(meta as Record<string, string>),
    ...(searchBar as Record<string, string>),
    ...(ui as Record<string, string>),
  };
}

/** One string from the English catalog. Throws if the key is not there. */
export function enString(key: string): string {
  const value = loadEnCatalog()[key];
  if (value === undefined) {
    throw new Error(`No English catalog entry for "${key}" — add it to apps/desktop/locales/en/`);
  }
  return value;
}

/**
 * A real `I18nService` loaded with the English catalogs.
 *
 * Use this in place of a key-echoing stub wherever a test asserts on rendered
 * text. A fresh instance per call keeps tests from sharing locale state.
 */
export function createEnI18n(): II18nService {
  const service = new I18nService({ initialLocale: 'en' });
  service.loadCatalog('en', 'en', loadEnCatalog());
  return service;
}

/**
 * Shared instance behind {@link enT}. Building one is cheap but not free, and
 * `t()` runs once per rendered string - a fresh service per call showed up as
 * real time across the suite.
 */
let shared: II18nService | undefined;

/** Resolve a key the way the app would, including ICU parameters. */
export function enT(key: string, params?: Record<string, unknown>): string {
  shared ??= createEnI18n();
  return shared.t(key, params);
}
