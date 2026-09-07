/**
 * Typed interfaces for raw database rows returned by SQLite queries.
 *
 * These replace `any` in repository mapRowToEntity methods, providing
 * documentation and partial type safety at the database boundary.
 * Column names match the SQL schema (snake_case).
 *
 * The index signature allows access to columns not explicitly listed,
 * which is necessary because SQLite rows can vary by module version
 * and some queries use SELECT * which may return extra columns.
 */

/** Base for all row types - allows extra columns from SELECT * */
interface BaseRow {
  [key: string]: unknown;
}

// --- Module databases ------------------------------------------------

/**
 * Row from the module_info table (present in every module database).
 * All module types share this table with info_id = 1.
 * Bible/Dictionary modules add type-specific columns.
 */
export interface ModuleInfoRow extends BaseRow {
  info_id: number;
  abbreviation: string;
  full_name: string;
  language_code: string;
  year_published?: number;
  copyright?: string;
  description?: string;
  publisher?: string;
  author?: string;
  version?: string;
  created_date?: string;
  metadata?: string;
  // -- identity + provenance ------------------------------

  module_uuid?: string;
  format?: string;
  format_version?: string;
  content_version?: string;
  content_sha256?: string;
  license_spdx?: string;
  license_url?: string;
  source_url?: string;
  versification?: string;
  is_original_language?: number;  // 0 or 1
  right_to_left?: number;         // 0 or 1
  // Dictionary-specific (added by ALTER in Dictionary.sql)
  dictionary_type?: string;
  language_from?: string;
  language_to?: string;
  // Devotional-specific (added by ALTER in Devotional.sql)
  devotional_type?: string;
  total_days?: number;
}

/**
 * Row from the bible_verse table.
 *
 * `text` is clean UTF-8 and `formatting` holds the structured span JSON. The
 * legacy `text_plain` / `formatting_data` spellings are still declared so the
 * row type also covers databases that carry them.
 */
export interface BibleVerseRow extends BaseRow {
  verse_id: number;
  text: string;
  /** Structured formatting JSON. */
  formatting?: string;
  /** Legacy spelling of `formatting`. */
  formatting_data?: string;
  /** Legacy column; `text` is already plain. */
  text_plain?: string;
  word_count?: number;
  metadata?: string;         // JSON
}

/**
 * Row from the interlinear_word table.
 *
 * Word offsets are **0-based and inclusive** in v2. v1 shipped a
 * `CHECK (word_position_start > 0)` 1-based constraint.
 */
export interface InterlinearWordRow extends BaseRow {
  interlinear_id: number;
  verse_id: number;
  word_position_start: number;
  word_position_end: number;
  /** Nullable: `original_word TEXT` has no NOT NULL. Whole-OT NULL in shipped modules. */
  original_word?: string;
  transliteration?: string;
  strongs_number?: string;
  morphology?: string;
  lemma?: string;
  /**
   * Brief gloss in the module's own language: the short out-of-context
   * equivalent (`logos` -> "word, speech"), not how this translation rendered
   * the word and not a full definition. Optional -- a module shipping Strong's
   * numbers may leave it NULL and let a lexicon module supply it.
   */
  gloss?: string;
  /**
   * Word ranges beyond the first, for a discontiguous alignment: comma-separated
   * `"start-end"` entries, or a bare index for a single word -- `"12-14,18"`.
   * Parse with `parseWordPositionList`.
   *
   * NULL/undefined -- the usual case -- means the alignment is exactly
   * `word_position_start`..`word_position_end`.
   */
  extra_word_positions?: string;
  metadata?: string;  // JSON
}

/**
 * Row from the unified `verse_link` table.
 * Present in every module database and in the user database.
 *
 * Range semantics: see the single normative statement in `Core/Types.ts`.
 */
export interface VerseLinkRow extends BaseRow {
  link_id: number;
  source_type: string;
  source_id: number;
  verse_id_start: number;
  verse_id_end?: number;
  link_type: string;
  sort_order?: number;
  context?: string;
  metadata?: string;  // JSON
}

