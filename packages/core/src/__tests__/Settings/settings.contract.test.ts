/**
 * Contract tests for the settings registry, store and feature flags (task 0087).
 * These pin the behavior consumers (audio, unit system, notifications, ...) rely on.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createFeatureFlags,
  createMemoryPort,
  createSettingsStore,
  defineSettings,
  FEATURE_FLAGS,
  lazyFeature,
  mergeSettings,
  parseFlagOverrides,
  type SettingDef,
  type SettingsStoragePort,
} from '../../browser';

const DEFS: SettingDef[] = [
  { key: 'swipe', type: 'boolean', default: true, scope: 'device', group: 'gestures', labelKey: 'g.swipe', label: 'Swipe' },
  { key: 'threshold', type: 'integer', default: 100, min: 20, max: 400, scope: 'device', group: 'gestures', labelKey: 'g.t', order: 2, widget: 'slider', dependsOn: { swipe: true } },
  { key: 'lineHeight', type: 'number', default: 1.8, min: 1.2, max: 2.5, step: 0.1, scope: 'synced', group: 'text', labelKey: 't.lh' },
  { key: 'layout', type: 'enum', values: ['inline', 'stacked'], default: 'stacked', scope: 'synced', group: 'text', labelKey: 't.layout' },
  { key: 'excluded', type: 'string-array', default: [], scope: 'device', group: 'text', labelKey: 't.ex' },
  { key: 'audioOnly', type: 'boolean', default: false, scope: 'device', group: 'audio', labelKey: 'a.x', flag: 'audio' },
];

describe('SettingsRegistry', () => {
  const registry = defineSettings(DEFS);

  it('exposes defaults, scopes and groups', () => {
    expect(registry.defaults()).toEqual({
      swipe: true, threshold: 100, lineHeight: 1.8, layout: 'stacked', excluded: [], audioOnly: false,
    });
    expect(registry.keysForScope('synced')).toEqual(['lineHeight', 'layout']);
    expect(registry.groups().map((g) => g.id)).toEqual(['gestures', 'text', 'audio']);
  });

  it('orders a group by order then declaration', () => {
    const r = defineSettings([
      { key: 'b', type: 'boolean', default: false, scope: 'device', group: 'g', labelKey: 'b', order: 2 },
      { key: 'a', type: 'boolean', default: false, scope: 'device', group: 'g', labelKey: 'a', order: 1 },
      { key: 'c', type: 'boolean', default: false, scope: 'device', group: 'g', labelKey: 'c', order: 1 },
    ]);
    expect(r.groups()[0].settings.map((d) => d.key)).toEqual(['a', 'c', 'b']);
  });

  it('rejects malformed definitions at definition time', () => {
    const bad = (def: SettingDef) => () => defineSettings([def]);
    expect(bad({ key: 'a.b', type: 'boolean', default: true, scope: 'device', group: 'g', labelKey: 'k' })).toThrow(/dots/);
    expect(bad({ key: 'e', type: 'enum', values: ['x'], default: 'y', scope: 'device', group: 'g', labelKey: 'k' })).toThrow(/enum/);
    expect(bad({ key: 'n', type: 'number', default: 5, min: 10, scope: 'device', group: 'g', labelKey: 'k' })).toThrow(/below min/);
    expect(bad({ key: 's', type: 'number', default: 5, widget: 'slider', scope: 'device', group: 'g', labelKey: 'k' })).toThrow(/slider/);
    expect(() => defineSettings([DEFS[0], DEFS[0]])).toThrow(/Duplicate/);
  });

  it('validates types, clamps numbers, rejects the rest', () => {
    expect(registry.validate('swipe', 'yes').ok).toBe(false);
    expect(registry.validate('layout', 'grid').ok).toBe(false);
    expect(registry.validate('nope', 1).ok).toBe(false);
    expect(registry.validate('threshold', 1000)).toEqual({ ok: true, value: 400 });
    expect(registry.validate('threshold', 20.4)).toEqual({ ok: true, value: 20 });
    expect(registry.validate('lineHeight', 1.7999999)).toEqual({ ok: true, value: 1.8 });
    expect(registry.validate('threshold', NaN).ok).toBe(false);
    expect(registry.validate('excluded', ['a', 2]).ok).toBe(false);
  });

  it('honours a custom validate', () => {
    const r = defineSettings([
      { key: 'name', type: 'string', default: 'a', scope: 'device', group: 'g', labelKey: 'k', validate: (v: string) => v.length < 4 },
    ]);
    expect(r.validate('name', 'abc').ok).toBe(true);
    expect(r.validate('name', 'abcdef').ok).toBe(false);
  });

  it('sanitizes stored data field by field', () => {
    expect(registry.sanitize({ swipe: false, threshold: 'x', layout: 'inline', extra: 1 })).toMatchObject({
      swipe: false, threshold: 100, layout: 'inline',
    });
    expect(registry.sanitize(null)).toEqual(registry.defaults());
    expect('extra' in registry.sanitize({ extra: 1 })).toBe(false);
  });

  it('builds fields with translation, flag and dependsOn filtering', () => {
    const t = (key: string, fallback: string) => (key === 'g.swipe' ? 'Wisch' : fallback);
    const fields = registry.toFields('gestures', { translate: t, values: { swipe: true } });
    expect(fields.map((f) => f.key)).toEqual(['swipe', 'threshold']);
    expect(fields[0].title).toBe('Wisch');
    expect(fields[1]).toMatchObject({ kind: 'integer', widget: 'slider', numberConstraints: { minimum: 20, maximum: 400 } });
    expect(registry.toFields('gestures', { values: { swipe: false } }).map((f) => f.key)).toEqual(['swipe']);
    expect(registry.toFields('audio', { isEnabled: () => false })).toEqual([]);
    expect(registry.toFields('audio', { isEnabled: () => true })).toHaveLength(1);
  });

  it('merges registries and refuses key collisions', () => {
    const a = defineSettings([DEFS[0]]);
    const b = defineSettings([DEFS[2]]);
    expect(mergeSettings(a, b).definitions).toHaveLength(2);
    expect(() => mergeSettings(a, a)).toThrow(/Duplicate/);
  });
});

describe('SettingsStore', () => {
  const registry = defineSettings(DEFS);

  it('starts from defaults and stored values, and persists changes with their scope', () => {
    const port = createMemoryPort({ swipe: false, bogus: 1 });
    const write = vi.spyOn(port, 'write');
    const store = createSettingsStore(registry, port);
    expect(store.get('swipe')).toBe(false);
    expect(store.set('layout', 'inline')).toEqual({ ok: true });
    expect(write).toHaveBeenCalledWith([{ key: 'layout', value: 'inline', scope: 'synced' }]);
    expect(port.data.layout).toBe('inline');
  });

  it('rejects bad values without changing or persisting anything', () => {
    const port = createMemoryPort();
    const store = createSettingsStore(registry, port);
    expect(store.set('layout', 'grid').ok).toBe(false);
    expect(store.setMany({ swipe: false, layout: 'grid' }).ok).toBe(false);
    expect(store.get('swipe')).toBe(true);
    expect(port.data).toEqual({});
  });

  it('notifies once per real change with a new snapshot each time', () => {
    const store = createSettingsStore(registry);
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSnapshot();
    store.set('swipe', true); // unchanged
    expect(listener).not.toHaveBeenCalled();
    store.set('swipe', false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).not.toBe(before);
    expect(Object.isFrozen(store.getSnapshot())).toBe(true);
    store.setMany({ swipe: true, threshold: 50 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('resets some or all keys', () => {
    const store = createSettingsStore(registry);
    store.setMany({ swipe: false, threshold: 50 });
    store.reset(['swipe']);
    expect(store.get('swipe')).toBe(true);
    expect(store.get('threshold')).toBe(50);
    store.reset();
    expect(store.getAll()).toEqual(registry.defaults());
  });

  it('throws on reading an unknown key', () => {
    expect(() => createSettingsStore(registry).get('nope')).toThrow(/Unknown/);
  });

  it('accepts an async port, keeping edits made before the read resolves', async () => {
    let release!: (v: Record<string, unknown>) => void;
    const writes: unknown[] = [];
    const port: SettingsStoragePort = {
      read: () => new Promise((r) => { release = r; }),
      write: (c) => { writes.push(c); },
    };
    const store = createSettingsStore(registry, port);
    expect(store.get('layout')).toBe('stacked');
    store.set('threshold', 60);
    release({ layout: 'inline', threshold: 300 });
    await store.ready;
    expect(store.get('layout')).toBe('inline');
    expect(store.get('threshold')).toBe(60);
  });

  it('survives a port that throws', () => {
    const port: SettingsStoragePort = {
      read: () => { throw new Error('denied'); },
      write: () => { throw new Error('denied'); },
    };
    const store = createSettingsStore(registry, port);
    expect(store.get('swipe')).toBe(true);
    expect(store.set('swipe', false)).toEqual({ ok: true });
    expect(store.get('swipe')).toBe(false);
  });

  it('copies arrays so callers cannot mutate defaults', () => {
    const store = createSettingsStore(registry);
    store.set('excluded', ['KJV']);
    expect(registry.defaults().excluded).toEqual([]);
    expect(store.get<string[]>('excluded')).toEqual(['KJV']);
  });
});

describe('feature flags', () => {
  it('resolves override, then site, then default', () => {
    const flags = createFeatureFlags({ site: { audio: true, pwa: true }, overrides: { audio: false } });
    expect(flags.isEnabled('audio')).toBe(false); // override wins
    expect(flags.isEnabled('pwa')).toBe(true); // site over default false
    expect(flags.isEnabled('offlineAutoDownload')).toBe(true); // default
    expect(flags.isEnabled('timeline')).toBe(false); // default
  });

  it('ignores non-boolean values', () => {
    const flags = createFeatureFlags({ site: { audio: 'yes', offlineAutoDownload: 0 } });
    expect(flags.isEnabled('audio')).toBe(false);
    expect(flags.isEnabled('offlineAutoDownload')).toBe(true);
  });

  it('applies requires (genealogy needs tagGraph)', () => {
    expect(createFeatureFlags({ site: { genealogy: true } }).isEnabled('genealogy')).toBe(false);
    expect(createFeatureFlags({ site: { genealogy: true, tagGraph: true } }).isEnabled('genealogy')).toBe(true);
  });

  it('reads getters lazily', () => {
    let site: Record<string, unknown> = {};
    const flags = createFeatureFlags({ site: () => site });
    expect(flags.isEnabled('audio')).toBe(false);
    site = { audio: true };
    expect(flags.isEnabled('audio')).toBe(true);
  });

  it('lists every known flag', () => {
    expect(Object.keys(createFeatureFlags().all()).sort()).toEqual(Object.keys(FEATURE_FLAGS).sort());
  });

  it('parses dev overrides', () => {
    expect(parseFlagOverrides('audio, -pwa nope')).toEqual({ audio: true, pwa: false });
    expect(parseFlagOverrides('{"timeline":true,"pwa":"x"}')).toEqual({ timeline: true });
    expect(parseFlagOverrides('{bad')).toEqual({});
    expect(parseFlagOverrides(null)).toEqual({});
  });

  it('lazyFeature loads once, only when on, and retries after a failure', async () => {
    let on = false;
    const loader = vi.fn(async () => ({ init: 1 }));
    const load = lazyFeature({ isEnabled: () => on }, 'audio', loader);
    expect(await load()).toBeNull();
    expect(loader).not.toHaveBeenCalled();
    on = true;
    expect(await load()).toEqual({ init: 1 });
    await load();
    expect(loader).toHaveBeenCalledTimes(1);

    const failing = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue('ok');
    const retry = lazyFeature({ isEnabled: () => true }, 'audio', failing);
    await expect(retry()).rejects.toThrow('x');
    await expect(retry()).resolves.toBe('ok');
  });
});
