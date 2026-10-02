import { describe, it, expect, beforeEach } from 'vitest';
import { moduleStore } from '../stores/moduleStore';
import {
  moduleLanguage,
  moduleDirection,
  moduleContentAttrs,
  contentSwipeStep,
  contentArrowStep,
} from './contentDirection';

function setModules(mods: Array<{ abbreviation: string; type: string; language_code: string }>) {
  (moduleStore as unknown as { availableModules: unknown[] }).availableModules = mods;
}

describe('contentDirection (task 0076)', () => {
  beforeEach(() => {
    setModules([
      { abbreviation: 'KJV', type: 'bible', language_code: 'en' },
      { abbreviation: 'SVD', type: 'bible', language_code: 'ar' },
      { abbreviation: 'WLC', type: 'bible', language_code: 'he' },
    ]);
  });

  it('finds a module language case-insensitively', () => {
    expect(moduleLanguage('svd')).toBe('ar');
    expect(moduleLanguage('nope')).toBeUndefined();
    expect(moduleLanguage(undefined)).toBeUndefined();
  });

  it('derives direction from the module, not the UI', () => {
    document.documentElement.dir = 'rtl'; // Arabic UI
    try {
      expect(moduleDirection('KJV')).toBe('ltr');
      expect(moduleDirection('SVD')).toBe('rtl');
      expect(moduleDirection('WLC')).toBe('rtl');
    } finally {
      document.documentElement.removeAttribute('dir');
    }
  });

  it('builds dir, lang and data-content-dir attributes', () => {
    expect(moduleContentAttrs('SVD')).toEqual({ dir: 'rtl', lang: 'ar', 'data-content-dir': 'rtl' });
    expect(moduleContentAttrs('KJV')).toEqual({ dir: 'ltr', lang: 'en', 'data-content-dir': 'ltr' });
  });

  it('swipes follow the content direction', () => {
    // LTR: swipe left = next, swipe right = prev
    expect(contentSwipeStep(-120, 'KJV')).toBe('next');
    expect(contentSwipeStep(120, 'KJV')).toBe('prev');
    // RTL: reversed
    expect(contentSwipeStep(-120, 'SVD')).toBe('prev');
    expect(contentSwipeStep(120, 'SVD')).toBe('next');
  });

  it('chapter arrow keys follow the content direction', () => {
    expect(contentArrowStep('ArrowRight', 'KJV')).toBe('next');
    expect(contentArrowStep('ArrowLeft', 'KJV')).toBe('prev');
    expect(contentArrowStep('ArrowRight', 'SVD')).toBe('prev');
    expect(contentArrowStep('ArrowLeft', 'SVD')).toBe('next');
    expect(contentArrowStep('ArrowUp', 'SVD')).toBeNull();
  });
});
