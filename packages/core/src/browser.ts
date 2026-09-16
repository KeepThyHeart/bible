/**
 * `@bible/core/browser` - the platform-free subset of the core package.
 *
 * ## Why this exists
 *
 * The main entry point (`index.ts`) re-exports the whole Data layer, which
 * reaches `better-sqlite3` and Node's `fs`/`path`. That is correct for the
 * Electron main process and for the web *server*, but it cannot be bundled for
 * a browser. Before this barrel existed, the web client worked around that by
 * keeping hand-maintained copies of core modules under `src/utils/`:
 * `copyTemplateEngine.ts` (a verbatim copy of CopyService), `bibleSections.ts`,
 * and `HookRegistryClient.ts`. Each carried a comment explaining that core was
 * CommonJS-only and could not be imported - and each was free to drift from the
 * original, which for the copy-template engine meant the two apps could format
 * copied verses differently.
 *
 * Everything re-exported here is pure TypeScript: no imports outside this set,
 * no filesystem, no database driver, no Node globals. It is safe in a browser
 * bundle, a web worker, an Electron renderer, and a Node script alike.
 *
 * ## Adding to this barrel
 *
 * Only add a module if it (transitively) imports nothing platform-specific.
 * `packages/core/src/__tests__/browserBarrel.test.ts` enforces that by walking
 * the import graph, so a violation fails the build rather than the browser.
 */

// --- Verse identity and book names -----------------------------------------
export { VerseIdHelper, Book } from './Data/Core/Types';
export type { VerseId, BookNumber } from './Data/Core/Types';

export {
  BOOK_COUNT,
  ENGLISH_BOOK_NAMES,
  ENGLISH_DISPLAY_NAMES,
  ENGLISH_SINGLE_CHAPTER_BOOKS,
  LONG_NAMES,
  MEDIUM_NAMES,
  SHORT_NAMES,
  getBookName,
  getBookNumber,
  isSingleChapterBook,
} from './Data/Core/BookNames';
export type { BookNameFormat } from './Data/Core/BookNames';

// --- Reference parsing / formatting ----------------------------------------
export { ReferenceParser } from './Services/ReferenceParser';
export type { ParsedReference, IReferenceParser, ReferenceParserConfig } from './Services/ReferenceParser';

// --- Locale identity and per-language processing ----------------------------
// Shared, translation-free locale metadata (direction, script, digits) plus
// the `Localizer` interface that gives every planned locale correct
// number/date/collation/case behavior today, and a place for a language's own
// book-name table once one is drafted. See `Data/Locales/Localizer.ts`.
export {
  LOCALE_REGISTRY,
  resolveLocaleDescriptor,
  directionForTag,
} from './Data/Locales/LocaleRegistry';
export type { LocaleDescriptor, LocaleDirection, DigitSystem } from './Data/Locales/LocaleRegistry';
export {
  EnglishLocalizer,
  createIntlLocalizer,
  getLocalizer,
  registerLocalizer,
} from './Data/Locales/Localizer';
export type { Localizer, DigitFormatOptions } from './Data/Locales/Localizer';
export { parseLocaleMeta } from './Data/Locales/LocaleMetadata';
export type { LocaleMetadata, LocaleStatus } from './Data/Locales/LocaleMetadata';
// Side-effect import: registers every built-in Localizer beyond `en` (see the
// module doc). Both books/*.ts files are pure data - no platform deps - so
// this belongs in the browser barrel too.
export { SpanishLocalizer, ChineseSimplifiedLocalizer } from './Data/Locales/registerBuiltinLocalizers';
export {
  ES_BOOK_NAMES, ES_DISPLAY_NAMES, ES_SHORT_NAMES, ES_SINGLE_CHAPTER_BOOKS,
} from './Data/Locales/books/es';
export {
  ZH_HANS_BOOK_NAMES, ZH_HANS_DISPLAY_NAMES, ZH_HANS_SHORT_NAMES, ZH_HANS_SINGLE_CHAPTER_BOOKS,
} from './Data/Locales/books/zhHans';

export { collapseReferences, collapseReferencesStructured } from './Services/ReferenceCollapser';
export type { CollapseOptions, CollapsedSegment } from './Services/ReferenceCollapser';

// --- Bible structure --------------------------------------------------------
export { BIBLE_SECTIONS, getBibleSection } from './Services/BibleSections';
export type { BibleSectionKey, BibleSectionInfo } from './Services/BibleSections';

// --- Copy templates ---------------------------------------------------------
export { renderTemplate, BUILTIN_TEMPLATES, exportTemplates, importTemplates } from './Services/CopyService';
export type { SavedTemplate } from './Services/CopyService';

// --- Passage formatting (copy / insert) -------------------------------------
// The whole format engine: the numbered catalog, the block-tree renderer, the
// clipboard formats and the DOM-free verse-text extraction underneath them.
// See `Services/PassageFormat/index.ts` for which export answers which need.
export * from './Services/PassageFormat';

// --- Dictionary definition rendering ----------------------------------------
export {
  dictionaryDefinitionToHtml,
  definitionHasHtmlMarkup,
  newlinesToLineBreaks,
  readNewlineHandling,
  resolveNewlineHandling,
  NEWLINE_HANDLING_KEY,
} from './Services/DictionaryDefinitionFormatter';
export type { NewlineHandling } from './Services/DictionaryDefinitionFormatter';

// --- Text truncation --------------------------------------------------------
export { truncateAtWordBoundary, TRUNCATION_ELLIPSIS } from './Services/TextTruncation';
export type { TruncatedText } from './Services/TextTruncation';

// --- Strong's numbers -------------------------------------------------------
export { StrongsNumberHelper } from './Data/Core/StrongsNumberHelper';
export type { StrongsLanguage, ParsedStrongsNumber } from './Data/Core/StrongsNumberHelper';

// --- Plugin hook registry ---------------------------------------------------
export { HookRegistry } from './Plugin/HookRegistry';
export type { FilterHandler, ActionHandler } from './Plugin/HookRegistry';
