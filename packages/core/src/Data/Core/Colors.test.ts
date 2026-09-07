import { describe, it, expect } from 'vitest';
import {
  HIGHLIGHT_COLOR_NAMES,
  HIGHLIGHT_COLOR_HEX,
  isHexColor,
  isHighlightColorName,
  normalizeMarkupColor,
  markupColorName
} from './Colors';

describe('markup colours', () => {
  it('maps every palette name to a distinct hex value', () => {
    const hexes = HIGHLIGHT_COLOR_NAMES.map(n => HIGHLIGHT_COLOR_HEX[n]);
    expect(hexes).toHaveLength(6);
    expect(new Set(hexes).size).toBe(6);
    expect(hexes.every(h => isHexColor(h))).toBe(true);
  });

  describe('normalizeMarkupColor', () => {
    it('passes canonical hex through, upper-cased', () => {
      expect(normalizeMarkupColor('#aabbcc')).toBe('#AABBCC');
    });

    it('expands short hex', () => {
      expect(normalizeMarkupColor('#abc')).toBe('#AABBCC');
    });

    it('resolves a v1 palette name to its hex', () => {
      expect(normalizeMarkupColor('green')).toBe(HIGHLIGHT_COLOR_HEX.green.toUpperCase());
      expect(normalizeMarkupColor('  YELLOW ')).toBe(HIGHLIGHT_COLOR_HEX.yellow.toUpperCase());
    });

    it('falls back for unrecognised input', () => {
      expect(normalizeMarkupColor('chartreuse')).toBe(HIGHLIGHT_COLOR_HEX.yellow);
      expect(normalizeMarkupColor(undefined)).toBe(HIGHLIGHT_COLOR_HEX.yellow);
      expect(normalizeMarkupColor(42)).toBe(HIGHLIGHT_COLOR_HEX.yellow);
      expect(normalizeMarkupColor('nope', '#000000')).toBe('#000000');
    });
  });

  describe('markupColorName', () => {
    it('round-trips every palette swatch through hex', () => {
      for (const name of HIGHLIGHT_COLOR_NAMES) {
        expect(markupColorName(HIGHLIGHT_COLOR_HEX[name])).toBe(name);
        expect(markupColorName(name)).toBe(name);
      }
    });

    it('returns undefined for a custom colour', () => {
      expect(markupColorName('#123456')).toBeUndefined();
      expect(markupColorName('not a colour')).toBeUndefined();
    });
  });

  describe('type guards', () => {
    it('recognises hex and palette names', () => {
      expect(isHexColor('#FFF3A3')).toBe(true);
      expect(isHexColor('#FFF')).toBe(false);       // short hex is not canonical
      expect(isHexColor('yellow')).toBe(false);
      expect(isHighlightColorName('yellow')).toBe(true);
      expect(isHighlightColorName('#FFF3A3')).toBe(false);
    });
  });
});
