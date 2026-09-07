import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BibleTextService, EnrichedVerse, PassageData } from './BibleTextService';
import { ITemplateEngine } from './ITemplateEngine';
import { TemplateEngineType, TemplateView } from './TemplateTypes';
import { BibleVerse } from '../Data/Models/Bible/BibleVerse';
import { Book, VerseIdHelper } from '../Data/Core/Types';

// Mock BibleVerse for testing
const createMockVerse = (book: number, chapter: number, verse: number, text: string): BibleVerse => {
  const verseId = VerseIdHelper.calculate(book, chapter, verse);

  // Construct the real class rather than casting a literal that reimplements
  // its methods: `BibleVerse` derives most of these from `formattingData`, and
  // a hand-written `isPoetry: () => false` cannot go wrong the way the real one
  // can. `isParagraphStart` and the section heading come from `formatting`.
  return new BibleVerse({
    verseId,
    text,
    formattingData: {
      wordsOfChrist: [{ start: 10, end: 20 }],
      addedWords: [],
      footnotes: [],
      crossReferences: [],
      paragraphStart: verse === 1,
      sectionHeading: verse === 1 ? 'Chapter Heading' : undefined,
    },
  });
};

// Mock Template Engine
class MockTemplateEngine implements ITemplateEngine {
  validateTemplate = vi.fn().mockReturnValue(true);
  render = vi.fn().mockResolvedValue('<div>Rendered HTML</div>');
  // `registerFilter` is part of `ITemplateEngine`; leaving it off meant this
  // class did not implement the interface it declared.
  registerFilter = vi.fn();
}

