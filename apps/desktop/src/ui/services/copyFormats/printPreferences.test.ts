import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadPassageMarkupOptions, savePassageMarkupOptions } from './passageMarkupPreferences';
import { loadPrintPreferences, savePrintPreferences } from './printPreferences';

describe('printPreferences', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('gives a first-time user numbered verses, no margin', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
    expect(loadPrintPreferences()).toEqual({
      layout: 'numbered', notesMargin: false, notesMarginCm: 5, notesRule: false, unit: 'cm', lineSpacing: 1.6, fontSizePt: 14,
      showTitle: true, theme: 'bw', redLetters: false, verseNumbers: 'parenthetical',
    });
  });

  it('remembers the choices', () => {
    const prefs = {
      layout: 'blockquote', notesMargin: true, notesMarginCm: 7, notesRule: true, unit: 'in', lineSpacing: 2, fontSizePt: 12, showTitle: false, theme: 'sepia', redLetters: true, verseNumbers: 'first-full',
    } as const;
    savePrintPreferences(prefs);
    expect(loadPrintPreferences()).toEqual(prefs);
  });

  it('keeps its own verse-number style, whatever Copy last used', () => {
    savePassageMarkupOptions('blockquote-numbered', { ...loadPassageMarkupOptions('blockquote-numbered'), verseNumbers: 'none' });
    expect(loadPrintPreferences().verseNumbers).toBe('parenthetical');
  });

  it('defaults the unit from the locale until one is saved', () => {
    const spy = vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    expect(loadPrintPreferences().unit).toBe('in');
    savePrintPreferences({ ...loadPrintPreferences(), unit: 'cm' });
    expect(loadPrintPreferences().unit).toBe('cm');
    spy.mockRestore();
  });

  it('is independent of the Copy dialog keys and survives garbage', () => {
    localStorage.setItem('bible-desktop-last-insert-format', 'blockquote');
    expect(loadPrintPreferences().layout).toBe('numbered');
    localStorage.setItem('bible-desktop-print-preferences', '{not json');
    expect(loadPrintPreferences().layout).toBe('numbered');
  });
});
