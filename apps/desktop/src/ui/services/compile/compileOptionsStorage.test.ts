import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_COMPILE_OPTIONS,
  loadCompileFolder,
  loadCompileOptions,
  saveCompileFolder,
  saveCompileOptions,
} from './compileOptionsStorage';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('compileOptionsStorage', () => {
  it('defaults when nothing is stored', () => {
    expect(loadCompileOptions()).toEqual(DEFAULT_COMPILE_OPTIONS);
  });

  it('round-trips', () => {
    const o = { ...DEFAULT_COMPILE_OPTIONS, canonicalOrder: true, versesWithoutNotes: 'blank-space' as const, blankLines: 8 };
    saveCompileOptions(o);
    expect(loadCompileOptions()).toEqual(o);
  });

  it('a bad field falls back alone', () => {
    localStorage.setItem(
      'bible-desktop-compile-options',
      JSON.stringify({ canonicalOrder: true, verseLabel: 'wat', blankLines: -3, translation: 5, passageHeadings: 'yes' }),
    );
    expect(loadCompileOptions()).toEqual({ ...DEFAULT_COMPILE_OPTIONS, canonicalOrder: true });
  });

  it('malformed JSON gives defaults', () => {
    localStorage.setItem('bible-desktop-compile-options', '{nope');
    expect(loadCompileOptions()).toEqual(DEFAULT_COMPILE_OPTIONS);
  });

  it('survives a throwing localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(loadCompileOptions()).toEqual(DEFAULT_COMPILE_OPTIONS);
    expect(loadCompileFolder()).toBe('');
    expect(() => saveCompileOptions(DEFAULT_COMPILE_OPTIONS)).not.toThrow();
    expect(() => saveCompileFolder('x')).not.toThrow();
  });

  it('stores the folder', () => {
    saveCompileFolder('Sermons');
    expect(loadCompileFolder()).toBe('Sermons');
  });
});
