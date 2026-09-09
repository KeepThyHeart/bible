import { ISql } from '../Core/ISql';
import { DictionaryEntry, WordOccurrence, ExampleVerse } from '../Models/Dictionary/DictionaryEntry';
import { DictionaryModuleInfo } from '../Models/Dictionary/DictionaryModuleInfo';
import { VerseLinkRecord } from '../Models/Common/VerseLinkRecord';
import { VerseId, DictionaryType, assertDictionaryType } from '../Core/Types';
import { IDictionaryRepository } from './IDictionaryRepository';
import { BaseModuleRepository, mapModuleIdentity, buildIdentityAssignments } from './BaseModuleRepository';
import { ModuleInfoRow, DictionaryEntryRow, WordOccurrenceRow } from '../Core/RowTypes';
import { parseJsonField, stringifyJsonField } from '../Core/JsonHelpers';
import { buildPagination } from '../Core/SafeQuery';
import { escapeFts5Query } from '../../Services/FtsQuery';
import { VerseLinkRepository } from './VerseLinkRepository';

/**
 * Repository for Dictionary module databases (dictionary_*.db)
 *
 * This repository handles ALL operations for a dictionary/lexicon database:
 * - Module information (metadata about the dictionary)
 * - Dictionary entries (definitions, word studies, etc.)
 * - Word occurrences (shipped concordance data; see {@link getOccurrences})
 *
 * One caution that shapes every method here: "dictionary module" covers three
 * different kinds of work, and only the first is a lexicon.
 *
 * 1. Original-language lexicon - Strong's, Thayer. Keyed by "G25"; `word`,
 *    `transliteration` and `partOfSpeech` are populated and meaningful.
 * 2. Bible dictionary or encyclopaedia - ISBE, Easton's. Keyed by an English
 *    topic; the original-language fields are empty.
 * 3. General-language dictionary - Webster's 1828. Keyed by an English
 *    headword; the entry defines the English word and may never mention
 *    Scripture. As shipped, Webster's sets only `entryKey`, `word` (a copy of
 *    the key) and `definition`; `transliteration`, `pronunciation`,
 *    `partOfSpeech`, `etymology`, `usageNotes`, `semanticRange` and
 *    `relatedWords` are empty across all 62,387 entries, and the module has no
 *    `word_occurrence` table.
 *
 * So: check `getModuleInfo().dictionaryType` before rendering anything as
 * original-language text, and treat every optional field as genuinely absent
 * rather than merely unusual.
 *
 * @example
 * ```typescript
 * const strongsDb = new SqliteProvider('data/modules/dictionary_strongs.db');
 * const repo = new DictionaryRepository(strongsDb);
 *
 * // Get module info
 * const info = repo.getModuleInfo();
 * console.log(info.isStrongsConcordance()); // true
 *
 * // Look up a Strong's number
 * const entry = repo.getEntryByKey('G25'); // agapao - love
 * console.log(entry?.definition);
 * ```
 */
export class DictionaryRepository extends BaseModuleRepository<DictionaryModuleInfo> implements IDictionaryRepository {
  private readonly verseLinks: VerseLinkRepository;

  constructor(sql: ISql) {
    super(sql);
    this.verseLinks = new VerseLinkRepository(sql);
  }

  // ========================================================================
  // Module Info Operations
  // ========================================================================

  /**
   * Update the module information.
   *
   * `dictionary_type` is validated here rather than by a SQL CHECK: the set is
   * open, so there is no constraint to lean on and this is the enforcement
   * point.
   */
  updateModuleInfo(info: DictionaryModuleInfo): void {
    const identity = buildIdentityAssignments(info);
    this.sql.execute(
      `UPDATE module_info SET
        abbreviation = ?, full_name = ?, copyright = ?, description = ?,
        dictionary_type = ?, language_from = ?, language_to = ?,
        author = ?, year_published = ?, metadata = ?${identity.sql}
      WHERE info_id = 1`,
      [
        info.abbreviation,
        info.fullName,
        info.copyright ?? null,
        info.description ?? null,
        assertDictionaryType(info.dictionaryType),
        info.languageFrom ?? null,
        info.languageTo,
        info.author ?? null,
        info.yearPublished ?? null,
        stringifyJsonField(info.metadata),
        ...identity.params
      ]
    );
  }

  // ========================================================================
  // Verse Link Operations
  // ========================================================================

