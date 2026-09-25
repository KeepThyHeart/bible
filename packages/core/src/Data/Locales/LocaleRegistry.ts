/**
 * LocaleRegistry.ts
 *
 * Shared identity metadata for every UI locale this project plans to support
 * (see the globalization roadmap in `apps/desktop/locales/README.md`). This
 * is deliberately **identity data, not translated content**: an endonym
 * ("Français"), a base writing direction, a script identifier and a digit
 * system are facts about a language, the same kind of thing CLDR ships,
 * not UI copy that needs drafting or native-speaker review. Nothing here
 * requires - or substitutes for - drafting an actual `locales/<tag>/` catalog.
 *
 * ## Why this exists
 *
 * Before this module, "is this locale RTL?" was answered ad hoc and
 * inconsistently: the desktop app reads `locale.direction` from a shipped
 * catalog's `meta.json` (which only exists for locales that already have a
 * catalog), while the web app hard-codes an exact-match list
 * (`['ar','he','fa','ur']` in `apps/web/src/i18n.ts`) that silently fails for
 * a region variant like `ar-EG` - a real, previously-flagged bug. Both apps,
 * and the shared `Localizer` in `./Localizer.ts`, now read the same table
 * through {@link resolveLocaleDescriptor}, so a region-variant tag resolves
 * consistently everywhere and a newly-planned locale is described once.
 *
 * ## Relationship to a shipped catalog's `locale.status`
 *
 * `LocaleDescriptor` has no notion of "draft / beta / complete" - that is a
 * *translation-completeness* concern, scoped to one app's shipped catalogs
 * (see `LocaleStatus` in the desktop's `II18nService.ts`). A language can be
 * fully described here - direction, script, digits - years before anyone
 * drafts a single catalog string for it, and that is the point: the
 * `Localizer` in `./Localizer.ts` can already do locale-aware number/date
 * formatting and collation for a locale with no catalog at all.
 */

/** Base writing direction. */
export type LocaleDirection = 'ltr' | 'rtl';

/**
 * Which digits chapter/verse numbers and counts render in by default.
 *
 *  - `latin`  - `0`-`9`.
 *  - `native` - the script's own decimal digits (e.g. Eastern Arabic-Indic
 *               for Arabic, Bengali digits for Bengali).
 *
 * This is a *default*, not a fixed rule: `Localizer.formatNumber()` accepts
 * an explicit `digitSystem` to override it, because native readers of the
 * same language do not all agree (see the digits question in the
 * globalization roadmap). Nothing currently exposes that override as a user
 * preference; the option exists so a future settings UI can add one without
 * changing this layer.
 */
export type DigitSystem = 'latin' | 'native';

/**
 * Identity metadata for one UI locale. See the module doc for what this is
 * (and is not) a substitute for.
 */
export interface LocaleDescriptor {
  /** BCP-47 tag, e.g. `es`, `pt-BR`, `zh-Hans`. */
  readonly tag: string;
  /** Name in English, for logs and maintainers. */
  readonly englishName: string;
  /** Endonym - the language's name for itself, e.g. `Español`. */
  readonly nativeName: string;
  readonly direction: LocaleDirection;
  /**
   * ISO 15924 script code, used to key a `:lang()` font stack. `zh-Hans`
   * (`Hans`) and `ja` (`Jpan`) are listed separately even though they share
   * Han code points - Unicode's Han unification means they need distinct
   * font stacks and an exact `lang` tag, not a shared "CJK" bucket.
   */
  readonly script: string;
  /** The digit system chapter/verse numbers use unless overridden. */
  readonly defaultDigitSystem: DigitSystem;
  /**
   * Unicode `numberingSystem` id (the `-u-nu-` value `Intl.NumberFormat`
   * accepts) for this locale's *native* digits, when it has a distinct one
   * from Western `latn`. Undefined for locales whose native digits already
   * are `0`-`9`.
   */
  readonly nativeNumberingSystem?: string;
}

/**
 * Every locale in the current globalization plan, `en` included. Order
 * matches the roadmap list in `apps/desktop/locales/README.md`.
 *
 * Endonyms and directions here are standard, publicly documented facts about
 * each language (the same class of data CLDR publishes) - not a translated
 * UI string that needs review.
 */
