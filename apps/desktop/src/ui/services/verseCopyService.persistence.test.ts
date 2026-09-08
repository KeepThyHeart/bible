/**
 * Last-used copy/format settings survive a restart.
 *
 * These were module-level variables, so the user's chosen format reset every
 * time the app closed. They are localStorage-backed now, which means every
 * read has to survive the three ways that storage goes wrong: a stale format
 * id, malformed JSON, and a localStorage that throws outright.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getLastUsedFormatId,
  setLastUsedFormatId,
  getLastUsedFormatOptions,
  setLastUsedFormatOptions,
  getLastUsedCopyOptions,
  setLastUsedCopyOptions,
  DEFAULT_FORMAT_ID,
  DEFAULT_FORMAT_OPTIONS,
  DEFAULT_COPY_OPTIONS,
} from './verseCopyService';

const FORMAT_KEY = 'bible-desktop-last-copy-format';
const FORMAT_OPTIONS_KEY = 'bible-desktop-last-copy-format-options';

describe('last-used format persistence', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('round-trips a format id through storage', () => {
    setLastUsedFormatId('combined');
    expect(getLastUsedFormatId()).toBe('combined');
    // The point of the change: the value is in storage, not in a variable
    // that dies with the process.
    expect(localStorage.getItem(FORMAT_KEY)).toBe('combined');
  });

  it('falls back to the default when nothing is stored', () => {
    expect(getLastUsedFormatId()).toBe(DEFAULT_FORMAT_ID);
  });

  it('falls back when the stored id names a format that no longer exists', () => {
    localStorage.setItem(FORMAT_KEY, 'a-format-we-removed');
    expect(getLastUsedFormatId()).toBe(DEFAULT_FORMAT_ID);
  });

  it('round-trips format options', () => {
    setLastUsedFormatOptions({ displayVersionNumber: false, wordsOfChristInRed: false });
    expect(getLastUsedFormatOptions()).toEqual({ displayVersionNumber: false, wordsOfChristInRed: false });
  });

  it('falls back per field when the stored options are malformed', () => {
    localStorage.setItem(FORMAT_OPTIONS_KEY, '{"displayVersionNumber": "yes please"');
    expect(getLastUsedFormatOptions()).toEqual(DEFAULT_FORMAT_OPTIONS);

    // Valid JSON, one bad field: keep the good one, default the bad one.
    localStorage.setItem(FORMAT_OPTIONS_KEY, JSON.stringify({ displayVersionNumber: false, wordsOfChristInRed: 'red' }));
    expect(getLastUsedFormatOptions()).toEqual({
      displayVersionNumber: false,
      wordsOfChristInRed: DEFAULT_FORMAT_OPTIONS.wordsOfChristInRed,
    });
  });

  it('survives a localStorage that throws on read and on write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => setLastUsedFormatId('combined')).not.toThrow();
    expect(getLastUsedFormatId()).toBe(DEFAULT_FORMAT_ID);
    expect(getLastUsedFormatOptions()).toEqual(DEFAULT_FORMAT_OPTIONS);
    expect(getLastUsedCopyOptions()).toEqual(DEFAULT_COPY_OPTIONS);
  });

  it('round-trips legacy copy options too', () => {
    setLastUsedCopyOptions({ includeReference: false, includeVerseNumbers: false, includeTranslation: true });
    expect(getLastUsedCopyOptions()).toEqual({
      includeReference: false,
      includeVerseNumbers: false,
      includeTranslation: true,
    });
  });
});
