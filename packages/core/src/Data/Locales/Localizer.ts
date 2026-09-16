/**
 * Localizer.ts
 *
 * One interface for "everything about formatting and parsing that varies by
 * language" - numbers, dates, collation/case, and (once drafted) a language's
 * book-name table for display and reference parsing. This is the
 * infrastructure the globalization plan's book-names/reference-parsing
 * question asked for: "each language needs to be able to implement its own
 * localization class; make all language-specific processing a single
 * interface." It replaces scattered per-call-site special-casing with one
 * lookup, {@link getLocalizer}.
 *
 * ## What this does NOT do
 *
 * It does not translate anything. `referenceParserConfig` is `undefined`
 * until someone drafts that language's book-name table (a separate,
 * content-drafting task); every other capability - number/date formatting,
 * collation, case-folding - works for **any** BCP-47 tag today via
 * {@link createIntlLocalizer}, using nothing but the platform's own `Intl`
 * and the identity facts in `LocaleRegistry.ts`. A locale with no custom
 * class registered still gets correct, locale-aware behavior; a locale that
 * needs something `Intl` cannot express (a book-name table, a bespoke
 * collation rule) gets one by registering a fuller implementation with
 * {@link registerLocalizer} - nothing else has to change to pick it up.
 *
 * ## Turkish dotted/dotless I
 *
 * `toLocaleUpperCase()` / `toLocaleLowerCase()` below exist specifically so
 * that Turkish (`tr`) case-folds through `Intl`'s locale-aware algorithm
 * (`'i'.toLocaleUpperCase('tr') === 'İ'`, not the ASCII `'I'`) rather than a
 * plain `.toUpperCase()`/`.toLowerCase()`, which is the hazard flagged in the
 * globalization audit. Identifier/key comparisons elsewhere in the codebase
 * must keep using the plain ASCII methods - this pair is only for
 * user-visible text.
 */

import type { ReferenceParserConfig } from '../../Services/ReferenceParser';
import {
  ENGLISH_BOOK_NAMES,
  ENGLISH_DISPLAY_NAMES,
  ENGLISH_SINGLE_CHAPTER_BOOKS,
} from '../Core/BookNames';
import {
  resolveLocaleDescriptor,
  type DigitSystem,
  type LocaleDescriptor,
  type LocaleDirection,
} from './LocaleRegistry';

export type { DigitSystem, LocaleDirection };

/** Shared by every formatting method: override the locale's default digit system for this one call. */
export interface DigitFormatOptions {
  digitSystem?: DigitSystem;
}

/**
 * All language-specific processing for one locale, behind one interface.
 *
 * An implementation may be as simple as {@link createIntlLocalizer}'s output
 * (pure `Intl` + registry facts) or as rich as a language needs - the
 * consumer never has to know which.
 */
export interface Localizer {
  readonly tag: string;
  readonly direction: LocaleDirection;
  readonly defaultDigitSystem: DigitSystem;

  /** Locale- and (optionally) digit-system-aware number formatting. */
  formatNumber(value: number, options?: DigitFormatOptions & Intl.NumberFormatOptions): string;

  /** Locale- and (optionally) digit-system-aware date formatting. */
  formatDate(date: Date, options?: DigitFormatOptions & Intl.DateTimeFormatOptions): string;

  /** Locale-aware string comparison (`Intl.Collator`), for user-visible sorting. */
  compare(a: string, b: string, options?: Intl.CollatorOptions): number;

  /** Locale-aware case folding for user-visible text (see the Turkish note above). */
  toLocaleUpperCase(value: string): string;
  toLocaleLowerCase(value: string): string;

  /**
   * This language's book-name / reference-parsing table, ready to pass as
   * {@link ReferenceParserConfig}. `undefined` when nobody has drafted one
   * yet - `ReferenceParser` and any book-name display should fall back to
   * the English table in that case (English is always an accepted parse
   * input, per the globalization roadmap), never throw or blank the UI.
   */
  readonly referenceParserConfig?: ReferenceParserConfig;
}

function numberingSystemFor(descriptor: LocaleDescriptor | undefined, digitSystem: DigitSystem): string | undefined {
  if (digitSystem === 'latin') return 'latn';
  return descriptor?.nativeNumberingSystem ?? 'latn';
}

/**
 * Build a locale's identity-and-`Intl` behavior with no hand-authored
 * per-language logic. This is what every planned locale gets automatically
 * (see {@link getLocalizer}), and what a fuller {@link Localizer} for a given
 * language should build on rather than duplicate.
 */
export function createIntlLocalizer(
  tag: string,
  overrides: Partial<Pick<Localizer, 'referenceParserConfig'>> = {},
): Localizer {
  const descriptor = resolveLocaleDescriptor(tag);
  const direction = descriptor?.direction ?? 'ltr';
  const defaultDigitSystem = descriptor?.defaultDigitSystem ?? 'latin';

  return {
    tag,
    direction,
    defaultDigitSystem,

    formatNumber(value, options = {}) {
      const { digitSystem, ...rest } = options;
      const numberingSystem = numberingSystemFor(descriptor, digitSystem ?? defaultDigitSystem);
      return new Intl.NumberFormat(tag, { numberingSystem, ...rest }).format(value);
    },

    formatDate(date, options = {}) {
      const { digitSystem, ...rest } = options;
      const numberingSystem = numberingSystemFor(descriptor, digitSystem ?? defaultDigitSystem);
      return new Intl.DateTimeFormat(tag, { numberingSystem, ...rest }).format(date);
    },

    compare(a, b, options) {
      return new Intl.Collator(tag, options).compare(a, b);
    },

    toLocaleUpperCase(value) {
      return value.toLocaleUpperCase(tag);
    },

    toLocaleLowerCase(value) {
      return value.toLocaleLowerCase(tag);
    },

    referenceParserConfig: overrides.referenceParserConfig,
  };
}

/**
 * The reference implementation: `en`'s book names are the repo's actual
 * source of truth (`Data/Core/BookNames.ts`), so this is not a stub the way
 * every other locale's `Localizer` currently is. Every other language falls
 * back to this table for parsing until its own is drafted.
 */
export const EnglishLocalizer: Localizer = createIntlLocalizer('en', {
  referenceParserConfig: {
    bookNames: ENGLISH_BOOK_NAMES,
    displayNames: ENGLISH_DISPLAY_NAMES,
    singleChapterBooks: ENGLISH_SINGLE_CHAPTER_BOOKS,
  },
});

const registry = new Map<string, Localizer>([['en', EnglishLocalizer]]);

/**
 * Register a `Localizer` for a tag, replacing whatever was registered
 * before (including the generic `Intl`-only default). This is the one place
 * a language "plugs in" its own class - nothing that calls {@link getLocalizer}
 * needs to change.
 */
export function registerLocalizer(localizer: Localizer): void {
  registry.set(localizer.tag, localizer);
}

/**
 * The `Localizer` for a tag: whatever was registered for it, or its primary
 * subtag (`ar-EG` reuses the `ar` registration), or - for any tag nobody has
 * registered a custom class for, planned or not - a generic one built from
 * `Intl` and {@link resolveLocaleDescriptor}. This never returns `undefined`
 * and never throws: every locale gets at least correct number/date/collation
 * behavior, even with no catalog and no custom class.
 */
export function getLocalizer(tag: string): Localizer {
  const exact = registry.get(tag);
  if (exact) return exact;
  const i = tag.indexOf('-');
  if (i !== -1) {
    const primary = registry.get(tag.slice(0, i));
    if (primary) return primary;
  }
  return createIntlLocalizer(tag);
}
