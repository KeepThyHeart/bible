/**
 * Content direction for module text (task 0076).
 *
 * Scripture, commentary and dictionary prose follow the MODULE's writing
 * direction, never the UI's: an Arabic UI with the KJV open is LTR text inside
 * RTL chrome. Spread `moduleContentAttrs(abbr)` on the element that holds the
 * module's text.
 */
import { directionForLanguage, logicalArrow, logicalSwipe } from '@bible/core/browser';
import type { LocaleDirection, LogicalStep } from '@bible/core/browser';
import { moduleStore } from '../stores/moduleStore';
import { dictionaryStore } from '../stores/dictionaryStore';

/** The `language_code` of an installed module (any type), or undefined when unknown. */
export function moduleLanguage(abbr: string | null | undefined): string | undefined {
  if (!abbr) return undefined;
  const wanted = abbr.toLowerCase();
  const fromManifest = moduleStore.availableModules?.find(m => m.abbreviation?.toLowerCase() === wanted);
  if (fromManifest?.language_code) return fromManifest.language_code;
  return dictionaryStore.modules?.find(m => m.abbreviation?.toLowerCase() === wanted)?.language_code || undefined;
}

/** Writing direction of a module's text. */
export function moduleDirection(abbr: string | null | undefined): LocaleDirection {
  return directionForLanguage(moduleLanguage(abbr));
}

export interface ContentAttrs {
  dir: LocaleDirection;
  lang: string | undefined;
  'data-content-dir': LocaleDirection;
}

/** `dir`, `lang` and `data-content-dir` for the container of a module's text. */
export function moduleContentAttrs(abbr: string | null | undefined): ContentAttrs {
  const lang = moduleLanguage(abbr);
  const dir = directionForLanguage(lang);
  return { dir, lang, 'data-content-dir': dir };
}

/**
 * Previous/next step for a horizontal swipe over a module's text. Follows the
 * CONTENT direction: a leftward swipe advances in LTR text and goes back in RTL.
 */
export function contentSwipeStep(deltaX: number, abbr: string | null | undefined): LogicalStep | null {
  return logicalSwipe(deltaX, moduleDirection(abbr));
}

/** Previous/next step for ArrowLeft/ArrowRight over a module's text (content direction). */
export function contentArrowStep(key: string, abbr: string | null | undefined): LogicalStep | null {
  return logicalArrow(key, moduleDirection(abbr));
}
