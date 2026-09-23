import { ReferenceParser, getLocalizer } from '@bible/core';
import { getMainLocale } from './MainI18n';

const cache = new Map<string, ReferenceParser>();

/**
 * A `ReferenceParser` built from the active UI locale's `Localizer.referenceParserConfig`
 * (falling back to English until a locale's book-name table is drafted - see
 * `Localizer.ts`'s module doc). Cached per locale tag; a locale's config is
 * immutable once registered so the cache never needs invalidating.
 *
 * For Electron main-process code that has no renderer `useI18n()` hook
 * context. Call this fresh each time you need a parser rather than caching
 * the *result* at module scope - the active locale (reported by the
 * renderer via `setMainLocale`) can change while the app is running.
 */
export function getLocalizedReferenceParser(tag: string = getMainLocale()): ReferenceParser {
  let parser = cache.get(tag);
  if (!parser) {
    parser = new ReferenceParser(getLocalizer(tag).referenceParserConfig);
    cache.set(tag, parser);
  }
  return parser;
}
