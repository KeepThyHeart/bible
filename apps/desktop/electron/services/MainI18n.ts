/**
 * Key resolution for the main process.
 *
 * The renderer has had `I18nService` all along; main has not, which is why
 * every string it produces - native dialog titles and filters, detached window
 * titles, the About box - was an English literal by construction. Those strings
 * are as user-facing as anything in a pane, and on Windows and Linux the menu
 * bar and the file dialogs are often the first thing a reader sees.
 *
 * This is deliberately much smaller than the renderer's service:
 *
 *  - **Synchronous.** A dialog title is needed at the moment the dialog opens,
 *    inside an IPC handler; awaiting a catalog there would mean either blocking
 *    the handler or opening the dialog with a placeholder.
 *  - **Loaded once, at startup.** Catalogs are read from the same two roots
 *    `i18nHandlers` serves to the renderer, so main and renderer cannot show
 *    different text for the same key.
 *  - **No ICU.** Main-process strings are titles and labels; the handful that
 *    interpolate take a plain `{name}` placeholder. Anything needing a plural
 *    belongs in a pane, where the full service is available.
 *
 * The active locale arrives from the renderer (see `i18n:setLocale`), because
 * that is where the user chooses it and where it is persisted. Until the
 * renderer reports one - during startup, or if it never does - main resolves
 * English, which is also the fallback for a key a translation has not reached.
 */

import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const FALLBACK_LOCALE = 'en';

/** locale -> flat key/string map merged across every namespace. */
const catalogs = new Map<string, Record<string, string>>();

let activeLocale = FALLBACK_LOCALE;
let loaded = false;

/**
 * Built-in catalogs ship with the app. In dev they sit next to the sources; in
 * a packaged build `locales/` is asarUnpack'd beside the archive. Kept in step
 * with `ipc/i18nHandlers.ts`, which resolves the same two roots for the
 * renderer.
 */
function builtinLocalesDir(): string {
  const dev = path.resolve(__dirname, '..', '..', 'locales');
  const packaged = path.join(process.resourcesPath ?? '', 'locales');
  // Reachable from a unit test, where `electron` is a stub and `app` may not
  // exist at all. The dev path resolves the same way there, so the catalogs
  // still load and a test asserting a window title sees real English.
  try {
    return app.isPackaged ? packaged : dev;
  } catch {
    return dev;
  }
}

function userLocalesDir(): string | undefined {
  try {
    return path.join(app.getPath('userData'), 'locales');
  } catch {
    return undefined;
  }
}

/** Merge every `<root>/<locale>/<namespace>.json` into the locale's map. */
function loadRoot(root: string): void {
  let localeDirs: string[];
  try {
    localeDirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    // A missing directory is normal: `userData/locales` only exists once
    // someone puts a language in it.
    return;
  }
  for (const locale of localeDirs) {
    let files: string[];
    try {
      files = fs.readdirSync(path.join(root, locale));
    } catch {
      continue;
    }
    const merged = catalogs.get(locale) ?? {};
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(path.join(root, locale, file), 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value === 'string') merged[key] = value;
          }
        }
      } catch {
        // One malformed catalog must not take the menu bar down with it.
      }
    }
    catalogs.set(locale, merged);
  }
}

/**
 * Read the catalogs from disk. Safe to call more than once; only the first
 * call does the work. Called from `main.ts` before the first window is built.
 */
export function loadMainCatalogs(): void {
  if (loaded) return;
  loaded = true;
  // User catalogs load second so they win over the built-ins, matching the
  // renderer's merge order.
  loadRoot(builtinLocalesDir());
  const userDir = userLocalesDir();
  if (userDir) loadRoot(userDir);
}

/** Told to main by the renderer whenever the user changes language. */
export function setMainLocale(locale: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(locale)) return;
  activeLocale = locale;
}

export function getMainLocale(): string {
  return activeLocale;
}

function lookup(key: string): string | undefined {
  const primary = catalogs.get(activeLocale);
  if (primary && Object.prototype.hasOwnProperty.call(primary, key)) return primary[key];
  if (activeLocale !== FALLBACK_LOCALE) {
    const fallback = catalogs.get(FALLBACK_LOCALE);
    if (fallback && Object.prototype.hasOwnProperty.call(fallback, key)) return fallback[key];
  }
  return undefined;
}

/**
 * Resolve a catalog key, substituting `{name}` placeholders.
 *
 * An unknown key returns the key itself rather than `[key]`: this text goes
 * into OS chrome - a window title, a file dialog - where brackets read as part
 * of the name. The key is at least searchable.
 */
export function t(key: string, params?: Record<string, unknown>): string {
  loadMainCatalogs();
  const message = lookup(key) ?? key;
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

/** Test seam: drop everything loaded so a test can start from a known state. */
export function resetMainI18nForTests(): void {
  catalogs.clear();
  activeLocale = FALLBACK_LOCALE;
  loaded = false;
}
