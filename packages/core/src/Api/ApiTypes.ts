/**
 * Shared request/response types for the Bible application API.
 *
 * These types define the data shapes that flow between any client
 * (Electron IPC, REST, CLI) and the core business logic.
 *
 * Not star-exported from the package root: `SearchOptions` and `SearchResult`
 * here collide with the different types of the same names in
 * `src/types/search.ts`. Import by path: `@bible/core/Api/ApiTypes`.
 */

// --- Common Types --------------------------------------------------

/** A contiguous range of verses, specified by start and end verse IDs. */
export interface PassageRange {
  startVerseId: number;
  endVerseId: number;
}

// --- Bible Types ----------------------------------------------------

export interface BibleModuleSummary {
  /** Module ID from the module_metadata table in main.db (SQLite auto-increment). Optional because discovery APIs may return summaries before installation. */
  moduleId?: number;
  abbreviation: string;
  name: string;
  languageCode?: string;
  version?: string;
  databasePath: string;
}

export interface FormattedVerse {
  verseId: number;
  bookNumber: number;
  chapter: number;
  verse: number;
  textHtml: string;
  isParagraphStart: boolean;
  sectionHeading?: string;
  /** True if this verse contains any words-of-Christ markup. Performance hint so the renderer can skip red-letter processing for verses that have none. Individual word ranges are in the formatting data of the underlying BibleVerse. */
  wordsOfChrist?: boolean;
  footnotes?: Footnote[];
}

export interface Footnote {
  marker: string;
  text: string;
}

export interface ChapterResult {
  verses: FormattedVerse[];
  hasInterlinearData: boolean;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  /** Additional module abbreviations to search in parallel. */
  additionalModules?: string[];
}

export interface VerseSearchResult {
  verseId: number;
  /** Start of the matched passage range (for passage-level results). Defaults to verseId for single-verse matches. */
  passageStart?: number;
  /** End of the matched passage range (for passage-level results). */
  passageEnd?: number;
  bookNumber: number;
  chapter: number;
  verse: number;
  textHtml: string;
  bookName: string;
  module: string;
}

export interface InterlinearWord {
  position: number;
  word: string;
  strongsNumber?: string;
  morphology?: string;
  gloss?: string;
  transliteration?: string;
}

export interface BookInfo {
  bookNumber: number;
  name: string;
  abbreviation: string;
  testament: 'OT' | 'NT';
  chapterCount: number;
}

// --- Commentary Types -----------------------------------------------

export interface CommentaryModuleSummary {
  moduleId?: number;
  abbreviation: string;
  name: string;
  languageCode?: string;
}

export interface CommentaryEntryResult {
  entryId?: number;
  verseIdStart?: number;
  verseIdEnd?: number;
  entryLevel: 'book' | 'chapter' | 'passage' | 'verse';
  content: string;
  wordCount?: number;
}

export interface CommentaryEntrySummaryResult {
  verseIdStart: number;
  verseIdEnd?: number;
  entryLevel: 'book' | 'chapter' | 'passage' | 'verse';
  wordCount?: number;
}

// --- Dictionary Types -----------------------------------------------

export interface DictionaryModuleSummary {
  moduleId?: number;
  abbreviation: string;
  name: string;
  languageCode?: string;
}

export interface DictionaryEntryResult {
  entryId: number;
  entryKey: string;
  title: string;
  content: string;
  pronunciation?: string;
}

// --- User Data Types ------------------------------------------------

export interface UserCrossReferenceResult {
  crossRefId: number;
  sourceVerseId: number;
  targetVerseId: number;
  notes?: string;
  createdAt?: string;
}

export interface UserHighlightResult {
  highlightId: number;
  verseId: number;
  moduleAbbreviation: string;
  colorCode: string;
  createdAt?: string;
}

export interface UserNoteResult {
  noteId: number;
  noteType: string;
  title: string;
  content: string;
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
}

// --- Session Types --------------------------------------------------

export interface SessionSummary {
  sessionId: number;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
}

export interface SessionDataResult {
  sessionId: number;
  name: string;
  sessionData: Record<string, unknown>;
}

// --- Search Types ---------------------------------------------------

export interface SearchResult {
  query: string;
  module: string;
  results: VerseSearchResult[];
  totalCount: number;
}

export interface IndexStatus {
  module: string;
  isIndexed: boolean;
  totalVerses?: number;
  indexedVerses?: number;
}

// --- Book / Topical / Cross-Reference Types -------------------------

export interface BookModuleSummary {
  moduleId?: number;
  abbreviation: string;
  name: string;
}

export interface BookSectionResult {
  sectionId: number;
  title: string;
  content?: string;
  parentId?: number;
  sortOrder: number;
}

export interface TopicalIndexSummary {
  moduleId?: number;
  abbreviation: string;
  name: string;
}

export interface TopicResult {
  topicId: number;
  name: string;
  parentId?: number;
  childCount?: number;
}

export interface CrossReferenceGroupResult {
  sourceVerseId: number;
  entries: CrossReferenceEntryResult[];
}

export interface CrossReferenceEntryResult {
  targetVerseId: number;
  targetVerseIdEnd?: number;
  votes?: number;
}
