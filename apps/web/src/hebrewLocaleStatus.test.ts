/**
 * B-149: Hebrew is promoted to beta, so the web language picker always lists
 * it (with the "Preview" badge every non-complete language carries) rather
 * than only while it is the active locale. Mirrors desktop's test.
 */
import { describe, expect, it } from 'vitest';
import { availableLocaleInfos, selectableLocaleInfos } from './i18n';
import meta from './locales/he-IL/meta.json';

describe('he-IL locale status (B-149)', () => {
  it('is beta', () => {
    expect(meta['locale.status']).toBe('beta');
    expect(availableLocaleInfos().find((i) => i.code === 'he-IL')?.status).toBe('beta');
  });

  it('is listed in the language picker even when another language is active', () => {
    expect(selectableLocaleInfos('en').some((i) => i.code === 'he-IL')).toBe(true);
    expect(selectableLocaleInfos().some((i) => i.code === 'he-IL')).toBe(true);
  });
});
