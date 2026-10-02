import { describe, it, expect } from 'vitest';
import { contentDirAttrs } from './contentDirection';

describe('contentDirAttrs', () => {
  it('gives RTL for Arabic/Hebrew/Persian modules regardless of the UI', () => {
    for (const lang of ['ar', 'he', 'fa', 'he-IL', 'fa-IR']) {
      expect(contentDirAttrs(lang)).toEqual({ dir: 'rtl', lang, 'data-content-dir': 'rtl' });
    }
  });
  it('gives LTR for English and unknown languages', () => {
    expect(contentDirAttrs('en')).toEqual({ dir: 'ltr', lang: 'en', 'data-content-dir': 'ltr' });
    expect(contentDirAttrs(undefined)).toEqual({ dir: 'ltr', lang: undefined, 'data-content-dir': 'ltr' });
    expect(contentDirAttrs(null).dir).toBe('ltr');
  });
});