export const LOCALE_REGISTRY: readonly LocaleDescriptor[] = [
  { tag: 'en', englishName: 'English', nativeName: 'English', direction: 'ltr', script: 'Latn', defaultDigitSystem: 'latin' },
  { tag: 'zh-Hans', englishName: 'Chinese (Simplified)', nativeName: '简体中文', direction: 'ltr', script: 'Hans', defaultDigitSystem: 'latin' },
  { tag: 'es', englishName: 'Spanish', nativeName: 'Español', direction: 'ltr', script: 'Latn', defaultDigitSystem: 'latin' },
  { tag: 'hi', englishName: 'Hindi', nativeName: 'हिन्दी', direction: 'ltr', script: 'Deva', defaultDigitSystem: 'latin', nativeNumberingSystem: 'deva' },
  { tag: 'ar', englishName: 'Arabic', nativeName: 'العربية', direction: 'rtl', script: 'Arab', defaultDigitSystem: 'native', nativeNumberingSystem: 'arab' },
  { tag: 'fr', englishName: 'French', nativeName: 'Français', direction: 'ltr', script: 'Latn', defaultDigitSystem: 'latin' },
  { tag: 'ru', englishName: 'Russian', nativeName: 'Русский', direction: 'ltr', script: 'Cyrl', defaultDigitSystem: 'latin' },
  { tag: 'pt-BR', englishName: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)', direction: 'ltr', script: 'Latn', defaultDigitSystem: 'latin' },
  { tag: 'id', englishName: 'Indonesian', nativeName: 'Bahasa Indonesia', direction: 'ltr', script: 'Latn', defaultDigitSystem: 'latin' },
  { tag: 'bn', englishName: 'Bengali', nativeName: 'বাংলা', direction: 'ltr', script: 'Beng', defaultDigitSystem: 'native', nativeNumberingSystem: 'beng' },
  { tag: 'ur', englishName: 'Urdu', nativeName: 'اردو', direction: 'rtl', script: 'Arab', defaultDigitSystem: 'latin', nativeNumberingSystem: 'arabext' },
  { tag: 'ja', englishName: 'Japanese', nativeName: '日本語', direction: 'ltr', script: 'Jpan', defaultDigitSystem: 'latin' },
  { tag: 'vi', englishName: 'Vietnamese', nativeName: 'Tiếng Việt', direction: 'ltr', script: 'Latn', defaultDigitSystem: 'latin' },
  { tag: 'tr', englishName: 'Turkish', nativeName: 'Türkçe', direction: 'ltr', script: 'Latn', defaultDigitSystem: 'latin' },
];

const BY_TAG: ReadonlyMap<string, LocaleDescriptor> = new Map(
  LOCALE_REGISTRY.map((d) => [d.tag, d]),
);

/** The primary language subtag: `ar-EG` -> `ar`, `zh-Hans` -> `zh` (not itself a registry key). */
function primarySubtag(tag: string): string {
  const i = tag.indexOf('-');
  return i === -1 ? tag : tag.slice(0, i);
}

/**
 * Resolve a BCP-47 tag to its {@link LocaleDescriptor}.
 *
 * Tries, in order: an exact match (`zh-Hans`); then a match against every
 * registry tag's own primary subtag (`ar-EG` -> the `ar` entry, `ur-PK` -> the
 * `ur` entry); then `undefined`. This is what fixes the class of bug where a
 * region variant of a supported language was treated as unsupported (the
 * `ar-EG` case flagged in the globalization audit) - callers should use this
 * instead of an exact-match list.
 */
export function resolveLocaleDescriptor(tag: string): LocaleDescriptor | undefined {
  const exact = BY_TAG.get(tag);
  if (exact) return exact;
  const primary = primarySubtag(tag);
  if (primary === tag) return undefined;
  return LOCALE_REGISTRY.find((d) => primarySubtag(d.tag) === primary);
}

/**
 * Writing direction for a tag, defaulting to `ltr` for anything unresolved
 * (an unplanned locale, a user-supplied one, or a malformed tag) - the same
 * safe-to-fail direction `I18nService`'s own default takes.
 */
export function directionForTag(tag: string): LocaleDirection {
  return resolveLocaleDescriptor(tag)?.direction ?? 'ltr';
}
