import { describe, expect, it } from 'vitest';
import { validateManifest } from './ExtensionManifestValidator';

function manifest(userData?: unknown): Record<string, unknown> {
  const m: Record<string, unknown> = {
    id: 'ext.example.memory',
    name: 'Memory',
    version: '1.0.0',
    publisher: 'example',
    engines: { bibleApp: '^1.0.0' },
    main: 'dist/extension.js',
    permissions: ['storage'],
  };
  if (userData !== undefined) m.userData = userData;
  return m;
}

describe('manifest userData', () => {
  it('is optional', () => {
    const r = validateManifest(manifest());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest.userData).toBeUndefined();
  });

  it('accepts backup flag, reserved sync flag and per-database declarations', () => {
    const r = validateManifest(manifest({
      backup: false,
      sync: false,
      databases: { progress: { backup: true }, 'embeddings-v2': { backup: false, sync: false } },
    }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.userData?.backup).toBe(false);
      expect(r.manifest.userData?.databases?.progress).toEqual({ backup: true });
    }
  });

  it.each([
    ['non-object', 'yes', '/userData'],
    ['unknown key', { backups: true }, '/userData'],
    ['non-boolean backup', { backup: 'true' }, '/userData/backup'],
    ['bad database name', { databases: { '../x': { backup: true } } }, '/userData/databases/../x'],
    ['database entry not an object', { databases: { a: true } }, '/userData/databases/a'],
    ['unknown database key', { databases: { a: { backups: true } } }, '/userData/databases/a'],
    ['non-boolean database backup', { databases: { a: { backup: 1 } } }, '/userData/databases/a/backup'],
  ])('rejects %s', (_name, userData, path) => {
    const r = validateManifest(manifest(userData));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path === path || e.path.startsWith(path))).toBe(true);
  });
});
