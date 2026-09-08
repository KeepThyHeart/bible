import { describe, it, expect } from 'vitest';
import { UserTextMarkup, HIGHLIGHT_COLOR_HEX } from '@bible/core';
import type { TextMarkupMetadata } from '@bible/core';
import {
  groupByColor,
  getHighlightStats,
  toExportFormat,
  exportToCSV
} from './highlightHelpers';

const YELLOW = HIGHLIGHT_COLOR_HEX.yellow.toUpperCase();
const GREEN = HIGHLIGHT_COLOR_HEX.green.toUpperCase();

function markup(color: string, verseIdStart = 43003016, metadata?: TextMarkupMetadata): UserTextMarkup {
  return new UserTextMarkup({ moduleId: 1, verseIdStart, color, metadata });
}

describe('highlightHelpers colour handling', () => {
  describe('groupByColor', () => {
    it('groups a v1 palette name and its v2 hex into one bucket', () => {
      const grouped = groupByColor([markup('yellow'), markup(YELLOW), markup('green')]);

      expect(grouped.get(YELLOW)).toHaveLength(2);
      expect(grouped.get(GREEN)).toHaveLength(1);
      expect(grouped.size).toBe(2);
    });

    it('keeps custom colours rather than discarding them', () => {
      const grouped = groupByColor([markup('#123456'), markup('#123456'), markup('yellow')]);

      expect(grouped.get('#123456')).toHaveLength(2);
      expect(grouped.get(YELLOW)).toHaveLength(1);
    });
  });

  describe('getHighlightStats', () => {
    it('always reports the six palette colours, zero when unused', () => {
      const stats = getHighlightStats([]);

      expect(Object.keys(stats.byColor)).toHaveLength(6);
      expect(stats.byColor[YELLOW]).toBe(0);
      expect(stats.total).toBe(0);
    });

    it('counts palette names and hex under the same canonical key', () => {
      const stats = getHighlightStats([markup('yellow'), markup('#fff3a3'), markup('green')]);

      expect(stats.byColor[YELLOW]).toBe(2);
      expect(stats.byColor[GREEN]).toBe(1);
      expect(stats.total).toBe(3);
    });

    it('adds a bucket for a custom colour', () => {
      const stats = getHighlightStats([markup('#123456')]);

      expect(stats.byColor['#123456']).toBe(1);
      expect(stats.byColor[YELLOW]).toBe(0);
    });

    it('counts markup types and notes', () => {
      const underlined = new UserTextMarkup({
        moduleId: 1,
        verseIdStart: 1001001,
        color: 'blue',
        noteId: 7,
        metadata: { markupType: 'underline' }
      });

      const stats = getHighlightStats([markup('yellow'), underlined]);

      expect(stats.byType.highlight).toBe(1);
      expect(stats.byType.underline).toBe(1);
      expect(stats.withNotes).toBe(1);
    });
  });

  describe('toExportFormat', () => {
    it('exports canonical hex plus the palette name when there is one', () => {
      const exported = toExportFormat(markup('yellow'));

      expect(exported.color).toBe(YELLOW);
      expect(exported.colorName).toBe('yellow');
    });

    it('omits the palette name for a custom colour', () => {
      const exported = toExportFormat(markup('#123456'));

      expect(exported.color).toBe('#123456');
      expect(exported.colorName).toBeUndefined();
    });

    it('exports the underline colour as hex only when underlined', () => {
      const both = markup('yellow', 43003016, { markupType: 'both', underlineColor: 'green' });

      expect(toExportFormat(both).underlineColor).toBe(GREEN);
      expect(toExportFormat(markup('yellow')).underlineColor).toBeUndefined();
    });
  });

  describe('exportToCSV', () => {
    it('includes both the hex and the palette-name columns', () => {
      const [header, row] = exportToCSV([markup('yellow')]).split('\n');

      expect(header).toContain('Color,Color Name');
      expect(row).toContain(`${YELLOW},yellow`);
    });
  });
});
