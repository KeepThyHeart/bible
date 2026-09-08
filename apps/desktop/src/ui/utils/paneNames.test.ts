import { describe, it, expect } from 'vitest';
import { PANE_NAME_KEYS, localizePaneLabel, genericEnglishTitle } from './paneNames';

/** Stands in for a locale where every pane name is obviously not English. */
const t = (key: string) => `<${key}>`;

describe('localizePaneLabel', () => {
  it('translates the generic English title of a default panel', () => {
    expect(localizePaneLabel(t, 'study', 'Study')).toBe('<paneName.study>');
    expect(localizePaneLabel(t, 'commentary', 'Commentary')).toBe('<paneName.commentary>');
    expect(localizePaneLabel(t, 'bible', 'Bible')).toBe('<paneName.bible>');
    expect(localizePaneLabel(t, 'newtab', 'New Tab')).toBe('<paneName.newTab>');
  });

  it('translates the raw content type, which is what addPanel falls back to', () => {
    expect(localizePaneLabel(t, 'topics', 'topics')).toBe('<paneName.topics>');
  });

  it('leaves a content-derived title alone', () => {
    // A passage and a module name are data, not chrome.
    expect(localizePaneLabel(t, 'bible', 'John 3')).toBe('John 3');
    expect(localizePaneLabel(t, 'commentary', 'Matthew Henry')).toBe('Matthew Henry');
    expect(localizePaneLabel(t, 'dictionary', "Strong's Greek")).toBe("Strong's Greek");
  });

  it('does not translate a title that belongs to a different pane type', () => {
    // "Bible" as a *book* pane's title is a module called Bible, not the
    // Bible pane; only the type's own generic label is a candidate.
    expect(localizePaneLabel(t, 'book', 'Bible')).toBe('Bible');
  });

  it('passes through extension panels, which name themselves', () => {
    expect(localizePaneLabel(t, 'ext:my.extension', 'Study')).toBe('Study');
  });

  it('passes through when there is no content type or no title', () => {
    expect(localizePaneLabel(t, undefined, 'Study')).toBe('Study');
    expect(localizePaneLabel(t, 'study', undefined)).toBeUndefined();
    expect(localizePaneLabel(t, 'study', '')).toBe('');
  });

  it('has a catalog key for every named pane type', () => {
    for (const [type, key] of Object.entries(PANE_NAME_KEYS)) {
      expect(key, type).toMatch(/^paneName\./);
    }
  });
});

describe('genericEnglishTitle', () => {
  /**
   * Panel titles are persisted into the serialized layout. Writing the
   * *localized* label to disk when creating a pane while a non-English locale
   * is active would store, e.g., an Arabic user's Commentary tab as
   * "التفسير", which `localizePaneLabel` cannot match and therefore can never
   * translate again, not even after switching back to English. Call sites
   * must store the canonical English title and localize at render time
   * instead.
   */
  it('round-trips through localizePaneLabel for every named pane type', () => {
    for (const type of Object.keys(PANE_NAME_KEYS) as Array<keyof typeof PANE_NAME_KEYS>) {
      const stored = genericEnglishTitle(type);
      expect(stored, `no canonical title for ${type}`).toBeTruthy();
      // The whole contract: what we persist is what we can later localize.
      expect(localizePaneLabel(t, type, stored), `${type} did not round-trip`).toBe(
        `<${PANE_NAME_KEYS[type]}>`,
      );
    }
  });

  it('returns undefined for extension panels, which name themselves', () => {
    expect(genericEnglishTitle('ext:some.extension')).toBeUndefined();
  });

  it('never returns already-localized text', () => {
    // Guards the regression directly: if a call site passed a translated label
    // in, it would not survive this round trip.
    expect(localizePaneLabel(t, 'commentary', '<paneName.commentary>')).toBe(
      '<paneName.commentary>',
    );
    expect(genericEnglishTitle('commentary')).toBe('Commentary');
  });
});
