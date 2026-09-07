import { describe, it, expect } from 'vitest';
import { CrossReferenceService, EnrichedCrossReference } from './CrossReferenceService';
import { BibleVerse } from '../Data/Models/Bible/BibleVerse';
import { UserCrossReference } from '../Data/Models/User/UserCrossReference';
import { Book, VerseIdHelper } from '../Data/Core/Types';

describe('CrossReferenceService', () => {
  // ==========================================================================
  // extractBuiltInCrossRefs Tests
  // ==========================================================================

  describe('extractBuiltInCrossRefs', () => {
    it('should extract cross-references from verse formatting data', () => {
      const verse = new BibleVerse({
        verseId: VerseIdHelper.calculate(Book.John, 3, 16),
        text: 'For God so loved the world...',
        formattingData: {
          crossReferences: [
            {
              position: 0,
              marker: 'a',
              references: [
                VerseIdHelper.calculate(Book.Romans, 5, 8),
                VerseIdHelper.calculate(Book.FirstJohn, 4, 9),
              ],
            },
            {
              position: 0,
              marker: 'b',
              references: [VerseIdHelper.calculate(Book.John, 1, 14)],
            },
          ],
        },
      });

      const refs = CrossReferenceService.extractBuiltInCrossRefs(verse);

      expect(refs).toHaveLength(3);
      expect(refs).toContain(VerseIdHelper.calculate(Book.Romans, 5, 8));
      expect(refs).toContain(VerseIdHelper.calculate(Book.FirstJohn, 4, 9));
      expect(refs).toContain(VerseIdHelper.calculate(Book.John, 1, 14));
    });

    it('should return empty array if no cross-references', () => {
      const verse = new BibleVerse({
        verseId: VerseIdHelper.calculate(Book.John, 3, 16),
        text: 'For God so loved the world...',
      });

      const refs = CrossReferenceService.extractBuiltInCrossRefs(verse);

      expect(refs).toEqual([]);
    });

    it('should return empty array if formattingData has no crossReferences', () => {
      const verse = new BibleVerse({
        verseId: VerseIdHelper.calculate(Book.John, 3, 16),
        text: 'For God so loved the world...',
        formattingData: {},
      });

      const refs = CrossReferenceService.extractBuiltInCrossRefs(verse);

      expect(refs).toEqual([]);
    });

    it('should handle multiple cross-reference groups', () => {
      const verse = new BibleVerse({
        verseId: VerseIdHelper.calculate(Book.Matthew, 5, 17),
        text: 'Do not think that I came to destroy the Law...',
        formattingData: {
          crossReferences: [
            {
              position: 0,
              marker: 'a',
              references: [
                VerseIdHelper.calculate(Book.Romans, 3, 31),
                VerseIdHelper.calculate(Book.Romans, 10, 4),
              ],
            },
            {
              position: 0,
              marker: 'b',
              references: [
                VerseIdHelper.calculate(Book.Luke, 16, 17),
              ],
            },
            {
              position: 0,
              marker: 'c',
              references: [
                VerseIdHelper.calculate(Book.Matthew, 3, 15),
              ],
            },
          ],
        },
      });

      const refs = CrossReferenceService.extractBuiltInCrossRefs(verse);

      expect(refs).toHaveLength(4);
    });
  });

  // ==========================================================================
  // mergeCrossReferences Tests
  // ==========================================================================

  describe('mergeCrossReferences', () => {
    it('should merge built-in and user cross-references', () => {
      const builtInRefs = [
        VerseIdHelper.calculate(Book.Romans, 5, 8),
        VerseIdHelper.calculate(Book.FirstJohn, 4, 9),
      ];

      const userRefs = [
        new UserCrossReference({
          fromVerseIdStart: VerseIdHelper.calculate(Book.John, 3, 16),
          toVerseIdStart: VerseIdHelper.calculate(Book.John, 1, 14),
        }),
        new UserCrossReference({
          fromVerseIdStart: VerseIdHelper.calculate(Book.John, 3, 16),
          toVerseIdStart: VerseIdHelper.calculate(Book.Ephesians, 2, 8),
        }),
      ];

      const merged = CrossReferenceService.mergeCrossReferences(builtInRefs, userRefs);

      expect(merged).toHaveLength(4);
      expect(merged).toContain(VerseIdHelper.calculate(Book.Romans, 5, 8));
      expect(merged).toContain(VerseIdHelper.calculate(Book.FirstJohn, 4, 9));
      expect(merged).toContain(VerseIdHelper.calculate(Book.John, 1, 14));
      expect(merged).toContain(VerseIdHelper.calculate(Book.Ephesians, 2, 8));
    });

    it('should remove duplicate references', () => {
      const builtInRefs = [
        VerseIdHelper.calculate(Book.Romans, 5, 8),
        VerseIdHelper.calculate(Book.John, 1, 14),
      ];

      const userRefs = [
        new UserCrossReference({
          fromVerseIdStart: VerseIdHelper.calculate(Book.John, 3, 16),
          toVerseIdStart: VerseIdHelper.calculate(Book.John, 1, 14), // Duplicate
        }),
        new UserCrossReference({
          fromVerseIdStart: VerseIdHelper.calculate(Book.John, 3, 16),
          toVerseIdStart: VerseIdHelper.calculate(Book.Ephesians, 2, 8),
        }),
      ];

      const merged = CrossReferenceService.mergeCrossReferences(builtInRefs, userRefs);

      expect(merged).toHaveLength(3); // Duplicate removed
    });

    it('should sort references by verse ID', () => {
      const builtInRefs = [
        VerseIdHelper.calculate(Book.FirstJohn, 4, 9), // Later book
        VerseIdHelper.calculate(Book.Romans, 5, 8),    // Earlier book
      ];

      const userRefs = [
        new UserCrossReference({
          fromVerseIdStart: VerseIdHelper.calculate(Book.John, 3, 16),
          toVerseIdStart: VerseIdHelper.calculate(Book.Genesis, 1, 1), // First book
        }),
      ];

      const merged = CrossReferenceService.mergeCrossReferences(builtInRefs, userRefs);

      // Should be sorted: Genesis < Romans < 1 John
      expect(merged[0]).toBe(VerseIdHelper.calculate(Book.Genesis, 1, 1));
      expect(merged[1]).toBe(VerseIdHelper.calculate(Book.Romans, 5, 8));
      expect(merged[2]).toBe(VerseIdHelper.calculate(Book.FirstJohn, 4, 9));
    });

    it('should handle empty built-in refs', () => {
      const userRefs = [
        new UserCrossReference({
          fromVerseIdStart: VerseIdHelper.calculate(Book.John, 3, 16),
          toVerseIdStart: VerseIdHelper.calculate(Book.Romans, 5, 8),
        }),
      ];

      const merged = CrossReferenceService.mergeCrossReferences([], userRefs);

      expect(merged).toHaveLength(1);
      expect(merged[0]).toBe(VerseIdHelper.calculate(Book.Romans, 5, 8));
    });

    it('should handle empty user refs', () => {
      const builtInRefs = [
        VerseIdHelper.calculate(Book.Romans, 5, 8),
      ];

      const merged = CrossReferenceService.mergeCrossReferences(builtInRefs, []);

      expect(merged).toHaveLength(1);
      expect(merged[0]).toBe(VerseIdHelper.calculate(Book.Romans, 5, 8));
    });

    it('should handle both empty', () => {
      const merged = CrossReferenceService.mergeCrossReferences([], []);

      expect(merged).toEqual([]);
    });
  });

  // ==========================================================================
  // enrichCrossReferences Tests
  // ==========================================================================

  describe('enrichCrossReferences', () => {
    it('should enrich cross-references with verse text', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const builtInRefs = [
        VerseIdHelper.calculate(Book.Romans, 5, 8),
      ];
      const userRefs: UserCrossReference[] = [];

      const verseTextMap = new Map<number, string>();
      verseTextMap.set(
        VerseIdHelper.calculate(Book.Romans, 5, 8),
        'But God commendeth his love toward us...'
      );

      const enriched = CrossReferenceService.enrichCrossReferences(
        verseId,
        builtInRefs,
        userRefs,
        verseTextMap
      );

      expect(enriched).toHaveLength(1);
      expect(enriched[0].fromVerseId).toBe(verseId);
      expect(enriched[0].toVerseId).toBe(VerseIdHelper.calculate(Book.Romans, 5, 8));
      expect(enriched[0].verseText).toBe('But God commendeth his love toward us...');
      expect(enriched[0].verseReference).toBe('Romans 5:8');
      expect(enriched[0].isUserCreated).toBe(false);
    });

    it('should mark user cross-references correctly', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const builtInRefs: number[] = [];
      const userRefs = [
        new UserCrossReference({
          fromVerseIdStart: verseId,
          toVerseIdStart: VerseIdHelper.calculate(Book.Ephesians, 2, 8),
          notes: 'Salvation by grace',
        }),
      ];

      const enriched = CrossReferenceService.enrichCrossReferences(
        verseId,
        builtInRefs,
        userRefs
      );

      expect(enriched).toHaveLength(1);
      expect(enriched[0].isUserCreated).toBe(true);
      expect(enriched[0].notes).toBe('Salvation by grace');
    });

    it('should not duplicate references that are both built-in and user-created', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const sharedRef = VerseIdHelper.calculate(Book.Romans, 5, 8);

      const builtInRefs = [sharedRef];
      const userRefs = [
        new UserCrossReference({
          fromVerseIdStart: verseId,
          toVerseIdStart: sharedRef, // Same as built-in
          notes: 'My note',
        }),
      ];

      const enriched = CrossReferenceService.enrichCrossReferences(
        verseId,
        builtInRefs,
        userRefs
      );

      expect(enriched).toHaveLength(1);
      expect(enriched[0].isUserCreated).toBe(false); // Built-in takes precedence
    });

    it('should include both built-in and user references', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const builtInRefs = [
        VerseIdHelper.calculate(Book.Romans, 5, 8),
        VerseIdHelper.calculate(Book.FirstJohn, 4, 9),
      ];
      const userRefs = [
        new UserCrossReference({
          fromVerseIdStart: verseId,
          toVerseIdStart: VerseIdHelper.calculate(Book.Ephesians, 2, 8),
        }),
        new UserCrossReference({
          fromVerseIdStart: verseId,
          toVerseIdStart: VerseIdHelper.calculate(Book.Titus, 3, 5),
        }),
      ];

      const enriched = CrossReferenceService.enrichCrossReferences(
        verseId,
        builtInRefs,
        userRefs
      );

      expect(enriched).toHaveLength(4);
      const builtInCount = enriched.filter(r => !r.isUserCreated).length;
      const userCount = enriched.filter(r => r.isUserCreated).length;

      expect(builtInCount).toBe(2);
      expect(userCount).toBe(2);
    });

    it('should work without verse text map', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const builtInRefs = [
        VerseIdHelper.calculate(Book.Romans, 5, 8),
      ];

      const enriched = CrossReferenceService.enrichCrossReferences(
        verseId,
        builtInRefs,
        []
      );

      expect(enriched).toHaveLength(1);
      expect(enriched[0].verseText).toBeUndefined();
      expect(enriched[0].verseReference).toBe('Romans 5:8');
    });
  });

  // ==========================================================================
  // formatVerseReference Tests
  // ==========================================================================

  describe('formatVerseReference', () => {
    it('should format John 3:16', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);

      const formatted = CrossReferenceService.formatVerseReference(verseId);

      expect(formatted).toBe('John 3:16');
    });

    it('should format Genesis 1:1', () => {
      const verseId = VerseIdHelper.calculate(Book.Genesis, 1, 1);

      const formatted = CrossReferenceService.formatVerseReference(verseId);

      expect(formatted).toBe('Genesis 1:1');
    });

    it('should format Revelation 22:21', () => {
      const verseId = VerseIdHelper.calculate(Book.Revelation, 22, 21);

      const formatted = CrossReferenceService.formatVerseReference(verseId);

      expect(formatted).toBe('Revelation 22:21');
    });

    it('should format Romans 8:28', () => {
      const verseId = VerseIdHelper.calculate(Book.Romans, 8, 28);

      const formatted = CrossReferenceService.formatVerseReference(verseId);

      expect(formatted).toBe('Romans 8:28');
    });

    it('should format 1 Corinthians 13:13', () => {
      const verseId = VerseIdHelper.calculate(Book.FirstCorinthians, 13, 13);

      const formatted = CrossReferenceService.formatVerseReference(verseId);

      expect(formatted).toBe('1 Corinthians 13:13');
    });

    it('should format 2 Peter 3:9', () => {
      const verseId = VerseIdHelper.calculate(Book.SecondPeter, 3, 9);

      const formatted = CrossReferenceService.formatVerseReference(verseId);

      expect(formatted).toBe('2 Peter 3:9');
    });

    it('should handle Psalms 23:1', () => {
      const verseId = VerseIdHelper.calculate(Book.Psalms, 23, 1);

      const formatted = CrossReferenceService.formatVerseReference(verseId);

      expect(formatted).toBe('Psalms 23:1');
    });
  });

  // ==========================================================================
  // groupByVerse Tests
  // ==========================================================================

  describe('groupByVerse', () => {
    it('should group cross-references by source verse', () => {
      const refs: EnrichedCrossReference[] = [
        {
          fromVerseId: VerseIdHelper.calculate(Book.John, 3, 16),
          fromVerseIdEnd: VerseIdHelper.calculate(Book.John, 3, 16),
          toVerseId: VerseIdHelper.calculate(Book.Romans, 5, 8),
          toVerseIdEnd: VerseIdHelper.calculate(Book.Romans, 5, 8),
          verseReference: 'Romans 5:8',
          isUserCreated: false,
        },
        {
          fromVerseId: VerseIdHelper.calculate(Book.John, 3, 16),
          fromVerseIdEnd: VerseIdHelper.calculate(Book.John, 3, 16),
          toVerseId: VerseIdHelper.calculate(Book.FirstJohn, 4, 9),
          toVerseIdEnd: VerseIdHelper.calculate(Book.FirstJohn, 4, 9),
          verseReference: '1 John 4:9',
          isUserCreated: false,
        },
        {
          fromVerseId: VerseIdHelper.calculate(Book.Romans, 8, 28),
          fromVerseIdEnd: VerseIdHelper.calculate(Book.Romans, 8, 28),
          toVerseId: VerseIdHelper.calculate(Book.Romans, 8, 31),
          toVerseIdEnd: VerseIdHelper.calculate(Book.Romans, 8, 31),
          verseReference: 'Romans 8:31',
          isUserCreated: false,
        },
      ];

      const grouped = CrossReferenceService.groupByVerse(refs);

      expect(grouped.size).toBe(2);
      expect(grouped.get(VerseIdHelper.calculate(Book.John, 3, 16))).toHaveLength(2);
      expect(grouped.get(VerseIdHelper.calculate(Book.Romans, 8, 28))).toHaveLength(1);
    });

    it('should handle empty array', () => {
      const grouped = CrossReferenceService.groupByVerse([]);

      expect(grouped.size).toBe(0);
    });

    it('should handle single verse with multiple references', () => {
      const verseId = VerseIdHelper.calculate(Book.Matthew, 5, 17);
      const refs: EnrichedCrossReference[] = [
        {
          fromVerseId: verseId,
          fromVerseIdEnd: verseId,
          toVerseId: VerseIdHelper.calculate(Book.Romans, 3, 31),
          toVerseIdEnd: VerseIdHelper.calculate(Book.Romans, 3, 31),
          verseReference: 'Romans 3:31',
          isUserCreated: false,
        },
        {
          fromVerseId: verseId,
          fromVerseIdEnd: verseId,
          toVerseId: VerseIdHelper.calculate(Book.Romans, 10, 4),
          toVerseIdEnd: VerseIdHelper.calculate(Book.Romans, 10, 4),
          verseReference: 'Romans 10:4',
          isUserCreated: false,
        },
        {
          fromVerseId: verseId,
          fromVerseIdEnd: verseId,
          toVerseId: VerseIdHelper.calculate(Book.Luke, 16, 17),
          toVerseIdEnd: VerseIdHelper.calculate(Book.Luke, 16, 17),
          verseReference: 'Luke 16:17',
          isUserCreated: false,
        },
      ];

      const grouped = CrossReferenceService.groupByVerse(refs);

      expect(grouped.size).toBe(1);
      expect(grouped.get(verseId)).toHaveLength(3);
    });

    it('should preserve reference order', () => {
      const verseId = VerseIdHelper.calculate(Book.John, 3, 16);
      const refs: EnrichedCrossReference[] = [
        {
          fromVerseId: verseId,
          fromVerseIdEnd: verseId,
          toVerseId: VerseIdHelper.calculate(Book.Romans, 5, 8),
          toVerseIdEnd: VerseIdHelper.calculate(Book.Romans, 5, 8),
          verseReference: 'Romans 5:8',
          isUserCreated: false,
        },
        {
          fromVerseId: verseId,
          fromVerseIdEnd: verseId,
          toVerseId: VerseIdHelper.calculate(Book.FirstJohn, 4, 9),
          toVerseIdEnd: VerseIdHelper.calculate(Book.FirstJohn, 4, 9),
          verseReference: '1 John 4:9',
          isUserCreated: true,
        },
        {
          fromVerseId: verseId,
          fromVerseIdEnd: verseId,
          toVerseId: VerseIdHelper.calculate(Book.Ephesians, 2, 8),
          toVerseIdEnd: VerseIdHelper.calculate(Book.Ephesians, 2, 8),
          verseReference: 'Ephesians 2:8',
          isUserCreated: true,
        },
      ];

      const grouped = CrossReferenceService.groupByVerse(refs);
      const verseRefs = grouped.get(verseId)!;

      expect(verseRefs[0].toVerseId).toBe(VerseIdHelper.calculate(Book.Romans, 5, 8));
      expect(verseRefs[1].toVerseId).toBe(VerseIdHelper.calculate(Book.FirstJohn, 4, 9));
      expect(verseRefs[2].toVerseId).toBe(VerseIdHelper.calculate(Book.Ephesians, 2, 8));
    });
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('Integration Tests', () => {
    it('should handle complete cross-reference workflow', () => {
      // Step 1: Extract built-in cross-references from verse
      const verse = new BibleVerse({
        verseId: VerseIdHelper.calculate(Book.John, 3, 16),
        text: 'For God so loved the world...',
        formattingData: {
          crossReferences: [
            {
              position: 0,
              marker: 'a',
              references: [
                VerseIdHelper.calculate(Book.Romans, 5, 8),
                VerseIdHelper.calculate(Book.FirstJohn, 4, 9),
              ],
            },
          ],
        },
      });

      const builtInRefs = CrossReferenceService.extractBuiltInCrossRefs(verse);

      // Step 2: Add user cross-references
      const userRefs = [
        new UserCrossReference({
          fromVerseIdStart: verse.verseId,
          toVerseIdStart: VerseIdHelper.calculate(Book.Ephesians, 2, 8),
          notes: 'Salvation by grace',
        }),
      ];

      // Step 3: Merge them
      const merged = CrossReferenceService.mergeCrossReferences(builtInRefs, userRefs);

      expect(merged).toHaveLength(3);

      // Step 4: Enrich with verse text
      const verseTextMap = new Map<number, string>();
      verseTextMap.set(
        VerseIdHelper.calculate(Book.Romans, 5, 8),
        'But God commendeth his love...'
      );
      verseTextMap.set(
        VerseIdHelper.calculate(Book.FirstJohn, 4, 9),
        'In this was manifested the love of God...'
      );
      verseTextMap.set(
        VerseIdHelper.calculate(Book.Ephesians, 2, 8),
        'For by grace are ye saved...'
      );

      const enriched = CrossReferenceService.enrichCrossReferences(
        verse.verseId,
        builtInRefs,
        userRefs,
        verseTextMap
      );

      expect(enriched).toHaveLength(3);
      expect(enriched.filter(r => r.isUserCreated)).toHaveLength(1);
      expect(enriched.filter(r => !r.isUserCreated)).toHaveLength(2);

      // Step 5: Group by verse
      const grouped = CrossReferenceService.groupByVerse(enriched);

      expect(grouped.size).toBe(1);
      expect(grouped.get(verse.verseId)).toHaveLength(3);
    });

    it('should handle multiple verses with cross-references', () => {
      const refs: EnrichedCrossReference[] = [
        // John 3:16 references
        {
          fromVerseId: VerseIdHelper.calculate(Book.John, 3, 16),
          fromVerseIdEnd: VerseIdHelper.calculate(Book.John, 3, 16),
          toVerseId: VerseIdHelper.calculate(Book.Romans, 5, 8),
          toVerseIdEnd: VerseIdHelper.calculate(Book.Romans, 5, 8),
          verseReference: 'Romans 5:8',
          isUserCreated: false,
        },
        {
          fromVerseId: VerseIdHelper.calculate(Book.John, 3, 16),
          fromVerseIdEnd: VerseIdHelper.calculate(Book.John, 3, 16),
          toVerseId: VerseIdHelper.calculate(Book.FirstJohn, 4, 9),
          toVerseIdEnd: VerseIdHelper.calculate(Book.FirstJohn, 4, 9),
          verseReference: '1 John 4:9',
          isUserCreated: false,
        },
        // Romans 8:28 references
        {
          fromVerseId: VerseIdHelper.calculate(Book.Romans, 8, 28),
          fromVerseIdEnd: VerseIdHelper.calculate(Book.Romans, 8, 28),
          toVerseId: VerseIdHelper.calculate(Book.Jeremiah, 29, 11),
          toVerseIdEnd: VerseIdHelper.calculate(Book.Jeremiah, 29, 11),
          verseReference: 'Jeremiah 29:11',
          isUserCreated: false,
        },
        {
          fromVerseId: VerseIdHelper.calculate(Book.Romans, 8, 28),
          fromVerseIdEnd: VerseIdHelper.calculate(Book.Romans, 8, 28),
          toVerseId: VerseIdHelper.calculate(Book.Philippians, 1, 6),
          toVerseIdEnd: VerseIdHelper.calculate(Book.Philippians, 1, 6),
          verseReference: 'Philippians 1:6',
          isUserCreated: true,
        },
      ];

      const grouped = CrossReferenceService.groupByVerse(refs);

      expect(grouped.size).toBe(2);

      const john316Refs = grouped.get(VerseIdHelper.calculate(Book.John, 3, 16))!;
      expect(john316Refs).toHaveLength(2);

      const romans828Refs = grouped.get(VerseIdHelper.calculate(Book.Romans, 8, 28))!;
      expect(romans828Refs).toHaveLength(2);

      // Check user vs built-in counts
      const userCreatedInRomans = romans828Refs.filter(r => r.isUserCreated);
      expect(userCreatedInRomans).toHaveLength(1);
    });
  });
});
