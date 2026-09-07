import { ITemplateEngine } from './ITemplateEngine';
import { TemplateEngineType, TemplateView } from './TemplateTypes';
import { BibleVerse } from '../Data/Models/Bible/BibleVerse';
import { VerseIdHelper } from '../Data/Core/Types';

/**
 * A BibleVerse enriched with contextual data needed for template rendering.
 * The raw BibleVerse only contains verse_id and text; EnrichedVerse adds
 * human-readable identifiers (book name, abbreviation, module info) and
 * pre-computed formatting flags so templates don't need repository access.
 */
export interface EnrichedVerse {
  // Verse identification
  verseId: number;
  verseNumber: number;
  chapterNumber: number;
  bookNumber: number;
  bookName: string;
  bookAbbreviation: string;

  // Verse content
  text: string;
  textPlain: string;

  // Formatting metadata
  isParagraphStart: boolean;
  isPoetry: boolean;
  poetryIndent: number;
  hasWordsOfChrist: boolean;
  sectionHeading?: string;

  // Optional formatting details
  formattingData?: {
    wordsOfChrist?: Array<{ start: number; end: number }>;
    addedWords?: Array<{ start: number; end: number }>;
    footnotes?: Array<{ position: number; marker: string; text: string }>;
    crossReferences?: Array<{ position: number; marker: string; references: number[] }>;
  };

  // Module information
  moduleName?: string;
  moduleAbbreviation?: string;
}

/**
 * Passage data containing one or more verses with metadata.
 */
export interface PassageData {
  verses: EnrichedVerse[];

  // Passage context
  reference: string; // e.g., "John 3:16" or "Romans 8:28-30"
  startVerseId: number;
  endVerseId: number;

  // Module info
  moduleName: string;
  moduleAbbreviation: string;

  // Optional metadata
  displayMode?: 'simple' | 'standard' | 'study';
  showVerseNumbers?: boolean;
  showSectionHeadings?: boolean;
  showFootnotes?: boolean;
  showCrossReferences?: boolean;
}

/**
 * Service for rendering Bible passages using templates.
 *
 * This service accepts a TemplateView (template + engine selection) and passage data,
 * then uses the specified template engine to render HTML output. Multiple template
 * engines can be registered and selected per-render call.
 *
 * Controllers should:
 * 1. Fetch verse data from repositories
 * 2. Enrich verses with context using BibleTextService.enrichVerse()
 * 3. Create a TemplateView with the desired engine and template
 * 4. Call renderPassage() with the TemplateView and passage data
 *
 * @example
 * ```typescript
 * // Template engine implementations live in the platform package (e.g. @bible/desktop)
 * // import { LiquidTemplateEngine, HandlebarsTemplateEngine } from '@bible/desktop';
 *
 * // Create template engines (provide your own ITemplateEngine implementations)
 * const engines = new Map<TemplateEngineType, ITemplateEngine>();
 * // engines.set(TemplateEngineType.Liquid, new LiquidTemplateEngine());
 * // engines.set(TemplateEngineType.Handlebars, new HandlebarsTemplateEngine());
 *
 * const service = new BibleTextService(engines);
 *
 * // Controller fetches data and enriches it
 * const verses = bibleRepo.getChapterVerses(43, 3); // John 3
 * const enrichedVerses = verses.map(v =>
 *   BibleTextService.enrichVerse(v, "John", "Jn", "King James Version", "KJV")
 * );
 *
 * // Prepare passage data
 * const passageData: PassageData = {
 *   verses: enrichedVerses,
 *   reference: "John 3:1-21",
 *   startVerseId: enrichedVerses[0].verseId,
 *   endVerseId: enrichedVerses[enrichedVerses.length - 1].verseId,
 *   moduleName: "King James Version",
 *   moduleAbbreviation: "KJV",
 *   displayMode: "standard"
 * };
 *
 * // Create template view (specify engine + template)
 * const templateView: TemplateView = {
 *   engine: TemplateEngineType.Liquid,
 *   template: standardTemplate
 * };
 *
 * // Render using template view
 * const html = await service.renderPassage(templateView, passageData);
 * ```
 */
export class BibleTextService {
  private engines: Map<TemplateEngineType, ITemplateEngine>;

  /**
   * Creates a BibleTextService with a registry of template engines.
   *
   * @param engines - Map of template engine types to their implementations
   */
  constructor(engines: Map<TemplateEngineType, ITemplateEngine>) {
    this.engines = engines;
  }

