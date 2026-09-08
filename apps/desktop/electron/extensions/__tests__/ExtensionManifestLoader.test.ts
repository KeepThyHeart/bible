import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadManifest } from '../ExtensionManifestLoader';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'ext-loader-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeManifest(dir: string, body: unknown): string {
  const installPath = join(tmpRoot, dir);
  mkdirSync(installPath, { recursive: true });
  writeFileSync(join(installPath, 'extension.json'), JSON.stringify(body), 'utf8');
  return installPath;
}

describe('loadManifest', () => {
  it('returns ok=true with a parsed manifest for a valid extension.json', () => {
    const installPath = writeManifest('valid-ext', {
      id: 'ext.example.tools',
      name: { key: 'extension.name' },
      version: '1.0.0',
      publisher: 'example',
      engines: { bibleApp: '^1.0.0' },
    });
    const result = loadManifest(installPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.id).toBe('ext.example.tools');
      expect(result.installPath).toBe(installPath);
      expect(result.manifestPath).toBe(join(installPath, 'extension.json'));
    }
  });

  it('returns manifest.missing when extension.json is absent', () => {
    const installPath = join(tmpRoot, 'no-manifest');
    mkdirSync(installPath);
    const result = loadManifest(installPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('manifest.missing');
    }
  });

  it('returns manifest.parse-error on invalid JSON', () => {
    const installPath = join(tmpRoot, 'bad-json');
    mkdirSync(installPath);
    writeFileSync(join(installPath, 'extension.json'), '{ not: json', 'utf8');
    const result = loadManifest(installPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('manifest.parse-error');
    }
  });

  it('returns the validator errors when the manifest fails validation', () => {
    const installPath = writeManifest('invalid-ext', {
      id: 'not-a-valid-id',
      version: 'not-semver',
    });
    const result = loadManifest(installPath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // At least one structured error from the validator (path, code, message).
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]?.code).not.toBe('manifest.missing');
      expect(result.errors[0]?.code).not.toBe('manifest.parse-error');
    }
  });
});
