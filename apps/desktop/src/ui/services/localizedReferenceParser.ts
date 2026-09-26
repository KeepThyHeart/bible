import { ReferenceParser, getLocalizer } from '@bible/core';
import { i18nService } from './I18nService';
import type { LocaleCode } from './II18nService';

const cache = new Map<string, ReferenceParser>();

/**
 * A `ReferenceParser` built from the active UI locale's `Localizer.referenceParserConfig`
 * (falling back to English until a locale's book-name table is drafted - see
 * `Localizer.ts`'s module doc). Cached per locale tag; a locale's config is
 * immutable once registered so the cache never needs invalidating.
 *
 * For non-React module-level code (services, stores) that has no `useI18n()`
 * hook context. Call this fresh each time you need a parser rather than
 * caching the *result* at module scope - the active locale can change while
 * the app is running.
 */
export function getLocalizedReferenceParser(tag: LocaleCode = i18nService.currentLocale): ReferenceParser {
  let parser = cache.get(tag);
  if (!parser) {
    parser = new ReferenceParser(getLocalizer(tag).referenceParserConfig);
    cache.set(tag, parser);
  }
  return parser;
}
