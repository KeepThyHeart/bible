/**
 * Trust tiers, the trust anchor, and no auto-activation.
 *
 * The load-bearing claim under test is that a *valid signature is not enough*.
 * Treating `signatureStatus === 'verified'` as trustworthy would not do:
 * verification only checks the package against the key shipped inside that
 * same package - a hostile author controls both halves. Promotion to `signed`
 * must additionally require the key to be in the app's own trusted set.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Extensions } from '@bible/core';

import {
  isTrustedPublisherKey,
  getTrustedPublisherKeys,
  __setTrustedPublisherKeysForTests,
} from '../TrustedPublishers';
import {
  __setDefaultCatalogUrlForTests,
  __clearDefaultCatalogUrlForTests,
} from '../DefaultCatalog';
import { ExtensionRegistry } from '../ExtensionRegistry';
import { FakeSql } from './fakeSql';
import { initializeExtensionSchema } from '../extensionSchema';

const TRUSTED_KEY = 'a'.repeat(64);
const UNKNOWN_KEY = 'b'.repeat(64);

afterEach(() => {
  __setTrustedPublisherKeysForTests(undefined);
});

// --- 1. The derivation rule -----------------------------------------------

describe('deriveTrustTier', () => {
  it('does NOT promote a self-signed package just because it verifies', () => {
    // Verifying a signature is not the same as trusting the signer: intact
    // signature, unknown signer -> untrusted.
    expect(
      Extensions.deriveTrustTier({
        signatureStatus: 'verified',
        signatureKey: UNKNOWN_KEY,
        trustedPublisherKeys: [TRUSTED_KEY],
      }),
    ).toBe('untrusted');
  });

  it('promotes only when the signing key is in the trusted set', () => {
    expect(
      Extensions.deriveTrustTier({
        signatureStatus: 'verified',
        signatureKey: TRUSTED_KEY,
        trustedPublisherKeys: [TRUSTED_KEY],
      }),
    ).toBe('signed');
  });

  it('matches trusted keys case-insensitively', () => {
    expect(
      Extensions.deriveTrustTier({
        signatureStatus: 'verified',
        signatureKey: TRUSTED_KEY.toUpperCase(),
        trustedPublisherKeys: [TRUSTED_KEY],
      }),
    ).toBe('signed');
  });

  it.each(['unsigned', 'invalid', 'error'] as const)(
    'treats signatureStatus=%s as untrusted even with a trusted key present',
    (status) => {
      expect(
        Extensions.deriveTrustTier({
          signatureStatus: status,
          signatureKey: TRUSTED_KEY,
          trustedPublisherKeys: [TRUSTED_KEY],
        }),
      ).toBe('untrusted');
    },
  );

  it('is untrusted when there is no signature key at all', () => {
    expect(
      Extensions.deriveTrustTier({
        signatureStatus: 'verified',
        trustedPublisherKeys: [TRUSTED_KEY],
      }),
    ).toBe('untrusted');
    expect(
      Extensions.deriveTrustTier({
        signatureStatus: 'verified',
        signatureKey: '',
        trustedPublisherKeys: [TRUSTED_KEY],
      }),
    ).toBe('untrusted');
  });

  it('is untrusted with an empty trust anchor, which is the shipped default', () => {
    expect(
      Extensions.deriveTrustTier({
        signatureStatus: 'verified',
        signatureKey: TRUSTED_KEY,
        trustedPublisherKeys: [],
      }),
    ).toBe('untrusted');
  });

  it('marketplace wins regardless of signature state', () => {
    expect(
      Extensions.deriveTrustTier({
        signatureStatus: 'unsigned',
        trustedPublisherKeys: [],
        fromMarketplace: true,
      }),
    ).toBe('marketplace');
  });
});

// --- 2. The trust anchor --------------------------------------------------

describe('TrustedPublishers', () => {
  it('ships with an empty anchor, so nothing is vouched for by default', () => {
    expect(getTrustedPublisherKeys()).toEqual([]);
    expect(isTrustedPublisherKey(UNKNOWN_KEY)).toBe(false);
  });

  it('recognises a key once it is in the set', () => {
    __setTrustedPublisherKeysForTests([TRUSTED_KEY]);
    expect(isTrustedPublisherKey(TRUSTED_KEY)).toBe(true);
    expect(isTrustedPublisherKey(TRUSTED_KEY.toUpperCase())).toBe(true);
    expect(isTrustedPublisherKey(UNKNOWN_KEY)).toBe(false);
  });

  it('rejects empty and undefined keys', () => {
    __setTrustedPublisherKeysForTests([TRUSTED_KEY]);
    expect(isTrustedPublisherKey(undefined)).toBe(false);
    expect(isTrustedPublisherKey('')).toBe(false);
  });
});

// --- 3. The registry derives, rather than stores, the tier ----------------

function manifestFor(id: string): Extensions.ExtensionManifest {
  return {
    id,
    name: { key: 'extension.name' },
    version: '1.0.0',
    publisher: 'test',
    engines: { bibleApp: '^1.0.0' },
    main: './main.js',
  } as unknown as Extensions.ExtensionManifest;
}

describe('ExtensionRegistry — derived trust tier', () => {
  let db: FakeSql;
  let registry: ExtensionRegistry;

  beforeEach(() => {
    db = new FakeSql();
    initializeExtensionSchema(db);
    registry = new ExtensionRegistry(db);
  });

  it('reports untrusted for a self-signed install', () => {
    const info = registry.insert({
      manifest: manifestFor('ext.self.signed'),
      installPath: '/tmp/ext.self.signed',
      grantedPermissions: [],
      signatureStatus: 'verified',
      signatureKey: UNKNOWN_KEY,
    });
    expect(info.trustTier).toBe('untrusted');
  });

  it('reclassifies existing installs when the trust anchor changes', () => {
    registry.insert({
      manifest: manifestFor('ext.publisher'),
      installPath: '/tmp/ext.publisher',
      grantedPermissions: [],
      signatureStatus: 'verified',
      signatureKey: TRUSTED_KEY,
    });
    expect(registry.get('ext.publisher')).not.toBeNull();

    // Nothing was written to the row; adding the publisher must be enough.
    // A persisted tier column would still be reading 'untrusted' here.
    __setTrustedPublisherKeysForTests([TRUSTED_KEY]);
    const after = registry.list().find((e) => e.manifest.id === 'ext.publisher');
    expect(after?.trustTier).toBe('signed');

    __setTrustedPublisherKeysForTests([]);
    const reverted = registry.list().find((e) => e.manifest.id === 'ext.publisher');
    expect(reverted?.trustTier).toBe('untrusted');
  });

  it('reports untrusted for an unsigned install', () => {
    const info = registry.insert({
      manifest: manifestFor('ext.unsigned'),
      installPath: '/tmp/ext.unsigned',
      grantedPermissions: [],
      signatureStatus: 'unsigned',
    });
    expect(info.trustTier).toBe('untrusted');
  });
});

// --- 4. No auto-activation of freshly installed extensions ----------------

describe('install does not auto-enable', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'ext-trust-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  function writeSource(id: string): string {
    const dir = join(tmpRoot, 'src', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'extension.json'),
      JSON.stringify({
        id,
        name: { key: 'extension.name' },
        version: '1.0.0',
        publisher: 'test',
        engines: { bibleApp: '^1.0.0' },
        main: './main.js',
        permissions: ['bible:read'],
      }),
      'utf8',
    );
    writeFileSync(join(dir, 'main.js'), 'module.exports = { activate: () => {} };', 'utf8');
    return dir;
  }

  it('lands a fresh install disabled so it cannot run before the user says so', async () => {
    const { installExtension } = await import('../ExtensionHostInstaller');
    const db = new FakeSql();
    initializeExtensionSchema(db);
    const registry = new ExtensionRegistry(db);

    const sourcePath = writeSource('ext.test.fresh');
    const extensionsRoot = join(tmpRoot, 'installed');
    mkdirSync(extensionsRoot, { recursive: true });

    const ctx = {
      registry,
      extensionsRoot,
      logger: { appendLog: () => {} },
      consentPrompter: async () => ({ granted: true as const, grantedPermissions: [] }),
      activeWorkers: new Map(),
    };

    const result = await installExtension(ctx as never, { sourcePath });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    expect(result.state.enabled).toBe(false);
    expect(result.state.status).toBe('disabled');
    // And it is marked untrusted, since the fixture is unsigned.
    expect(result.state.trustTier).toBe('untrusted');
  });

  it('preserves the enabled state of an extension being upgraded in place', async () => {
    const { installExtension } = await import('../ExtensionHostInstaller');
    const db = new FakeSql();
    initializeExtensionSchema(db);
    const registry = new ExtensionRegistry(db);

    const sourcePath = writeSource('ext.test.upgrade');
    const extensionsRoot = join(tmpRoot, 'installed2');
    mkdirSync(extensionsRoot, { recursive: true });

    const ctx = {
      registry,
      extensionsRoot,
      logger: { appendLog: () => {} },
      consentPrompter: async () => ({ granted: true as const, grantedPermissions: [] }),
      activeWorkers: new Map(),
    };

    await installExtension(ctx as never, { sourcePath });
    // User turns it on, then an upgrade arrives.
    registry.setEnabled('ext.test.upgrade', true);

    const upgraded = await installExtension(ctx as never, { sourcePath });
    expect(upgraded.ok, JSON.stringify(upgraded)).toBe(true);
    if (!upgraded.ok) return;
    expect(upgraded.state.enabled).toBe(true);
  });
});

// --- 4. Marketplace provenance --------------------------------------------
//
// These tests pin the rule that makes the `marketplace` tier reachable *and*
// keeps it honest - only the app's configured default
// catalog promotes, because otherwise anyone could mint a marketplace-tier
// extension by publishing a `catalog.json` and talking a user into adding it.

describe('marketplace provenance', () => {
  const DEFAULT_CATALOG = 'https://catalog.example.org/extensions.json';
  const OTHER_CATALOG = 'https://someone-else.example.net/extensions.json';

  afterEach(() => {
    __clearDefaultCatalogUrlForTests();
  });

  function registryWithSource(sourceCatalogUrl?: string): Extensions.ExtensionStateInfo {
    const db = new FakeSql();
    initializeExtensionSchema(db);
    const registry = new ExtensionRegistry(db);
    return registry.insert({
      manifest: {
        id: 'ext.test.provenance',
        name: { key: 'n' },
        version: '1.0.0',
        publisher: 'p',
        engines: { bibleApp: '^1.0.0' },
        main: './main.js',
      } as never,
      installPath: '/fake/path',
      grantedPermissions: [],
      ...(sourceCatalogUrl !== undefined ? { sourceCatalogUrl } : {}),
    });
  }

  it('promotes an install from the configured default catalog', () => {
    __setDefaultCatalogUrlForTests(DEFAULT_CATALOG);
    expect(registryWithSource(DEFAULT_CATALOG).trustTier).toBe('marketplace');
  });

  it('does NOT promote an install from a user-added catalog', () => {
    // The load-bearing case. A user-added catalog is a source the user chose
    // to try, not one the app vouches for.
    __setDefaultCatalogUrlForTests(DEFAULT_CATALOG);
    expect(registryWithSource(OTHER_CATALOG).trustTier).toBe('untrusted');
  });

  it('promotes nothing when the app ships without a default catalog', () => {
    // Today's shipped state: no marketplace exists, so nothing can claim to
    // have come from one.
    __setDefaultCatalogUrlForTests(undefined);
    expect(registryWithSource(DEFAULT_CATALOG).trustTier).toBe('untrusted');
    expect(registryWithSource(OTHER_CATALOG).trustTier).toBe('untrusted');
  });

  it('leaves a sideload untouched', () => {
    __setDefaultCatalogUrlForTests(DEFAULT_CATALOG);
    const info = registryWithSource(undefined);
    expect(info.trustTier).toBe('untrusted');
    expect(info.sourceCatalogUrl).toBeUndefined();
  });

  it('reclassifies immediately when the default catalog changes', () => {
    // The reason provenance is stored but the *tier* is derived: pointing the
    // app at a different marketplace must not leave stale badges behind.
    __setDefaultCatalogUrlForTests(DEFAULT_CATALOG);
    const db = new FakeSql();
    initializeExtensionSchema(db);
    const registry = new ExtensionRegistry(db);
    registry.insert({
      manifest: {
        id: 'ext.test.reclassify',
        name: { key: 'n' },
        version: '1.0.0',
        publisher: 'p',
        engines: { bibleApp: '^1.0.0' },
        main: './main.js',
      } as never,
      installPath: '/fake/path',
      grantedPermissions: [],
      sourceCatalogUrl: DEFAULT_CATALOG,
    });
    expect(registry.get('ext.test.reclassify')?.trustTier).toBe('marketplace');

    __setDefaultCatalogUrlForTests(OTHER_CATALOG);
    expect(registry.get('ext.test.reclassify')?.trustTier).toBe('untrusted');
  });

  it('ignores trailing slashes and origin case when matching the default', () => {
    __setDefaultCatalogUrlForTests('https://Catalog.Example.org/extensions.json');
    expect(registryWithSource('https://catalog.example.org/extensions.json').trustTier).toBe(
      'marketplace',
    );
  });

  it('keeps the recorded source across a plain version upgrade', () => {
    // `upsert` without an explicit `sourceCatalogUrl` must not launder a
    // marketplace install into a sideload - or the reverse.
    __setDefaultCatalogUrlForTests(DEFAULT_CATALOG);
    const db = new FakeSql();
    initializeExtensionSchema(db);
    const registry = new ExtensionRegistry(db);
    const manifest = {
      id: 'ext.test.upgrade-keeps-source',
      name: { key: 'n' },
      version: '1.0.0',
      publisher: 'p',
      engines: { bibleApp: '^1.0.0' },
      main: './main.js',
    };
    registry.insert({
      manifest: manifest as never,
      installPath: '/fake/path',
      grantedPermissions: [],
      sourceCatalogUrl: DEFAULT_CATALOG,
    });
    const upgraded = registry.upsert({
      manifest: { ...manifest, version: '1.1.0' } as never,
      installPath: '/fake/path',
      grantedPermissions: [],
    });
    expect(upgraded.sourceCatalogUrl).toBe(DEFAULT_CATALOG);
    expect(upgraded.trustTier).toBe('marketplace');
  });
});
