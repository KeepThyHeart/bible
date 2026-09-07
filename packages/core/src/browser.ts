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
