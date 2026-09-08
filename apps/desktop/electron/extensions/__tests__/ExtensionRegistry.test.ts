import { describe, it, expect, beforeEach } from 'vitest';
import { Extensions } from '@bible/core';

type ExtensionManifest = Extensions.ExtensionManifest;
import { ExtensionRegistry } from '../ExtensionRegistry';
import { FakeSql } from './fakeSql';

function makeManifest(id = 'ext.example.greek-tools', version = '1.0.0'): ExtensionManifest {
  const result = Extensions.validateManifest({
    id,
    name: { key: 'extension.name' },
    version,
    publisher: 'example',
    engines: { bibleApp: '^1.0.0' },
    permissions: ['bible:read'],
  });
  if (!result.ok) throw new Error(`fixture invalid: ${JSON.stringify(result.errors)}`);
  return result.manifest;
}

describe('ExtensionRegistry', () => {
  let db: FakeSql;
  let registry: ExtensionRegistry;

  beforeEach(() => {
    db = new FakeSql();
    registry = new ExtensionRegistry(db);
  });

  it('insert persists row and returns ExtensionStateInfo', () => {
    const manifest = makeManifest();
    const info = registry.insert({
      manifest,
      installPath: '/data/extensions/ext.example.greek-tools',
      grantedPermissions: ['bible:read'],
    });

    expect(info.manifest.id).toBe('ext.example.greek-tools');
    expect(info.enabled).toBe(true);
    expect(info.status).toBe('installed');
    expect(info.crashCountSession).toBe(0);
    expect(info.grantedPermissions).toEqual(['bible:read']);

    expect(db.extensions.get('ext.example.greek-tools')?.version).toBe('1.0.0');
    expect(db.extensions.get('ext.example.greek-tools')?.enabled).toBe(1);
  });

  it('list returns every registered entry', () => {
    registry.insert({
      manifest: makeManifest('ext.example.greek-tools'),
      installPath: '/p/a',
      grantedPermissions: [],
    });
    registry.insert({
      manifest: makeManifest('ext.example.hebrew-tools'),
      installPath: '/p/b',
      grantedPermissions: [],
    });

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.manifest.id).sort()).toEqual([
      'ext.example.greek-tools',
      'ext.example.hebrew-tools',
    ]);
  });

  it('get returns null for unknown extensions', () => {
    expect(registry.get('ext.does.not-exist')).toBeNull();
  });

  it('upsert replaces an existing row in place', () => {
    const v1 = makeManifest('ext.example.greek-tools', '1.0.0');
    registry.insert({ manifest: v1, installPath: '/p', grantedPermissions: [] });

    const v2 = makeManifest('ext.example.greek-tools', '2.0.0');
    const info = registry.upsert({
      manifest: v2,
      installPath: '/p',
      grantedPermissions: ['bible:read', 'notes:write'],
    });

    expect(info.manifest.version).toBe('2.0.0');
    expect(info.grantedPermissions).toContain('notes:write');
    expect(db.extensions.get('ext.example.greek-tools')?.version).toBe('2.0.0');
    expect(registry.list()).toHaveLength(1);
  });

  it('setEnabled flips status between installed and disabled', () => {
    registry.insert({
      manifest: makeManifest(),
      installPath: '/p',
      grantedPermissions: [],
    });

    registry.setEnabled('ext.example.greek-tools', false);
    expect(registry.get('ext.example.greek-tools')?.status).toBe('disabled');
    expect(registry.get('ext.example.greek-tools')?.enabled).toBe(false);

    registry.setEnabled('ext.example.greek-tools', true);
    expect(registry.get('ext.example.greek-tools')?.status).toBe('installed');
    expect(registry.get('ext.example.greek-tools')?.enabled).toBe(true);
  });

  it('setEnabled does not blow away worker-owned status (failed/auto-disabled)', () => {
    registry.insert({
      manifest: makeManifest(),
      installPath: '/p',
      grantedPermissions: [],
    });
    registry.setStatus('ext.example.greek-tools', 'auto-disabled', 'crash loop');
    // Re-enable should NOT clobber auto-disabled - the worker subsystem owns
    // that status until resetCrashState is called.
    registry.setEnabled('ext.example.greek-tools', true);
    expect(registry.get('ext.example.greek-tools')?.status).toBe('auto-disabled');
  });

  it('recordCrash increments and persists', () => {
    registry.insert({
      manifest: makeManifest(),
      installPath: '/p',
      grantedPermissions: [],
    });
    expect(registry.recordCrash('ext.example.greek-tools')).toBe(1);
    expect(registry.recordCrash('ext.example.greek-tools')).toBe(2);
    expect(registry.recordCrash('ext.example.greek-tools')).toBe(3);
    expect(db.extensions.get('ext.example.greek-tools')?.crash_count_session).toBe(3);
  });

  it('resetCrashState clears the counter and last error', () => {
    registry.insert({
      manifest: makeManifest(),
      installPath: '/p',
      grantedPermissions: [],
    });
    registry.recordCrash('ext.example.greek-tools');
    registry.setStatus('ext.example.greek-tools', 'failed', 'boom');
    registry.resetCrashState('ext.example.greek-tools');

    const info = registry.get('ext.example.greek-tools');
    expect(info?.crashCountSession).toBe(0);
    expect(info?.lastError).toBeUndefined();
    expect(info?.status).toBe('installed');
  });

  it('remove deletes the row and the in-memory entry', () => {
    registry.insert({
      manifest: makeManifest(),
      installPath: '/p',
      grantedPermissions: [],
    });
    registry.remove('ext.example.greek-tools');
    expect(registry.get('ext.example.greek-tools')).toBeNull();
    expect(db.extensions.size).toBe(0);
  });

  it('setPermissions persists and returns updated info', () => {
    registry.insert({
      manifest: makeManifest(),
      installPath: '/p',
      grantedPermissions: ['bible:read'],
    });
    registry.setPermissions('ext.example.greek-tools', ['bible:read', 'storage']);
    expect(registry.get('ext.example.greek-tools')?.grantedPermissions).toEqual([
      'bible:read',
      'storage',
    ]);
  });
});
