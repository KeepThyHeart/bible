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
  MAX_CHAPTERS,
  MEDIUM_NAMES,
  NT_BOOKS,
  OT_BOOKS,
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

// --- Verse text formatting --------------------------------------------------
// The pure half of `VerseFormatter`: raw module text + word-range metadata in,
// display HTML out (Words of Christ, divine-name small caps, OSIS strip). The
// web client's offline read path calls this so it renders exactly what the
// server does; `formatVerseText(BibleVerse)` (the model adapter) stays out.
export {
  formatVerseFields,
  stripOsisTags,
  highlightSearchTerms,
  hasWordsOfChrist,
  getFootnotes,
} from './Services/VerseTextFormatter';
export type { FormattedVerse, VerseFormattingData, VerseWordRange } from './Services/VerseTextFormatter';

// --- Word indexing and interlinear cells ------------------------------------
// The English-word index space (`extractWordsWithFormatting`) that interlinear
// rows, highlights and formatting spans all address, and the cell builder that
// partitions it for the interlinear view. DOM-free, so the desktop renderer,
// the web client and Node scripts tokenise a verse identically.
export {
  extractWordsWithFormatting,
  extractWords,
  countWordsInRange,
} from './Services/WordIndexing';
export type { WordInfo } from './Services/WordIndexing';
export {
  buildInterlinearCells,
  cellsPartitionWordSpace,
  cellStrongsNumbers,
} from './Services/InterlinearCells';
export type { InterlinearWord, InterlinearCell } from './Services/InterlinearCells';

// --- Annotations (highlights, decorations, find marks, selection capture) ----
// The React-free half of verse annotation painting: per-word classes/styles
// (`wordRenderAttrs`), the verse-to-HTML producer (`renderVerseWords`), the
// extension-decoration resolver, theme colour keys and the DOM selection
// mapping. Apps keep only their framework glue (store hooks, components).
// Flat exports: no name collides with the rest of this barrel.
export * from './Annotations';

// --- Readable stores (framework-neutral state seam) ---------------------------
// `subscribe` + `getSnapshot`: the shape `useSyncExternalStore` (React, and
// Preact via compat) consumes. `fromZustand` adapts a desktop store,
// `fromSelector` derives a stable slice, `createStore` is a tiny value store.
export { fromZustand, fromSelector, createStore } from './Ui/ReadableStore';
export type { ReadableStore, WritableStore, ZustandLike } from './Ui/ReadableStore';

// --- Content text direction ---------------------------------------------------
// Direction of a *module's* text (by its language), independent of UI locale.
export { directionForLanguage, isRtlLanguage } from './Data/Locales/TextDirection';

// --- Module catalog metadata ----------------------------------------------------
// Language-free module facts: which module is the AI digest, recommended
// translations, commentary sort order, machine-authorship detection. The prose
// and notice wording stay in each app's own localization.
export {
  DIGEST_MODULE_ABBR,
  isDigestModule,
  isAiGeneratedMetadata,
  getModuleProvenanceKind,
  isAiGeneratedModule,
  RECOMMENDED_BIBLES,
  DEFAULT_COMMENTARY_PRIORITY,
  COMMENTARY_PRIORITY,
  getCommentaryPriority,
} from './Services/ModuleDescriptions';
export type { ModuleProvenanceKind, ModuleProvenanceMetadata } from './Services/ModuleDescriptions';

// --- Text truncation --------------------------------------------------------
export { truncateAtWordBoundary, TRUNCATION_ELLIPSIS } from './Services/TextTruncation';
export type { TruncatedText } from './Services/TextTruncation';

// --- Strong's numbers -------------------------------------------------------
export { StrongsNumberHelper } from './Data/Core/StrongsNumberHelper';
export type { StrongsLanguage, ParsedStrongsNumber } from './Data/Core/StrongsNumberHelper';

// --- Plugin hook registry ---------------------------------------------------
export { HookRegistry } from './Plugin/HookRegistry';
export type { FilterHandler, ActionHandler } from './Plugin/HookRegistry';

// --- Data-provider seam (task 0034) -----------------------------------------
// DTO types plus the ten Promise-returning provider interfaces - pure data
// and interface declarations, no platform dependency. See `Providers/interfaces.ts`'s
// own doc comment for what this is and why it (not the module repositories)
// is where a remote/licensed content source plugs in. Namespaced (like
// `Extensions`/`Usfm` above) because two DTO names (`SearchOptions`,
// `TopicVerseData`) collide with pre-existing, differently-shaped root
// exports (`Data/Models/Main/SavedSearch.ts`, `Services/Search/TopicExpansion.ts`) -
// a flat `export *` would be ambiguous for both.
export * as Providers from './Providers';

// --- Crypto primitives (task 0078) -------------------------------------------
// Argon2id (hash-wasm, loaded lazily), HKDF-SHA-256 and AES-256-GCM over
// WebCrypto, plus strict base64url and KDF-parameter validation. Shared by the
// backup format and, later, by account sync so both use one implementation and
// one set of test vectors. Namespaced: the names are generic.
export * as Crypto from './Crypto';

// --- Backup format v1 (task 0078) ---------------------------------------------
// The encrypted container, ZIP payload, user-table registry and restore
// planner. Namespaced because the names are generic.
export * as Backup from './Backup';