/** Row from the commentary_entry table */
export interface CommentaryEntryRow extends BaseRow {
  entry_id: number;
  verse_id_start: number;
  verse_id_end?: number;
  entry_level?: string;
  content?: string;
  content_file?: string;
  word_count?: number;
  metadata?: string;  // JSON
}

/** Row from the dictionary_entry table */
export interface DictionaryEntryRow extends BaseRow {
  entry_id: number;
  entry_key: string;
  word?: string;
  transliteration?: string;
  pronunciation?: string;
  part_of_speech?: string;
  definition?: string;
  etymology?: string;
  usage_notes?: string;
  semantic_range?: string;
  related_words?: string;   // JSON array
  example_verses?: string;  // JSON array
  content_file?: string;
  metadata?: string;         // JSON
}

/**
 * Row from the word_occurrence table (dictionary modules).
 *
 * The source Bible is identified by `module_uuid`.
 * modules carry `bible_module`, a bare abbreviation acting as a soft cross-DB
 * reference.
 */
export interface WordOccurrenceRow extends BaseRow {
  occurrence_id: number;
  entry_key: string;
  verse_id: number;
  /** v2: joins `module_info.module_uuid` of the source Bible. */
  bible_module_uuid?: string;
  /** Tolerated alternate spelling. */
  module_uuid?: string;
  /** Legacy abbreviation-based soft reference. */
  bible_module?: string;
  translation_word?: string;
  metadata?: string;  // JSON
}

/** Row from the book_section table */
export interface BookSectionRow extends BaseRow {
  section_id: number;
  parent_section_id?: number;
  section_number?: number;
  title?: string;
  content?: string;
  content_file?: string;
  word_count?: number;
  metadata?: string;  // JSON
}

/** Row from the scripture_reference table (books) */
export interface ScriptureReferenceRow extends BaseRow {
  reference_id: number;
  section_id: number;
  verse_id_start: number;
  verse_id_end?: number;
  context?: string;
  metadata?: string;  // JSON
}

/**
 * Row from the cross_reference_group table.
 *
 * The source anchor is the canonical inclusive range (ModuleFormat section 5): a
 * single-verse group is `verse_id_end = verse_id_start`, never NULL. A v1
 * module spells both as a single `verse_id` column; the repository aliases it
 * onto this v2 shape so mapping code only ever sees one row shape.
 */
export interface CrossReferenceGroupRow extends BaseRow {
  group_id: number;
  verse_id_start: number;
  verse_id_end: number;
  phrase?: string;
  sort_order?: number;
  metadata?: string;  // JSON
}

/** Row from the cross_reference_entry table */
export interface CrossReferenceEntryRow extends BaseRow {
  entry_id: number;
  group_id: number;
  target_verse_id: number;
  target_verse_end_id?: number;
  note?: string;
  sort_order?: number;
  metadata?: string;  // JSON
}

/** Row from the topic table (topical index modules) */
export interface TopicRow extends BaseRow {
  topic_id: number;
  parent_topic_id?: number;
  name: string;
  /** Short annotation on the heading: a gloss, or Nave's "See X" redirects. */
  description?: string;
  /** The topic's prose body, where the work has one. NULL for most topics. */
  content?: string;
  /** Path to the body held outside the database; alternative to `content`. */
  content_file?: string;
  word_count?: number;
  sort_order?: number;
  metadata?: string;  // JSON
}

/**
 * Row from the topic<->verse table.
 *
 * The canonical spelling is `verse_id_start` / `verse_id_end`. The reversed
 * `start_verse_id` / `end_verse_id` spelling is also declared so one row type
 * covers either shape.
 */
