import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRINT_PREFERENCES,
  defaultPrintUnit,
  notesMarginFromUnit,
  notesMarginInUnit,
  buildPrintStylesheet,
  clampNotesMarginCm,
  normalizePrintPreferences,
  printTitleHtml,
  printWantsRedLetters,
  printLayoutFormatId,
  printNotesRuleHtml,
} from './printLayout';

describe('printLayout', () => {
  it('defaults to numbered verses with no notes margin', () => {
    expect(normalizePrintPreferences(undefined)).toEqual(DEFAULT_PRINT_PREFERENCES);
    expect(DEFAULT_PRINT_PREFERENCES.layout).toBe('numbered');
    expect(DEFAULT_PRINT_PREFERENCES.notesMargin).toBe(false);
  });

  it('keeps valid saved fields and repairs each bad one on its own', () => {
    expect(normalizePrintPreferences({ layout: 'blockquote', notesMargin: true, notesMarginCm: 6.5, notesRule: true, unit: 'in', lineSpacing: 2.5, fontSizePt: 12, showTitle: false, theme: 'sepia', redLetters: true, verseNumbers: 'superscript' }))
      .toEqual({ layout: 'blockquote', notesMargin: true, notesMarginCm: 6.5, notesRule: true, unit: 'in', lineSpacing: 2.5, fontSizePt: 12, showTitle: false, theme: 'sepia', redLetters: true, verseNumbers: 'superscript' });
    expect(normalizePrintPreferences({ layout: 'bogus', notesMargin: 'yes', notesMarginCm: 'wide', unit: 'furlong', lineSpacing: 7, fontSizePt: 'big', notesRule: 1, theme: 'neon', showTitle: 'yes', redLetters: 3, verseNumbers: 'roman' }))
      .toEqual(DEFAULT_PRINT_PREFERENCES);
    expect(normalizePrintPreferences({ layout: 'blockquote', notesMarginCm: 99 }))
      .toMatchObject({ layout: 'blockquote', notesMarginCm: 8.3 });
  });

  it('clamps and steps the margin width', () => {
    expect(clampNotesMarginCm(1)).toBe(3);
    expect(clampNotesMarginCm(20)).toBe(8.3);
    expect(clampNotesMarginCm(NaN)).toBe(5);
  });

  it('converts between cm and inches on quarter-inch steps and half-cm steps', () => {
    expect(notesMarginInUnit(5, 'cm')).toBe(5);
    expect(notesMarginInUnit(4.3, 'cm')).toBe(4.5);
    expect(notesMarginInUnit(5, 'in')).toBe(2);
    expect(notesMarginInUnit(3, 'in')).toBe(1.25);
    expect(notesMarginInUnit(8.3, 'in')).toBe(3.25);
    expect(notesMarginFromUnit(2, 'in')).toBeCloseTo(5.08, 5);
    expect(notesMarginFromUnit(3.25, 'in')).toBe(8.255);
  });

  it('defaults the unit from the locale and keeps a saved unit', () => {
    expect(defaultPrintUnit('en-US')).toBe('in');
    expect(defaultPrintUnit('en-GB')).toBe('cm');
    expect(defaultPrintUnit('es')).toBe('cm');
    expect(defaultPrintUnit(undefined)).toBe('cm');
    expect(normalizePrintPreferences(null, 'in').unit).toBe('in');
    expect(normalizePrintPreferences({ unit: 'cm' }, 'in').unit).toBe('cm');
  });

  it('applies line spacing and text size to the page', () => {
    const css = buildPrintStylesheet({ ...DEFAULT_PRINT_PREFERENCES, lineSpacing: 2.5, fontSizePt: 11 });
    expect(css).toContain('font-size: 11pt; line-height: 2.5');
    expect(buildPrintStylesheet(DEFAULT_PRINT_PREFERENCES)).toContain('font-size: 14pt; line-height: 1.6');
  });

  it('maps layouts to formats', () => {
    expect(printLayoutFormatId('numbered')).toBe('blockquote-numbered');
    expect(printLayoutFormatId('blockquote')).toBe('blockquote');
    expect(printLayoutFormatId('preview')).toBeNull();
  });

  it('draws no quote line by default but does for the block-quote layout', () => {
    expect(buildPrintStylesheet(DEFAULT_PRINT_PREFERENCES)).not.toContain('border-inline-start: 2px');
    expect(buildPrintStylesheet({ ...DEFAULT_PRINT_PREFERENCES, layout: 'blockquote' }))
      .toContain('border-inline-start: 2px solid #000');
  });

  it('narrows the text column with an inline-end margin, only when on', () => {
    const off = buildPrintStylesheet(DEFAULT_PRINT_PREFERENCES);
    expect(off).not.toContain('padding-inline-end');
    expect(printNotesRuleHtml(DEFAULT_PRINT_PREFERENCES)).toBe('');
    const on = { ...DEFAULT_PRINT_PREFERENCES, notesMargin: true, notesMarginCm: 6 };
    const css = buildPrintStylesheet(on);
    // No rule by default: plain blank space.
    expect(css).toContain('padding-inline-end: 6cm');
    expect(css).not.toContain('notes-rule');
    expect(printNotesRuleHtml(on)).toBe('');
    expect(css).toContain('font-size: 14pt');
    // With the rule on, the text stops a gap short of it.
    const ruled = { ...on, notesRule: true };
    const ruledCss = buildPrintStylesheet(ruled);
    expect(ruledCss).toContain('padding-inline-end: 6.5cm');
    expect(ruledCss).toContain('inset-inline-end: 6cm');
    expect(printNotesRuleHtml(ruled)).toContain('notes-rule');
  });

  it('is black and white by default, with a bold title', () => {
    const css = buildPrintStylesheet(DEFAULT_PRINT_PREFERENCES);
    expect(css).toContain('font-weight: 700');
    expect(css).not.toContain('h1, sup { color');
    expect(DEFAULT_PRINT_PREFERENCES.theme).toBe('bw');
    expect(DEFAULT_PRINT_PREFERENCES.showTitle).toBe(true);
  });

  it('colours only the title and verse numbers in a colour theme', () => {
    const css = buildPrintStylesheet({ ...DEFAULT_PRINT_PREFERENCES, theme: 'blue' });
    expect(css).toContain('h1, sup { color: #1f4e8c !important; }');
    expect(css).toContain('* { color: #000 !important');
    expect(css).not.toContain('B71C1C');
  });

  it('keeps words of Christ red only in a colour theme when asked', () => {
    expect(printWantsRedLetters({ ...DEFAULT_PRINT_PREFERENCES, redLetters: true })).toBe(false);
    expect(printWantsRedLetters({ ...DEFAULT_PRINT_PREFERENCES, theme: 'green', redLetters: true })).toBe(true);
    expect(buildPrintStylesheet({ ...DEFAULT_PRINT_PREFERENCES, theme: 'green', redLetters: true })).toContain('B71C1C');
    expect(buildPrintStylesheet({ ...DEFAULT_PRINT_PREFERENCES, redLetters: true })).not.toContain('B71C1C');
  });

  it('prints the title only when asked, escaped', () => {
    expect(printTitleHtml('A <b>', DEFAULT_PRINT_PREFERENCES)).toBe('<h1>A &lt;b&gt;</h1>');
    expect(printTitleHtml('A', { ...DEFAULT_PRINT_PREFERENCES, showTitle: false })).toBe('');
  });
});
