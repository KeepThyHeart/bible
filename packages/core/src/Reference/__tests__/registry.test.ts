import { describe, it, expect, vi } from 'vitest';
import { ReferenceEngine } from '../engine';
import {
  addReferenceLocaleSource,
  availableReferenceLocales,
  getMergedReferenceLocale,
  loadedReferenceLocaleFor,
  loadedReferenceLocales,
  loadReferenceLocales,
  onReferenceLocalesChanged,
  referenceLocalesVersion,
  registerReferenceLocale,
  resolveReferenceLocaleTag,
} from '../registry';
import { validateReferenceLocale } from '../validate';
import type { ReferenceLocaleData } from '../types';
import { encodeParse } from './helpers';

// NOTE: registry state is module-level and shared by every test in this file,
// so the tests below run in a deliberate order (fresh state first).

describe('resolveReferenceLocaleTag', () => {
  it.each([
    ['zh-CN', 'zh-Hans'],
    ['zh-Hans', 'zh-Hans'],
    ['zh-Hans-CN', 'zh-Hans'],
    ['zh-SG', 'zh-Hans'],
    ['zh-TW', undefined],
    ['zh-Hant', undefined],
    ['ar-SA', 'ar'],
    ['ar', 'ar'],
    ['es-MX', 'es'],
    ['es_ES', 'es'],
    ['pt-BR', undefined],
    ['EN', 'en'],
    ['en-GB', 'en'],
    ['fa-IR', 'fa'],
    ['he-IL', 'he'],
    ['', undefined],
    ['xx', undefined],
  ])('%s -> %s', (tag, expected) => {
    expect(resolveReferenceLocaleTag(tag)).toBe(expected);
  });

  it('honours an explicit list of known tags', () => {
    expect(resolveReferenceLocaleTag('pt-BR', ['pt-BR', 'pt'])).toBe('pt-BR');
    expect(resolveReferenceLocaleTag('pt-PT', ['pt-BR', 'pt'])).toBe('pt');
    expect(resolveReferenceLocaleTag('ZH-hans', ['zh-Hans'])).toBe('zh-Hans');
  });
});

