import { describe, it, expect } from 'vitest';

import {
  CATALOG_INDEX_FORMAT,
  CATALOG_INDEX_VERSION,
  MAX_INDEX_CATALOGS,
  parseCatalogIndex,
} from '../CatalogIndex';

const SCOPE = 'https://modules.example.org/';
const INDEX_URL = `${SCOPE}index.json`;

function index(catalogs: unknown[]): string {
  return JSON.stringify({ format: CATALOG_INDEX_FORMAT, version: CATALOG_INDEX_VERSION, catalogs });
}

describe('parseCatalogIndex', () => {
  it('resolves catalog URLs against the index URL', () => {
    const { entries, rejected } = parseCatalogIndex(
      index([
        { url: 'catalog.json', name: 'English modules', abbreviation: 'EN' },
        { url: 'es/catalog.json', name: 'Módulos en español' },
        { url: `${SCOPE}de/`, name: 'Deutsch' },
      ]),
      INDEX_URL,
      SCOPE,
    );

    expect(rejected).toEqual([]);
    expect(entries).toEqual([
      { url: `${SCOPE}catalog.json`, name: 'English modules', abbreviation: 'EN' },
      { url: `${SCOPE}es/catalog.json`, name: 'Módulos en español', abbreviation: undefined },
      { url: `${SCOPE}de/`, name: 'Deutsch', abbreviation: undefined },
    ]);
  });

  it('skips catalogs outside the official prefix', () => {
    const { entries, rejected } = parseCatalogIndex(
      index([
        { url: 'https://evil.example/catalog.json', name: 'Elsewhere' },
        { url: 'https://modules.example.org.evil.example/catalog.json', name: 'Lookalike' },
        { url: 'http://modules.example.org/catalog.json', name: 'Plain HTTP' },
        { url: 'es/catalog.json', name: 'Spanish' },
      ]),
      INDEX_URL,
      SCOPE,
    );

    expect(entries.map((entry) => entry.name)).toEqual(['Spanish']);
    expect(rejected).toHaveLength(3);
  });

  it('keeps "../" from climbing out of a nested scope', () => {
    const scope = 'https://example.org/modules/';
    const { entries, rejected } = parseCatalogIndex(
      index([{ url: '../private/catalog.json', name: 'Escape' }]),
      `${scope}index.json`,
      scope,
    );

    expect(entries).toEqual([]);
    expect(rejected).toHaveLength(1);
  });

  it('skips duplicates, the index itself, and malformed entries', () => {
    const { entries, rejected } = parseCatalogIndex(
      index([
        { url: 'es/catalog.json', name: 'Spanish' },
        { url: 'ES/../es/catalog.json', name: 'Spanish again' },
        { url: 'index.json', name: 'Myself' },
        { url: 'fr/catalog.json' },
        { url: 'de/catalog.json', name: 'German', abbreviation: 42 },
        'junk',
      ]),
      INDEX_URL,
      SCOPE,
    );

    expect(entries.map((entry) => entry.name)).toEqual(['Spanish']);
    expect(rejected).toHaveLength(5);
  });

  it('refuses documents that are not a catalog index', () => {
    expect(() => parseCatalogIndex('{oops', INDEX_URL, SCOPE)).toThrow();
    expect(() => parseCatalogIndex('[]', INDEX_URL, SCOPE)).toThrow();
    // A signed catalog served in the index's place must not be read as an index.
    expect(() =>
      parseCatalogIndex(JSON.stringify({ repository: { name: 'X' }, modules: [] }), INDEX_URL, SCOPE),
    ).toThrow(/kth-bible-catalog-index/);
    expect(() =>
      parseCatalogIndex(JSON.stringify({ format: CATALOG_INDEX_FORMAT, version: 2, catalogs: [] }), INDEX_URL, SCOPE),
    ).toThrow();
    expect(() =>
      parseCatalogIndex(JSON.stringify({ format: CATALOG_INDEX_FORMAT, version: 1 }), INDEX_URL, SCOPE),
    ).toThrow(/catalogs/);
  });

  it(`refuses an index listing more than ${MAX_INDEX_CATALOGS} catalogs`, () => {
    const many = Array.from({ length: MAX_INDEX_CATALOGS + 1 }, (_, n) => ({
      url: `c${n}/catalog.json`,
      name: `Catalog ${n}`,
    }));

    expect(() => parseCatalogIndex(index(many), INDEX_URL, SCOPE)).toThrow(/at most/);
  });
});
