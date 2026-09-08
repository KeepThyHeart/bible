/**
 * Copy Formats Module
 *
 * **The formatting itself lives in `@bible/core`.** The block-tree renderer,
 * the clipboard formats, the numbered catalog and the verse-text extraction
 * underneath them all moved to `Services/PassageFormat` there, so the web
 * client renders the same output from the same code instead of its own inline
 * restatement of it. What is left in this folder is what could not move: the
 * *storage* - the keys are per-app - and the legacy `{var}` template files.
 *
 * This barrel is the seam. Desktop code keeps importing from
 * `services/copyFormats`, and gets core's engine plus desktop's persistence
 * under one roof, with `BibleVerse` still spelled the way the renderer has
 * always spelled it.
 */

import type { CopyFormatSettings } from '@bible/core';
import { loadAdvancedCopyOptions } from './advancedOptions';
import { loadActiveTemplateText } from './savedTemplates';

// --- The engine, from core --------------------------------------------------
// `PassageVerse` is core's name for what this app has always called
// `BibleVerse`; the alias keeps that spelling for the renderer while leaving
// core's own `BibleVerse` (the Data-layer model) unshadowed.
export type {
  PassageVerse,
  PassageVerse as BibleVerse,
  VerseContext,
  FormatOptions,
  CopyFormat,
  CopyFormatSettings,
} from '@bible/core';
export { DEFAULT_FORMAT_OPTIONS, DEFAULT_COPY_FORMAT_SETTINGS } from '@bible/core';

// Format registry
export {
  getAllFormats,
  getFormatById,
  getDefaultFormat,
  getBuiltInFormats,
  DEFAULT_FORMAT_ID,
} from '@bible/core';

// Individual formats
export {
  standardFormat,
  combinedFormat,
  templateFormat,
  renderCopyTemplate,
  buildTemplateContext,
} from '@bible/core';

// The shared renderer behind Standard and Combined
export { renderPassageCopy } from '@bible/core';
export type { CopyShape } from '@bible/core';

// Format helpers
export {
  truncateForPreview,
  getCleanVerseText,
  getVerseTextForPreview,
  getVerseTextForFormat,
  buildReference,
  buildPassageReference,
} from '@bible/core';

// Passage markup - the note-insertion side of the engine (block quotes,
// per-verse headings, inline quotations). Shares the verse-text extraction and
// the `FormatOptions` vocabulary with the clipboard formats above.
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
  HEADING_LEVELS,
} from '@bible/core';
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
  PassageMarkupSourceOptions,
} from '@bible/core';

// The one numbered, ordered format list both dialogs read
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
} from '@bible/core';
export type {
  PassageFormatEntry,
  PassageFormatFamily,
  PassageFormatCatalogOptions,
} from '@bible/core';

// --- Desktop's own persistence ----------------------------------------------

// Saved templates (Handlebars-style, restored parity with web CopyDialog)
export {
  BUILTIN_TEMPLATES,
  loadUserTemplates,
  saveUserTemplates,
  upsertUserTemplate,
  deleteUserTemplate as deleteSavedCopyTemplate,
  getAllTemplates as getAllCopyTemplates,
  findTemplateByName as findCopyTemplateByName,
  loadActiveTemplateText,
  saveActiveTemplateText,
  loadActiveTemplateName,
  saveActiveTemplateName
} from './savedTemplates';
export type { SavedTemplate } from './savedTemplates';

// Advanced options - the shape controls shared by Standard and Combined
export {
  DEFAULT_ADVANCED_COPY_OPTIONS,
  ADVANCED_COPY_OPTIONS_KEY,
  loadAdvancedCopyOptions,
  saveAdvancedCopyOptions
} from './advancedOptions';
export type { AdvancedCopyOptions, ReferencePosition, VerseTextFormat } from './advancedOptions';

// Per-format insertion preferences (localStorage, keyed by format id)
export {
  DEFAULT_INSERT_FORMAT_ID,
  PASSAGE_INSERT_KEYS,
  loadPassageMarkupOptions,
  savePassageMarkupOptions,
  getLastInsertFormatId,
  setLastInsertFormatId,
  getSkipFormatMenu,
  setSkipFormatMenu
} from './passageMarkupPreferences';

/**
 * The saved state a copy format needs handed to it.
 *
 * Core's formats take their stored settings as an argument rather than reading
 * storage themselves - that is what let the engine leave the renderer. This is
 * the desktop app's answer to that argument, in one place so every caller
 * supplies the same thing.
 */
export function loadCopyFormatSettings(): CopyFormatSettings {
  return {
    advanced: loadAdvancedCopyOptions(),
    templateText: loadActiveTemplateText(),
  };
}

// `{var}` template exports. Custom templates are edited inline in
// `PassageDialog`, so nothing imports these today; they are kept so a note
// saved against a `{var}` template can still be re-rendered.
export { default as customFormat } from './customFormat';

export {
  getActiveTemplate,
  setActiveTemplateId,
  getActiveTemplateId,
  createFormatFromTemplate,
  formatWithTemplate,
  formatWithTemplateConfig
} from './customFormat';

export type {
  TemplateConfig,
  MasterVariables,
  VerseVariables
} from './templateParser';

export {
  substituteVariables,
  buildVerseVariables,
  buildMasterVariables,
  applyTemplate,
  validateTemplate,
  getMasterVariableList,
  getVerseVariableList,
  BUILT_IN_TEMPLATES
} from './templateParser';

export type { UserTemplate } from './templateStorage';

export {
  getUserTemplates,
  getBuiltInTemplates,
  getAllTemplates,
  getTemplateById,
  saveUserTemplate,
  updateUserTemplate,
  deleteUserTemplate,
  duplicateTemplate,
  getDefaultTemplateId,
  setDefaultTemplate,
  clearDefaultTemplate,
  getDefaultTemplate,
  isTemplateNameUnique,
  exportTemplates,
  importTemplates
} from './templateStorage';
