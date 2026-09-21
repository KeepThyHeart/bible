import { describe, it, expect } from 'vitest';
import { MODULE_TYPES, normalizeModuleType } from './Types';

describe('normalizeModuleType', () => {
  it('maps the catalog spellings to the names the app uses', () => {
    expect(normalizeModuleType('topical')).toBe('topical_index');
    expect(normalizeModuleType('xref')).toBe('cross_reference');
  });

  it('leaves canonical types alone', () => {
    for (const type of MODULE_TYPES) expect(normalizeModuleType(type)).toBe(type);
  });

  it('returns an unknown type unchanged rather than hiding it', () => {
    expect(normalizeModuleType('mystery')).toBe('mystery');
  });
});

describe('ModuleCatalog.getParsedCatalog', () => {
  it('reports catalog modules under the canonical type names', async () => {
    const { ModuleCatalog } = await import('../Models/Main/ModuleCatalog');
    const catalog = new ModuleCatalog({
      name: 'Official',
      url: 'https://example.test/catalog.json',
      type: 'official',
      isEnabled: true,
      priority: 1,
    } as never);
    catalog.catalogJson = JSON.stringify({
      repository: { name: 'Official', url: 'x', version: '1' },
      modules: [
        { module_id: 'nave', module_type: 'topical', name: 'Nave' },
        { module_id: 'tsk', module_type: 'xref', name: 'TSK' },
        { module_id: 'kjv', module_type: 'bible', name: 'KJV' },
      ],
    });

    expect(catalog.getParsedCatalog()?.modules.map(m => m.module_type)).toEqual([
      'topical_index',
      'cross_reference',
      'bible',
    ]);
  });
});
