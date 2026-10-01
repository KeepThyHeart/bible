import { ReferenceParser, getLocalizer, loadReferenceLocales, referenceLocalesVersion } from '@bible/core';
import { getMainLocale } from './MainI18n';

const cache = new Map<string, { version: number; parser: ReferenceParser }>();

/**
 * Load the reference-engine data for these locales (default: the UI locale
 * the renderer reported). Locale data loads on demand (task 0077).
 */
export function ensureReferenceLocales(tags: readonly string[] = [getMainLocale()]): Promise<string[]> {
  return loadReferenceLocales(tags);
}

/**
 * A `ReferenceParser` for a locale (default: the active UI locale): that
 * language's names, once its data has loaded, plus English. Cached per tag
 * until more locale data loads. A tag whose data is not loaded yet parses
 * English now and starts loading, so the next call has it.
 *
 * For Electron main-process code that has no renderer `useI18n()` hook
 * context. Call this fresh each time you need a parser rather than caching
 * the *result* at module scope - the active locale (reported by the
 * renderer via `setMainLocale`) can change while the app is running.
 */
export function getLocalizedReferenceParser(tag: string = getMainLocale()): ReferenceParser {
  const version = referenceLocalesVersion();
  const hit = cache.get(tag);
  if (hit && hit.version === version) return hit.parser;
  const config = getLocalizer(tag).referenceParserConfig;
  if (!config && !tag.toLowerCase().startsWith('en')) void ensureReferenceLocales([tag]);
  const parser = new ReferenceParser(config);
  cache.set(tag, { version, parser });
  return parser;
}
