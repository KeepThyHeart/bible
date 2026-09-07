export interface BookTopic {
  title: string;
  chapter: number;
  verse: number;
  endChapter: number;
  endVerse: number;
}

export interface BookTopicsData {
  topics: BookTopic[];
}

export interface ChapterData {
  verses: VerseData[];
  hasInterlinearData: boolean;
  /** Book numbers (1-66) that have content in this module. Only present when verses is empty. */
  coveredBooks?: number[];
}

export interface VerseFootnote {
  position: number;
  marker: string;
  text: string;
}

export interface VerseData {
  verse_id: number;
  book_number: number;
  chapter: number;
  verse: number;
  text: string;
  text_html: string;
  is_paragraph_start: boolean;
  words_of_christ: boolean;
  footnotes?: VerseFootnote[];
  section_heading?: string;
}

export interface CommentaryData {
  entries: CommentaryEntryData[];
  content_format?: 'html' | 'markdown' | 'plain';
}

export interface CommentaryEntryData {
  entry_id: number;
  verse_id_start: number;
  verse_id_end: number;
  entry_level: string;
  content: string;
  word_count: number;
}

export interface InterlinearData {
  words: InterlinearWordData[];
  strongsEntries: Record<string, StrongsEntryData>;
}

export interface InterlinearWordData {
  verseId: number;
  /** First English word index this row covers. 0-based, inclusive. */
  position: number;
  /**
   * Last English word index this row covers. 0-based, inclusive.
   *
   * Optional only because the field post-dates the endpoint and its responses
   * are HTTP-cacheable for up to a day: a browser can still hold one without
   * it. Absent means "unusable", not "one word long" — see
   * `rowsHaveEndPositions` in `utils/interlinearRows.ts`.
   */
  positionEnd?: number;
  originalWord: string;
  transliteration: string;
  strongsNumber: string;
  morphology: string;
  gloss: string;
  language: string;
}

export interface StrongsEntryData {
  strongsNumber: string;
  word: string;
  transliteration: string;
  definition: string;
  partOfSpeech: string;
  etymology?: string;
  briefMeaning?: string;
}

export interface CommentaryHomeModule {
  moduleAbbr: string;
  moduleName: string;
  wordCount: number;
}

export interface CommentaryHomeData {
  verseModules: CommentaryHomeModule[];
  passageModules?: CommentaryHomeModule[];
  chapterModules: CommentaryHomeModule[];
}

export interface CommentaryAllModulesData {
  modules: Record<string, CommentaryData>;
}

export interface ChapterOverviewEntry {
  moduleIdx: number;
  startVerse: number;
  endVerse: number;
  level: string;   // "v" | "p" | "c" | "b"
  wordCount: number;
}

export interface ChapterOverviewData {
  book: number;
  chapter: number;
  modules: [string, string][];   // [abbr, name][]
  entries: ChapterOverviewEntry[];
}

export interface CommentaryChapterVersesData {
  verses: number[];
}

export interface CommentaryModuleInfoData {
  abbreviation: string;
  fullName: string;
  author: string | null;
  yearPublished: number | null;
  version: string | null;
  languageCode: string;
  copyright: string | null;
  description: string | null;
  publisher: string | null;
  createdDate: string | null;
}

/**
 * What a search row is, which differs by which search produced it:
 *
 * - Keyword and Strong's rows carry the core `MatchType` — `'exact'`, `'stem'`
 *   (a different form of the same word) or `'fuzzy'` (a close spelling). The
 *   server used to flatten all three to a hardcoded `'bible'`, so the browser
 *   could not tell an approximate match from a real one; it now passes the
 *   real type through.
 * - Semantic rows carry the *retrieval level* the embedding matched at —
 *   `'verse'`, `'paragraph'` or `'chapter'`. These are not match types, which
 *   is why anything keying off `'fuzzy'` must first check the search mode.
 * - `'reference'` marks the synthetic row `searchStore` promotes to the top
 *   when the query itself parses as a verse reference.
 */
export type SearchResultType =
  | 'exact'
  | 'stem'
  | 'fuzzy'
  | 'verse'
  | 'paragraph'
  | 'chapter'
  | 'reference';

export interface SearchResultData {
  verseId: number;
  /** For passage/range results (e.g. semantic paragraph matches), the last verse of the range. */
  endVerseId?: number;
  reference: string;
  title?: string;
  text: string;
  snippet?: string;
  score?: number;
  module: string;
  type: SearchResultType;
}

export interface SearchResultSet {
  results: SearchResultData[];
  /** How many rows are in `results` — the page, not the match set. */
  total: number;
  /**
   * How many matches the search found in total, of which `results` is the first
   * page. Optional: only the keyword endpoint reports it, and only a server new
   * enough to send it — read it through the store's fallbacks, never bare.
   */
  totalAvailable?: number;
  /**
   * Matches per book number over the *whole* match set, so the distribution
   * chart can describe the search rather than the page. Approximate (fuzzy)
   * spellings are excluded, matching what the chart counts. Optional for the
   * same reason as `totalAvailable`.
   */
  bookCounts?: Record<number, number>;
}

