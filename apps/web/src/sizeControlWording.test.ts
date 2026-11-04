/**
 * B-107 (web): the Aa popover and the Settings text-size labels use the same
 * terms as desktop: "Text scale" for the all-text control, "UI size" for the
 * interface, Bible / Study text for the reading sizes, and say what each
 * affects. No controls were added or merged.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, 'locales');
type Sizes = Record<string, string>;
const sizes = (loc: string) =>
  (JSON.parse(fs.readFileSync(path.join(ROOT, loc, 'ui.json'), 'utf8')) as { settings: { textSize: Sizes } }).settings.textSize;
const en = sizes('en');

describe('size control wording (en)', () => {
  it('names the controls with the desktop terms', () => {
    expect(en.popoverTitle).toBe('Text scale');
    expect(en.uiText).toBe('UI size');
    expect(en.bibleText).toBe('Bible Text');
    expect(en.studyText).toBe('Study Text');
    expect(en.decreaseAll).toContain('text scale');
    expect(en.increaseAll).toContain('text scale');
  });

  it('says what the all-text control affects, and what the link opens', () => {
    for (const k of ['decreaseAll', 'increaseAll']) {
      expect(en[k]).toMatch(/Bible, Study and UI text/);
    }
    expect(en.moreOptions).toMatch(/Bible, Study and UI sizes/);
  });

  it('no longer uses the old vague names', () => {
    for (const k of ['popoverTitle', 'decreaseAll', 'increaseAll', 'uiText', 'moreOptions']) {
      expect(en[k]).not.toMatch(/font sizes|UI Text|More text options|^Text size$/);
    }
  });
});

describe('size control wording (translations)', () => {
  const keys = ['popoverTitle', 'decreaseAll', 'increaseAll', 'uiText', 'moreOptions'];
  for (const loc of ['ar', 'es', 'fa-IR', 'he-IL', 'zh-Hans']) {
    it(`${loc} carries the reworded strings`, () => {
      const cat = sizes(loc);
      for (const k of keys) expect(cat[k], `${loc} ${k}`).not.toBe(en[k]);
      expect(cat.decreaseAll.length).toBeGreaterThan(en.popoverTitle.length);
    });
  }
});