describe('loading on demand', () => {
  it('only English is loaded at first', () => {
    expect(loadedReferenceLocales()).toEqual(['en']);
    expect(availableReferenceLocales()).toEqual(expect.arrayContaining(['en', 'es', 'zh-Hans', 'ar', 'he', 'fa']));
    expect(loadedReferenceLocaleFor('fa')).toBeUndefined();
    expect(getMergedReferenceLocale('fa')).toBeUndefined();
  });

  it('before loading, an fa engine knows only OSIS ids', () => {
    const e = ReferenceEngine.create({ locales: ['fa'] });
    expect(e.locales).toEqual([]);
    expect(e.parse('یوحنا ۳:۱۶').ok).toBe(false);
    expect(e.parse('John 3:16').ok).toBe(true); // "John" is also the OSIS id
    const r = e.parse('John 3:16');
    expect(r.ok && r.locale).toBe('osis');
    expect(e.parse('Genesis 1:1').ok).toBe(false); // an English long name, not OSIS
    expect(encodeParse(e.parse('Gen 1:1'))).toBe('1:1:1');
    expect(e.bookName(43)).toBe('John'); // OSIS fallback
  });

  it('loadReferenceLocales resolves tags, returns data tags, and fires the change listener', async () => {
    const before = referenceLocalesVersion();
    const listener = vi.fn();
    const off = onReferenceLocalesChanged(listener);
    const stale = ReferenceEngine.create({ locales: ['fa'] });

    const got = await loadReferenceLocales(['fa-IR', 'xx']);
    expect(got).toEqual(['fa']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(referenceLocalesVersion()).toBeGreaterThan(before);
    expect(loadedReferenceLocales()).toContain('fa');
    expect(loadedReferenceLocaleFor('fa-IR')).toBe('fa');

    const fresh = ReferenceEngine.create({ locales: ['fa'] });
    expect(fresh).not.toBe(stale);
    expect(fresh.locales).toEqual(['fa']);
    expect(encodeParse(fresh.parse('یوحنا ۳:۱۶'))).toBe('43:3:16');
    expect(fresh.format({ book: 43, chapter: 3, verse: 16 })).toBe('یوحنا ۳:۱۶');

    off();
    await loadReferenceLocales(['he']);
    expect(listener).toHaveBeenCalledTimes(1); // unsubscribed
  });

  it('loading an already loaded locale costs nothing and fires nothing', async () => {
    const listener = vi.fn();
    const off = onReferenceLocalesChanged(listener);
    const v = referenceLocalesVersion();
    expect(await loadReferenceLocales(['fa', 'en'])).toEqual(['fa', 'en']);
    expect(listener).not.toHaveBeenCalled();
    expect(referenceLocalesVersion()).toBe(v);
    off();
  });

  it('concurrent loads of the same locale share one load', async () => {
    const [a, b] = await Promise.all([loadReferenceLocales(['es']), loadReferenceLocales(['es'])]);
    expect(a).toEqual(['es']);
    expect(b).toEqual(['es']);
    expect(loadedReferenceLocales().filter((t) => t === 'es')).toHaveLength(1);
  });

  it('a throwing listener does not break loading', async () => {
    const off = onReferenceLocalesChanged(() => {
      throw new Error('boom');
    });
    await expect(loadReferenceLocales(['ar'])).resolves.toEqual(['ar']);
    off();
  });
});

describe('registerReferenceLocale', () => {
  const custom: ReferenceLocaleData = {
    tag: 'es-test',
    extends: 'es',
    name: 'Spanish with comma chapter:verse',
    syntax: { chapterVerse: [',', ':'], list: [';', '.'] },
    format: { chapterVerse: ',' },
  };

  it('extends es: overrides separators, inherits the books', () => {
    const listener = vi.fn();
    const off = onReferenceLocalesChanged(listener);
    registerReferenceLocale(custom);
    expect(listener).toHaveBeenCalledTimes(1);
    off();

    const merged = getMergedReferenceLocale('es-test')!;
    expect(merged.books?.['43']?.long).toBe('Juan');
    expect(merged.syntax?.chapterVerse).toEqual([',', ':']);
    expect(merged.format?.chapterVerse).toBe(',');
    expect(merged.ordinals?.['1']).toContain('Primera');
    expect(validateReferenceLocale(merged).errors).toEqual([]);
  });

  it('"Juan 3,16" parses and formats back as "Juan 3,16"', () => {
    const e = ReferenceEngine.create({ locales: ['es-test'] });
    expect(e.locales).toEqual(['es-test']);
    const r = e.parse('Juan 3,16');
    expect(encodeParse(r)).toBe('43:3:16');
    expect(r.ok && r.locale).toBe('es-test');
    expect(e.format({ book: 43, chapter: 3, verse: 16 })).toBe('Juan 3,16');
    expect(e.format({ book: 43, chapter: 3, verse: 16, endVerse: 18 })).toBe('Juan 3,16-18');
    // ":" is still accepted as an input separator
    expect(encodeParse(e.parse('Juan 3:16'))).toBe('43:3:16');
  });

  it('uses the new list separators: ";" continues a list, "," is no longer one', () => {
    const e = ReferenceEngine.create({ locales: ['es-test'] });
    const r = e.parse('Juan 3,16; 4,1');
    expect(r.ok && r.ranges.map((x) => [x.chapter, x.verse])).toEqual([
      [3, 16],
      [4, 1],
    ]);
  });

  it('children resolve by exact tag, and the parent stays untouched', () => {
    expect(loadedReferenceLocaleFor('es-test')).toBe('es-test');
    expect(loadedReferenceLocaleFor('es-MX')).toBe('es');
    const es = ReferenceEngine.create({ locales: ['es'] });
    expect(es.format({ book: 43, chapter: 3, verse: 16 })).toBe('Juan 3:16');
  });

  it('replaces data registered under the same tag', () => {
    registerReferenceLocale({ ...custom, format: { chapterVerse: '.' } });
    const e = ReferenceEngine.create({ locales: ['es-test'] });
    expect(e.format({ book: 43, chapter: 3, verse: 16 })).toBe('Juan 3.16');
    registerReferenceLocale(custom);
  });
});

describe('addReferenceLocaleSource', () => {
  const data: ReferenceLocaleData = {
    tag: 'la-test',
    extends: 'en',
    name: 'Test Latin',
    ordinals: {},
    books: { '43': { long: 'Ioannes', short: 'Io' } },
  };

  it('a source supplies a locale that loadReferenceLocales then loads', async () => {
    const load = vi.fn(async (tag: string) => (tag === 'la-test' ? data : undefined));
    const remove = addReferenceLocaleSource({ tags: () => ['la-test', 'la-missing'], load });
    try {
      expect(availableReferenceLocales()).toContain('la-test');
      expect(loadedReferenceLocales()).not.toContain('la-test');

      expect(await loadReferenceLocales(['la-test'])).toEqual(['la-test']);
      expect(load).toHaveBeenCalledWith('la-test');
      expect(loadedReferenceLocales()).toContain('la-test');

      const e = ReferenceEngine.create({ locales: ['la-test'] });
      expect(encodeParse(e.parse('Ioannes 3:16'))).toBe('43:3:16');
      expect(encodeParse(e.parse('Romans 8:28'))).toBe('45:8:28'); // inherited from en
      expect(e.bookName(43)).toBe('Ioannes');

      // loaded once: a second call does not ask the source again
      load.mockClear();
      await loadReferenceLocales(['la-test']);
      expect(load).not.toHaveBeenCalled();
    } finally {
      remove();
    }
    // Removing a source stops offering its unloaded tags; data already loaded stays.
    expect(availableReferenceLocales()).not.toContain('la-missing');
    expect(loadedReferenceLocales()).toContain('la-test');
  });

  it('a source with nothing for the tag, or one that throws, loads nothing and never rejects', async () => {
    const remove = addReferenceLocaleSource({
      tags: () => ['la-none', 'la-throws'],
      load: async (tag) => {
        if (tag === 'la-throws') throw new Error('network down');
        return undefined;
      },
    });
    try {
      await expect(loadReferenceLocales(['la-none', 'la-throws'])).resolves.toEqual([]);
      expect(loadedReferenceLocales()).not.toContain('la-none');
      expect(loadedReferenceLocales()).not.toContain('la-throws');
    } finally {
      remove();
    }
  });

  it('built-in files win over sources', async () => {
    const load = vi.fn(async () => undefined);
    const remove = addReferenceLocaleSource({ tags: () => ['he'], load });
    try {
      await loadReferenceLocales(['he']);
      expect(load).not.toHaveBeenCalled();
    } finally {
      remove();
    }
  });
});
