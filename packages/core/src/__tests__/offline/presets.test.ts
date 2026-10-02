import { describe, it, expect } from 'vitest';
import { presetFromStarterPack, specFromPreset } from '../../offline/presets';
import { MemoryPackSpecStore } from '../../offline/memoryPackSpecStore';

describe('presets', () => {
  it('maps a starter pack to a preset of module refs', () => {
    const p = presetFromStarterPack({ pack_id: 'starter', name: 'Starter', description: 'd', version: '2', module_ids: ['kjv', 'strongs'] });
    expect(p).toEqual({
      id: 'starter',
      name: 'Starter',
      description: 'd',
      version: '2',
      items: [{ kind: 'module', id: 'kjv' }, { kind: 'module', id: 'strongs' }],
    });
  });

  it('omits absent optional fields', () => {
    const p = presetFromStarterPack({ pack_id: 'a', name: 'A', module_ids: [] });
    expect(p).toEqual({ id: 'a', name: 'A', items: [] });
  });

  it('builds a spec from a preset with copied items', () => {
    const preset = presetFromStarterPack({ pack_id: 'starter', name: 'Starter', version: '2', module_ids: ['kjv'] });
    const spec = specFromPreset(preset, () => '2026-01-01T00:00:00Z', () => 'id-1');
    expect(spec).toEqual({
      packId: 'id-1',
      name: 'Starter',
      items: [{ kind: 'module', id: 'kjv' }],
      fromPreset: { id: 'starter', version: '2' },
      updatedAt: '2026-01-01T00:00:00Z',
    });
    spec.items[0].id = 'changed';
    expect(preset.items[0].id).toBe('kjv');
  });

  it('fromPreset has no version when the preset has none', () => {
    const spec = specFromPreset({ id: 'x', name: 'X', items: [] }, () => 't', () => 'n');
    expect(spec.fromPreset).toEqual({ id: 'x' });
  });
});

describe('MemoryPackSpecStore', () => {
  it('saves, lists copies, replaces and removes', async () => {
    const store = new MemoryPackSpecStore();
    const spec = { packId: 'p', name: 'P', items: [{ kind: 'module' as const, id: 'kjv' }], updatedAt: 't' };
    await store.save(spec);
    spec.items.push({ kind: 'module', id: 'esv' });
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0].items).toHaveLength(1);
    listed[0].name = 'mutated';
    expect((await store.list())[0].name).toBe('P');
    await store.save({ ...spec, name: 'P2' });
    expect(await store.list()).toHaveLength(1);
    await store.remove('p');
    expect(await store.list()).toEqual([]);
  });
});
