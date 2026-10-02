/**
 * Multilingual Bible reference engine (task 0077): parsing, scanning,
 * suggesting and formatting references in any language with locale data.
 *
 * Self-contained: nothing here imports from the rest of core. Locale data is
 * one JSON file per language in `./locales/` (format: {@link ReferenceLocaleData});
 * English and OSIS ids are always loaded, every other language on demand via
 * {@link loadReferenceLocales}.
 */
export * from './types';
export { ReferenceEngine, referenceEngineFor, damerau, type ReferenceEngineOptions, type BookLookup } from './engine';
export {
  addReferenceLocaleSource,
  availableReferenceLocales,
  getMergedReferenceLocale,
  loadReferenceLocales,
  loadedReferenceLocaleFor,
  loadedReferenceLocales,
  onReferenceLocalesChanged,
  referenceLocalesVersion,
  registerReferenceLocale,
  resolveReferenceLocaleTag,
  type ReferenceLocaleSource,
} from './registry';
export { normalizeString as normalizeReferenceText } from './normalize';
export { toDigits } from './format';
export { OSIS_IDS, osisId } from './canon';
export { compileLocale, mergeLocaleData, ROOT_FORMAT, ROOT_SYNTAX, type CompiledLocale } from './compile';
export { validateReferenceLocale, type LocaleValidationReport } from './validate';
