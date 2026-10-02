// Weights, measures and money (task 0069). Pure TypeScript, browser-safe.
export * from './types';
export { MeasureRegistry, getMeasureRegistry } from './registry';
export {
  getMeasureLocalePack, createLocalePack, emptyLocalePack, measurePackLanguage,
  phrase as measurePhrase, pluralPhrase as measurePluralPhrase, unitName as measureUnitName,
  modernUnitName as measureModernUnitName, textUnitName as measureTextUnitName, BUILTIN_PHRASES, BUILTIN_MODERN_NAMES,
} from './locale';
export type { MeasurePackLanguage, MeasureVerseNotes } from './locale';
export {
  MEASURE_SETTINGS, measureSettingsRegistry, resolveMeasurePreferences, defaultMeasureSystems, defaultClock,
} from './prefs';
export type { DefaultMeasureSystems } from './prefs';
export {
  convertToSystem, formatConverted, formatConvertedRange, shouldShowRange, secondaryApplies, formatWages, scaleWages,
  formatClock, formatClockTime, formatMetal, formatQuantity, formatSig2, formatTitleQuantity, roundSig2, sumApprox,
} from './convert';
export type { FormatContext, WagesScale } from './convert';
export { resolveMeasureAnchors } from './anchor';
export type { AnchorContext } from './anchor';
export { buildMeasureLayer, emptyMeasureLayer, MeasureIndex, MEASURE_LAYER_KEY, MEASURE_LAYER_ORDER, MEASURE_VERSE_BADGE, isFallbackOnly } from './layer';
export type { MeasureSurface, MeasureIndexEntry } from './layer';
export { buildMeasurePopup } from './popup';
export type { PopupContext } from './popup';
export { bundledMeasureDataSource, loadChapterOccurrences } from './data';
export type { IMeasureDataSource, LoadChapterOptions } from './data';
export { computeChapterMeasures, computeVerseMeasures } from './chapter';
export type { ComputeChapterMeasuresInput, ChapterMeasures, ComputeVerseMeasuresInput } from './chapter';
