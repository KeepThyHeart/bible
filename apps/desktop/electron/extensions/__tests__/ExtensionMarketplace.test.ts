/**
 * Install-from-catalog and the blocklist kill-switch.
 *
 * The two claims worth testing here are the ones a marketplace lives or dies
 * on:
 *
 *   1. Bytes that do not match the catalog's published checksum are discarded
 *      **before anything is unpacked** - a lying catalog cannot get code as
 *      far as the extraction path.
 *   2. A blocked extension refuses to *run* without being deleted, and only
 *      the app's own blocklist can do the blocking.
 *
 * Everything runs against a fake gateway and a real zip built on the fly; no
 * socket is opened and no marketplace is contacted.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Extensions } from '@bible/core';

import { ExtensionCatalogService } from '../marketplace/ExtensionCatalogService';
import { installExtensionFromCatalog } from '../marketplace/installFromCatalog';
import { ExtensionBlocklistService } from '../marketplace/ExtensionBlocklistService';
import {
  __setDefaultCatalogUrlForTests,
  __setBlocklistUrlForTests,
  __clearDefaultCatalogUrlForTests,
} from '../DefaultCatalog';
import { NetworkBlockedError, type INetworkGateway } from '../../services/NetworkGateway';
import { ExtensionRegistry } from '../ExtensionRegistry';
import { initializeExtensionSchema } from '../extensionSchema';
import { FakeSql } from './fakeSql';
import { makeZip } from './makeZip';

const DEFAULT_CATALOG = 'https://catalog.example.org/extensions.json';
const BLOCKLIST_URL = 'https://catalog.example.org/blocklist.json';
const BUNDLE_URL = 'https://catalog.example.org/hello-1.0.0.zip';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'bible-mkt-test-'));
});

afterEach(() => {
  __clearDefaultCatalogUrlForTests();
  rmSync(tmpRoot, { recursive: true, force: true });
});

// --- Fixtures -------------------------------------------------------------

/**
 * Build a real `.zip` containing a minimal valid extension.
 *
 * Deliberately a real archive rather than a stub: the whole point of the hash
 * gate is what happens *before* unpacking, so the test needs a payload the
 * unpacker would actually accept in order to prove the gate fired first.
 */
function makeBundle(id: string, version: string): Buffer {
  return makeZip([
    {
      path: 'extension.json',
      content: JSON.stringify({
        id,
        name: { key: 'ext.name' },
        version,
        publisher: 'example',
        engines: { bibleApp: `^${Extensions.EXTENSION_API_VERSION.split('.')[0]}.0.0` },
        main: './main.js',
        permissions: [],
      }),
    },
    { path: 'main.js', content: 'exports.activate = () => {};' },
  ]);
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function catalogDoc(entries: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    format: Extensions.EXTENSION_CATALOG_FORMAT,
    name: 'Example Catalog',
    extensions: entries,
  });
}

/** Fake egress that serves a per-URL body map and records every request. */
class FakeGateway implements Partial<INetworkGateway> {
  readonly requested: string[] = [];
  offline = false;
  readonly bodies = new Map<string, Buffer>();
  status = 200;

  isOffline(): boolean {
    return this.offline;
  }

  async fetchBuffered(opts: { url: string; maxResponseBytes: number }): Promise<{
    status: number;
    headers: Record<string, string>;
    url: string;
    body: Buffer;
  }> {
    this.requested.push(opts.url);
    if (this.offline) throw new NetworkBlockedError('test');
    const body = this.bodies.get(opts.url) ?? Buffer.alloc(0);
    if (body.byteLength > opts.maxResponseBytes) {
      throw new Error(`Response exceeded ${opts.maxResponseBytes} bytes`);
    }
    return { status: this.status, headers: {}, url: opts.url, body };
  }
}

