/**
 * B-107: the interface-size, text-scale and text-size controls say what each
 * one affects and point at the others, in the same words everywhere.
 * (The controls stay separate; nothing is merged.)
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../locales');
const ui = (loc: string) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, loc, 'ui.json'), 'utf8')) as Record<string, string>;
const en = ui('en');
const P = 'preferencesDialog.';

describe('size control wording (en)', () => {
  it('names the three controls consistently: UI size, Text scale, Typography text sizes', () => {
    expect(en[P + 'uiControlFontSizeLabel']).toMatch(/^UI size: /);
    expect(en[P + 'globalFontScaleLabel']).toMatch(/^Text scale: /);
    expect(en[P + 'resetTo14']).toContain('UI size');
    expect(en[P + 'resetTo100']).toContain('text scale');
    expect(en[P + 'decreaseFontScale']).toContain('text scale');
    expect(en[P + 'increaseFontScale']).toContain('text scale');
  });

  it('says what each control affects', () => {
    expect(en[P + 'uiControlFontSizeDescription']).toMatch(/whole interface/);
    expect(en[P + 'uiControlFontSizeDescription']).toMatch(/Bible text/);
    expect(en[P + 'globalFontScaleDescription']).toMatch(/all text/);
    expect(en[P + 'typographyIntro']).toMatch(/Bible text applies to the Bible pane/);
    expect(en[P + 'typographyIntro']).toMatch(/Study \/ pane text applies to the Study pane/);
  });

  it('cross-references the other controls', () => {
    expect(en[P + 'uiControlFontSizeDescription']).toContain('Typography');
    expect(en[P + 'globalFontScaleDescription']).toContain('UI size');
    expect(en[P + 'typographyIntro']).toContain('UI size');
    expect(en[P + 'typographyIntro']).toContain('Text scale');
    expect(en[P + 'fontsIntro']).toContain('text scale');
  });

  it('no longer uses the old "Global Font Scale" / "UI Control Font Size" names', () => {
    for (const k of ['uiControlFontSizeLabel', 'uiControlFontSizeDescription', 'globalFontScaleLabel', 'globalFontScaleDescription', 'typographyIntro', 'fontsIntro']) {
      expect(en[P + k]).not.toMatch(/Global Font Scale|UI Control Font Size|global font scale/i);
    }
  });
});

describe('size control wording (translations)', () => {
  const reworded = ['uiControlFontSizeLabel', 'uiControlFontSizeDescription', 'globalFontScaleLabel', 'globalFontScaleDescription', 'typographyIntro', 'fontsIntro', 'resetTo100', 'resetTo14', 'decreaseFontScale', 'increaseFontScale'];
  const locales = ['ar', 'es', 'fa-IR', 'he-IL', 'hi', 'pt-BR', 'ru', 'zh-Hans'];
  for (const loc of locales) {
    it(`${loc} carries the reworded strings`, () => {
      const cat = ui(loc);
      for (const k of reworded) expect(cat[P + k], `${loc} ${k}`).not.toBe(en[P + k]);
      // The new descriptions are longer than the old one-liners: they name what is affected.
      expect(cat[P + 'uiControlFontSizeDescription'].length).toBeGreaterThan(60);
    });
    it(`${loc} keeps the placeholders`, () => {
      const cat = ui(loc);
      expect(cat[P + 'uiControlFontSizeLabel']).toContain('{size}');
      expect(cat[P + 'globalFontScaleLabel']).toContain('{percent}');
      expect(cat[P + 'fontsIntro']).toContain('{percent}');
    });
  }
});