  /**
   * Example verses for an entry.
   *
   * Read from the unified `verse_link` table (`source_type='dictionary_entry'`).
   */
  getExampleVerses(entryId: number): ExampleVerse[] {
    return this.verseLinks
      .getForSource('dictionary_entry', entryId)
      .map(link => ({ verseId: link.verseIdStart, text: link.context }));
  }

  /** Verse links for an entry. */
  getVerseLinksForEntry(entryId: number): VerseLinkRecord[] {
    return this.verseLinks.getForSource('dictionary_entry', entryId);
  }

  /**
   * Entries that cite a given verse.
   *
   * Only answerable on a v2 module: on v1 the citations live inside an unindexed
   * JSON column, so this returns an empty array there rather than table-scanning
   * and parsing every entry.
   */
  getEntriesReferencingVerse(verseId: VerseId): DictionaryEntry[] {
    const entryIds = this.verseLinks.getSourceIdsForVerse('dictionary_entry', verseId);
    if (entryIds.length === 0) return [];

    const placeholders = entryIds.map(() => '?').join(',');
    const rows = this.sql.queryAll<DictionaryEntryRow>(
      `SELECT * FROM dictionary_entry WHERE entry_id IN (${placeholders}) ORDER BY entry_key`,
      entryIds
    );
    return this.hydrateExampleVerses(rows.map(row => this.mapRowToEntry(row)));
  }

  // ========================================================================
  // Dictionary Entry Operations
  // ========================================================================

  /**
   * Get a dictionary entry by ID
   */
  getEntry(entryId: number): DictionaryEntry | undefined {
    const row = this.sql.queryOne<DictionaryEntryRow>(
      'SELECT * FROM dictionary_entry WHERE entry_id = ?',
      [entryId]
    );

    return row ? this.hydrateExampleVerses([this.mapRowToEntry(row)])[0] : undefined;
  }

  /**
   * Get a dictionary entry by key (e.g., "G25", "Love", "Baptism")
   * Attempts exact match first, then case-insensitive, then hyphenation variants
   */
  getEntryByKey(entryKey: string): DictionaryEntry | undefined {
    // Try exact match first
    let row = this.sql.queryOne<DictionaryEntryRow>(
      'SELECT * FROM dictionary_entry WHERE entry_key = ?',
      [entryKey]
    );

    if (row) {
      return this.hydrateExampleVerses([this.mapRowToEntry(row)])[0];
    }

    // Try case-insensitive match
    row = this.sql.queryOne<DictionaryEntryRow>(
      'SELECT * FROM dictionary_entry WHERE LOWER(entry_key) = LOWER(?)',
      [entryKey]
    );

    if (row) {
      return this.hydrateExampleVerses([this.mapRowToEntry(row)])[0];
    }

    // Try hyphenation variants (with hyphens removed and with/without hyphens)
    const dehyphenated = entryKey.replace(/-/g, '');
    row = this.sql.queryOne<DictionaryEntryRow>(
      'SELECT * FROM dictionary_entry WHERE REPLACE(LOWER(entry_key), \'-\', \'\') = ?',
      [dehyphenated.toLowerCase()]
    );

    return row ? this.hydrateExampleVerses([this.mapRowToEntry(row)])[0] : undefined;
  }

  /**
   * Get all entries
   */
  getAllEntries(options?: { limit?: number; offset?: number }): DictionaryEntry[] {
    let sql = 'SELECT * FROM dictionary_entry ORDER BY entry_key';

    sql += buildPagination(options?.limit, options?.offset);

    const rows = this.sql.queryAll<DictionaryEntryRow>(sql);
    return this.hydrateExampleVerses(rows.map(row => this.mapRowToEntry(row)));
  }