  /**
   * Renders a Bible passage using the provided template view.
   *
   * @param templateView - The template view containing engine type and template string
   * @param passageData - The passage data with enriched verse information
   * @returns A promise that resolves to the rendered HTML
   * @throws Error if template engine not found or template rendering fails
   */
  async renderPassage(templateView: TemplateView, passageData: PassageData): Promise<string> {
    // Get the specified template engine
    const engine = this.engines.get(templateView.engine);
    if (!engine) {
      throw new Error(`Template engine '${templateView.engine}' not registered`);
    }

    // Validate template before rendering
    if (!engine.validateTemplate(templateView.template)) {
      throw new Error('Invalid template syntax');
    }

    // Prepare data for template engine
    const templateData = {
      passage: passageData,
      verses: passageData.verses,
      reference: passageData.reference,
      moduleName: passageData.moduleName,
      moduleAbbreviation: passageData.moduleAbbreviation,
      displayMode: passageData.displayMode ?? 'standard',
      showVerseNumbers: passageData.showVerseNumbers ?? true,
      showSectionHeadings: passageData.showSectionHeadings ?? true,
      showFootnotes: passageData.showFootnotes ?? true,
      showCrossReferences: passageData.showCrossReferences ?? false,
    };

    // Render using specified template engine
    return await engine.render(templateView.template, templateData);
  }

  /**
   * Creates enriched verse data from a BibleVerse model.
   * This helper combines verse data with book/chapter context.
   *
   * @param verse - The BibleVerse from the database
   * @param bookName - The full name of the book (e.g., "John")
   * @param bookAbbreviation - The abbreviation (e.g., "Jn")
   * @param moduleName - The module name (e.g., "King James Version")
   * @param moduleAbbreviation - The module abbreviation (e.g., "KJV")
   * @returns Enriched verse data ready for template rendering
   */
  static enrichVerse(
    verse: BibleVerse,
    bookName: string,
    bookAbbreviation: string,
    moduleName?: string,
    moduleAbbreviation?: string
  ): EnrichedVerse {
    const { bookNumber, chapter, verse: verseNum } = VerseIdHelper.parse(verse.verseId);

    return {
      // Identification
      verseId: verse.verseId,
      verseNumber: verseNum,
      chapterNumber: chapter,
      bookNumber,
      bookName,
      bookAbbreviation,

      // Content
      text: verse.text,
      textPlain: verse.getPlainText(),

      // Formatting flags
      isParagraphStart: verse.isParagraphStart(),
      isPoetry: verse.isPoetry(),
      poetryIndent: verse.getPoetryIndent(),
      hasWordsOfChrist: verse.hasWordsOfChrist(),
      sectionHeading: verse.getSectionHeading(),

      // Detailed formatting
      formattingData: verse.formattingData ? {
        wordsOfChrist: verse.formattingData.wordsOfChrist,
        addedWords: verse.formattingData.addedWords,
        footnotes: verse.formattingData.footnotes,
        crossReferences: verse.formattingData.crossReferences,
      } : undefined,

      // Module info
      moduleName,
      moduleAbbreviation,
    };
  }

  /**
   * Generates a standard reference string for a passage.
   *
   * @param bookName - The book name
   * @param startChapter - Starting chapter
   * @param startVerse - Starting verse
   * @param endChapter - Ending chapter (optional, if different from start)
   * @param endVerse - Ending verse (optional, for ranges)
   * @returns A formatted reference string
   */
  static formatReference(
    bookName: string,
    startChapter: number,
    startVerse: number,
    endChapter?: number,
    endVerse?: number
  ): string {
    if (!endVerse || (startChapter === endChapter && startVerse === endVerse)) {
      // Single verse: "John 3:16"
      return `${bookName} ${startChapter}:${startVerse}`;
    }

    if (endChapter && endChapter !== startChapter) {
      // Multi-chapter range: "John 3:16-4:5"
      return `${bookName} ${startChapter}:${startVerse}-${endChapter}:${endVerse}`;
    }

    // Single chapter range: "John 3:16-18"
    return `${bookName} ${startChapter}:${startVerse}-${endVerse}`;
  }

  /**
   * Validates that a template view is syntactically correct.
   *
   * @param templateView - The template view to validate
   * @returns true if the template is valid and engine is registered
   */
  validateTemplate(templateView: TemplateView): boolean {
    const engine = this.engines.get(templateView.engine);
    if (!engine) {
      return false;
    }
    return engine.validateTemplate(templateView.template);
  }

  /**
   * Checks if a template engine type is registered.
   *
   * @param engineType - The template engine type to check
   * @returns true if the engine is registered
   */
  hasEngine(engineType: TemplateEngineType): boolean {
    return this.engines.has(engineType);
  }

  /**
   * Gets the list of registered template engine types.
   *
   * @returns Array of registered engine types
   */
  getRegisteredEngines(): TemplateEngineType[] {
    return Array.from(this.engines.keys());
  }
}