// Strong's search types
export interface WordFamilyMemberData {
  strongsNumber: string;
  word: string;
  transliteration: string;
  gloss: string;
  relationship: 'self' | 'parent' | 'child' | 'related';
}

export interface StrongsSearchResult {
  entry: {
    strongsNumber: string;
    word: string;
    transliteration: string;
    gloss: string;
  } | null;
  wordFamily: WordFamilyMemberData[];
  results: SearchResultData[];
  /** How many occurrences this response carries (after the page cap). */
  total: number;
  /**
   * How many occurrences exist in total, so the UI can offer to load the rest.
   *
   * Optional because a self-hosted deployment can run a browser client against
   * an older server that does not send it; `searchStore.readTotalAvailable`
   * falls back to `total` in that case.
   */
  totalAvailable?: number;
  groupedCounts: Record<string, number>;
}

export interface ModuleInfo {
  module_id: number;
  abbreviation: string;
  name: string;
  type: string;
  language_code: string;
}

// ─── Module sections (from settings.json via /api/module-sections) ───

export interface ModuleSection {
  title: string;
  helpText?: string;
  modules: string[];
}

export interface ModuleTypeInfo {
  sections: ModuleSection[];
  descriptions: Record<string, { title?: string; description?: string }>;
  sortOrders?: Record<string, number>;
}

export interface ModuleSectionsResponse {
  configured: boolean;
  about?: string | null;
  bibles?: ModuleTypeInfo;
  commentaries?: ModuleTypeInfo;
  dictionaries?: ModuleTypeInfo;
}

export interface BookInfo {
  book_number: number;
  book_name: string;
  book_abbreviation: string;
  testament: string;
  chapter_count: number;
}

export interface SearchOptions {
  modules?: string[];
  page?: number;
  pageSize?: number;
  scope?: string;
}

// Cross-reference types
export interface CrossRefGroupData {
  group: {
    group_id: number;
    verse_id: number;
    phrase: string | null;
    sort_order: number;
  };
  entries: CrossRefEntryData[];
}

export interface CrossRefEntryData {
  entry_id: number;
  group_id: number;
  target_verse_id: number;
  target_verse_end_id: number | null;
  note: string | null;
  sort_order: number;
}

/**
 * Counts on a topic come in two units and must not be mixed:
 *  - `verse_count` expands ranges (a Gen 1:1-5 link counts as 5 verses)
 *  - `reference_count` is one per stored link, and is therefore the number of
 *    rows the /verses endpoint can return — the only safe basis for pagination
 *    and for any "N more" affordance.
 */
// Topical index types
export interface VerseTopicData {
  topic_id: number;
  parent_topic_id: number | null;
  parent_name?: string;
  ancestors: { topic_id: number; name: string; verse_count: number; reference_count?: number }[];
  name: string;
  description: string | null;
  source_abbreviation: string;
  source_name: string;
  verse_count: number;
  reference_count?: number;
}

export interface TopicDetailData {
  topic: {
    topic_id: number;
    parent_topic_id: number | null;
    name: string;
    description: string | null;
    sort_order: number;
  };
  children: TopicChildData[];
  parent_chain: { topic_id: number; name: string }[];
  verse_count: number;
  reference_count?: number;
}

export interface TopicChildData {
  topic_id: number;
  name: string;
  description: string | null;
  verse_count: number;
  reference_count?: number;
  child_count?: number;
}

export interface TopicVerseData {
  topic_id: number;
  start_verse_id: number;
  end_verse_id: number;
  context: string | null;
  sort_order: number;
}

export interface TopicSearchResultData {
  topic_id: number;
  name: string;
  description: string | null;
  ancestors: { topic_id: number; name: string; verse_count: number; reference_count?: number }[];
  source_abbreviation: string;
  source_name: string;
  verse_count: number;
  reference_count?: number;
}

// Tag graph types
export interface TagGraphEntityData {
  entity_id: string;
  category: string;
  name: string;
  notes?: string;
  source?: string;
}

export interface TagGraphEntityDetailData {
  id: string;
  name: string;
  notes?: string;
  [key: string]: unknown;
}

export interface TagGraphAssociationData {
  id: string;
  entity1Id: string;
  entity1Category: string;
  entity1Name: string;
  entity2Id: string;
  entity2Category: string;
  entity2Name: string;
  associationTypeId?: string;
  relationshipName: string;
  reciprocalName?: string;
  strength?: number;
  confidence?: string;
  notes?: string;
}

export interface TagGraphVerseData {
  entityId: string;
  entityCategory: string;
  startVerseId: number;
  endVerseId: number;
  source: string;
}

export interface TagGraphSearchResultData {
  id: string;
  category: string;
  name: string;
  notes?: string;
}

export interface TagGraphFacetMember {
  entityId: string;
  entityCategory: string;
  name: string;
}

export interface TagGraphFacetData {
  facetId: number;
  facetLabel: string;
  sourceModule: string;
  members: TagGraphFacetMember[];
}

export interface TagGraphTopicLinkData {
  entity_id: string;
  entity_category: string;
  source_module: string;
  topic_id: number;
  match_type: 'exact' | 'alias' | 'stem';
  topic_name?: string;
  source_name?: string;
  verse_count?: number;
}