  /**
   * Search dictionary entries by title first, then by full text.
   *
   * The full-text index covers `word`, `definition` and `usage_notes`, and
   * BM25 happily ranks a passing mention in a long definition above the entry
   * actually titled with the search word. With a LIMIT applied, looking up
   * "Moses" in a dictionary that plainly has a MOSES entry returned thirty
   * other articles and not that one. Title matches are what someone typing a
   * word into a dictionary means, so they lead; full-text hits fill the rest.
   */
  searchEntries(query: string, options?: { limit?: number }): DictionaryEntry[] {
    const limit = options?.limit ?? 100;

    const titleRows = this.sql.queryAll<DictionaryEntryRow>(
      `SELECT * FROM dictionary_entry
       WHERE word LIKE ? OR entry_key LIKE ?
       ORDER BY
         CASE
           WHEN LOWER(word) = LOWER(?) OR LOWER(entry_key) = LOWER(?) THEN 0
           WHEN LOWER(word) LIKE LOWER(? || '%') OR LOWER(entry_key) LIKE LOWER(? || '%') THEN 1
           ELSE 2
         END,
         entry_key
       LIMIT ?`,
      [`%${query}%`, `%${query}%`, query, query, query, query, limit]
    );

    const rows = [...titleRows];
    if (rows.length < limit) {
      const seen = new Set(rows.map(r => r.entry_id));
      // Raw input cannot go into MATCH: an apostrophe, a hyphen or a bare
      // "not" is a syntax error, which the API surfaced as a 500.
      const ftsQuery = escapeFts5Query(query);
      if (ftsQuery) {
        const ftsRows = this.sql.queryAll<DictionaryEntryRow>(
          `SELECT e.* FROM dictionary_entry e
           JOIN dictionary_entry_fts fts ON e.entry_id = fts.rowid
           WHERE dictionary_entry_fts MATCH ?
           ORDER BY fts.rank
           LIMIT ?`,
          [ftsQuery, limit]
        );
        for (const row of ftsRows) {
          if (rows.length >= limit) break;
          if (seen.has(row.entry_id)) continue;
          seen.add(row.entry_id);
          rows.push(row);
        }
      }
    }

    return this.hydrateExampleVerses(rows.map(row => this.mapRowToEntry(row)));
  }

  /**
   * Search dictionary entries by title (word/entry_key) only
   */
  searchByTitle(query: string, options?: { limit?: number }): DictionaryEntry[] {
    const limit = options?.limit ?? 100;
    const pattern = `%${query}%`;

    const rows = this.sql.queryAll<DictionaryEntryRow>(
      `SELECT * FROM dictionary_entry
       WHERE word LIKE ? OR entry_key LIKE ?
       ORDER BY
         CASE
           WHEN LOWER(word) = LOWER(?) OR LOWER(entry_key) = LOWER(?) THEN 0
           WHEN LOWER(word) LIKE LOWER(? || '%') OR LOWER(entry_key) LIKE LOWER(? || '%') THEN 1
           ELSE 2
         END,
         entry_key
       LIMIT ?`,
      [pattern, pattern, query, query, query, query, limit]
    );

    return this.hydrateExampleVerses(rows.map(row => this.mapRowToEntry(row)));
  }