export interface TopicVerseRow extends BaseRow {
  topic_id: number;
  /** Canonical spelling. */
  verse_id_start?: number;
  /** Canonical spelling. */
  verse_id_end?: number;
  /** Tolerated reversed spelling. */
  start_verse_id?: number;
  /** Tolerated reversed spelling. */
  end_verse_id?: number;
  context?: string;
  sort_order?: number;
}

// --- Main database ---------------------------------------------------

/** Row from the bible_book table */
export interface BibleBookRow extends BaseRow {
  book_id: number;
  book_number: number;
  book_name: string;
  book_abbreviation: string;
  testament: string;
  book_group?: string;
  chapter_count: number;
  verse_count?: number;
  metadata?: string;       // JSON
}

/** Row from the chapter_info table */
export interface ChapterInfoRow extends BaseRow {
  chapter_info_id: number;
  book_id: number;
  chapter: number;
  verse_count: number;
  first_absolute_id?: number;
  last_absolute_id?: number;
  metadata?: string;  // JSON
}

/** Row from the module_metadata table */
export interface ModuleMetadataRow extends BaseRow {
  module_id: number;
  /**
   * Stable module identity, mirrored from the module file's
   * `module_info.module_uuid`. NOT NULL in the schema: a module without a UUID
   * is rejected at import rather than registered, so every row has one.
   */
  module_uuid: string;
  module_type: string;
  module_name: string;
  abbreviation?: string;
  version?: string;
  language_code: string;
  installed_date?: string;
  last_updated?: string;
  database_path: string;
  size_bytes?: number;
  is_indexed?: number;      // 0 or 1
  last_indexed_date?: string;
  features?: string;         // JSON array
  sword_metadata?: string;   // JSON
  metadata?: string;         // JSON
}

/** Row from the module_repository table */
export interface ModuleCatalogRow extends BaseRow {
  repository_id: number;
  name: string;
  abbreviation?: string;
  url: string;
  type: string;
  is_enabled?: number;  // 0 or 1
  priority?: number;
  catalog_json?: string;
  last_updated?: string;
  last_fetched?: string;
  metadata?: string;     // JSON
  signature_status?: string;      // 'verified' | 'unsigned' | 'invalid' | 'untrusted_key' | 'error'
  signing_public_key?: string;    // hex Ed25519 public key
}

/** Row from the download_queue table */
export interface DownloadQueueRow extends BaseRow {
  queue_id: number;
  module_id?: number;
  module_name: string;
  download_url: string;
  download_size_bytes?: number;
  status: string;
  progress_bytes?: number;
  download_speed_bps?: number;
  started_date?: string;
  completed_date?: string;
  error_message?: string;
  retry_count?: number;
  metadata?: string;  // JSON
}

/** Row from the module_update table */
export interface ModuleUpdateRow extends BaseRow {
  update_id: number;
  module_id: number;
  current_version?: string;
  available_version: string;
  release_date?: string;
  changelog?: string;
  download_url?: string;
  download_size_bytes?: number;
  is_critical?: number;     // 0 or 1
  user_ignored?: number;    // 0 or 1
  notified_date?: string;
  metadata?: string;         // JSON
}

// --- User database ---------------------------------------------------

/** Row from the user_note table */
export interface UserNoteRow extends BaseRow {
  note_id: number;
  user_commentary_id?: number;
  parent_note_id?: number;
  verse_id_start?: number;
  verse_id_end?: number;
  title?: string;
  content?: string;
  content_format?: string;
  note_type: string;
  document_type?: string;
  visibility?: string;
  created_date?: string;
  modified_date?: string;
  tags?: string;       // JSON array
  series_name?: string;
  entry_date?: string;
  metadata?: string;   // JSON
}

/** Row from the user_text_markup table */
export interface UserTextMarkupRow extends BaseRow {
  markup_id: number;
  module_id?: number;
  verse_id_start: number;
  verse_id_end?: number;
  text_start?: number;
  text_end?: number;
  color: string;
  note_id?: number;
  created_date?: string;
  metadata?: string;  // JSON
}

