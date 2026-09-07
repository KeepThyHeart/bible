import { describe, it, expect } from 'vitest';
import {
  getBibleSection,
  BIBLE_SECTIONS,
} from './BibleSections';

describe('BibleSections', () => {
  describe('BIBLE_SECTIONS structure', () => {
    it('should export exactly 10 sections', () => {
      expect(BIBLE_SECTIONS).toHaveLength(10);
    });

    it('should have correct section keys in order', () => {
      const keys = BIBLE_SECTIONS.map((s) => s.key);
      expect(keys).toEqual([
        'pentateuch',
        'ot-history',
        'wisdom',
        'major-prophets',
        'minor-prophets',
        'gospels',
        'acts',
        'pauline',
        'general',
        'revelation',
      ]);
    });

    it('should have sections covering books 1-66 with no gaps', () => {
      let expectedBook = 1;
      for (const section of BIBLE_SECTIONS) {
        expect(section.firstBook).toBe(expectedBook);
        expectedBook = section.lastBook + 1;
      }
      // Should end at book 66
      expect(BIBLE_SECTIONS[BIBLE_SECTIONS.length - 1].lastBook).toBe(66);
    });

    it('should have non-empty display names for all sections', () => {
      for (const section of BIBLE_SECTIONS) {
        expect(section.name).toBeTruthy();
        expect(section.name.length).toBeGreaterThan(0);
      }
    });

    it('should maintain canonical order with no overlaps', () => {
      for (let i = 0; i < BIBLE_SECTIONS.length - 1; i++) {
        const current = BIBLE_SECTIONS[i];
        const next = BIBLE_SECTIONS[i + 1];
        expect(current.lastBook + 1).toBe(next.firstBook);
      }
    });
  });

  describe('Testament assignment', () => {
    describe('Old Testament (books 1-39)', () => {
      it('should assign Genesis (book 1) to Pentateuch', () => {
        expect(getBibleSection(1)).toBe('pentateuch');
      });

      it('should assign Deuteronomy (book 5) to Pentateuch', () => {
        expect(getBibleSection(5)).toBe('pentateuch');
      });

      it('should assign Joshua (book 6) to OT History', () => {
        expect(getBibleSection(6)).toBe('ot-history');
      });

      it('should assign Esther (book 17) to OT History', () => {
        expect(getBibleSection(17)).toBe('ot-history');
      });

      it('should assign Job (book 18) to Wisdom', () => {
        expect(getBibleSection(18)).toBe('wisdom');
      });

      it('should assign Song of Solomon (book 22) to Wisdom', () => {
        expect(getBibleSection(22)).toBe('wisdom');
      });

      it('should assign Isaiah (book 23) to Major Prophets', () => {
        expect(getBibleSection(23)).toBe('major-prophets');
      });

      it('should assign Daniel (book 27) to Major Prophets', () => {
        expect(getBibleSection(27)).toBe('major-prophets');
      });

      it('should assign Hosea (book 28) to Minor Prophets', () => {
        expect(getBibleSection(28)).toBe('minor-prophets');
      });

      it('should assign Malachi (book 39) to Minor Prophets', () => {
        expect(getBibleSection(39)).toBe('minor-prophets');
      });
    });

    describe('New Testament (books 40-66)', () => {
      it('should assign Matthew (book 40) to Gospels', () => {
        expect(getBibleSection(40)).toBe('gospels');
      });

      it('should assign John (book 43) to Gospels', () => {
        expect(getBibleSection(43)).toBe('gospels');
      });

      it('should assign Acts (book 44) to Acts section', () => {
        expect(getBibleSection(44)).toBe('acts');
      });

      it('should assign Romans (book 45) to Pauline Epistles', () => {
        expect(getBibleSection(45)).toBe('pauline');
      });

      it('should assign Philemon (book 57) to Pauline Epistles', () => {
        expect(getBibleSection(57)).toBe('pauline');
      });

      it('should assign Hebrews (book 58) to General Epistles', () => {
        expect(getBibleSection(58)).toBe('general');
      });

      it('should assign Jude (book 65) to General Epistles', () => {
        expect(getBibleSection(65)).toBe('general');
      });

      it('should assign Revelation (book 66) to Revelation section', () => {
        expect(getBibleSection(66)).toBe('revelation');
      });
    });

    describe('Boundary books', () => {
      it('Genesis (book 1) should be first OT book in Pentateuch', () => {
        const section = getBibleSection(1);
        expect(section).toBe('pentateuch');
        const pentateuch = BIBLE_SECTIONS.find((s) => s.key === 'pentateuch');
        expect(pentateuch?.firstBook).toBe(1);
      });

      it('Malachi (book 39) should be last OT book', () => {
        const section = getBibleSection(39);
        expect(section).toBe('minor-prophets');
        // Verify no OT book beyond 39
        for (let book = 40; book <= 66; book++) {
          const sec = getBibleSection(book);
          expect(
            ['pentateuch', 'ot-history', 'wisdom', 'major-prophets', 'minor-prophets'].includes(sec)
          ).toBe(false);
        }
      });

      it('Matthew (book 40) should be first NT book', () => {
        const section = getBibleSection(40);
        expect(section).toBe('gospels');
        const gospels = BIBLE_SECTIONS.find((s) => s.key === 'gospels');
        expect(gospels?.firstBook).toBe(40);
      });

      it('Revelation (book 66) should be last book of Bible', () => {
        const section = getBibleSection(66);
        expect(section).toBe('revelation');
        const revelation = BIBLE_SECTIONS.find((s) => s.key === 'revelation');
        expect(revelation?.lastBook).toBe(66);
      });
    });
  });

  describe('Section groupings', () => {
    it('Pentateuch should include Genesis-Deuteronomy (books 1-5)', () => {
      const pentateuch = BIBLE_SECTIONS.find((s) => s.key === 'pentateuch');
      expect(pentateuch?.firstBook).toBe(1);
      expect(pentateuch?.lastBook).toBe(5);
      for (let book = 1; book <= 5; book++) {
        expect(getBibleSection(book)).toBe('pentateuch');
      }
    });

    it('OT History should include Joshua-Esther (books 6-17)', () => {
      const otHistory = BIBLE_SECTIONS.find((s) => s.key === 'ot-history');
      expect(otHistory?.firstBook).toBe(6);
      expect(otHistory?.lastBook).toBe(17);
      for (let book = 6; book <= 17; book++) {
        expect(getBibleSection(book)).toBe('ot-history');
      }
    });

    it('Wisdom should include Job-Song of Solomon (books 18-22)', () => {
      const wisdom = BIBLE_SECTIONS.find((s) => s.key === 'wisdom');
      expect(wisdom?.firstBook).toBe(18);
      expect(wisdom?.lastBook).toBe(22);
      for (let book = 18; book <= 22; book++) {
        expect(getBibleSection(book)).toBe('wisdom');
      }
    });

    it('Major Prophets should include Isaiah-Daniel (books 23-27)', () => {
      const majorProphets = BIBLE_SECTIONS.find((s) => s.key === 'major-prophets');
      expect(majorProphets?.firstBook).toBe(23);
      expect(majorProphets?.lastBook).toBe(27);
      for (let book = 23; book <= 27; book++) {
        expect(getBibleSection(book)).toBe('major-prophets');
      }
    });

    it('Minor Prophets should include Hosea-Malachi (books 28-39)', () => {
      const minorProphets = BIBLE_SECTIONS.find((s) => s.key === 'minor-prophets');
      expect(minorProphets?.firstBook).toBe(28);
      expect(minorProphets?.lastBook).toBe(39);
      for (let book = 28; book <= 39; book++) {
        expect(getBibleSection(book)).toBe('minor-prophets');
      }
    });

    it('Gospels should include Matthew-John (books 40-43)', () => {
      const gospels = BIBLE_SECTIONS.find((s) => s.key === 'gospels');
      expect(gospels?.firstBook).toBe(40);
      expect(gospels?.lastBook).toBe(43);
      for (let book = 40; book <= 43; book++) {
        expect(getBibleSection(book)).toBe('gospels');
      }
    });

    it('Acts should be single book (book 44)', () => {
      const acts = BIBLE_SECTIONS.find((s) => s.key === 'acts');
      expect(acts?.firstBook).toBe(44);
      expect(acts?.lastBook).toBe(44);
      expect(getBibleSection(44)).toBe('acts');
    });

    it('Pauline Epistles should include Romans-Philemon (books 45-57)', () => {
      const pauline = BIBLE_SECTIONS.find((s) => s.key === 'pauline');
      expect(pauline?.firstBook).toBe(45);
      expect(pauline?.lastBook).toBe(57);
      for (let book = 45; book <= 57; book++) {
        expect(getBibleSection(book)).toBe('pauline');
      }
    });

    it('General Epistles should include Hebrews-Jude (books 58-65)', () => {
      const general = BIBLE_SECTIONS.find((s) => s.key === 'general');
      expect(general?.firstBook).toBe(58);
      expect(general?.lastBook).toBe(65);
      for (let book = 58; book <= 65; book++) {
        expect(getBibleSection(book)).toBe('general');
      }
    });

    it('Revelation should be single book (book 66)', () => {
      const revelation = BIBLE_SECTIONS.find((s) => s.key === 'revelation');
      expect(revelation?.firstBook).toBe(66);
      expect(revelation?.lastBook).toBe(66);
      expect(getBibleSection(66)).toBe('revelation');
    });
  });

  describe('Invalid book numbers', () => {
    it('should throw error for book 0', () => {
      expect(() => getBibleSection(0)).toThrow('Invalid book number: 0');
    });

    it('should throw error for negative numbers', () => {
      expect(() => getBibleSection(-1)).toThrow('Invalid book number: -1');
      expect(() => getBibleSection(-100)).toThrow('Invalid book number: -100');
    });

    it('should throw error for book 67', () => {
      expect(() => getBibleSection(67)).toThrow('Invalid book number: 67');
    });

    it('should throw error for large numbers beyond 66', () => {
      expect(() => getBibleSection(100)).toThrow('Invalid book number: 100');
      expect(() => getBibleSection(1000)).toThrow('Invalid book number: 1000');
    });

    it('should throw error message containing the invalid book number', () => {
      try {
        getBibleSection(99);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('99');
      }
    });
  });

  describe('Book ordering verification', () => {
    it('should correctly order all 66 books sequentially', () => {
      for (let book = 1; book <= 66; book++) {
        // Should not throw for any book 1-66
        expect(() => getBibleSection(book)).not.toThrow();
      }
    });

    it('adjacent books should return valid sections', () => {
      for (let book = 1; book < 66; book++) {
        const current = getBibleSection(book);
        const next = getBibleSection(book + 1);
        expect(typeof current).toBe('string');
        expect(typeof next).toBe('string');
        // Both should be valid section keys
        const validKeys = BIBLE_SECTIONS.map((s) => s.key);
        expect(validKeys).toContain(current);
        expect(validKeys).toContain(next);
      }
    });

    it('books should transition correctly between sections', () => {
      // Test transitions at section boundaries
      for (let i = 0; i < BIBLE_SECTIONS.length - 1; i++) {
        const current = BIBLE_SECTIONS[i];
        const next = BIBLE_SECTIONS[i + 1];
        // Last book of current section
        expect(getBibleSection(current.lastBook)).toBe(current.key);
        // First book of next section
        expect(getBibleSection(next.firstBook)).toBe(next.key);
        // They should be different sections
        expect(current.key).not.toBe(next.key);
      }
    });
  });

  describe('Type safety and return values', () => {
    it('should return a valid BibleSectionKey for each valid book', () => {
      const validKeys = BIBLE_SECTIONS.map((s) => s.key);
      for (let book = 1; book <= 66; book++) {
        const result = getBibleSection(book);
        expect(validKeys).toContain(result);
      }
    });

    it('should consistently return the same section for the same book', () => {
      const testBooks = [1, 20, 40, 50, 66];
      for (const book of testBooks) {
        const firstCall = getBibleSection(book);
        const secondCall = getBibleSection(book);
        expect(firstCall).toBe(secondCall);
      }
    });

    it('BibleSectionInfo should have required properties', () => {
      for (const section of BIBLE_SECTIONS) {
        expect(section).toHaveProperty('key');
        expect(section).toHaveProperty('name');
        expect(section).toHaveProperty('firstBook');
        expect(section).toHaveProperty('lastBook');
      }
    });

    it('should have numeric book numbers', () => {
      for (const section of BIBLE_SECTIONS) {
        expect(typeof section.firstBook).toBe('number');
        expect(typeof section.lastBook).toBe('number');
        expect(Number.isInteger(section.firstBook)).toBe(true);
        expect(Number.isInteger(section.lastBook)).toBe(true);
      }
    });
  });
});
