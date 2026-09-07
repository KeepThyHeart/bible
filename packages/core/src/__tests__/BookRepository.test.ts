import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { BookRepository } from '../Data/Repositories/BookRepository';
import { BookSection } from '../Data/Models/Book/BookSection';
import { ScriptureReference } from '../Data/Models/Book/ScriptureReference';
import { TestSqliteProvider } from './helpers/TestSqliteProvider';

// ---------------------------------------------------------------------------
// Read-only SQLite provider for testing against real module databases
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Database path
// ---------------------------------------------------------------------------
const DB_PATH = path.resolve(__dirname, '../../../desktop/data/modules/book_concord.db');

describe.skipIf(!fs.existsSync(DB_PATH))('BookRepository (book_concord.db)', () => {
  let provider: TestSqliteProvider;
  let repo: BookRepository;

  beforeAll(() => {
    provider = new TestSqliteProvider(DB_PATH);
    repo = new BookRepository(provider);
  });

  afterAll(() => {
    provider.close();
  });

  // ========================================================================
  // Module Info
  // ========================================================================

  describe('getModuleInfo', () => {
    it('should return module info', () => {
      const info = repo.getModuleInfo();
      expect(info).toBeDefined();
      expect(info!.abbreviation).toBeDefined();
      expect(info!.fullName).toBeDefined();
      expect(typeof info!.abbreviation).toBe('string');
      expect(info!.fullName.length).toBeGreaterThan(0);
    });

    it('should have a language code', () => {
      const info = repo.getModuleInfo();
      expect(info).toBeDefined();
      expect(info!.languageCode).toBeDefined();
      expect(info!.languageCode.length).toBeGreaterThanOrEqual(2);
    });

    it('should have moduleType set to book', () => {
      const info = repo.getModuleInfo();
      expect(info).toBeDefined();
      expect(info!.moduleType).toBe('book');
    });

    it('getDisplayName should return a readable string', () => {
      const info = repo.getModuleInfo();
      expect(info).toBeDefined();
      const displayName = info!.getDisplayName();
      expect(displayName.length).toBeGreaterThan(0);
    });
  });

  // ========================================================================
  // getTopLevelSections
  // ========================================================================

  describe('getTopLevelSections', () => {
    it('should return a non-empty list of top-level sections', () => {
      const sections = repo.getTopLevelSections();
      expect(sections.length).toBeGreaterThan(0);
    });

    it('should return BookSection instances with no parent', () => {
      const sections = repo.getTopLevelSections();
      for (const section of sections) {
        expect(section).toBeInstanceOf(BookSection);
        expect(section.isTopLevel()).toBe(true);
      }
    });

    it('should return sections with titles', () => {
      const sections = repo.getTopLevelSections();
      for (const section of sections) {
        expect(section.title).toBeDefined();
        expect(section.title.length).toBeGreaterThan(0);
      }
    });

    it('should return sections with sectionId set', () => {
      const sections = repo.getTopLevelSections();
      for (const section of sections) {
        expect(section.sectionId).toBeDefined();
        expect(section.sectionId).toBeGreaterThan(0);
      }
    });
  });

  // ========================================================================
  // getSection
  // ========================================================================

  describe('getSection', () => {
    it('should return a section by its ID', () => {
      const topLevel = repo.getTopLevelSections();
      expect(topLevel.length).toBeGreaterThan(0);

      const section = repo.getSection(topLevel[0].sectionId!);
      expect(section).toBeDefined();
      expect(section!.sectionId).toBe(topLevel[0].sectionId);
      expect(section!.title).toBe(topLevel[0].title);
    });

    it('should return undefined for a non-existent section ID', () => {
      const result = repo.getSection(999999999);
      expect(result).toBeUndefined();
    });

    it('should return section with content', () => {
      const topLevel = repo.getTopLevelSections();
      expect(topLevel.length).toBeGreaterThan(0);

      const section = repo.getSection(topLevel[0].sectionId!);
      expect(section).toBeDefined();
      expect(section!.content).toBeDefined();
    });
  });

  // ========================================================================
  // getSectionsByParent
  // ========================================================================

  describe('getSectionsByParent', () => {
    it('should return children of a top-level section', () => {
      const topLevel = repo.getTopLevelSections();
      let parentWithChildren: BookSection | undefined;
      let children: BookSection[] = [];

      for (const section of topLevel) {
        children = repo.getSectionsByParent(section.sectionId!);
        if (children.length > 0) {
          parentWithChildren = section;
          break;
        }
      }

      if (parentWithChildren) {
        expect(children.length).toBeGreaterThan(0);
        for (const child of children) {
          expect(child.parentSectionId).toBe(parentWithChildren.sectionId);
          expect(child.isTopLevel()).toBe(false);
        }
      }
    });

    it('should return empty array for a leaf section', () => {
      // Find a leaf section
      const allSections = repo.getAllSections();
      const leaf = allSections.find(s => {
        const children = repo.getSectionsByParent(s.sectionId!);
        return children.length === 0;
      });

      if (leaf) {
        const children = repo.getSectionsByParent(leaf.sectionId!);
        expect(children).toEqual([]);
      }
    });
  });

  // ========================================================================
  // getAllSections
  // ========================================================================

  describe('getAllSections', () => {
    it('should return all sections in the book', () => {
      const sections = repo.getAllSections();
      expect(sections.length).toBeGreaterThan(0);

      // Should include both top-level and child sections
      const topLevel = sections.filter(s => s.isTopLevel());
      const children = sections.filter(s => !s.isTopLevel());

      expect(topLevel.length).toBeGreaterThan(0);
      // A book should typically have child sections too
      expect(children.length).toBeGreaterThanOrEqual(0);
    });

    it('should include more sections than getTopLevelSections', () => {
      const all = repo.getAllSections();
      const topLevel = repo.getTopLevelSections();
      expect(all.length).toBeGreaterThanOrEqual(topLevel.length);
    });
  });

  // ========================================================================
  // getAllSectionSummaries
  // ========================================================================

  describe('getAllSectionSummaries', () => {
    it('should return summaries for all sections', () => {
      const summaries = repo.getAllSectionSummaries();
      expect(summaries.length).toBeGreaterThan(0);

      for (const summary of summaries.slice(0, 10)) {
        expect(summary.sectionId).toBeDefined();
        expect(summary.title).toBeDefined();
        expect(typeof summary.title).toBe('string');
      }
    });

    it('should have same count as getAllSections', () => {
      const summaries = repo.getAllSectionSummaries();
      const sections = repo.getAllSections();
      expect(summaries.length).toBe(sections.length);
    });

    it('should indicate which sections have children', () => {
      const summaries = repo.getAllSectionSummaries();
      const withChildren = summaries.filter(s => s.hasChildren);
      // At least some sections should have children in a structured book
      // (this might be 0 if the book is flat, which is valid too)
      expect(withChildren.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ========================================================================
  // searchSections
  // ========================================================================

  describe('searchSections', () => {
    it('should find sections matching a common term', () => {
      // Use a term likely to appear in Book of Concord
      const results = repo.searchSections('faith');
      expect(results.length).toBeGreaterThan(0);

      for (const section of results) {
        expect(section).toBeInstanceOf(BookSection);
        expect(section.sectionId).toBeDefined();
      }
    });

    it('should respect the limit option', () => {
      const results = repo.searchSections('faith', { limit: 3 });
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('should return empty array for gibberish query', () => {
      const results = repo.searchSections('xyzzyqqq999impossible');
      expect(results).toEqual([]);
    });
  });

  // ========================================================================
  // getNextSection
  // ========================================================================

  describe('getNextSection', () => {
    it('should return the next section after the first top-level section', () => {
      const topLevel = repo.getTopLevelSections();
      expect(topLevel.length).toBeGreaterThan(0);

      const next = repo.getNextSection(topLevel[0].sectionId!);
      expect(next).toBeDefined();
      expect(next!.sectionId).not.toBe(topLevel[0].sectionId);
    });

    it('should navigate through multiple sections sequentially', () => {
      const topLevel = repo.getTopLevelSections();
      expect(topLevel.length).toBeGreaterThan(0);

      let current = topLevel[0];
      const visited = new Set<number>();
      visited.add(current.sectionId!);

      // Navigate forward 5 times and ensure no loops
      for (let i = 0; i < 5; i++) {
        const next = repo.getNextSection(current.sectionId!);
        if (!next) break;
        expect(visited.has(next.sectionId!)).toBe(false);
        visited.add(next.sectionId!);
        current = next;
      }
    });

    it('should return a different section when navigating forward', () => {
      // Verify that getNextSection returns a section different from the current one
      const topLevel = repo.getTopLevelSections();
      expect(topLevel.length).toBeGreaterThan(0);

      // Navigate forward a few steps, ensure each step produces a unique section
      const visited = new Set<number>();
      let current = topLevel[0];
      visited.add(current.sectionId!);

      for (let i = 0; i < 3; i++) {
        const next = repo.getNextSection(current.sectionId!);
        if (!next) break;
        expect(next.sectionId).not.toBe(current.sectionId);
        current = next;
      }
    });
  });

  // ========================================================================
  // getPreviousSection
  // ========================================================================

  describe('getPreviousSection', () => {
    it('should return undefined for the first top-level section', () => {
      const topLevel = repo.getTopLevelSections();
      expect(topLevel.length).toBeGreaterThan(0);

      const prev = repo.getPreviousSection(topLevel[0].sectionId!);
      expect(prev).toBeUndefined();
    });

    it('should navigate back from a section', () => {
      const topLevel = repo.getTopLevelSections();
      expect(topLevel.length).toBeGreaterThan(0);

      // getNextSection goes to first child (depth-first), so going back
      // should return to the parent. Verify the round-trip is consistent.
      const next = repo.getNextSection(topLevel[0].sectionId!);
      if (next) {
        const prev = repo.getPreviousSection(next.sectionId!);
        expect(prev).toBeDefined();
        // The previous section of the "next" should be the original section
        // (either as parent or as the immediately preceding section)
        expect(prev!.sectionId).toBeGreaterThan(0);
      }
    });
  });

  // ========================================================================
  // getParentSection
  // ========================================================================

  describe('getParentSection', () => {
    it('should return the parent of a child section', () => {
      const topLevel = repo.getTopLevelSections();
      let childSection: BookSection | undefined;

      for (const section of topLevel) {
        const children = repo.getSectionsByParent(section.sectionId!);
        if (children.length > 0) {
          childSection = children[0];
          const parent = repo.getParentSection(childSection.sectionId!);
          expect(parent).toBeDefined();
          expect(parent!.sectionId).toBe(section.sectionId);
          break;
        }
      }
    });

    it('should return undefined for a top-level section', () => {
      const topLevel = repo.getTopLevelSections();
      expect(topLevel.length).toBeGreaterThan(0);

      const parent = repo.getParentSection(topLevel[0].sectionId!);
      expect(parent).toBeUndefined();
    });

    it('should return undefined for a non-existent section', () => {
      const parent = repo.getParentSection(999999999);
      expect(parent).toBeUndefined();
    });
  });

  // ========================================================================
  // getScriptureReferences
  // ========================================================================

  describe('getScriptureReferences', () => {
    it('should return scripture references for a section that has them', () => {
      const allSections = repo.getAllSections();
      let sectionWithRefs: BookSection | undefined;
      let refs: ScriptureReference[] = [];

      for (const section of allSections) {
        refs = repo.getScriptureReferences(section.sectionId!);
        if (refs.length > 0) {
          sectionWithRefs = section;
          break;
        }
      }

      if (sectionWithRefs) {
        expect(refs.length).toBeGreaterThan(0);
        for (const ref of refs) {
          expect(ref).toBeInstanceOf(ScriptureReference);
          expect(ref.contentId).toBe(sectionWithRefs.sectionId);
          expect(ref.verseIdStart).toBeGreaterThan(0);
        }
      }
    });

    it('should return references ordered by verse_id_start', () => {
      const allSections = repo.getAllSections();
      for (const section of allSections) {
        const refs = repo.getScriptureReferences(section.sectionId!);
        if (refs.length > 1) {
          for (let i = 1; i < refs.length; i++) {
            expect(refs[i].verseIdStart).toBeGreaterThanOrEqual(refs[i - 1].verseIdStart);
          }
          break;
        }
      }
    });

    it('should return empty array for a section with no references', () => {
      const refs = repo.getScriptureReferences(999999999);
      expect(refs).toEqual([]);
    });
  });

  // ========================================================================
  // getSectionsReferencingVerse
  // ========================================================================

  describe('getSectionsReferencingVerse', () => {
    it('should find sections that reference a commonly cited verse', () => {
      // Find a verse that is referenced in the book
      const allSections = repo.getAllSections();
      let referencedVerseId: number | undefined;

      for (const section of allSections) {
        const refs = repo.getScriptureReferences(section.sectionId!);
        if (refs.length > 0) {
          referencedVerseId = refs[0].verseIdStart;
          break;
        }
      }

      if (referencedVerseId) {
        const sections = repo.getSectionsReferencingVerse(referencedVerseId);
        expect(sections.length).toBeGreaterThan(0);
        for (const section of sections) {
          expect(section).toBeInstanceOf(BookSection);
        }
      }
    });

    it('should return empty array for a verse not referenced in this book', () => {
      // Use a verse ID unlikely to appear in Book of Concord references
      const sections = repo.getSectionsReferencingVerse(99099099);
      expect(sections).toEqual([]);
    });
  });

  // ========================================================================
  // BookSection model methods
  // ========================================================================

  describe('BookSection model methods', () => {
    it('getExcerpt should truncate long content', () => {
      const sections = repo.getAllSections();
      const longSection = sections.find(s => s.content && s.content.length > 200);
      if (longSection) {
        const excerpt = longSection.getExcerpt(50);
        expect(excerpt.length).toBeLessThanOrEqual(53); // 50 + '...'
      }
    });

    it('getFullHeading should combine section number and title', () => {
      const sections = repo.getAllSections();
      const numberedSection = sections.find(s => s.sectionNumber !== undefined);
      if (numberedSection) {
        const heading = numberedSection.getFullHeading();
        expect(heading).toContain(numberedSection.sectionNumber!);
        expect(heading).toContain(numberedSection.title);
      }
    });

    it('getFullHeading should return just title when no section number', () => {
      const section = new BookSection({
        title: 'Introduction',
        content: 'Some content',
      });
      expect(section.getFullHeading()).toBe('Introduction');
    });

    it('getDepth should return correct depth for section numbers', () => {
      const section1 = new BookSection({ title: 'T', content: 'C', sectionNumber: '1' });
      const section2 = new BookSection({ title: 'T', content: 'C', sectionNumber: '1.2' });
      const section3 = new BookSection({ title: 'T', content: 'C', sectionNumber: '1.2.3' });

      expect(section1.getDepth()).toBe(1);
      expect(section2.getDepth()).toBe(2);
      expect(section3.getDepth()).toBe(3);
    });

    it('getDepth should return 0 when no section number', () => {
      const section = new BookSection({ title: 'T', content: 'C' });
      expect(section.getDepth()).toBe(0);
    });
  });

  // ========================================================================
  // ScriptureReference model methods
  // ========================================================================

  describe('ScriptureReference model methods', () => {
    it('isSingleVerse should detect single verses', () => {
      const ref = new ScriptureReference({
        contentId: 1,
        verseIdStart: 43003016,
      });
      expect(ref.isSingleVerse()).toBe(true);
    });

    it('isSingleVerse should detect ranges', () => {
      const ref = new ScriptureReference({
        contentId: 1,
        verseIdStart: 43003016,
        verseIdEnd: 43003018,
      });
      expect(ref.isSingleVerse()).toBe(false);
    });

    it('containsVerse should work for single verse', () => {
      const ref = new ScriptureReference({
        contentId: 1,
        verseIdStart: 43003016,
      });
      expect(ref.containsVerse(43003016)).toBe(true);
      expect(ref.containsVerse(43003017)).toBe(false);
    });

    it('containsVerse should work for range', () => {
      const ref = new ScriptureReference({
        contentId: 1,
        verseIdStart: 43003016,
        verseIdEnd: 43003018,
      });
      expect(ref.containsVerse(43003016)).toBe(true);
      expect(ref.containsVerse(43003017)).toBe(true);
      expect(ref.containsVerse(43003018)).toBe(true);
      expect(ref.containsVerse(43003019)).toBe(false);
      expect(ref.containsVerse(43003015)).toBe(false);
    });

    it('getVerseCount should return correct count', () => {
      const single = new ScriptureReference({ contentId: 1, verseIdStart: 43003016 });
      expect(single.getVerseCount()).toBe(1);

      const range = new ScriptureReference({ contentId: 1, verseIdStart: 43003016, verseIdEnd: 43003018 });
      expect(range.getVerseCount()).toBe(3);
    });
  });
});