  /**
   * Create a new dictionary entry
   */
  createEntry(entry: DictionaryEntry): DictionaryEntry {
    const result = this.sql.execute(
      `INSERT INTO dictionary_entry (
        entry_key, word, transliteration, pronunciation, part_of_speech,
        definition, etymology, usage_notes, semantic_range,
        related_words, example_verses, content_file, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.entryKey,
        entry.word ?? null,
        entry.transliteration ?? null,
        entry.pronunciation ?? null,
        entry.partOfSpeech ?? null,
        entry.definition,
        entry.etymology ?? null,
        entry.usageNotes ?? null,
        entry.semanticRange ?? null,
        stringifyJsonField(entry.relatedWords),
        stringifyJsonField(entry.exampleVerses),
        entry.contentFile ?? null,
        stringifyJsonField(entry.metadata)
      ]
    );

    entry.entryId = result.lastInsertRowId;
    return entry;
  }

  /**
   * Update an existing dictionary entry
   */
  updateEntry(entry: DictionaryEntry): DictionaryEntry {
    if (!entry.entryId) {
      throw new Error('Cannot update dictionary entry without ID');
    }

    this.sql.execute(
      `UPDATE dictionary_entry SET
        entry_key = ?, word = ?, transliteration = ?, pronunciation = ?, part_of_speech = ?,
        definition = ?, etymology = ?, usage_notes = ?, semantic_range = ?,
        related_words = ?, example_verses = ?, content_file = ?, metadata = ?
      WHERE entry_id = ?`,
      [
        entry.entryKey,
        entry.word ?? null,
        entry.transliteration ?? null,
        entry.pronunciation ?? null,
        entry.partOfSpeech ?? null,
        entry.definition,
        entry.etymology ?? null,
        entry.usageNotes ?? null,
        entry.semanticRange ?? null,
        stringifyJsonField(entry.relatedWords),
        stringifyJsonField(entry.exampleVerses),
        entry.contentFile ?? null,
        stringifyJsonField(entry.metadata),
        entry.entryId
      ]
    );

    return entry;
  }

  /**
   * Delete a dictionary entry
   */
  deleteEntry(entryId: number): boolean {
    const result = this.sql.execute(
      'DELETE FROM dictionary_entry WHERE entry_id = ?',
      [entryId]
    );
    return result.changes > 0;
  }

  // ========================================================================
  // Word Occurrence Operations (for concordances)
  // ========================================================================

  /**
   * Get all occurrences of a word (by entry key).
   *
   * These are SHIPPED concordance rows - a publisher's exhaustive list of the
   * verses in one named translation where this entry's word stands behind the
   * English - not a derived index. Two things follow.
   *
   * **It is usually the wrong source.** When a Bible module ships an
   * interlinear alignment, the same occurrences are already queryable from that
   * module's own `interlinear_word.strongs_number`, in the database that owns
   * the text, covering exactly the translations the user has installed. Prefer
   * that. This method is for concordance content that cannot be recomputed
   * because its translation ships no alignment. Nothing currently populates
   * `word_occurrence`: the shipped Strong's modules have zero rows.
   *
   * **The table is optional and this method throws when it is missing.** Most
   * dictionaries are not concordances and omit it entirely, in which case this
   * raises `no such table: word_occurrence`. That behaviour is asserted by
   * `DictionaryRepository.test.ts` and is deliberately left unchanged; callers
   * that may see such a module must guard accordingly.
   *
   * Returned rows may name Bible modules the user does not own -
   * `bible_module_uuid` is a soft reference across database files that nothing
   * enforces. Filter by installed module UUIDs before display.
   */
  getOccurrences(entryKey: string): WordOccurrence[] {
    const rows = this.sql.queryAll<WordOccurrenceRow>(
      'SELECT * FROM word_occurrence WHERE entry_key = ? ORDER BY verse_id',
      [entryKey]
    );

    return rows.map(row => this.mapRowToOccurrence(row));
  }

  /**
   * Get occurrences for a specific verse - which dictionary entries have a
   * word occurring here.
   *
   * Not the same question as "which entries cite this verse as an example":
   * that is `getVerseLinksForEntry`'s side of the model. Examples are editorial
   * selection, occurrences are exhaustive enumeration.
   *
   * Throws when the optional `word_occurrence` table is absent, and carries the
   * same caveats about preferring interlinear data and filtering by installed
   * modules - see {@link getOccurrences}.
   */
  getOccurrencesForVerse(verseId: VerseId): WordOccurrence[] {
    const rows = this.sql.queryAll<WordOccurrenceRow>(
      'SELECT * FROM word_occurrence WHERE verse_id = ?',
      [verseId]
    );

    return rows.map(row => this.mapRowToOccurrence(row));
  }

  // ========================================================================
  // Letter Index
  // ========================================================================

  getLetterIndex(): Array<{ letter: string; count: number }> {
    return this.sql.queryAll<{ letter: string; count: number }>(
      `SELECT UPPER(SUBSTR(entry_key, 1, 1)) AS letter, COUNT(*) AS count
       FROM dictionary_entry
       WHERE entry_key != '' AND entry_key NOT LIKE ' %'
       GROUP BY UPPER(SUBSTR(entry_key, 1, 1))
       ORDER BY letter`
    );
  }

  // ========================================================================
  // Browsing (pagination, navigation)
  // ========================================================================

  browseByLetter(letter: string | null, limit: number, offset: number): { entries: Array<{ entryKey: string; word: string }>; total: number } {
    let whereClause = "WHERE entry_key != '' AND entry_key NOT LIKE ' %'";
    const params: (string | number)[] = [];

    if (letter) {
      whereClause += ' AND UPPER(SUBSTR(entry_key, 1, 1)) = ?';
      params.push(letter.toUpperCase());
    }

    const countRow = this.sql.queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM dictionary_entry ${whereClause}`,
      params
    );
    const total = countRow?.total ?? 0;

    const entries = this.sql.queryAll<{ entry_key: string; word: string }>(
      `SELECT entry_key, word FROM dictionary_entry ${whereClause} ORDER BY entry_key LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ).map(row => ({ entryKey: row.entry_key, word: row.word }));

    return { entries, total };
  }

  getAdjacentEntries(entryKey: string): { prev: { entryKey: string; word: string } | null; next: { entryKey: string; word: string } | null } {
    const prevRow = this.sql.queryOne<{ entry_key: string; word: string }>(
      `SELECT entry_key, word FROM dictionary_entry WHERE entry_key < ? AND entry_key != '' AND entry_key NOT LIKE ' %' ORDER BY entry_key DESC LIMIT 1`,
      [entryKey]
    );
    const nextRow = this.sql.queryOne<{ entry_key: string; word: string }>(
      `SELECT entry_key, word FROM dictionary_entry WHERE entry_key > ? ORDER BY entry_key ASC LIMIT 1`,
      [entryKey]
    );

    return {
      prev: prevRow ? { entryKey: prevRow.entry_key, word: prevRow.word } : null,
      next: nextRow ? { entryKey: nextRow.entry_key, word: nextRow.word } : null,
    };
  }

  getEntryCount(): number {
    const row = this.sql.queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM dictionary_entry WHERE entry_key != '' AND entry_key NOT LIKE ' %'`
    );
    return row?.count ?? 0;
  }

