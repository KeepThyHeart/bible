import { VerseId, Metadata } from '../../Core/Types';

/**
 * Dictionary entry entity from a dictionary module database.
 *
 * Nearly every field is optional because the module type spans three kinds of
 * work: an original-language lexicon (Strong's - `word` is Greek or Hebrew), a
 * Bible dictionary (ISBE - `word` is an English topic), and a general-language
 * dictionary (Webster's 1828 - `word` is an English headword and the entry may
 * not mention Scripture at all). Webster's, as shipped, populates only
 * `entryKey`, `word` and `definition`.
 *
 * `definition` is the only field guaranteed present. Consult
 * `DictionaryModuleInfo.dictionaryType` before treating `word` as
 * original-language text or expecting a transliteration.
 */
export class DictionaryEntry {
  entryId?: number;
  entryKey: string;
  word?: string;
  transliteration?: string;
  pronunciation?: string;
  partOfSpeech?: string;
  definition: string;
  etymology?: string;
  usageNotes?: string;
  semanticRange?: string;
  relatedWords: string[];
  /**
   * Illustrative verses cited by this entry.
   *
   * @deprecated Use `IDictionaryRepository.getVerseLinksForEntry()` (or
   * `getExampleVerses()` for a version-agnostic read). The JSON
   * There is no `example_verses` column - these are
   * `verse_link` rows there - but the repository keeps this field populated so
   * consumers outside `@bible/core` (desktop/web dictionary IPC handlers)
   * compile and behave unchanged.
   */
  exampleVerses: ExampleVerse[];
  contentFile?: string;
  metadata?: Metadata;

  constructor(data: {
    entryId?: number;
    entryKey: string;
    word?: string;
    transliteration?: string;
    pronunciation?: string;
    partOfSpeech?: string;
    definition: string;
    etymology?: string;
    usageNotes?: string;
    semanticRange?: string;
    relatedWords?: string[];
    exampleVerses?: ExampleVerse[];
    contentFile?: string;
    metadata?: Metadata;
  }) {
    this.entryId = data.entryId;
    this.entryKey = data.entryKey;
    this.word = data.word;
    this.transliteration = data.transliteration;
    this.pronunciation = data.pronunciation;
    this.partOfSpeech = data.partOfSpeech;
    this.definition = data.definition;
    this.etymology = data.etymology;
    this.usageNotes = data.usageNotes;
    this.semanticRange = data.semanticRange;
    this.relatedWords = data.relatedWords ?? [];
    this.exampleVerses = data.exampleVerses ?? [];
    this.contentFile = data.contentFile;
    this.metadata = data.metadata;
  }

  /**
   * Check if this is a Strong's number entry.
   *
   * Tests the shape of `entryKey` ("G25", "H430"), not the module's declared
   * type. A general dictionary keyed by English headwords will always answer
   * false, which is the useful behaviour; but a lexicon keyed by some other
   * scheme will too, so this is a rendering hint, not a classification. Use
   * `DictionaryModuleInfo.dictionaryType` when you need the latter.
   */
  isStrongsEntry(): boolean {
    return this.entryKey.match(/^[HG]\d+$/) !== null;
  }

  /**
   * Get the language for Strong's entries.
   *
   * Derived purely from the entry key's leading letter, so it returns null for
   * every non-Strong's dictionary - including a Greek or Hebrew lexicon that
   * happens to use its own numbering.
   */
  getStrongsLanguage(): 'Hebrew' | 'Greek' | null {
    if (this.entryKey.startsWith('H')) return 'Hebrew';
    if (this.entryKey.startsWith('G')) return 'Greek';
    return null;
  }

  /**
   * Add a related word
   */
  addRelatedWord(entryKey: string): void {
    if (!this.relatedWords.includes(entryKey)) {
      this.relatedWords.push(entryKey);
    }
  }

  /**
   * Add an example verse
   */
  addExampleVerse(verse: ExampleVerse): void {
    this.exampleVerses.push(verse);
  }

  /**
   * Get definition excerpt.
   *
   * Strips HTML first because `definition` may be markup or plain text
   * depending on the source work, and `maxLength` should count visible
   * characters either way.
   */
  getDefinitionExcerpt(maxLength: number = 100): string {
    const plainText = this.definition.replace(/<[^>]*>/g, ''); // Strip HTML
    return plainText.length > maxLength
      ? plainText.substring(0, maxLength) + '...'
      : plainText;
  }
}

/**
 * A verse an entry CITES AS AN EXAMPLE - editorial selection by the entry's
 * author, typically a handful per entry.
 *
 * Distinct from {@link WordOccurrence}, which is the exhaustive enumeration of
 * every verse where a word occurs in a given translation. Different questions;
 * not interchangeable.
 */
export interface ExampleVerse {
  verseId: VerseId;
  text?: string;
}

/**
 * One verse where an entry's word occurs in a specific translation - a row of
 * exhaustive-concordance data authored by the module's publisher.
 *
 * Not a search result and not derived at runtime. Where a Bible module ships an
 * interlinear alignment, prefer querying that module's own
 * `interlinear_word.strongs_number`: it covers exactly the translations the
 * user has installed and stays correct when a translation is revised. These
 * rows exist for concordances whose verse lists cannot be recomputed.
 *
 * Contrast {@link ExampleVerse} (a few illustrative citations) and
 * `interlinear_word.gloss` (a context-free equivalent). {@link translationWord}
 * here is how this one verse rendered the word.
 *
 * the Bible a word was counted in is identified by {@link moduleUuid} - a
 * stable cross-database key. The deprecated {@link bibleModule} carries a
 * bare abbreviation, which is unstable (abbreviations collide and change between
 * releases). Use {@link getModuleReference} to read whichever is available.
 */
export class WordOccurrence {
  occurrenceId?: number;
  entryKey: string;
  verseId: VerseId;
  /** v2: stable identity of the source Bible module. */
  moduleUuid?: string;
  /**
   * Reference to the source Bible module.
   *
   * @deprecated Use {@link moduleUuid} (or {@link getModuleReference}).
   * `word_occurrence` stores
   * `bible_module_uuid`. The repository keeps this field populated - resolving
   * it from the UUID - so the desktop and web dictionary IPC
   * handlers compile and behave unchanged.
   * read `moduleUuid`.
   */
  bibleModule?: string;
  translationWord?: string;
  metadata?: Metadata;

  constructor(data: {
    occurrenceId?: number;
    entryKey: string;
    verseId: VerseId;
    moduleUuid?: string;
    bibleModule?: string;
    translationWord?: string;
    metadata?: Metadata;
  }) {
    this.occurrenceId = data.occurrenceId;
    this.entryKey = data.entryKey;
    this.verseId = data.verseId;
    this.moduleUuid = data.moduleUuid;
    this.bibleModule = data.bibleModule;
    this.translationWord = data.translationWord;
    this.metadata = data.metadata;
  }

  /**
   * The reference to the source Bible module: the UUID when present, otherwise
   * the legacy abbreviation. Callers that need to know which they got should
   * check {@link moduleUuid} directly.
   */
  getModuleReference(): string | undefined {
    return this.moduleUuid ?? this.bibleModule;
  }
}
