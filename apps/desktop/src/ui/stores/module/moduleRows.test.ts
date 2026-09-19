import { describe, it, expect } from 'vitest';
import { mergeAndSortModules, getTabTypes } from './moduleRows';
import type { CatalogModule, ModuleMetadata } from './types';

describe('moduleRows', () => {
  // Helper to create a catalog module
  const catalogModule = (overrides?: Partial<CatalogModule>): CatalogModule => ({
    module_id: 'test-id',
    module_type: 'bible',
    name: 'Test Bible',
    abbreviation: 'TB',
    language_code: 'en',
    version: '1.0',
    description: 'Test',
    license: 'CC-BY-SA',
    download_url: 'http://example.com',
    download_size_bytes: 1000,
    installed_size_bytes: 1000,
    checksum: 'abc123',
    features: [],
    tags: [],
    recommended: false,
    created_date: '2024-01-01',
    updated_date: '2024-01-01',
    ...overrides
  });

  // Helper to create an installed module
  const installedModule = (overrides?: Partial<ModuleMetadata>): ModuleMetadata => ({
    module_id: 1,
    module_type: 'bible',
    abbreviation: 'TB',
    name: 'Test Bible',
    language_code: 'en',
    version: '1.0',
    database_path: '/path/to/db',
    is_indexed: false,
    update_available: false,
    usage_count: 0,
    user_hidden: false,
    ...overrides
  });

  describe('mergeAndSortModules', () => {
    it('merges catalog and installed modules by abbreviation', () => {
      const catalog = [
        catalogModule({ abbreviation: 'KJV', name: 'King James Version' }),
        catalogModule({ abbreviation: 'NASB', name: 'NASB' })
      ];
      const installed = [
        installedModule({ abbreviation: 'KJV', name: 'King James Version', module_id: 1 })
      ];

      const result = mergeAndSortModules(catalog, installed);

      const kjv = result.find(r => r.abbreviation === 'KJV');
      expect(kjv).toBeDefined();
      expect(kjv!.installed).toBe(true);
      expect(kjv!.catalogModule).toBeDefined();
      expect(kjv!.installedModule).toBeDefined();

      const nasb = result.find(r => r.abbreviation === 'NASB');
      expect(nasb).toBeDefined();
      expect(nasb!.installed).toBe(false);
      expect(nasb!.catalogModule).toBeDefined();
      expect(nasb!.installedModule).toBeUndefined();
    });

    it('includes catalog-only modules', () => {
      const catalog = [catalogModule({ abbreviation: 'KJV', name: 'King James' })];
      const installed: ModuleMetadata[] = [];

      const result = mergeAndSortModules(catalog, installed);

      expect(result).toHaveLength(1);
      expect(result[0].installed).toBe(false);
      expect(result[0].catalogModule).toBeDefined();
    });

    it('includes installed-only modules', () => {
      const catalog: CatalogModule[] = [];
      const installed = [installedModule({ abbreviation: 'OLD', name: 'Old Module' })];

      const result = mergeAndSortModules(catalog, installed);

      expect(result).toHaveLength(1);
      expect(result[0].installed).toBe(true);
      expect(result[0].catalogModule).toBeUndefined();
    });

    it('sets module_id from installed module if available, else from catalog', () => {
      const catalog = [
        catalogModule({ abbreviation: 'A', module_id: 'catalog-1' })
      ];
      const installed = [
        installedModule({ abbreviation: 'A', module_id: 999 })
      ];

      const result = mergeAndSortModules(catalog, installed);

      expect(result[0].module_id).toBe(999); // Prefers installed
    });

    it('uses catalog module_id when installed is not available', () => {
      const catalog = [
        catalogModule({ abbreviation: 'B', module_id: 'catalog-2' })
      ];
      const installed: ModuleMetadata[] = [];

      const result = mergeAndSortModules(catalog, installed);

      expect(result[0].module_id).toBe('catalog-2');
    });

    it('sets update_available from installed module', () => {
      const catalog = [catalogModule({ abbreviation: 'KJV', version: '2.0' })];
      const installed = [
        installedModule({
          abbreviation: 'KJV',
          update_available: true
        })
      ];

      const result = mergeAndSortModules(catalog, installed);

      expect(result[0].updateAvailable).toBe(true);
    });

    describe('sorting within groups', () => {
      it('sorts recommended modules first within a type', () => {
        const catalog = [
          catalogModule({
            abbreviation: 'KJV',
            name: 'King James',
            recommended: false
          }),
          catalogModule({
            abbreviation: 'NASB',
            name: 'NASB',
            recommended: true
          }),
          catalogModule({
            abbreviation: 'ESV',
            name: 'ESV',
            recommended: true
          })
        ];

        const result = mergeAndSortModules(catalog, []);

        // Recommended (NASB, ESV) should come first
        expect(result[0].abbreviation).toBe('ESV'); // ESV comes before NASB alphabetically
        expect(result[1].abbreviation).toBe('NASB');
        expect(result[2].abbreviation).toBe('KJV'); // Non-recommended last
      });

      it('sorts alphabetically within recommended and non-recommended groups', () => {
        const catalog = [
          catalogModule({ abbreviation: 'ZZZ', name: 'Z Bible', recommended: false }),
          catalogModule({ abbreviation: 'AAA', name: 'A Bible', recommended: false }),
          catalogModule({ abbreviation: 'BBB', name: 'B Bible', recommended: true }),
          catalogModule({ abbreviation: 'CCC', name: 'C Bible', recommended: true })
        ];

        const result = mergeAndSortModules(catalog, []);

        // Recommended first (BBB, CCC alphabetically), then non-recommended (AAA, ZZZ)
        expect(result[0].abbreviation).toBe('BBB');
        expect(result[1].abbreviation).toBe('CCC');
        expect(result[2].abbreviation).toBe('AAA');
        expect(result[3].abbreviation).toBe('ZZZ');
      });

      it('uses locale-aware collation for sorting', () => {
        const catalog = [
          catalogModule({ abbreviation: 'M1', name: 'Möglichkeiten' }),
          catalogModule({ abbreviation: 'M2', name: 'Möglich' })
        ];

        const result = mergeAndSortModules(catalog, []);

        // Both start with Mö, so the longer one should come second
        // With Intl.Collator numeric: true, this respects language rules
        expect(result.length).toBe(2);
        expect([result[0].abbreviation, result[1].abbreviation]).toEqual(['M2', 'M1']);
      });
    });

    describe('grouping by module type', () => {
      it('groups modules by module_type', () => {
        const catalog = [
          catalogModule({
            abbreviation: 'KJV',
            module_type: 'bible',
            name: 'King James'
          }),
          catalogModule({
            abbreviation: 'MHCC',
            module_type: 'commentary',
            name: 'Matthew Henry'
          }),
          catalogModule({
            abbreviation: 'ESV',
            module_type: 'bible',
            name: 'ESV'
          })
        ];

        const result = mergeAndSortModules(catalog, []);

        // Bible modules should come first (per MODULE_TYPES order)
        const bibles = result.filter(r => r.module_type === 'bible');
        const commentaries = result.filter(r => r.module_type === 'commentary');

        expect(bibles).toHaveLength(2);
        expect(commentaries).toHaveLength(1);

        // Bible group should come before commentary group in result
        const bibleIndex = result.findIndex(r => r.module_type === 'bible');
        const commentaryIndex = result.findIndex(r => r.module_type === 'commentary');
        expect(bibleIndex).toBeLessThan(commentaryIndex);
      });

      it('respects MODULE_TYPES order for grouping', () => {
        const catalog = [
          catalogModule({ abbreviation: 'D', module_type: 'dictionary' }),
          catalogModule({ abbreviation: 'B', module_type: 'bible' }),
          catalogModule({ abbreviation: 'C', module_type: 'commentary' })
        ];

        const result = mergeAndSortModules(catalog, []);

        const types = result.map(r => r.module_type);
        // bible (0), commentary (1), dictionary (2) per MODULE_TYPES
        expect(types).toEqual(['bible', 'commentary', 'dictionary']);
      });
    });

    it('uses catalog name/type/language when installed is missing', () => {
      const catalog = [catalogModule({
        abbreviation: 'KJV',
        name: 'King James Version',
        language_code: 'en',
        module_type: 'bible'
      })];

      const result = mergeAndSortModules(catalog, []);

      expect(result[0].name).toBe('King James Version');
      expect(result[0].language_code).toBe('en');
      expect(result[0].module_type).toBe('bible');
    });

    it('uses installed name/type/language when catalog is missing', () => {
      const installed = [installedModule({
        abbreviation: 'OLD',
        name: 'Old Bible',
        language_code: 'fr',
        module_type: 'bible'
      })];

      const result = mergeAndSortModules([], installed);

      expect(result[0].name).toBe('Old Bible');
      expect(result[0].language_code).toBe('fr');
      expect(result[0].module_type).toBe('bible');
    });

    it('returns empty array when given empty inputs', () => {
      const result = mergeAndSortModules([], []);
      expect(result).toEqual([]);
    });
  });

  describe('getTabTypes', () => {
    it('includes bible even when no bible modules exist', () => {
      const result = getTabTypes([], []);
      expect(result).toContain('bible');
      expect(result[0]).toBe('bible'); // Should be first
    });

    it('includes only types with modules, plus bible', () => {
      const catalog = [
        catalogModule({ module_type: 'commentary' }),
        catalogModule({ module_type: 'dictionary' })
      ];

      const result = getTabTypes(catalog, []);

      expect(result).toContain('bible');
      expect(result).toContain('commentary');
      expect(result).toContain('dictionary');
      // Should not include module types with no modules
      expect(result).not.toContain('book');
      expect(result).not.toContain('devotional');
    });

    it('includes types from both catalog and installed modules', () => {
      const catalog = [catalogModule({ module_type: 'commentary' })];
      const installed = [installedModule({ module_type: 'dictionary' })];

      const result = getTabTypes(catalog, installed);

      expect(result).toContain('bible');
      expect(result).toContain('commentary');
      expect(result).toContain('dictionary');
    });

    it('maintains MODULE_TYPES order', () => {
      const catalog = [
        catalogModule({ module_type: 'dictionary' }),
        catalogModule({ module_type: 'bible' }),
        catalogModule({ module_type: 'commentary' }),
        catalogModule({ module_type: 'book' })
      ];

      const result = getTabTypes(catalog, []);

      // Should follow MODULE_TYPES order: bible, commentary, dictionary, book, ...
      expect(result.slice(0, 4)).toEqual(['bible', 'commentary', 'dictionary', 'book']);
    });

    it('deduplicates types when they appear in both catalog and installed', () => {
      const catalog = [catalogModule({ module_type: 'bible' })];
      const installed = [installedModule({ module_type: 'bible' })];

      const result = getTabTypes(catalog, installed);

      const bibleCount = result.filter(t => t === 'bible').length;
      expect(bibleCount).toBe(1);
    });

    it('returns bible first even when not present in modules', () => {
      const catalog = [
        catalogModule({ module_type: 'commentary' }),
        catalogModule({ module_type: 'dictionary' })
      ];

      const result = getTabTypes(catalog, []);

      expect(result[0]).toBe('bible');
    });

    it('handles empty inputs', () => {
      const result = getTabTypes([], []);
      expect(result).toEqual(['bible']);
    });

    it('includes all MODULE_TYPES that are present', () => {
      const catalog = [
        catalogModule({ module_type: 'bible' }),
        catalogModule({ module_type: 'commentary' }),
        catalogModule({ module_type: 'dictionary' }),
        catalogModule({ module_type: 'book' }),
        catalogModule({ module_type: 'devotional' }),
        catalogModule({ module_type: 'lexicon' }),
        catalogModule({ module_type: 'topical_index' }),
        catalogModule({ module_type: 'cross_reference' }),
        catalogModule({ module_type: 'tag_graph' })
      ];

      const result = getTabTypes(catalog, []);

      expect(result).toEqual([
        'bible',
        'commentary',
        'dictionary',
        'book',
        'devotional',
        'lexicon',
        'topical_index',
        'cross_reference',
        'tag_graph'
      ]);
    });
  });
});
