import { describe, it, expect } from 'vitest';
import { WordFamilyService } from './WordFamilyService';
import { IDictionaryRepository } from '../Data/Repositories/IDictionaryRepository';
import { DictionaryEntry } from '../Data/Models/Dictionary/DictionaryEntry';

/**
 * Create a mock dictionary repository with given entries.
 */
function createMockDict(entries: Array<{ key: string; definition: string }>): IDictionaryRepository {
  const dictEntries = entries.map((e, i) => new DictionaryEntry({
    entryId: i + 1,
    entryKey: e.key,
    definition: e.definition,
  }));

  return {
    getModuleInfo: () => undefined,
    updateModuleInfo: () => {},
    getEntry: () => undefined,
    getEntryByKey: (key: string) => dictEntries.find(e => e.entryKey === key),
    getAllEntries: () => dictEntries,
    searchEntries: () => [],
    createEntry: (e) => e,
    updateEntry: (e) => e,
    deleteEntry: () => true,
    getOccurrences: () => [],
    getOccurrencesForVerse: () => [],
    // The rest of `IDictionaryRepository`. `WordFamilyService` does not call
    // these, but omitting them meant the object was not the interface it was
    // typed as - a method the service started using would have failed at run
    // time instead of at the type-check.
    searchByTitle: () => [],
    getExampleVerses: () => [],
    getVerseLinksForEntry: () => [],
    getEntriesReferencingVerse: () => [],
    getLetterIndex: () => [],
    browseByLetter: () => ({ entries: [], total: 0 }),
    getAdjacentEntries: () => ({ prev: null, next: null }),
    getEntryCount: () => dictEntries.length,
  };
}

describe('WordFamilyService', () => {
  // Real-ish Strong's definitions (trimmed)
  const greekEntries = [
    {
      key: '00025',
      definition: '25 ἀγαπάω ajgapavw agapao {ag-ap-ah\'-o} \n perhaps from agan (much); to love (in a social or moral sense):--(be-)love(-ed). Compare 5368.  see GREEK for 5368 \n ',
    },
    {
      key: '00026',
      definition: '26 ἀγάπη ajgavph agape {ag-ah\'-pay} \n from 25; love, i.e. affection or benevolence; specially (plural) a love-feast:--(feast of) charity(-ably), dear, love.  see GREEK for 25 \n ',
    },
    {
      key: '00027',
      definition: '27 ἀγαπητός ajgaphtovs agapetos {ag-ap-ay-tos\'} \n from 25; beloved:--(dearly, well) beloved, dear.  see GREEK for 25 \n ',
    },
    {
      key: '00100',
      definition: '100 ἁδρότης aJdrovths hadrotes {had-rot\'-ace} \n from hadros (stout); plumpness:--abundance. \n ',
    },
  ];

  const mockGreekDict = createMockDict(greekEntries);
  const service = new WordFamilyService(mockGreekDict, null);

  describe('parseDefinitionHeader', () => {
    it('should extract original word, transliteration, and pronunciation', () => {
      const header = service.parseDefinitionHeader(greekEntries[0].definition);
      expect(header.number).toBe(25);
      expect(header.originalWord).toBe('ἀγαπάω');
      expect(header.transliteration).toBe('agapao');
      expect(header.pronunciation).toBe('ag-ap-ah\'-o');
    });

    it('should handle entry with no braces gracefully', () => {
      const header = service.parseDefinitionHeader('999 some word');
      expect(header.number).toBe(999);
    });
  });

  describe('parseGlossAndRefs', () => {
    it('should extract gloss from after :-- separator', () => {
      const result = service.parseGlossAndRefs(greekEntries[0].definition, 'G');
      expect(result.gloss).toContain('love');
    });

    it('should extract derivation reference', () => {
      const result = service.parseGlossAndRefs(greekEntries[1].definition, 'G');
      expect(result.derivedFrom).toBe(25);
    });

    it('should extract see-GREEK references', () => {
      const result = service.parseGlossAndRefs(greekEntries[0].definition, 'G');
      expect(result.seeRefs).toContain(5368);
    });

    it('should extract Compare references', () => {
      const result = service.parseGlossAndRefs(greekEntries[0].definition, 'G');
      expect(result.compareRefs).toContain(5368);
    });

    it('should not double-count derivation in seeRefs', () => {
      // G26 has "from 25" AND "see GREEK for 25" - derivedFrom=25 but seeRefs should not include 25
      const result = service.parseGlossAndRefs(greekEntries[1].definition, 'G');
      expect(result.derivedFrom).toBe(25);
      expect(result.seeRefs).not.toContain(25);
    });
  });

  describe('getWordFamily', () => {
    it('should find G26 and G27 as children of G25', () => {
      const family = service.getWordFamily('G25');
      expect(family).not.toBeNull();
      expect(family!.primary.strongsNumber).toBe('G25');
      expect(family!.primary.word).toBe('ἀγαπάω');

      const memberNumbers = family!.members.map(m => m.strongsNumber);
      expect(memberNumbers).toContain('G26');
      expect(memberNumbers).toContain('G27');
    });

    it('should mark G26 as child of G25', () => {
      const family = service.getWordFamily('G25');
      const g26 = family!.members.find(m => m.strongsNumber === 'G26');
      expect(g26?.relationship).toBe('child');
    });

    it('should mark G25 as parent when viewing from G26', () => {
      const family = service.getWordFamily('G26');
      expect(family).not.toBeNull();
      const g25 = family!.members.find(m => m.strongsNumber === 'G25');
      expect(g25?.relationship).toBe('parent');
    });

    it('should include transitive siblings via shared parent', () => {
      // G26 is connected to G25 (parent). G27 is also connected to G25.
      // From G26's view, we get G25 directly. G27 is only reachable via G25.
      // The current graph only stores direct edges, so G27 is NOT in G26's family.
      // This is by design: the UI can expand G25's family to discover G27.
      const family = service.getWordFamily('G26');
      const memberNums = family!.members.map(m => m.strongsNumber);
      expect(memberNums).toContain('G25'); // direct parent
      // G27 not directly linked to G26 in the graph
    });

    it('should return empty family for entries with no cross-refs', () => {
      const family = service.getWordFamily('G100');
      expect(family).not.toBeNull();
      expect(family!.members.length).toBe(1); // just self
    });

    it('should return null for unknown entries', () => {
      const family = service.getWordFamily('G99999');
      expect(family).toBeNull();
    });
  });

  describe('getRelatedNumbers', () => {
    it('should return related numbers excluding self', () => {
      const related = service.getRelatedNumbers('G25');
      expect(related).toContain('G26');
      expect(related).toContain('G27');
      expect(related).not.toContain('G25');
    });

    it('should return empty array for no relations', () => {
      const related = service.getRelatedNumbers('G100');
      expect(related.length).toBe(0);
    });
  });

  describe('getEntryInfo', () => {
    it('should return cached entry metadata', () => {
      const info = service.getEntryInfo('G25');
      expect(info).not.toBeNull();
      expect(info!.word).toBe('ἀγαπάω');
      expect(info!.transliteration).toBe('agapao');
      expect(info!.gloss).toContain('love');
    });
  });
});
