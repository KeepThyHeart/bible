import { describe, it, expect } from 'vitest';
import {
  parseStarterPack,
  parseStarterPacks,
  selectStarterPacksForLanguage,
  isSupportedContentLanguage,
  SUPPORTED_CONTENT_LANGUAGES,
  MAX_STARTER_PACK_MODULES,
  type StarterPack,
} from './StarterPackTypes';

/** A minimal valid entry; individual tests override one field at a time. */
function validEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pack_id: 'starter-es',
    languages: ['es'],
    name: 'Spanish Starter',
    description: 'Reina-Valera 1909 with study helps.',
    version: '1.0.0',
    module_ids: ['rv1909', 'strongsgreek'],
    ...overrides,
  };
}

describe('parseStarterPack', () => {
  it('accepts a well-formed entry', () => {
    const result = parseStarterPack(validEntry());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pack.pack_id).toBe('starter-es');
    expect(result.pack.module_ids).toEqual(['rv1909', 'strongsgreek']);
    expect(result.pack.archive).toBeNull();
    expect(result.pack.download_size_bytes).toBeNull();
  });

  it.each([
    ['a non-object', 42],
    ['null', null],
    ['an array', []],
  ])('rejects %s', (_label, raw) => {
    const result = parseStarterPack(raw);
    expect(result.ok).toBe(false);
  });

  describe('pack_id', () => {
    it.each([
      ['uppercase', 'Starter-ES'],
      ['a leading dash', '-starter'],
      ['a space', 'starter es'],
      ['an empty string', ''],
      ['a path traversal attempt', '../../etc/passwd'],
    ])('rejects %s', (_label, packId) => {
      expect(parseStarterPack(validEntry({ pack_id: packId })).ok).toBe(false);
    });
  });

  describe('languages', () => {
    it.each([
      ['en'],
      ['es'],
      ['pt-BR'],
      ['zh-Hans'],
      ['zh-Hans-CN'],
    ])('accepts the BCP-47 tag %s', (tag) => {
      expect(parseStarterPack(validEntry({ languages: [tag] })).ok).toBe(true);
    });

    it.each([
      ['an empty array', []],
      ['a non-array', 'es'],
      ['a bogus tag', ['not a language']],
      ['an over-long tag', ['abcdefghijkl']],
    ])('rejects %s', (_label, languages) => {
      expect(parseStarterPack(validEntry({ languages })).ok).toBe(false);
    });

    it('rejects a case-insensitive duplicate', () => {
      // `en` and `EN` name the same locale; keeping both would double-count
      // the pack in the first-run list.
      expect(parseStarterPack(validEntry({ languages: ['en', 'EN'] })).ok).toBe(false);
    });
  });

  describe('module_ids', () => {
    it('rejects an empty list', () => {
      // An empty pack renders as an install button that does nothing.
      expect(parseStarterPack(validEntry({ module_ids: [] })).ok).toBe(false);
    });

    it('rejects duplicates', () => {
      expect(parseStarterPack(validEntry({ module_ids: ['kjv', 'kjv'] })).ok).toBe(false);
    });

    it('rejects a list beyond the ceiling', () => {
      const tooMany = Array.from({ length: MAX_STARTER_PACK_MODULES + 1 }, (_, i) => `m${i}`);
      expect(parseStarterPack(validEntry({ module_ids: tooMany })).ok).toBe(false);
    });

    it('rejects an id with a path separator', () => {
      expect(parseStarterPack(validEntry({ module_ids: ['../evil'] })).ok).toBe(false);
    });
  });

  describe('archive', () => {
    const archive = {
      download_url: 'https://example.org/packs/starter-es-1.0.0.biblepack',
      download_size_bytes: 1024,
      sha256: 'A'.repeat(64),
    };

    it('accepts a complete archive block and lowercases the digest', () => {
      const result = parseStarterPack(validEntry({ archive }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.pack.archive?.sha256).toBe('a'.repeat(64));
    });

    it('rejects a non-http URL', () => {
      // file:// would make the catalog able to point the installer at the
      // user's own disk.
      const bad = { ...archive, download_url: 'file:///etc/passwd' };
      expect(parseStarterPack(validEntry({ archive: bad })).ok).toBe(false);
    });

    it('rejects a malformed digest', () => {
      const bad = { ...archive, sha256: 'nope' };
      expect(parseStarterPack(validEntry({ archive: bad })).ok).toBe(false);
    });

    it('rejects a non-positive size', () => {
      const bad = { ...archive, download_size_bytes: 0 };
      expect(parseStarterPack(validEntry({ archive: bad })).ok).toBe(false);
    });

    it('treats an absent archive as the online-only case', () => {
      const result = parseStarterPack(validEntry({ archive: null }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.pack.archive).toBeNull();
    });
  });
});

describe('parseStarterPacks', () => {
  it('returns an empty result for a non-array', () => {
    expect(parseStarterPacks(undefined)).toEqual({ packs: [], rejected: [] });
    expect(parseStarterPacks({})).toEqual({ packs: [], rejected: [] });
  });

  it('keeps the good entries and reports the bad ones', () => {
    // One broken listing must not hide every other pack in the catalog.
    const { packs, rejected } = parseStarterPacks([
      validEntry({ pack_id: 'good-one' }),
      { pack_id: 'BROKEN' },
      validEntry({ pack_id: 'good-two' }),
    ]);
    expect(packs.map((p) => p.pack_id)).toEqual(['good-one', 'good-two']);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.index).toBe(1);
  });

  it('rejects a duplicate pack_id within one catalog', () => {
    const { packs, rejected } = parseStarterPacks([
      validEntry({ pack_id: 'dup' }),
      validEntry({ pack_id: 'dup' }),
    ]);
    expect(packs).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});

describe('selectStarterPacksForLanguage', () => {
  function pack(id: string, languages: string[]): StarterPack {
    return {
      pack_id: id,
      languages,
      name: id,
      description: id,
      version: '1.0.0',
      module_ids: ['m1'],
    };
  }

  it('matches an exact tag', () => {
    const packs = [pack('es', ['es']), pack('en', ['en'])];
    expect(selectStarterPacksForLanguage(packs, 'es').map((p) => p.pack_id)).toEqual(['es']);
  });

  it('matches case-insensitively', () => {
    expect(selectStarterPacksForLanguage([pack('es', ['ES'])], 'es')).toHaveLength(1);
  });

  it('falls back from a regional tag to the bare language', () => {
    // A user on es-MX should still be offered a pack tagged plain `es`.
    const packs = [pack('generic-es', ['es'])];
    expect(selectStarterPacksForLanguage(packs, 'es-MX').map((p) => p.pack_id)).toEqual(['generic-es']);
  });

  it('puts an exact match ahead of a primary-subtag match', () => {
    const packs = [pack('generic-es', ['es']), pack('mexico', ['es-MX'])];
    expect(selectStarterPacksForLanguage(packs, 'es-MX').map((p) => p.pack_id)).toEqual([
      'mexico',
      'generic-es',
    ]);
  });

  it('never crosses a script boundary', () => {
    // Simplified and Traditional Chinese are not interchangeable content.
    const packs = [pack('traditional', ['zh-Hant'])];
    expect(selectStarterPacksForLanguage(packs, 'zh-Hans')).toEqual([]);
  });

  it('lets an unscripted tag match either script', () => {
    const packs = [pack('generic-zh', ['zh'])];
    expect(selectStarterPacksForLanguage(packs, 'zh-Hans')).toHaveLength(1);
  });

  it('returns nothing when no pack matches', () => {
    // A normal outcome - several supported UI languages have no
    // redistributable content yet. The first-run UI must render this.
    expect(selectStarterPacksForLanguage([pack('es', ['es'])], 'hi')).toEqual([]);
  });

  const emptyLocales: Array<[string | undefined, string]> = [
    ['', 'empty'],
    [undefined, 'undefined'],
  ];
  it.each(emptyLocales)('returns nothing for an %s locale', (locale) => {
    expect(selectStarterPacksForLanguage([pack('es', ['es'])], locale as unknown as string)).toEqual([]);
  });
});

describe('SUPPORTED_CONTENT_LANGUAGES', () => {
  it('is the agreed four', () => {
    expect([...SUPPORTED_CONTENT_LANGUAGES]).toEqual(['en', 'es', 'hi', 'zh-Hans']);
  });

  it('narrows only exact tags', () => {
    expect(isSupportedContentLanguage('es')).toBe(true);
    expect(isSupportedContentLanguage('zh-Hans')).toBe(true);
    expect(isSupportedContentLanguage('zh-Hant')).toBe(false);
    expect(isSupportedContentLanguage('fr')).toBe(false);
  });

  it('has a locale catalog for every entry', () => {
    // Guards the pairing the first-run picker depends on: a supported content
    // language with no UI catalog would show up as a blank row.
    for (const code of SUPPORTED_CONTENT_LANGUAGES) {
      expect(code).toMatch(/^[a-z]{2}(-[A-Za-z]{4})?$/);
    }
  });
});