describe('BibleTextService', () => {
  let service: BibleTextService;
  let mockLiquidEngine: MockTemplateEngine;
  let mockHandlebarsEngine: MockTemplateEngine;

  beforeEach(() => {
    mockLiquidEngine = new MockTemplateEngine();
    mockHandlebarsEngine = new MockTemplateEngine();

    const engines = new Map<TemplateEngineType, ITemplateEngine>([
      [TemplateEngineType.Liquid, mockLiquidEngine],
      [TemplateEngineType.Handlebars, mockHandlebarsEngine]
    ]);

    service = new BibleTextService(engines);
  });

  describe('Constructor and Engine Management', () => {
    it('should create service with registered engines', () => {
      expect(service).toBeDefined();
      expect(service.hasEngine(TemplateEngineType.Liquid)).toBe(true);
      expect(service.hasEngine(TemplateEngineType.Handlebars)).toBe(true);
    });

    it('should return registered engine types', () => {
      const engines = service.getRegisteredEngines();
      expect(engines).toHaveLength(2);
      expect(engines).toContain(TemplateEngineType.Liquid);
      expect(engines).toContain(TemplateEngineType.Handlebars);
    });

    it('should check if engine exists', () => {
      expect(service.hasEngine(TemplateEngineType.Liquid)).toBe(true);
      expect(service.hasEngine(TemplateEngineType.Handlebars)).toBe(true);
    });
  });

  describe('enrichVerse', () => {
    it('should enrich a verse with book and module information', () => {
      const verse = createMockVerse(43, 3, 16, 'For God so loved the world...');

      const enriched = BibleTextService.enrichVerse(
        verse,
        'John',
        'Jn',
        'King James Version',
        'KJV'
      );

      expect(enriched.verseId).toBe(43003016);
      expect(enriched.verseNumber).toBe(16);
      expect(enriched.chapterNumber).toBe(3);
      expect(enriched.bookNumber).toBe(43);
      expect(enriched.bookName).toBe('John');
      expect(enriched.bookAbbreviation).toBe('Jn');
      expect(enriched.text).toBe('For God so loved the world...');
      expect(enriched.textPlain).toBe('For God so loved the world...');
      expect(enriched.isParagraphStart).toBe(false);
      expect(enriched.hasWordsOfChrist).toBe(true);
      expect(enriched.moduleName).toBe('King James Version');
      expect(enriched.moduleAbbreviation).toBe('KJV');
    });

    it('should enrich verse with formatting data', () => {
      const verse = createMockVerse(43, 3, 16, '<w>For God</w> so loved the world...');

      const enriched = BibleTextService.enrichVerse(verse, 'John', 'Jn');

      expect(enriched.formattingData).toBeDefined();
      expect(enriched.formattingData?.wordsOfChrist).toHaveLength(1);
      expect(enriched.formattingData?.wordsOfChrist?.[0]).toEqual({ start: 10, end: 20 });
    });

    it('should enrich verse that is paragraph start', () => {
      const verse = createMockVerse(43, 3, 1, 'There was a man of the Pharisees...');

      const enriched = BibleTextService.enrichVerse(verse, 'John', 'Jn');

      expect(enriched.isParagraphStart).toBe(true);
      expect(enriched.sectionHeading).toBe('Chapter Heading');
    });

    it('should work with Book enum', () => {
      const verse = createMockVerse(Book.Romans, 8, 28, 'And we know that all things...');

      const enriched = BibleTextService.enrichVerse(verse, 'Romans', 'Rom');

      expect(enriched.bookNumber).toBe(45);
      expect(enriched.chapterNumber).toBe(8);
      expect(enriched.verseNumber).toBe(28);
    });

    it('should handle verses without module information', () => {
      const verse = createMockVerse(1, 1, 1, 'In the beginning God created...');

      const enriched = BibleTextService.enrichVerse(verse, 'Genesis', 'Gen');

      expect(enriched.moduleName).toBeUndefined();
      expect(enriched.moduleAbbreviation).toBeUndefined();
    });
  });

  describe('formatReference', () => {
    it('should format single verse reference', () => {
      const ref = BibleTextService.formatReference('John', 3, 16);
      expect(ref).toBe('John 3:16');
    });

    it('should format single verse with same start and end', () => {
      const ref = BibleTextService.formatReference('John', 3, 16, 3, 16);
      expect(ref).toBe('John 3:16');
    });

    it('should format verse range in same chapter', () => {
      const ref = BibleTextService.formatReference('Romans', 8, 28, 8, 30);
      expect(ref).toBe('Romans 8:28-30');
    });

    it('should format verse range across chapters', () => {
      const ref = BibleTextService.formatReference('John', 3, 16, 4, 5);
      expect(ref).toBe('John 3:16-4:5');
    });

    it('should format entire chapter (verse 1 only)', () => {
      const ref = BibleTextService.formatReference('Psalm', 23, 1);
      expect(ref).toBe('Psalm 23:1');
    });

    it('should handle Genesis 1:1', () => {
      const ref = BibleTextService.formatReference('Genesis', 1, 1);
      expect(ref).toBe('Genesis 1:1');
    });

    it('should handle Revelation 22:21', () => {
      const ref = BibleTextService.formatReference('Revelation', 22, 21);
      expect(ref).toBe('Revelation 22:21');
    });
  });

  describe('validateTemplate', () => {
    it('should validate template using registered engine', () => {
      const templateView: TemplateView = {
        engine: TemplateEngineType.Liquid,
        template: '{{ verse.text }}'
      };

      const isValid = service.validateTemplate(templateView);

      expect(isValid).toBe(true);
      expect(mockLiquidEngine.validateTemplate).toHaveBeenCalledWith('{{ verse.text }}');
    });

    it('should return false for unregistered engine', () => {
      const templateView: TemplateView = {
        engine: 'UnknownEngine' as TemplateEngineType,
        template: '{{ verse.text }}'
      };

      const isValid = service.validateTemplate(templateView);

      expect(isValid).toBe(false);
    });

    it('should return false for invalid template syntax', () => {
      mockHandlebarsEngine.validateTemplate.mockReturnValue(false);

      const templateView: TemplateView = {
        engine: TemplateEngineType.Handlebars,
        template: '{{# unclosed tag'
      };

      const isValid = service.validateTemplate(templateView);

      expect(isValid).toBe(false);
    });
  });

  describe('renderPassage', () => {
    it('should render passage using specified template engine', async () => {
      const verses: EnrichedVerse[] = [
        {
          verseId: 43003016,
          verseNumber: 16,
          chapterNumber: 3,
          bookNumber: 43,
          bookName: 'John',
          bookAbbreviation: 'Jn',
          text: 'For God so loved the world...',
          textPlain: 'For God so loved the world...',
          isParagraphStart: false,
          isPoetry: false,
          poetryIndent: 0,
          hasWordsOfChrist: true
        }
      ];

      const passageData: PassageData = {
        verses,
        reference: 'John 3:16',
        startVerseId: 43003016,
        endVerseId: 43003016,
        moduleName: 'King James Version',
        moduleAbbreviation: 'KJV',
        displayMode: 'standard'
      };

      const templateView: TemplateView = {
        engine: TemplateEngineType.Liquid,
        template: '<div>{{ passage.reference }}</div>'
      };

      const html = await service.renderPassage(templateView, passageData);

      expect(html).toBe('<div>Rendered HTML</div>');
      expect(mockLiquidEngine.render).toHaveBeenCalled();

      // Check that template data was passed correctly
      const renderCall = mockLiquidEngine.render.mock.calls[0];
      expect(renderCall[0]).toBe('<div>{{ passage.reference }}</div>');
      expect(renderCall[1]).toMatchObject({
        passage: passageData,
        verses: verses,
        reference: 'John 3:16',
        moduleName: 'King James Version',
        moduleAbbreviation: 'KJV',
        displayMode: 'standard',
        showVerseNumbers: true,
        showSectionHeadings: true,
        showFootnotes: true,
        showCrossReferences: false
      });
    });

    it('should throw error if template engine not registered', async () => {
      const passageData: PassageData = {
        verses: [],
        reference: 'John 3:16',
        startVerseId: 43003016,
        endVerseId: 43003016,
        moduleName: 'KJV',
        moduleAbbreviation: 'KJV'
      };

      const templateView: TemplateView = {
        engine: 'UnknownEngine' as TemplateEngineType,
        template: 'test'
      };

      await expect(
        service.renderPassage(templateView, passageData)
      ).rejects.toThrow("Template engine 'UnknownEngine' not registered");
    });

    it('should throw error if template is invalid', async () => {
      mockLiquidEngine.validateTemplate.mockReturnValue(false);

      const passageData: PassageData = {
        verses: [],
        reference: 'John 3:16',
        startVerseId: 43003016,
        endVerseId: 43003016,
        moduleName: 'KJV',
        moduleAbbreviation: 'KJV'
      };

      const templateView: TemplateView = {
        engine: TemplateEngineType.Liquid,
        template: '{{# invalid'
      };

      await expect(
        service.renderPassage(templateView, passageData)
      ).rejects.toThrow('Invalid template syntax');
    });

    it('should use default display options when not specified', async () => {
      const passageData: PassageData = {
        verses: [],
        reference: 'John 3:16',
        startVerseId: 43003016,
        endVerseId: 43003016,
        moduleName: 'KJV',
        moduleAbbreviation: 'KJV'
        // No display options specified
      };

      const templateView: TemplateView = {
        engine: TemplateEngineType.Handlebars,
        template: '<div>{{reference}}</div>'
      };

      await service.renderPassage(templateView, passageData);

      const renderCall = mockHandlebarsEngine.render.mock.calls[0];
      expect(renderCall[1].displayMode).toBe('standard');
      expect(renderCall[1].showVerseNumbers).toBe(true);
      expect(renderCall[1].showSectionHeadings).toBe(true);
      expect(renderCall[1].showFootnotes).toBe(true);
      expect(renderCall[1].showCrossReferences).toBe(false);
    });

    it('should pass custom display options to template', async () => {
      const passageData: PassageData = {
        verses: [],
        reference: 'John 3:16',
        startVerseId: 43003016,
        endVerseId: 43003016,
        moduleName: 'KJV',
        moduleAbbreviation: 'KJV',
        displayMode: 'simple',
        showVerseNumbers: false,
        showSectionHeadings: false,
        showFootnotes: false,
        showCrossReferences: true
      };

      const templateView: TemplateView = {
        engine: TemplateEngineType.Liquid,
        template: '<div>test</div>'
      };

      await service.renderPassage(templateView, passageData);

      const renderCall = mockLiquidEngine.render.mock.calls[0];
      expect(renderCall[1].displayMode).toBe('simple');
      expect(renderCall[1].showVerseNumbers).toBe(false);
      expect(renderCall[1].showSectionHeadings).toBe(false);
      expect(renderCall[1].showFootnotes).toBe(false);
      expect(renderCall[1].showCrossReferences).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    it('should work with complete workflow: enrich -> render', async () => {
      // Create mock verse
      const verse = createMockVerse(43, 3, 16, 'For God so loved the world...');

      // Enrich it
      const enriched = BibleTextService.enrichVerse(
        verse,
        'John',
        'Jn',
        'King James Version',
        'KJV'
      );

      // Create passage data
      const passageData: PassageData = {
        verses: [enriched],
        reference: BibleTextService.formatReference('John', 3, 16),
        startVerseId: enriched.verseId,
        endVerseId: enriched.verseId,
        moduleName: 'King James Version',
        moduleAbbreviation: 'KJV',
        displayMode: 'standard'
      };

      // Render it
      const templateView: TemplateView = {
        engine: TemplateEngineType.Liquid,
        template: '<div>{{ passage.reference }}: {{ verses[0].text }}</div>'
      };

      const html = await service.renderPassage(templateView, passageData);

      expect(html).toBe('<div>Rendered HTML</div>');
      expect(mockLiquidEngine.render).toHaveBeenCalled();
    });

    it('should handle multiple verses in passage', async () => {
      const verses = [
        createMockVerse(45, 8, 28, 'And we know that all things...'),
        createMockVerse(45, 8, 29, 'For whom he did foreknow...'),
        createMockVerse(45, 8, 30, 'Moreover whom he did predestinate...')
      ];

      const enrichedVerses = verses.map(v =>
        BibleTextService.enrichVerse(v, 'Romans', 'Rom', 'KJV', 'KJV')
      );

      const passageData: PassageData = {
        verses: enrichedVerses,
        reference: BibleTextService.formatReference('Romans', 8, 28, 8, 30),
        startVerseId: enrichedVerses[0].verseId,
        endVerseId: enrichedVerses[enrichedVerses.length - 1].verseId,
        moduleName: 'King James Version',
        moduleAbbreviation: 'KJV'
      };

      expect(passageData.reference).toBe('Romans 8:28-30');
      expect(passageData.verses).toHaveLength(3);

      const templateView: TemplateView = {
        engine: TemplateEngineType.Handlebars,
        template: '<div>{{#each verses}}<p>{{text}}</p>{{/each}}</div>'
      };

      await service.renderPassage(templateView, passageData);

      expect(mockHandlebarsEngine.render).toHaveBeenCalled();
    });
  });
});
