/**
 * Translate with an English fallback for a missing catalog entry. Shared host helper (used by
 * nav entries, menus and pickers); it lives outside any feature module.
 */
type T = (key: string, params?: Record<string, unknown>) => string;

/**
 * Translate `key`, falling back to `defaultValue` when the catalog has no entry
 * (the i18n service answers `[key]` for a missing key).
 *
 * Single-brace placeholders in the English default (`{ref}`, `{n}`) belong to
 * the shared views, which substitute them themselves, so each is passed to the
 * ICU formatter as its own literal `{name}` text and survives untouched.
 */
export function translateWithDefault(t: T, key: string, defaultValue: string): string {
  const names = Array.from(new Set(Array.from(defaultValue.matchAll(/\{(\w+)\}/g), (m) => m[1])));
  const params = names.length > 0
    ? Object.fromEntries(names.map((name) => [name, `{${name}}`]))
    : undefined;
  const result = t(key, params);
  return result === `[${key}]` || result === key ? defaultValue : result;
}
