/**
 * The passage-format engine: one implementation of "render these verses in
 * that shape", shared by every app.
 *
 * It came out of the desktop renderer, where it had grown into a good copy
 * dialog (a numbered list of formats, per-format options, a live preview) that
 * the web client could not use - so the web client had written a weaker copy
 * of the same output logic inline, free to disagree with it. Everything here
 * is pure: no DOM, no storage, no framework. What each app still owns is the
 * chrome around it and the *storage key* its preferences live under.
 *
 * ## What a consumer needs
 *
 * - **The list of formats** - {@link getPassageFormatCatalog}, which returns
 *   ids, stable digit numbers, i18n key names and English fallback labels.
 * - **Plain text out** - {@link renderPassageMarkup} +
 *   {@link passageMarkupToSourceText} for the four markup shapes;
 *   {@link renderCopyTemplate} for the custom template.
 * - **HTML out** - {@link passageMarkupToHtml}.
 * - **A styled preview** - the {@link PassageMarkup} block tree from
 *   {@link renderPassageMarkup}, whose every line carries both an `html` and a
 *   `text` flavour, so a preview can colour words of Christ without
 *   re-deriving them.
 *
 * Core owns ids and i18n *key names*; the translated strings stay in each
 * app's locale catalog (`ui.passageInsert.format.<id>.{name,description}` for
 * the markup shapes, `copyOptionsDialog.format.<id>.{name,description}` for
 * the clipboard ones).
 */

// --- Vocabulary -------------------------------------------------------------
export type {
  PassageVerse,
  VerseContext,
  FormatOptions,
  CopyFormat,
} from './types';
export { DEFAULT_FORMAT_OPTIONS } from './types';

export type { CopyFormatSettings } from './settings';
export { DEFAULT_COPY_FORMAT_SETTINGS, resolveCopyFormatSettings } from './settings';

// --- Verse text extraction and reference building ---------------------------
export {
  stripHtml,
  getCleanVerseText,
  getVerseTextWithRed,
  getVerseTextForPreview,
  getVerseTextForFormat,
  buildReference,
  buildPassageReference,
  truncateForPreview,
} from './formatHelpers';
export type { ReferenceVersionStyle } from './formatHelpers';

// The DOM-free HTML handling underneath it, exported because an app rendering
// its own preview needs the same escaping rules.
export {
  decodeHtmlEntities,
  stripHtmlTags,
  escapeStrayMarkup,
  escapeHtml,
} from './htmlText';

// --- Advanced copy options (Standard / Combined) ----------------------------
export {
  DEFAULT_ADVANCED_COPY_OPTIONS,
  REFERENCE_POSITIONS,
  VERSE_TEXT_FORMATS,
  normalizeAdvancedCopyOptions,
  readBooleanField,
  readEnumField,
} from './copyOptions';
export type {
  AdvancedCopyOptions,
  ReferencePosition,
  VerseTextFormat,
} from './copyOptions';

// --- The clipboard formats --------------------------------------------------
export { renderPassageCopy } from './passageCopyRenderer';
export type { CopyShape } from './passageCopyRenderer';

export { default as standardFormat } from './standardFormat';
export { default as combinedFormat } from './combinedFormat';
export {
  default as templateFormat,
  renderCopyTemplate,
  buildTemplateContext,
} from './templateFormat';

export {
  getAllFormats,
  getFormatById,
  getDefaultFormat,
  getBuiltInFormats,
  DEFAULT_FORMAT_ID,
} from './formatRegistry';

// --- The markup formats -----------------------------------------------------
export {
  PASSAGE_MARKUP_FORMAT_IDS,
  PASSAGE_MARKUP_FORMATS,
  DEFAULT_PASSAGE_MARKUP_OPTIONS,
  DEFAULT_PASSAGE_MARKUP_LABELS,
  isPassageMarkupFormat,
  getPassageMarkupFormat,
  resolvePassageMarkupOptions,
  renderPassageMarkup,
  passageMarkupToHtml,
  passageMarkupToText,
  passageMarkupToMarkdown,
  passageMarkupToSourceText,
} from './passageMarkup';
export type {
  PassageMarkupFormatId,
  PassageMarkupFormatMeta,
  PassageMarkupOptions,
  PassageMarkupShapeOptions,
  PassageInsertOptions,
  PassageMarkup,
  PassageMarkupBlock,
  PassageMarkupLine,
  PassageMarkupLabels,
  PassageReferencePosition,
  VerseNumberStyle,
  QuoteMarkStyle,
  HeadingLevel,
  PassageMarkupHtmlOptions,
  PassageMarkupSourceOptions,
} from './passageMarkup';

export {
  normalizePassageMarkupOptions,
  PASSAGE_REFERENCE_POSITIONS,
  VERSE_NUMBER_STYLES,
  QUOTE_MARK_STYLES,
  HEADING_LEVELS,
} from './passageMarkupOptions';

// --- The one numbered list both dialogs read --------------------------------
export {
  PASSAGE_FORMAT_ORDER,
  DEFAULT_PASSAGE_FORMAT_ID,
  LEGACY_PASSAGE_FORMAT_IDS,
  MAX_FORMAT_SHORTCUT,
  isLegacyPassageFormat,
  remapLegacyFormatId,
  getPassageFormatCatalog,
  getPassageFormatEntry,
  getPassageFormatNumber,
  getPassageFormatByNumber,
  resolveFormatShortcut,
} from './formatCatalog';
export type {
  PassageFormatEntry,
  PassageFormatFamily,
  PassageFormatCatalogOptions,
} from './formatCatalog';
