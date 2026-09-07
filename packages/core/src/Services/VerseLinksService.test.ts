import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VerseLinksService } from './VerseLinksService';
import { IModuleMetadataRepository } from '../Data/Repositories/IModuleMetadataRepository';
import { IUserNoteRepository } from '../Data/Repositories/IUserNoteRepository';
import { IUserCrossReferenceRepository } from '../Data/Repositories/IUserCrossReferenceRepository';
import { Book, VerseIdHelper } from '../Data/Core/Types';

describe('VerseLinksService', () => {
  let service: VerseLinksService;
  let moduleMetadataRepo: ReturnType<typeof createMockModuleMetadataRepo>;
  let userNoteRepo: ReturnType<typeof createMockUserNoteRepo>;
  let commentaryRepoProvider: ReturnType<typeof createMockRepositoryProvider>;
  let crossReferenceRepoProvider: ReturnType<typeof createMockRepositoryProvider>;
  let bookRepoProvider: ReturnType<typeof createMockRepositoryProvider>;
  let userCrossReferenceRepo: ReturnType<typeof createMockUserCrossReferenceRepo>;

  // ========================================================================
  // Mock Factory Functions
  // ========================================================================

  function createMockModuleMetadataRepo(): IModuleMetadataRepository & { getByType: ReturnType<typeof vi.fn> } {
    return {
      getByType: vi.fn(),
    } as any;
  }

  function createMockUserNoteRepo(): IUserNoteRepository & {
    getForVerse: ReturnType<typeof vi.fn>;
    getForVerseRange: ReturnType<typeof vi.fn>;
  } {
    return {
      getForVerse: vi.fn(),
      // getBatchVerseLinks reads a whole chapter in one query rather than one
      // per verse; default to empty so the single-verse tests are unaffected.
      getForVerseRange: vi.fn().mockReturnValue([]),
    } as any;
  }

  function createMockRepositoryProvider() {
    return vi.fn();
  }

  function createMockUserCrossReferenceRepo(): IUserCrossReferenceRepository & {
    getFromVerse: ReturnType<typeof vi.fn>;
    getFromVerseRange: ReturnType<typeof vi.fn>;
  } {
    return {
      getFromVerse: vi.fn(),
      getFromVerseRange: vi.fn().mockReturnValue([]),
    } as any;
  }

  // ========================================================================
  // Setup & Teardown
  // ========================================================================

  beforeEach(() => {
    moduleMetadataRepo = createMockModuleMetadataRepo();
    userNoteRepo = createMockUserNoteRepo();
    commentaryRepoProvider = createMockRepositoryProvider();
    crossReferenceRepoProvider = createMockRepositoryProvider();
    bookRepoProvider = createMockRepositoryProvider();
    userCrossReferenceRepo = createMockUserCrossReferenceRepo();

    service = new VerseLinksService(
      moduleMetadataRepo,
      userNoteRepo,
      commentaryRepoProvider,
      crossReferenceRepoProvider,
      bookRepoProvider,
      userCrossReferenceRepo
    );
  });

  // ========================================================================
  // getVerseLinks Tests - Happy Path
  // ========================================================================

  describe('getVerseLinks', () => {
    it('should return empty summary when no content found', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);

      moduleMetadataRepo.getByType.mockReturnValue([]);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.verseId).toBe(verseId);
      expect(links.commentaries.direct).toEqual([]);
      expect(links.commentaries.mentions).toEqual([]);
      expect(links.crossReferences.modules).toEqual([]);
      expect(links.books).toEqual([]);
      expect(links.userContent.notes).toEqual([]);
      expect(links.userContent.journals).toEqual([]);
      expect(links.userRefCount).toBe(0);
    });

    it('should aggregate commentary direct entries', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const commentaryModule = {
        moduleId: 1,
        moduleName: 'Matthew Henry',
        abbreviation: 'MH',
        moduleType: 'commentary'
      };

      const mockCommentaryRepo = {
        getBestEntryForVerse: vi.fn().mockReturnValue({
          entryId: 101,
          entryLevel: 'verse',
          verseIdStart: verseId
        }),
        getVerseMentions: vi.fn().mockReturnValue([])
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'commentary') return [commentaryModule];
        return [];
      });
      commentaryRepoProvider.mockReturnValue(mockCommentaryRepo);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.commentaries.direct).toHaveLength(1);
      expect(links.commentaries.direct[0].moduleId).toBe(1);
      expect(links.commentaries.direct[0].moduleName).toBe('Matthew Henry');
      expect(links.commentaries.direct[0].abbreviation).toBe('MH');
      expect(links.commentaries.direct[0].isOpen).toBe(false);
    });

    it('should aggregate commentary mentions', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const commentaryModule = {
        moduleId: 2,
        moduleName: 'Adam Clarke',
        abbreviation: 'AC',
        moduleType: 'commentary'
      };

      const mockCommentaryRepo = {
        getBestEntryForVerse: vi.fn().mockReturnValue(null),
        getVerseMentions: vi.fn().mockReturnValue([
          { entryId: 201, verseIdStart: VerseIdHelper.calculate(Book.John, 3, 1), count: 1 },
          { entryId: 202, verseIdStart: VerseIdHelper.calculate(Book.John, 3, 1), count: 2 }
        ])
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'commentary') return [commentaryModule];
        return [];
      });
      commentaryRepoProvider.mockReturnValue(mockCommentaryRepo);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.commentaries.mentions).toHaveLength(1);
      expect(links.commentaries.mentions[0].count).toBe(3); // 1 + 2
      expect(links.commentaries.mentions[0].entryLevel).toBe('verse');
    });

    it('should aggregate cross-reference modules', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const xrefModule = {
        moduleId: 3,
        moduleName: 'Cross References',
        abbreviation: 'XREF',
        moduleType: 'cross_reference'
      };

      const mockXrefRepo = {
        getGroupsWithEntries: vi.fn().mockReturnValue([
          {
            entries: [
              {
                entryId: 301,
                targetVerseId: VerseIdHelper.calculate(Book.Romans, 5, 8),
                note: 'God\'s love'
              },
              {
                entryId: 302,
                targetVerseId: VerseIdHelper.calculate(Book.FirstJohn, 4, 9),
                note: 'Love demonstrated'
              }
            ]
          }
        ])
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'cross_reference') return [xrefModule];
        return [];
      });
      crossReferenceRepoProvider.mockReturnValue(mockXrefRepo);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.crossReferences.modules).toHaveLength(1);
      expect(links.crossReferences.modules[0].moduleId).toBe(3);
      expect(links.crossReferences.modules[0].references).toHaveLength(2);
      expect(links.crossReferences.modules[0].isOpen).toBe(false);
    });

    it('should aggregate book references with sections', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const bookModule = {
        moduleId: 4,
        moduleName: 'Bible Commentary',
        abbreviation: 'BC',
        moduleType: 'book'
      };

      const mockBookRepo = {
        getVerseReferencesWithSections: vi.fn().mockReturnValue([
          {
            sectionId: 401,
            sectionTitle: 'God\'s Love',
            context: 'Introduction to the theme',
            referenceId: 4001
          }
        ])
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'book') return [bookModule];
        return [];
      });
      bookRepoProvider.mockReturnValue(mockBookRepo);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.books).toHaveLength(1);
      expect(links.books[0].moduleId).toBe(4);
      expect(links.books[0].sections).toHaveLength(1);
      expect(links.books[0].sections[0].sectionTitle).toBe('God\'s Love');
    });

    it('should aggregate user notes (non-journal)', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);

      userNoteRepo.getForVerse.mockReturnValue([
        {
          noteId: 501,
          title: 'My Note',
          noteType: 'verse_note',
          content: 'This is about God\'s love for the world',
          createdDate: '2026-01-01',
          modifiedDate: '2026-01-02'
        },
        {
          noteId: 502,
          title: 'Sermon Notes',
          noteType: 'sermon',
          content: 'Sermon title and main points',
          createdDate: '2026-01-03'
        }
      ]);
      moduleMetadataRepo.getByType.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.userContent.notes).toHaveLength(2);
      expect(links.userContent.notes[0].noteId).toBe(501);
      expect(links.userContent.notes[0].noteType).toBe('verse_note');
      expect(links.userContent.notes[0].modifiedDate).toBe('2026-01-02');
    });

    it('should aggregate journal entries separately', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);

      userNoteRepo.getForVerse.mockReturnValue([
        {
          noteId: 601,
          title: 'Daily Reflection',
          noteType: 'journal',
          content: 'Today I learned about God\'s love',
          entryDate: '2026-01-15',
          createdDate: '2026-01-15'
        },
        {
          noteId: 602,
          title: 'Verse Note',
          noteType: 'verse_note',
          content: 'Quick note',
          createdDate: '2026-01-15'
        }
      ]);
      moduleMetadataRepo.getByType.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.userContent.notes).toHaveLength(1);
      expect(links.userContent.journals).toHaveLength(1);
      expect(links.userContent.journals[0].entryId).toBe(601);
      expect(links.userContent.journals[0].entryDate).toBe('2026-01-15');
    });

    it('should count user cross-references', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);

      moduleMetadataRepo.getByType.mockReturnValue([]);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([
        { fromVerseId: verseId, toVerseId: VerseIdHelper.calculate(Book.Romans, 5, 8) },
        { fromVerseId: verseId, toVerseId: VerseIdHelper.calculate(Book.Ephesians, 2, 8) }
      ]);

      const links = await service.getVerseLinks(verseId);

      expect(links.userRefCount).toBe(2);
    });

    it('should mark modules as open when in openModuleIds set', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const commentaryModule = {
        moduleId: 1,
        moduleName: 'Matthew Henry',
        abbreviation: 'MH',
        moduleType: 'commentary'
      };

      const mockCommentaryRepo = {
        getBestEntryForVerse: vi.fn().mockReturnValue({
          entryId: 101,
          entryLevel: 'verse',
          verseIdStart: verseId
        }),
        getVerseMentions: vi.fn().mockReturnValue([])
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'commentary') return [commentaryModule];
        return [];
      });
      commentaryRepoProvider.mockReturnValue(mockCommentaryRepo);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const openModuleIds = new Set([1]);
      const links = await service.getVerseLinks(verseId, openModuleIds);

      expect(links.commentaries.direct[0].isOpen).toBe(true);
    });
  });

  // ========================================================================
  // getVerseLinks Tests - Boundary Cases
  // ========================================================================

  describe('getVerseLinks - Boundary Cases', () => {
    it('should handle Genesis 1:1 (first verse)', async () => {
      const verseId = VerseIdHelper.calculate(Book.Genesis, 1, 1);

      moduleMetadataRepo.getByType.mockReturnValue([]);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.verseId).toBe(verseId);
      expect(links.commentaries.direct).toEqual([]);
    });

    it('should handle Revelation 22:21 (last verse)', async () => {
      const verseId = VerseIdHelper.calculate(Book.Revelation, 22, 21);

      moduleMetadataRepo.getByType.mockReturnValue([]);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.verseId).toBe(verseId);
      expect(links.commentaries.direct).toEqual([]);
    });

    it('should handle verse with range (verseIdEnd)', async () => {
      const verseId = VerseIdHelper.calculate(Book.Matthew, 5, 17);
      const commentaryModule = {
        moduleId: 1,
        moduleName: 'Matthew Henry',
        abbreviation: 'MH',
        moduleType: 'commentary'
      };

      const mockCommentaryRepo = {
        getBestEntryForVerse: vi.fn().mockReturnValue({
          entryId: 101,
          entryLevel: 'passage',
          verseIdStart: VerseIdHelper.calculate(Book.Matthew, 5, 17),
          verseIdEnd: VerseIdHelper.calculate(Book.Matthew, 5, 48)
        }),
        getVerseMentions: vi.fn().mockReturnValue([])
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'commentary') return [commentaryModule];
        return [];
      });
      commentaryRepoProvider.mockReturnValue(mockCommentaryRepo);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.commentaries.direct[0].entryLevel).toBe('passage');
      expect(links.commentaries.direct[0].verseIdEnd).toBeDefined();
    });
  });

  // ========================================================================
  // getVerseLinks Tests - Error Handling & Edge Cases
  // ========================================================================

  describe('getVerseLinks - Error Handling', () => {
    it('should handle missing commentary repository gracefully', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const commentaryModule = {
        moduleId: 1,
        moduleName: 'Matthew Henry',
        abbreviation: 'MH',
        moduleType: 'commentary'
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'commentary') return [commentaryModule];
        return [];
      });
      commentaryRepoProvider.mockReturnValue(null); // Repository not available
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.commentaries.direct).toEqual([]);
    });

    it('should handle commentary repo error gracefully', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const commentaryModule = {
        moduleId: 1,
        moduleName: 'Matthew Henry',
        abbreviation: 'MH',
        moduleType: 'commentary'
      };

      const mockCommentaryRepo = {
        getBestEntryForVerse: vi.fn().mockImplementation(() => {
          throw new Error('Database error');
        }),
        getVerseMentions: vi.fn().mockReturnValue([])
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'commentary') return [commentaryModule];
        return [];
      });
      commentaryRepoProvider.mockReturnValue(mockCommentaryRepo);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.commentaries.direct).toEqual([]);
    });

    it('should handle missing cross-reference module gracefully', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const xrefModule = {
        moduleId: 3,
        moduleName: 'Cross References',
        abbreviation: 'XREF',
        moduleType: 'cross_reference'
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'cross_reference') return [xrefModule];
        return [];
      });
      crossReferenceRepoProvider.mockReturnValue(null);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.crossReferences.modules).toEqual([]);
    });

    it('should handle missing book module gracefully', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const bookModule = {
        moduleId: 4,
        moduleName: 'Bible Commentary',
        abbreviation: 'BC',
        moduleType: 'book'
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'book') return [bookModule];
        return [];
      });
      bookRepoProvider.mockReturnValue(null);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.books).toEqual([]);
    });

    it('should handle undefined user note repo gracefully', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);

      moduleMetadataRepo.getByType.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const serviceWithoutUserRepo = new VerseLinksService(
        moduleMetadataRepo,
        undefined, // No user note repo
        commentaryRepoProvider,
        crossReferenceRepoProvider,
        bookRepoProvider,
        userCrossReferenceRepo
      );

      const links = await serviceWithoutUserRepo.getVerseLinks(verseId);

      expect(links.userContent.notes).toEqual([]);
      expect(links.userContent.journals).toEqual([]);
    });

    it('should handle user note repo error gracefully', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);

      moduleMetadataRepo.getByType.mockReturnValue([]);
      userNoteRepo.getForVerse.mockImplementation(() => {
        throw new Error('Database error');
      });
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.userContent.notes).toEqual([]);
      expect(links.userContent.journals).toEqual([]);
    });

    it('should handle user cross-reference repo error gracefully', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);

      moduleMetadataRepo.getByType.mockReturnValue([]);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockImplementation(() => {
        throw new Error('Database error');
      });

      const links = await service.getVerseLinks(verseId);

      expect(links.userRefCount).toBe(0);
    });

    it('should handle undefined user cross-reference repo gracefully', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);

      moduleMetadataRepo.getByType.mockReturnValue([]);
      userNoteRepo.getForVerse.mockReturnValue([]);

      const serviceWithoutUserXrefRepo = new VerseLinksService(
        moduleMetadataRepo,
        userNoteRepo,
        commentaryRepoProvider,
        crossReferenceRepoProvider,
        bookRepoProvider,
        undefined // No user cross-reference repo
      );

      const links = await serviceWithoutUserXrefRepo.getVerseLinks(verseId);

      expect(links.userRefCount).toBe(0);
    });
  });

  // ========================================================================
  // getVerseLinks Tests - Content Preview
  // ========================================================================

  describe('getVerseLinks - Content Previews', () => {
    it('should truncate long note content with preview', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const longContent = 'a'.repeat(150);

      userNoteRepo.getForVerse.mockReturnValue([
        {
          noteId: 501,
          title: 'My Note',
          noteType: 'verse_note',
          content: longContent,
          createdDate: '2026-01-01'
        }
      ]);
      moduleMetadataRepo.getByType.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.userContent.notes[0].contentPreview).toBeDefined();
      expect(links.userContent.notes[0].contentPreview!.length).toBeLessThanOrEqual(103); // 100 + '...'
      expect(links.userContent.notes[0].contentPreview).toContain('...');
    });

    it('should not truncate short note content', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const shortContent = 'Quick note about love';

      userNoteRepo.getForVerse.mockReturnValue([
        {
          noteId: 501,
          title: 'My Note',
          noteType: 'verse_note',
          content: shortContent,
          createdDate: '2026-01-01'
        }
      ]);
      moduleMetadataRepo.getByType.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.userContent.notes[0].contentPreview).toBe(shortContent);
    });

    it('should strip HTML from preview', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const htmlContent = '<p>This is <strong>bold</strong> text</p>';

      userNoteRepo.getForVerse.mockReturnValue([
        {
          noteId: 501,
          title: 'My Note',
          noteType: 'verse_note',
          content: htmlContent,
          createdDate: '2026-01-01'
        }
      ]);
      moduleMetadataRepo.getByType.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.userContent.notes[0].contentPreview).toBe('This is bold text');
      expect(links.userContent.notes[0].contentPreview).not.toContain('<');
    });

    it('should use modified date if available, otherwise created date', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);

      userNoteRepo.getForVerse.mockReturnValue([
        {
          noteId: 501,
          title: 'Note with modified date',
          noteType: 'verse_note',
          content: 'content',
          createdDate: '2026-01-01',
          modifiedDate: '2026-01-15'
        },
        {
          noteId: 502,
          title: 'Note without modified date',
          noteType: 'verse_note',
          content: 'content',
          createdDate: '2026-01-01'
        }
      ]);
      moduleMetadataRepo.getByType.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.userContent.notes[0].modifiedDate).toBe('2026-01-15');
      expect(links.userContent.notes[1].modifiedDate).toBe('2026-01-01');
    });
  });

  // ========================================================================
  // getBatchVerseLinks Tests
  // ========================================================================

  describe('getBatchVerseLinks', () => {
    it('should return map of verse links keyed by verse ID', async () => {
      const verseId1 = VerseIdHelper.calculate(Book.John, 3, 16);
      const verseId2 = VerseIdHelper.calculate(Book.Romans, 8, 28);

      moduleMetadataRepo.getByType.mockReturnValue([]);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const results = await service.getBatchVerseLinks([verseId1, verseId2]);

      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBe(2);
      expect(results.has(verseId1)).toBe(true);
      expect(results.has(verseId2)).toBe(true);
    });

    it('should handle empty verse ID array', async () => {
      const results = await service.getBatchVerseLinks([]);

      expect(results).toBeInstanceOf(Map);
      expect(results.size).toBe(0);
    });

    it('should maintain separate results for each verse', async () => {
      const verseId1 = VerseIdHelper.calculate(Book.John, 3, 16);
      const verseId2 = VerseIdHelper.calculate(Book.Romans, 8, 28);

      const commentaryModule = {
        moduleId: 1,
        moduleName: 'Commentary',
        abbreviation: 'C',
        moduleType: 'commentary'
      };

      // The batch path asks each module ONE range question and attributes the
      // answers per verse itself, so the mock supplies anchors, not per-verse
      // lookups. `getBestEntryAnchorsForRange` is verified to reproduce
      // `getBestEntryForVerse` exactly in RangeBatchQueries.test.ts.
      const mockCommentaryRepo = {
        getBestEntryAnchorsForRange: vi.fn().mockReturnValue([
          { entryId: 101, entryLevel: 'verse', verseIdStart: verseId1, verseIdEnd: verseId1 },
        ]),
        getVerseMentionRowsForRange: vi.fn().mockReturnValue([])
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'commentary') return [commentaryModule];
        return [];
      });
      commentaryRepoProvider.mockReturnValue(mockCommentaryRepo);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const results = await service.getBatchVerseLinks([verseId1, verseId2]);

      const links1 = results.get(verseId1)!;
      const links2 = results.get(verseId2)!;

      expect(links1.commentaries.direct).toHaveLength(1);
      expect(links2.commentaries.direct).toHaveLength(0);
    });

    it('should respect openModuleIds for batch queries', async () => {
      const verseId1 = VerseIdHelper.calculate(Book.John, 3, 16);
      const verseId2 = VerseIdHelper.calculate(Book.Romans, 8, 28);

      const commentaryModule = {
        moduleId: 1,
        moduleName: 'Commentary',
        abbreviation: 'C',
        moduleType: 'commentary'
      };

      const mockCommentaryRepo = {
        getBestEntryAnchorsForRange: vi.fn().mockReturnValue([
          { entryId: 101, entryLevel: 'verse', verseIdStart: verseId1, verseIdEnd: verseId2 },
        ]),
        getVerseMentionRowsForRange: vi.fn().mockReturnValue([])
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'commentary') return [commentaryModule];
        return [];
      });
      commentaryRepoProvider.mockReturnValue(mockCommentaryRepo);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const openModuleIds = new Set([1]);
      const results = await service.getBatchVerseLinks([verseId1, verseId2], openModuleIds);

      const links1 = results.get(verseId1)!;
      expect(links1.commentaries.direct[0].isOpen).toBe(true);
    });
  });

  // ========================================================================
  // Commentary Sorting Tests
  // ========================================================================

  describe('Commentary Sorting', () => {
    it('should sort open modules first, then alphabetically', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);

      const commentaryModules = [
        { moduleId: 1, moduleName: 'Matthew Henry', abbreviation: 'MH', moduleType: 'commentary' },
        { moduleId: 2, moduleName: 'Adam Clarke', abbreviation: 'AC', moduleType: 'commentary' },
        { moduleId: 3, moduleName: 'Jamieson Fausset Brown', abbreviation: 'JFB', moduleType: 'commentary' }
      ];

      const mockCommentaryRepo = {
        getBestEntryForVerse: vi.fn().mockReturnValue({
          entryId: 101,
          entryLevel: 'verse',
          verseIdStart: verseId
        }),
        getVerseMentions: vi.fn().mockReturnValue([])
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'commentary') return commentaryModules;
        return [];
      });
      commentaryRepoProvider.mockReturnValue(mockCommentaryRepo);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const openModuleIds = new Set([2]); // Adam Clarke is open
      const links = await service.getVerseLinks(verseId, openModuleIds);

      // Open module (AC) should come first, then others alphabetically (JFB, MH)
      expect(links.commentaries.direct[0].abbreviation).toBe('AC');
      expect(links.commentaries.direct[1].abbreviation).toBe('JFB');
      expect(links.commentaries.direct[2].abbreviation).toBe('MH');
    });

    it('should fall back to module name if abbreviation is missing', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);

      const commentaryModule = {
        moduleId: 1,
        moduleName: 'Matthew Henry Commentary',
        abbreviation: undefined,
        moduleType: 'commentary'
      };

      const mockCommentaryRepo = {
        getBestEntryForVerse: vi.fn().mockReturnValue({
          entryId: 101,
          entryLevel: 'verse',
          verseIdStart: verseId
        }),
        getVerseMentions: vi.fn().mockReturnValue([])
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'commentary') return [commentaryModule];
        return [];
      });
      commentaryRepoProvider.mockReturnValue(mockCommentaryRepo);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.commentaries.direct[0].abbreviation).toBe('Matthew Henry Commentary');
    });
  });

  // ========================================================================
  // Cross-Reference Formatting Tests
  // ========================================================================

  describe('Cross-Reference Formatting', () => {
    it('should format verse reference in cross-reference entries', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const xrefModule = {
        moduleId: 3,
        moduleName: 'Cross References',
        abbreviation: 'XREF',
        moduleType: 'cross_reference'
      };

      const mockXrefRepo = {
        getGroupsWithEntries: vi.fn().mockReturnValue([
          {
            entries: [
              {
                entryId: 301,
                targetVerseId: VerseIdHelper.calculate(Book.Romans, 5, 8),
                note: 'God\'s love'
              }
            ]
          }
        ])
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'cross_reference') return [xrefModule];
        return [];
      });
      crossReferenceRepoProvider.mockReturnValue(mockXrefRepo);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      // Real book names, from the shared name table. This used to assert the
      // placeholder `Book 45 5:8` that formatVerseId emitted - a string that
      // reached the UI verbatim.
      expect(links.crossReferences.modules[0].references[0].toVerseReference).toBe('Rom 5:8');
    });

    it('should include cross-reference notes when present', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const xrefModule = {
        moduleId: 3,
        moduleName: 'Cross References',
        abbreviation: 'XREF',
        moduleType: 'cross_reference'
      };

      const mockXrefRepo = {
        getGroupsWithEntries: vi.fn().mockReturnValue([
          {
            entries: [
              {
                entryId: 301,
                targetVerseId: VerseIdHelper.calculate(Book.Romans, 5, 8),
                note: 'Parallel passage showing God\'s love'
              }
            ]
          }
        ])
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'cross_reference') return [xrefModule];
        return [];
      });
      crossReferenceRepoProvider.mockReturnValue(mockXrefRepo);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const links = await service.getVerseLinks(verseId);

      expect(links.crossReferences.modules[0].references[0].notes).toBe('Parallel passage showing God\'s love');
    });
  });

  // ========================================================================
  // Integration Tests
  // ========================================================================

  describe('Integration Tests', () => {
    it('should aggregate all content types together', async () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);

      const commentaryModule = {
        moduleId: 1,
        moduleName: 'Matthew Henry',
        abbreviation: 'MH',
        moduleType: 'commentary'
      };
      const xrefModule = {
        moduleId: 3,
        moduleName: 'Cross References',
        abbreviation: 'XREF',
        moduleType: 'cross_reference'
      };
      const bookModule = {
        moduleId: 4,
        moduleName: 'Bible Study',
        abbreviation: 'BS',
        moduleType: 'book'
      };

      const mockCommentaryRepo = {
        getBestEntryForVerse: vi.fn().mockReturnValue({
          entryId: 101,
          entryLevel: 'verse',
          verseIdStart: verseId
        }),
        getVerseMentions: vi.fn().mockReturnValue([])
      };

      const mockXrefRepo = {
        getGroupsWithEntries: vi.fn().mockReturnValue([
          {
            entries: [
              { entryId: 301, targetVerseId: VerseIdHelper.calculate(Book.Romans, 5, 8), note: 'God\'s love' }
            ]
          }
        ])
      };

      const mockBookRepo = {
        getVerseReferencesWithSections: vi.fn().mockReturnValue([
          { sectionId: 401, sectionTitle: 'God\'s Love', context: 'Introduction', referenceId: 4001 }
        ])
      };

      moduleMetadataRepo.getByType.mockImplementation((type: string) => {
        if (type === 'commentary') return [commentaryModule];
        if (type === 'cross_reference') return [xrefModule];
        if (type === 'book') return [bookModule];
        return [];
      });
      commentaryRepoProvider.mockReturnValue(mockCommentaryRepo);
      crossReferenceRepoProvider.mockReturnValue(mockXrefRepo);
      bookRepoProvider.mockReturnValue(mockBookRepo);
      userNoteRepo.getForVerse.mockReturnValue([
        { noteId: 501, title: 'My Note', noteType: 'verse_note', content: 'Love', createdDate: '2026-01-01' }
      ]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([
        { fromVerseId: verseId, toVerseId: VerseIdHelper.calculate(Book.Ephesians, 2, 8) }
      ]);

      const links = await service.getVerseLinks(verseId);

      expect(links.commentaries.direct).toHaveLength(1);
      expect(links.crossReferences.modules).toHaveLength(1);
      expect(links.books).toHaveLength(1);
      expect(links.userContent.notes).toHaveLength(1);
      expect(links.userRefCount).toBe(1);
    });

    it('should handle multiple verses in parallel batch query', async () => {
      const verseId1 = VerseIdHelper.calculate(Book.John, 3, 16);
      const verseId2 = VerseIdHelper.calculate(Book.Romans, 5, 8);
      const verseId3 = VerseIdHelper.calculate(Book.Ephesians, 2, 8);

      moduleMetadataRepo.getByType.mockReturnValue([]);
      userNoteRepo.getForVerse.mockReturnValue([]);
      userCrossReferenceRepo.getFromVerse.mockReturnValue([]);

      const results = await service.getBatchVerseLinks([verseId1, verseId2, verseId3]);

      expect(results.size).toBe(3);
      for (const verseId of [verseId1, verseId2, verseId3]) {
        const links = results.get(verseId)!;
        expect(links.verseId).toBe(verseId);
      }
    });
  });
});