  // ========================================================================
  // Private Mapping Methods
  // ========================================================================

  protected mapRowToModuleInfo(row: ModuleInfoRow): DictionaryModuleInfo {
    return new DictionaryModuleInfo({
      ...mapModuleIdentity(row),
      infoId: row.info_id,
      abbreviation: row.abbreviation,
      fullName: row.full_name,
      dictionaryType: row.dictionary_type as DictionaryType,
      languageFrom: row.language_from,
      languageTo: row.language_to,
      author: row.author,
      yearPublished: row.year_published,
      copyright: row.copyright,
      description: row.description,
      version: row.version,
      createdDate: row.created_date,
      metadata: parseJsonField(row.metadata),
    });
  }

  private mapRowToEntry(row: DictionaryEntryRow): DictionaryEntry {
    return new DictionaryEntry({
      entryId: row.entry_id,
      entryKey: row.entry_key,
      word: row.word,
      transliteration: row.transliteration,
      pronunciation: row.pronunciation,
      partOfSpeech: row.part_of_speech,
      definition: row.definition ?? '',
      etymology: row.etymology,
      usageNotes: row.usage_notes,
      semanticRange: row.semantic_range,
      relatedWords: parseJsonField<string[]>(row.related_words) ?? [],
      exampleVerses: parseJsonField<ExampleVerse[]>(row.example_verses) ?? [],
      contentFile: row.content_file,
      metadata: parseJsonField(row.metadata)
    });
  }

  /**
   * Map a `word_occurrence` row.
   *
   * the source Bible is identified by `module_uuid`. For compatibility,
   * shipped modules carry `bible_module`, a bare abbreviation used as a soft
   * cross-database reference; it is surfaced on the deprecated
   * {@link WordOccurrence.bibleModule} property.
   */
  private mapRowToOccurrence(row: WordOccurrenceRow): WordOccurrence {
    const uuid = row.bible_module_uuid ?? row.module_uuid;
    return new WordOccurrence({
      occurrenceId: row.occurrence_id,
      entryKey: row.entry_key,
      verseId: row.verse_id,
      moduleUuid: uuid,
      // The deprecated `bibleModule` field is kept populated - it is read by
      // `@bible/desktop` and `@bible/web` IPC handlers. It
      // resolves from the UUID so those consumers still get a value.
      bibleModule: row.bible_module ?? uuid,
      translationWord: row.translation_word,
      metadata: parseJsonField(row.metadata)
    });
  }

  /**
   * Populate the deprecated `exampleVerses` field from `verse_link`.
   *
   * Batched so a list query stays a single extra round trip rather than N.
   * This stays until `DictionaryEntry.exampleVerses` is retired in favour of
   * {@link getVerseLinksForEntry}.
   */
  private hydrateExampleVerses(entries: DictionaryEntry[]): DictionaryEntry[] {
    if (entries.length === 0) return entries;

    const ids = entries.map(e => e.entryId).filter((id): id is number => id !== undefined);
    if (ids.length === 0) return entries;

    const byEntry = this.verseLinks.getForSources('dictionary_entry', ids);
    for (const entry of entries) {
      const links = entry.entryId !== undefined ? byEntry.get(entry.entryId) : undefined;
      entry.exampleVerses = (links ?? []).map(link => ({
        verseId: link.verseIdStart,
        text: link.context
      }));
    }
    return entries;
  }
}
