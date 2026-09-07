import { describe, it, expect } from 'vitest';
import { StrongsNumberHelper } from './StrongsNumberHelper';

describe('StrongsNumberHelper', () => {
  describe('parse', () => {
    it('should parse Greek numbers', () => {
      const result = StrongsNumberHelper.parse('G25');
      expect(result).toEqual({ prefix: 'G', number: 25, language: 'Greek' });
    });

    it('should parse Hebrew numbers', () => {
      const result = StrongsNumberHelper.parse('H7225');
      expect(result).toEqual({ prefix: 'H', number: 7225, language: 'Hebrew' });
    });

    it('should handle case insensitivity', () => {
      expect(StrongsNumberHelper.parse('g25')?.prefix).toBe('G');
      expect(StrongsNumberHelper.parse('h430')?.prefix).toBe('H');
    });

    it('should strip zero padding', () => {
      expect(StrongsNumberHelper.parse('G0025')?.number).toBe(25);
      expect(StrongsNumberHelper.parse('H07225')?.number).toBe(7225);
    });

    it('should handle strongs: prefix', () => {
      const result = StrongsNumberHelper.parse('strongs:G25');
      expect(result).toEqual({ prefix: 'G', number: 25, language: 'Greek' });
    });

    it('should return null for invalid input', () => {
      expect(StrongsNumberHelper.parse('')).toBeNull();
      expect(StrongsNumberHelper.parse('X25')).toBeNull();
      expect(StrongsNumberHelper.parse('G')).toBeNull();
      expect(StrongsNumberHelper.parse('25')).toBeNull();
      expect(StrongsNumberHelper.parse('G0')).toBeNull();
      expect(StrongsNumberHelper.parse('hello')).toBeNull();
    });
  });

  describe('isStrongsNumber', () => {
    it('should return true for valid numbers', () => {
      expect(StrongsNumberHelper.isStrongsNumber('G25')).toBe(true);
      expect(StrongsNumberHelper.isStrongsNumber('H7225')).toBe(true);
      expect(StrongsNumberHelper.isStrongsNumber('strongs:G25')).toBe(true);
    });

    it('should return false for invalid input', () => {
      expect(StrongsNumberHelper.isStrongsNumber('love')).toBe(false);
      expect(StrongsNumberHelper.isStrongsNumber('')).toBe(false);
    });
  });

  describe('toDictionaryKey', () => {
    it('should convert to 5-digit zero-padded key', () => {
      expect(StrongsNumberHelper.toDictionaryKey('G25')).toBe('00025');
      expect(StrongsNumberHelper.toDictionaryKey('H7225')).toBe('07225');
      expect(StrongsNumberHelper.toDictionaryKey('G3588')).toBe('03588');
    });

    it('should handle already-padded input', () => {
      expect(StrongsNumberHelper.toDictionaryKey('G0025')).toBe('00025');
    });

    it('should return null for invalid input', () => {
      expect(StrongsNumberHelper.toDictionaryKey('invalid')).toBeNull();
    });
  });

  describe('toDisplayFormat', () => {
    it('should produce canonical display format', () => {
      expect(StrongsNumberHelper.toDisplayFormat('G25')).toBe('G25');
      expect(StrongsNumberHelper.toDisplayFormat('H7225')).toBe('H7225');
      expect(StrongsNumberHelper.toDisplayFormat('G0025')).toBe('G25');
      expect(StrongsNumberHelper.toDisplayFormat('H07225')).toBe('H7225');
    });
  });

  describe('toInterlinearVariants', () => {
    it('should return single variant for Greek (no padding)', () => {
      const variants = StrongsNumberHelper.toInterlinearVariants('G25');
      expect(variants).toContain('G25');
      // Greek should not have padded variants
      expect(variants.length).toBe(1);
    });

    it('should return multiple variants for Hebrew (variable padding)', () => {
      const variants = StrongsNumberHelper.toInterlinearVariants('H430');
      expect(variants).toContain('H430');
      expect(variants).toContain('H0430');
      expect(variants).toContain('H00430');
    });

    it('should return variants for larger Hebrew numbers', () => {
      const variants = StrongsNumberHelper.toInterlinearVariants('H7225');
      expect(variants).toContain('H7225');
      expect(variants).toContain('H07225');
    });
  });

  describe('buildInterlinearWhereClause', () => {
    it('should build SQL clause with correct params', () => {
      const result = StrongsNumberHelper.buildInterlinearWhereClause('G25');
      expect(result).not.toBeNull();
      expect(result!.clause).toContain('strongs_number IN');
      expect(result!.params).toContain('G25');
    });

    it('should return null for invalid input', () => {
      expect(StrongsNumberHelper.buildInterlinearWhereClause('invalid')).toBeNull();
    });
  });

  describe('getDictionaryModule', () => {
    it('should return Greek dictionary for G prefix', () => {
      expect(StrongsNumberHelper.getDictionaryModule('G25')).toBe('strongsgreek');
    });

    it('should return Hebrew dictionary for H prefix', () => {
      expect(StrongsNumberHelper.getDictionaryModule('H430')).toBe('strongshebrew');
    });
  });
});
