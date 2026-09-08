/**
 * Writing direction for *content*, as opposed to the UI chrome.
 *
 * The two are independent and must not be conflated: a user reading with an
 * Arabic interface may well have the KJV open, and an English interface is a
 * perfectly normal way to read the Van Dyck Arabic Bible. UI direction comes
 * from the active locale (`II18nService.currentDirection`); content direction
 * comes from the *module's* language, which is what this file resolves.
 *
 * Consumers set `dir`/`lang` on the element wrapping the module's text. Once a
 * subtree carries its own `dir`, the bidi algorithm lays it out correctly no
 * matter what the surrounding UI direction is.
 */

import type { LocaleDirection } from '../services/II18nService';

/**
 * Right-to-left ISO-639 language codes, restricted to those a Bible/commentary/
 * lexicon module realistically declares.
 *
 * A static table rather than `Intl.Locale.prototype.getTextInfo()`: the latter
 * is unavailable in the jsdom environment the component tests run under, and
 * this list is small, stable and easy to audit.
 */
const RTL_LANGUAGE_CODES: ReadonlySet<string> = new Set([
  'ar', // Arabic
  'arc', // Aramaic
  'ckb', // Central Kurdish / Sorani (Arabic script)
  'dv', // Divehi
  'fa', // Persian
  'he', // Hebrew
  'iw', // Hebrew (legacy code)
  'ps', // Pashto
  'sd', // Sindhi
  'syc', // Classical Syriac
  'syr', // Syriac
  'ug', // Uyghur
  'ur', // Urdu
  'yi', // Yiddish
]);

/**
 * Script subtags that force RTL.
 *
 * Deliberately NOT listed above as bare languages: `az`, `ku`, `pa` and
 * friends are written in several scripts and are predominantly Latin or
 * Cyrillic today, so only an explicit `-Arab` says otherwise.
 */
const RTL_SCRIPT_SUBTAGS: ReadonlySet<string> = new Set(['arab', 'hebr', 'syrc', 'thaa']);

/** A BCP-47 script subtag is exactly four alphabetic characters (`Latn`, `Arab`). */
const SCRIPT_SUBTAG = /^[a-z]{4}$/;

/**
 * Direction for a BCP-47 / ISO-639 language code. Unknown or missing codes
 * fall back to `ltr`.
 *
 * An explicit script subtag ALWAYS wins over the language subtag - `ku-Latn`
 * is left-to-right even though Kurdish is often written right-to-left.
 */
export function directionForLanguage(code: string | undefined | null): LocaleDirection {
  if (!code) return 'ltr';
  const parts = code.toLowerCase().split(/[-_]/);

  const script = parts.slice(1).find((p) => SCRIPT_SUBTAG.test(p));
  if (script) return RTL_SCRIPT_SUBTAGS.has(script) ? 'rtl' : 'ltr';

  return RTL_LANGUAGE_CODES.has(parts[0]) ? 'rtl' : 'ltr';
}

/** True when the given module language should be laid out right-to-left. */
export function isRtlLanguage(code: string | undefined | null): boolean {
  return directionForLanguage(code) === 'rtl';
}
