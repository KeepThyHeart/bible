/**
 * `II18nService` resolves localization keys to displayable strings against the
 * currently-selected locale. Catalogs are flat namespaced JSON files
 * (`locales/<bcp47>/<namespace>.json`); the service merges all loaded
 * namespaces into a single key->string lookup.
 *
 * Missing-key behavior:
 *  - Production: fall back to the `en` catalog. If still missing, return the
 *    key wrapped in brackets, e.g. `[bible.openCommentary]`.
 *  - Development: log a one-time warning per missing key.
 *
 * ICU MessageFormat is used for plurals/gender via `params`.
 */

import type { IEvent } from '../types/Event';
import type { LocalizedString } from '../types/LocalizedString';

export type LocaleCode = string; // BCP-47, e.g. 'en', 'es', 'zh-Hant'

/**
 * Translation maturity of a locale, and - for a locale that ships **built
 * into the app** (see `BUILT_IN_LOCALES` in `GeneralSection.tsx`) - whether it
 * is offered at all:
 *
 *  - `complete` - reviewed by a native speaker and considered shippable.
 *                 Offered with no badge. "Regular", full support.
 *  - `beta`     - machine-drafted, not yet reviewed, but complete and stable
 *                 enough to offer with an honest badge. A built-in locale at
 *                 this status IS shown in the language pickers.
 *  - `draft`    - machine-drafted and incomplete, or awaiting its first
 *                 review pass. A built-in locale at this status is withheld
 *                 from the pickers entirely (see `selectableLocales()`); a
 *                 user-supplied one (dropped into `<userData>/locales/`) is
 *                 still shown, badged, because hiding the user's own catalog
 *                 would be a regression.
 *
 * Promote a built-in locale by changing its `meta.json` `locale.status` from
 * `draft` to `beta` (badge shown) or `complete` (badge dropped) - nothing else
 * needs to change; `selectableLocales()` and the pickers read this field.
 *
 * Anything we cannot prove is `complete` or `beta` is treated as `draft`; see
 * `DEFAULT_LOCALE_STATUS` in `I18nService.ts`.
 */
export type LocaleStatus = 'complete' | 'beta' | 'draft';

/** Base writing direction. Forward-planning for Arabic/Hebrew UI locales. */
export type LocaleDirection = 'ltr' | 'rtl';

/**
 * Descriptive metadata for one locale, sourced from that locale's
 * `meta.json` catalog (see `locales/README.md`). Keys inside `meta.json` are
 * flat and namespaced under `locale.`:
 *
 * ```json
 * {
 *   "locale.name": "Spanish",
 *   "locale.nativeName": "Español",
 *   "locale.status": "draft",
 *   "locale.direction": "ltr"
 * }
 * ```
 *
 * Shipping it as a normal namespace means the existing catalog IPC bridge picks
 * it up with no changes - no separate registry file or extra IPC channel.
 */
export interface LocaleMetadata {
  /** BCP-47 code, i.e. the folder name. */
  code: LocaleCode;
  /** Name in English, for logs and for maintainers: `Spanish`. */
  name: string;
  /** Endonym, for the language picker: `Español`. */
  nativeName: string;
  status: LocaleStatus;
  direction: LocaleDirection;
}

export interface II18nService {
  /** Resolve a key to the current locale's string with ICU MessageFormat. */
  t(key: string, params?: Record<string, unknown>): string;

  /** Resolve a `LocalizedString` (literal passes through, `{key}` is looked up). */
  resolve(value: LocalizedString): string;

  /**
   * Gather all values registered as `<key>.alias.0`, `.alias.1`, ... in order.
   * Used by the command registry for fuzzy search.
   */
  tAliases(key: string): string[];

  readonly currentLocale: LocaleCode;

  /** Switch active locale. Persists to user prefs and fires `onDidChangeLocale`. */
  setLocale(locale: LocaleCode): Promise<void>;

  /** All locales for which a catalog is loaded. */
  readonly availableLocales: LocaleCode[];

  /**
   * All loaded locales with their metadata, ready for a language picker.
   * Ordered: the fallback locale (`en`) first, then `complete` locales, then
   * `draft` locales, each group sorted by native name.
   *
   * A picker rendering this list MUST show `status === 'draft'` entries with a
   * visible "draft / pending review" marker.
   */
  readonly availableLocaleInfos: LocaleMetadata[];

  /** Metadata for one locale. Falls back to conservative defaults, never throws. */
  getLocaleMetadata(locale: LocaleCode): LocaleMetadata;

  /** Writing direction of the active locale - bind to `<html dir>`. */
  readonly currentDirection: LocaleDirection;

  /** Add or replace a catalog namespace. Used at startup and by extension activation. */
  loadCatalog(locale: LocaleCode, namespace: string, strings: Record<string, string>): void;

  onDidChangeLocale: IEvent<LocaleCode>;
}
