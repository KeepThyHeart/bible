import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// B-161: the Download button for the speech model lives in Preferences > Speech.
describe('Privacy list pointer for the speech model', () => {
  for (const loc of ['en', 'ar', 'es', 'fa-IR', 'he-IL', 'hi', 'pt-BR', 'ru', 'zh-Hans']) {
    it(`${loc} names the Speech section, not Downloads & storage`, () => {
      const c = JSON.parse(readFileSync(join(__dirname, '../../../../locales', loc, 'ui.json'), 'utf8'));
      expect(c['preferencesDialog.privacyOnlineSpeech']).toContain(c['preferencesDialog.sectionSpeech']);
      expect(c['preferencesDialog.privacyOnlineSpeech']).not.toContain(c['preferencesDialog.sectionDownloads']);
    });
  }
});
