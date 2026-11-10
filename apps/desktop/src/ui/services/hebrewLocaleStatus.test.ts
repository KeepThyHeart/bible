/**
 * B-149: Hebrew is promoted to beta, so the language picker always lists it
 * (with the "Preview" notice every non-complete language carries) rather than
 * only while it is the active locale.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { LocaleMetadata } from './II18nService';
import { selectableLocales } from '../components/PreferencesDialog/GeneralSection';

const meta = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../locales/he-IL/meta.json'), 'utf8'),
) as Record<string, string>;

describe('he-IL locale status (B-149)', () => {
  it('is beta', () => {
    expect(meta['locale.status']).toBe('beta');
  });

  it('is listed in the language picker even when another language is active', () => {
    const he = { code: 'he-IL', name: 'Hebrew', nativeName: 'עברית', status: meta['locale.status'], direction: 'rtl' } as unknown as LocaleMetadata;
    const en = { code: 'en', name: 'English', nativeName: 'English', status: 'complete', direction: 'ltr' } as unknown as LocaleMetadata;
    expect(selectableLocales([en, he], 'en').map((i) => i.code)).toContain('he-IL');
  });
});