/** Minimal host context for the install path. */
function makeCtx(db: FakeSql): {
  ctx: Record<string, unknown>;
  registry: ExtensionRegistry;
  extensionsRoot: string;
} {
  const registry = new ExtensionRegistry(db);
  const extensionsRoot = join(tmpRoot, 'installed');
  mkdirSync(extensionsRoot, { recursive: true });
  return {
    registry,
    extensionsRoot,
    ctx: {
      registry,
      extensionsRoot,
      logger: { appendLog: (): void => {} },
      consentPrompter: async () => ({ granted: true as const, grantedPermissions: [] }),
      activeWorkers: new Map(),
    },
  };
}

// --- 1. Install from catalog ----------------------------------------------

describe('installExtensionFromCatalog', () => {
  it('installs a listing whose bytes match the published checksum', async () => {
    __setDefaultCatalogUrlForTests(DEFAULT_CATALOG);
    const bundle = makeBundle('ext.example.hello', '1.0.0');
    const gateway = new FakeGateway();
    gateway.bodies.set(
      DEFAULT_CATALOG,
      Buffer.from(
        catalogDoc([
          {
            id: 'ext.example.hello',
            version: '1.0.0',
            name: 'Hello',
            downloadUrl: BUNDLE_URL,
            sha256: sha256(bundle),
            sizeBytes: bundle.byteLength,
          },
        ]),
      ),
    );
    gateway.bodies.set(BUNDLE_URL, bundle);

    const db = new FakeSql();
    initializeExtensionSchema(db);
    const catalogService = new ExtensionCatalogService({
      db,
      gateway: gateway as unknown as INetworkGateway,
    });
    await catalogService.refresh(DEFAULT_CATALOG);

    const { ctx } = makeCtx(db);
    const result = await installExtensionFromCatalog(ctx as never, {
      extensionId: 'ext.example.hello',
      catalogService,
      gateway: gateway as unknown as INetworkGateway,
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    // Provenance recorded, and it is what makes the tier reachable.
    expect(result.state.sourceCatalogUrl).toBe(DEFAULT_CATALOG);
    expect(result.state.trustTier).toBe('marketplace');
    // A catalog install lands disabled, exactly like a sideload: consent
    // covers permissions, not execution.
    expect(result.state.enabled).toBe(false);
  });

  it('discards a bundle whose hash does not match, before unpacking anything', async () => {
    __setDefaultCatalogUrlForTests(DEFAULT_CATALOG);
    const realBundle = makeBundle('ext.example.hello', '1.0.0');
    const substituted = makeBundle('ext.example.evil', '9.9.9');
    const gateway = new FakeGateway();
    gateway.bodies.set(
      DEFAULT_CATALOG,
      Buffer.from(
        catalogDoc([
          {
            id: 'ext.example.hello',
            version: '1.0.0',
            name: 'Hello',
            downloadUrl: BUNDLE_URL,
            // The catalog advertises the honest bundle...
            sha256: sha256(realBundle),
          },
        ]),
      ),
    );
    // ...but the download serves a different one.
    gateway.bodies.set(BUNDLE_URL, substituted);

    const db = new FakeSql();
    initializeExtensionSchema(db);
    const catalogService = new ExtensionCatalogService({
      db,
      gateway: gateway as unknown as INetworkGateway,
    });
    await catalogService.refresh(DEFAULT_CATALOG);

    const { ctx, extensionsRoot } = makeCtx(db);
    const result = await installExtensionFromCatalog(ctx as never, {
      extensionId: 'ext.example.hello',
      catalogService,
      gateway: gateway as unknown as INetworkGateway,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('HashMismatch');
    // Nothing reached the registry...
    expect(db.extensions.size).toBe(0);
    // ...and nothing was written to disk, which is the claim that matters:
    // the substituted archive never reached the unpacker.
    expect(existsSync(extensionsRoot) ? readdirSync(extensionsRoot) : []).toEqual([]);
  });

  it('reports a listing that is not in any cached catalog', async () => {
    const db = new FakeSql();
    initializeExtensionSchema(db);
    const gateway = new FakeGateway();
    const catalogService = new ExtensionCatalogService({
      db,
      gateway: gateway as unknown as INetworkGateway,
    });
    const { ctx } = makeCtx(db);

    const result = await installExtensionFromCatalog(ctx as never, {
      extensionId: 'ext.nope',
      catalogService,
      gateway: gateway as unknown as INetworkGateway,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NotListed');
    expect(gateway.requested).toEqual([]);
  });

  it('refuses to download in offline mode', async () => {
    __setDefaultCatalogUrlForTests(DEFAULT_CATALOG);
    const bundle = makeBundle('ext.example.hello', '1.0.0');
    const gateway = new FakeGateway();
    gateway.bodies.set(
      DEFAULT_CATALOG,
      Buffer.from(
        catalogDoc([
          {
            id: 'ext.example.hello',
            version: '1.0.0',
            name: 'Hello',
            downloadUrl: BUNDLE_URL,
            sha256: sha256(bundle),
          },
        ]),
      ),
    );
    gateway.bodies.set(BUNDLE_URL, bundle);

    const db = new FakeSql();
    initializeExtensionSchema(db);
    const catalogService = new ExtensionCatalogService({
      db,
      gateway: gateway as unknown as INetworkGateway,
    });
    await catalogService.refresh(DEFAULT_CATALOG);
    gateway.offline = true;

    const { ctx } = makeCtx(db);
    const result = await installExtensionFromCatalog(ctx as never, {
      extensionId: 'ext.example.hello',
      catalogService,
      gateway: gateway as unknown as INetworkGateway,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('Offline');
  });

  it('does not promote an install from a user-added catalog', async () => {
    // The decision-2 rule, end to end: same bundle, same signature status,
    // different source - and only the default catalog confers the tier.
    __setDefaultCatalogUrlForTests(DEFAULT_CATALOG);
    const otherCatalog = 'https://someone-else.example.net/extensions.json';
    const bundle = makeBundle('ext.example.hello', '1.0.0');
    const gateway = new FakeGateway();
    gateway.bodies.set(
      otherCatalog,
      Buffer.from(
        catalogDoc([
          {
            id: 'ext.example.hello',
            version: '1.0.0',
            name: 'Hello',
            downloadUrl: BUNDLE_URL,
            sha256: sha256(bundle),
          },
        ]),
      ),
    );
    gateway.bodies.set(BUNDLE_URL, bundle);

    const db = new FakeSql();
    initializeExtensionSchema(db);
    const catalogService = new ExtensionCatalogService({
      db,
      gateway: gateway as unknown as INetworkGateway,
    });
    catalogService.addSource({ url: otherCatalog, acknowledgeRisk: true });
    await catalogService.refresh(otherCatalog);

    const { ctx } = makeCtx(db);
    const result = await installExtensionFromCatalog(ctx as never, {
      extensionId: 'ext.example.hello',
      catalogService,
      gateway: gateway as unknown as INetworkGateway,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.state.trustTier).toBe('untrusted');
  });
});

// --- 2. Blocklist ---------------------------------------------------------

function blocklistDoc(entries: Array<Record<string, unknown>>): string {
  return JSON.stringify({ format: Extensions.EXTENSION_BLOCKLIST_FORMAT, entries });
}

function makeBlocklist(gateway: FakeGateway): {
  service: ExtensionBlocklistService;
  db: FakeSql;
} {
  const db = new FakeSql();
  initializeExtensionSchema(db);
  return {
    db,
    service: new ExtensionBlocklistService({
      db,
      gateway: gateway as unknown as INetworkGateway,
    }),
  };
}

describe('ExtensionBlocklistService', () => {
  it('blocks every version when a rule carries no range', async () => {
    __setBlocklistUrlForTests(BLOCKLIST_URL);
    const gateway = new FakeGateway();
    gateway.bodies.set(
      BLOCKLIST_URL,
      Buffer.from(blocklistDoc([{ id: 'ext.bad', reason: 'Exfiltrates notes' }])),
    );
    const { service } = makeBlocklist(gateway);
    await service.refresh();

    expect(service.check('ext.bad', '1.0.0')?.reason).toBe('Exfiltrates notes');
    expect(service.check('ext.bad', '99.0.0')).toBeDefined();
    expect(service.check('ext.good', '1.0.0')).toBeUndefined();
  });

  it('blocks only the affected versions when a range is given', async () => {
    // The reason granularity exists: a bad 1.4.2 must not condemn 1.4.1.
    __setBlocklistUrlForTests(BLOCKLIST_URL);
    const gateway = new FakeGateway();
    gateway.bodies.set(
      BLOCKLIST_URL,
      Buffer.from(
        blocklistDoc([{ id: 'ext.bad', versions: '>=1.4.0 <1.4.3', reason: 'Data loss bug' }]),
      ),
    );
    const { service } = makeBlocklist(gateway);
    await service.refresh();

    expect(service.check('ext.bad', '1.4.2')).toBeDefined();
    expect(service.check('ext.bad', '1.4.0')).toBeDefined();
    expect(service.check('ext.bad', '1.3.9')).toBeUndefined();
    expect(service.check('ext.bad', '1.4.3')).toBeUndefined();
  });

  it('ignores an unparseable range instead of treating it as a wildcard', async () => {
    // A typo in one published range must not silently disable an extension
    // everywhere with a reason string that does not explain it.
    __setBlocklistUrlForTests(BLOCKLIST_URL);
    const gateway = new FakeGateway();
    gateway.bodies.set(
      BLOCKLIST_URL,
      Buffer.from(blocklistDoc([{ id: 'ext.bad', versions: 'not a range', reason: 'oops' }])),
    );
    const { service } = makeBlocklist(gateway);
    await service.refresh();
    expect(service.check('ext.bad', '1.0.0')).toBeUndefined();
  });

  it('replaces rules wholesale so a removed rule un-blocks', async () => {
    // Merging would make un-blocking impossible.
    __setBlocklistUrlForTests(BLOCKLIST_URL);
    const gateway = new FakeGateway();
    gateway.bodies.set(
      BLOCKLIST_URL,
      Buffer.from(blocklistDoc([{ id: 'ext.bad', reason: 'temporary' }])),
    );
    const { service } = makeBlocklist(gateway);
    await service.refresh();
    expect(service.check('ext.bad', '1.0.0')).toBeDefined();

    gateway.bodies.set(BLOCKLIST_URL, Buffer.from(blocklistDoc([])));
    await service.refresh();
    expect(service.check('ext.bad', '1.0.0')).toBeUndefined();
  });

  it('keeps existing rules when a refresh fails', async () => {
    // Dropping them because a request timed out would un-block software the
    // publisher has declared dangerous.
    __setBlocklistUrlForTests(BLOCKLIST_URL);
    const gateway = new FakeGateway();
    gateway.bodies.set(
      BLOCKLIST_URL,
      Buffer.from(blocklistDoc([{ id: 'ext.bad', reason: 'Exfiltrates notes' }])),
    );
    const { service } = makeBlocklist(gateway);
    await service.refresh();

    gateway.status = 500;
    const res = await service.refresh();
    expect(res.ok).toBe(false);
    expect(service.check('ext.bad', '1.0.0')).toBeDefined();
  });

  it('blocks nothing on a build with no blocklist endpoint', async () => {
    // Today's shipped state. Not an error the user should ever see.
    __setBlocklistUrlForTests(undefined);
    const gateway = new FakeGateway();
    const { service } = makeBlocklist(gateway);
    const res = await service.refresh();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('NotConfigured');
    expect(gateway.requested).toEqual([]);
  });

  it('does not refresh in offline mode', async () => {
    __setBlocklistUrlForTests(BLOCKLIST_URL);
    const gateway = new FakeGateway();
    gateway.offline = true;
    const { service } = makeBlocklist(gateway);
    const res = await service.refresh();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('Offline');
  });

  it('drops a rule with no reason rather than blocking silently', async () => {
    __setBlocklistUrlForTests(BLOCKLIST_URL);
    const gateway = new FakeGateway();
    gateway.bodies.set(BLOCKLIST_URL, Buffer.from(blocklistDoc([{ id: 'ext.bad' }])));
    const { service } = makeBlocklist(gateway);
    await service.refresh();
    expect(service.check('ext.bad', '1.0.0')).toBeUndefined();
  });
});

// --- 3. Enforcement: refuse to run, never delete --------------------------

describe('blocklist enforcement at activation', () => {
  it('refuses to activate a blocked extension and leaves it installed', async () => {
    __setBlocklistUrlForTests(BLOCKLIST_URL);
    const gateway = new FakeGateway();
    gateway.bodies.set(
      BLOCKLIST_URL,
      Buffer.from(
        blocklistDoc([
          { id: 'ext.bad', reason: 'Exfiltrates your notes', url: 'https://advisory.example' },
        ]),
      ),
    );
    const { service: blocklist, db } = makeBlocklist(gateway);
    await blocklist.refresh();

    const registry = new ExtensionRegistry(db);
    const installPath = join(tmpRoot, 'ext.bad');
    mkdirSync(installPath, { recursive: true });
    writeFileSync(join(installPath, 'main.js'), '');
    registry.insert({
      manifest: {
        id: 'ext.bad',
        name: { key: 'n' },
        version: '1.0.0',
        publisher: 'p',
        engines: { bibleApp: '^1.0.0' },
        main: './main.js',
      } as never,
      installPath,
      grantedPermissions: [],
      enabled: true,
    });

    const { activate } = await import('../ExtensionHostLifecycle');
    const ctx = {
      registry,
      blocklist,
      activeWorkers: new Map(),
      logger: { appendLog: (): void => {} },
      workerFactory: {},
    };

    await expect(activate(ctx as never, 'ext.bad')).rejects.toThrow(/blocked/i);

    // Refused, not removed: the files are still there and the row still
    // exists. The user keeps what they installed.
    expect(existsSync(installPath)).toBe(true);
    expect(registry.get('ext.bad')).not.toBeNull();
    // And the reason is recorded where the UI can read it.
    expect(registry.get('ext.bad')?.lastError).toContain('Exfiltrates your notes');
  });

  it('starts normally when the installed version falls outside the blocked range', async () => {
    __setBlocklistUrlForTests(BLOCKLIST_URL);
    const gateway = new FakeGateway();
    gateway.bodies.set(
      BLOCKLIST_URL,
      Buffer.from(blocklistDoc([{ id: 'ext.ok', versions: '<1.0.0', reason: 'old builds only' }])),
    );
    const { service: blocklist, db } = makeBlocklist(gateway);
    await blocklist.refresh();

    const registry = new ExtensionRegistry(db);
    registry.insert({
      manifest: {
        id: 'ext.ok',
        name: { key: 'n' },
        version: '2.0.0',
        publisher: 'p',
        engines: { bibleApp: '^1.0.0' },
        main: './main.js',
      } as never,
      installPath: join(tmpRoot, 'ext.ok'),
      grantedPermissions: [],
      enabled: true,
    });

    const { activate } = await import('../ExtensionHostLifecycle');
    const ctx = {
      registry,
      blocklist,
      activeWorkers: new Map(),
      logger: { appendLog: (): void => {} },
      workerFactory: undefined,
    };

    // Gets past the blocklist gate and fails later, on the missing worker
    // factory - which is the proof it was not blocked.
    await expect(activate(ctx as never, 'ext.ok')).rejects.toThrow(/worker factory/i);
  });

  it('blocks nothing when the host has no blocklist wired', async () => {
    const db = new FakeSql();
    initializeExtensionSchema(db);
    const registry = new ExtensionRegistry(db);
    registry.insert({
      manifest: {
        id: 'ext.any',
        name: { key: 'n' },
        version: '1.0.0',
        publisher: 'p',
        engines: { bibleApp: '^1.0.0' },
        main: './main.js',
      } as never,
      installPath: join(tmpRoot, 'ext.any'),
      grantedPermissions: [],
      enabled: true,
    });

    const { activate } = await import('../ExtensionHostLifecycle');
    const ctx = {
      registry,
      blocklist: undefined,
      activeWorkers: new Map(),
      logger: { appendLog: (): void => {} },
      workerFactory: undefined,
    };
    await expect(activate(ctx as never, 'ext.any')).rejects.toThrow(/worker factory/i);
  });
});
