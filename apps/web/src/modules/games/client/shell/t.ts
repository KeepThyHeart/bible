/**
 * Translation for the games' app-shell strings (task 0115).
 *
 * `gt('games.home.join', 'Join a room')` looks the key up in the `games`
 * catalogue (`src/locales/<lng>/games.json`, merged into `ui` under the same
 * `games.*` paths) and returns the English fallback when there is no catalogue
 * yet: tests, a first paint, or a language with no entry.
 *
 * Which i18next instance answers depends on where the client runs. Embedded in
 * the reader it is the reader's own (the module's `i18nNamespace` loads the
 * strings). On the phone page, which loads none of the reader, `main.tsx`
 * installs a small instance of its own (`./standaloneI18n.ts`). Game *content*
 * (questions, prompts, verse text) is not translated here; only shell chrome.
 */
import i18next from 'i18next';
import type { i18n } from 'i18next';

let instance: i18n | null = null;

/** Use this instance instead of the global one (the phone page). */
export function setGamesI18n(next: i18n | null): void {
  instance = next;
}

export function gt(key: string, fallback: string, values?: Record<string, string | number>): string {
  const source = instance ?? i18next;
  if (typeof source.t !== 'function' || !source.isInitialized) return interpolate(fallback, values);
  return source.t(key, { defaultValue: fallback, ...values }) as string;
}

/** The fallback goes through the same ICU-style `{name}` interpolation the reader's i18next applies (ICU `{name}`, in the reader's catalogue and the phone page's). */
function interpolate(text: string, values?: Record<string, string | number>): string {
  if (!values) return text;
  return text.replace(/\{\s*(\w+)\s*\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