/** Row from the user_commentary (prayer list) table */
export interface UserCommentaryRow extends BaseRow {
  user_commentary_id: number;
  name: string;
  description?: string;
  created_date?: string;
  modified_date?: string;
  is_default?: number;  // 0 or 1
  color?: string;
  metadata?: string;     // JSON
}

/**
 * Row from the user_data_item table - the generic extensible store.
 *
 * Addressed by (owner_uuid, collection, item_key). See UserDatabase.sql 4.7 for
 * why `owner_uuid` is a module UUID rather than a local module_id, and why it
 * carries no foreign key.
 */
export interface UserDataItemRow extends BaseRow {
  item_id: number;
  /** Owning module's `module_info.module_uuid`, or `app:<feature>`. */
  owner_uuid: string;
  /** Named set within the owner: 'settings', 'verse_ratings', ... */
  collection: string;
  /** Key within the collection; unique per (owner_uuid, collection). */
  item_key: string;
  /** Payload as TEXT; parse per `value_type`. */
  value?: string;
  value_type: string;
  sort_order: number;
  created_date?: string;
  modified_date?: string;
  metadata?: string;  // JSON
}

/** Row from the user_cross_reference table */
export interface UserCrossReferenceRow extends BaseRow {
  user_xref_id: number;
  /** Source passage, inclusive both ends. Single verse: end = start. */
  from_verse_id_start: number;
  from_verse_id_end: number;
  /** Target passage, inclusive both ends. Single verse: end = start. */
  to_verse_id_start: number;
  to_verse_id_end: number;
  notes?: string;
  created_date?: string;
  metadata?: string;  // JSON
}

/** Row from the session table */
export interface SessionRow extends BaseRow {
  session_id: number;
  name: string;
  description?: string;
  created_date?: string;
  modified_date?: string;
  last_opened?: string;
  is_autosave?: number;  // 0 or 1
  is_default?: number;   // 0 or 1
  session_data?: string; // JSON
  metadata?: string;      // JSON
}

/** Row from the collection table */
export interface CollectionRow extends BaseRow {
  collection_id: number;
  parent_collection_id?: number;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  created_date?: string;
  modified_date?: string;
  sort_order?: number;
  metadata?: string;  // JSON
}

/** Row from the pinned_item table */
export interface PinnedItemRow extends BaseRow {
  pin_id: number;
  collection_id: number;
  item_type: string;
  verse_id_start?: number;
  verse_id_end?: number;
  reference_id?: number;
  reference_text?: string;
  module_id?: number;
  title?: string;
  notes?: string;
  created_date?: string;
  sort_order?: number;
  metadata?: string;  // JSON
}

// --- Search ----------------------------------------------------------

/** Row from the bible_search_index table */
export interface BibleSearchIndexRow extends BaseRow {
  index_id: number;
  type: string;
  document: string;
  division?: string;
  last_indexed?: string;
  is_indexed?: number;  // 0 or 1
  metadata?: string;     // JSON
}

/** Row from the bible_search_verse_position table */
export interface BibleSearchVersePositionRow extends BaseRow {
  position_id: number;
  type: string;
  document: string;
  division?: string;
  verse_id: number;
  start_index: number;
  end_index: number;
}

/** Row from the saved_search table */
export interface SavedSearchRow extends BaseRow {
  search_id: number;
  name: string;
  query: string;
  search_type: string;
  scope?: string;       // JSON
  options?: string;      // JSON
  created_date?: string;
  last_used?: string;
  use_count?: number;
  metadata?: string;     // JSON
}

/**
 * Row from the legacy `note_verse_link` table (user database).
 *
 * Superseded by {@link VerseLinkRow} (`source_type='note'`).
 */
export interface NoteVerseLinkRow extends BaseRow {
  link_id: number;
  note_id: number;
  verse_id_start: number;
  verse_id_end?: number;
  link_type: string;
  word_start?: number;
  word_end?: number;
  metadata?: string;  // JSON
}
