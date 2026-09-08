/**
 * Per-format insertion preferences.
 *
 * The contract worth protecting is that the settings are *independent*: an H2
 * choice for verse headings and a no-quote-marks choice for inline quotations
 * both have to come back, and neither may overwrite the other. Everything else
 * here is the degrade-gracefully rule the sibling copy stores follow - a bad
 * value must cost the user that one field, not their whole setup.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadPassageMarkupOptions,
  savePassageMarkupOptions,
  getLastInsertFormatId,
  setLastInsertFormatId,
  getSkipFormatMenu,
  setSkipFormatMenu,
  DEFAULT_INSERT_FORMAT_ID,
  PASSAGE_INSERT_KEYS,
} from './passageMarkupPreferences';
import { DEFAULT_PASSAGE_MARKUP_OPTIONS } from '@bible/core';

describe('per-format option persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns that format’s own defaults when nothing is saved', () => {
    expect(loadPassageMarkupOptions('inline-quote')).toEqual(
      DEFAULT_PASSAGE_MARKUP_OPTIONS['inline-quote'],
    );
    // Different formats have deliberately different defaults.
    expect(loadPassageMarkupOptions('blockquote').verseNumbers).toBe('none');
    expect(loadPassageMarkupOptions('blockquote-numbered').verseNumbers).toBe('parenthetical');
  });

  it('round-trips a format’s options across a restart', () => {
    savePassageMarkupOptions('heading-per-verse', {
      ...DEFAULT_PASSAGE_MARKUP_OPTIONS['heading-per-verse'],
      headingLevel: 2,
      displayVersionNumber: false,
    });

    // A restart is exactly this: the module re-reads storage from scratch.
    const restored = loadPassageMarkupOptions('heading-per-verse');
    expect(restored.headingLevel).toBe(2);
    expect(restored.displayVersionNumber).toBe(false);
  });

  it('keeps each format’s settings apart', () => {
    savePassageMarkupOptions('heading-per-verse', {
      ...DEFAULT_PASSAGE_MARKUP_OPTIONS['heading-per-verse'],
      headingLevel: 2,
    });
    savePassageMarkupOptions('inline-quote', {
      ...DEFAULT_PASSAGE_MARKUP_OPTIONS['inline-quote'],
      quoteMarks: 'none',
    });

    // The whole point: switching between the two does not make the user
    // re-choose either.
    expect(loadPassageMarkupOptions('heading-per-verse').headingLevel).toBe(2);
    expect(loadPassageMarkupOptions('inline-quote').quoteMarks).toBe('none');
    expect(loadPassageMarkupOptions('inline-quote').headingLevel).toBe(
      DEFAULT_PASSAGE_MARKUP_OPTIONS['inline-quote'].headingLevel,
    );
  });

  it('falls back per field, so one bad value cannot discard the rest', () => {
    localStorage.setItem(
      PASSAGE_INSERT_KEYS.options,
      JSON.stringify({
        blockquote: { verseNumbers: 'sideways', referencePosition: 'none', headingLevel: 99 },
      }),
    );

    const loaded = loadPassageMarkupOptions('blockquote');
    expect(loaded.referencePosition).toBe('none');
    expect(loaded.verseNumbers).toBe(DEFAULT_PASSAGE_MARKUP_OPTIONS.blockquote.verseNumbers);
    expect(loaded.headingLevel).toBe(DEFAULT_PASSAGE_MARKUP_OPTIONS.blockquote.headingLevel);
  });

  it('degrades to defaults on malformed JSON', () => {
    localStorage.setItem(PASSAGE_INSERT_KEYS.options, '{not json');
    expect(loadPassageMarkupOptions('blockquote')).toEqual(DEFAULT_PASSAGE_MARKUP_OPTIONS.blockquote);
  });

  it('survives a localStorage that throws', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    expect(loadPassageMarkupOptions('blockquote')).toEqual(DEFAULT_PASSAGE_MARKUP_OPTIONS.blockquote);
    expect(() =>
      savePassageMarkupOptions('blockquote', DEFAULT_PASSAGE_MARKUP_OPTIONS.blockquote),
    ).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});

describe('last-used format', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('opens on the default until something is chosen', () => {
    expect(getLastInsertFormatId()).toBe(DEFAULT_INSERT_FORMAT_ID);
  });

  it('remembers a markup format and a clipboard format alike', () => {
    setLastInsertFormatId('heading-per-verse');
    expect(getLastInsertFormatId()).toBe('heading-per-verse');

    // The picker offers both families, so either may be the last choice.
    setLastInsertFormatId('template');
    expect(getLastInsertFormatId()).toBe('template');
  });

  // "Standard" and "Combined" are still renderable - a note written with one
  // keeps its shape - but they are no longer offered, so opening the picker on
  // one would show a list with nothing selected. The closest surviving shape
  // is what the user gets instead, not the default.
  it('remaps a retired format onto the shape it was a restatement of', () => {
    setLastInsertFormatId('standard');
    expect(getLastInsertFormatId()).toBe('blockquote-numbered');

    setLastInsertFormatId('combined');
    expect(getLastInsertFormatId()).toBe('inline-quote');
  });

  it('ignores an id that names no format at all', () => {
    localStorage.setItem(PASSAGE_INSERT_KEYS.lastFormat, 'format-from-a-later-version');
    expect(getLastInsertFormatId()).toBe(DEFAULT_INSERT_FORMAT_ID);
  });
});

describe('skip-the-menu preference', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is off by default — Tab asks', () => {
    expect(getSkipFormatMenu()).toBe(false);
  });

  it('round-trips both ways', () => {
    setSkipFormatMenu(true);
    expect(getSkipFormatMenu()).toBe(true);
    setSkipFormatMenu(false);
    expect(getSkipFormatMenu()).toBe(false);
  });

  it('reads as off when storage is unavailable, so the menu is never lost', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    expect(getSkipFormatMenu()).toBe(false);
  });
});
