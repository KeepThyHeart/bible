import { ReferenceParser, getLocalizer, loadReferenceLocales, referenceLocalesVersion } from '@bible/core';
import { i18nService } from './I18nService';
import type { LocaleCode } from './II18nService';

const cache = new Map<string, { version: number; parser: ReferenceParser }>();

/**
 * Load the reference-engine data (book names, separators, digits) for the UI
 * language. Locale data is loaded on demand (task 0077): only English and
 * OSIS ids are always in memory. Called at startup and on every locale
 * change; extra languages (installed Bibles) go through the same call.
 */
export function ensureReferenceLocales(tags: readonly string[] = [i18nService.currentLocale]): Promise<string[]> {
  return loadReferenceLocales(tags);
}

void ensureReferenceLocales();
i18nService.onDidChangeLocale((tag) => void ensureReferenceLocales([tag]));

/**
 * A `ReferenceParser` for the active UI locale: that language's names (once
 * its data has loaded) plus English, which is always accepted. Cached per
 * locale tag until more locale data loads.
 *
 * For non-React module-level code (services, stores) that has no `useI18n()`
 * hook context. Call this fresh each time you need a parser rather than
 * caching the *result* at module scope - the active locale can change while
 * the app is running.
 */
export function getLocalizedReferenceParser(tag: LocaleCode = i18nService.currentLocale): ReferenceParser {
  const version = referenceLocalesVersion();
  const hit = cache.get(tag);
  if (hit && hit.version === version) return hit.parser;
  const parser = new ReferenceParser(getLocalizer(tag).referenceParserConfig);
  cache.set(tag, { version, parser });
  return parser;
}
