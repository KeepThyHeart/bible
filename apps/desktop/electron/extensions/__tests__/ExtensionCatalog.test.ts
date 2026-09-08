/**
 * Catalog source management and fetching.
 *
 * Two rules carry the weight here, and both are enforced in the service
 * rather than the UI so no caller can route around them:
 *
 *   1. A catalog the user added is inert until they acknowledge the risk.
 *      The gate lives at the fetch boundary, not in a dialog.
 *   2. Adding a catalog grants no trust. Only the app's *configured default*
 *      catalog can confer the `marketplace` tier - otherwise anyone could
 *      publish a `catalog.json` and mint marketplace-tier extensions.
 *
 * Everything runs against a fake `NetworkGateway`; no socket is opened.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Extensions } from '@bible/core';

import { ExtensionCatalogService } from '../marketplace/ExtensionCatalogService';
import {
  __setDefaultCatalogUrlForTests,
  __clearDefaultCatalogUrlForTests,
  normalizeCatalogUrl,
} from '../DefaultCatalog';
import { NetworkBlockedError, type INetworkGateway } from '../../services/NetworkGateway';
import { initializeExtensionSchema } from '../extensionSchema';
import { FakeSql } from './fakeSql';

const DEFAULT_CATALOG = 'https://catalog.example.org/extensions.json';
const USER_CATALOG = 'https://someone-else.example.net/extensions.json';
const GOOD_SHA = 'a'.repeat(64);

function catalogDoc(over: Record<string, unknown> = {}): unknown {
  return {
    format: Extensions.EXTENSION_CATALOG_FORMAT,
    name: 'Example Catalog',
    extensions: [
      {
        id: 'ext.example.hello',
        version: '1.0.0',
        name: 'Hello',
        downloadUrl: 'https://example.com/hello-1.0.0.zip',
        sha256: GOOD_SHA,
      },
    ],
    ...over,
  };
}

/**
 * Fake egress. Records every URL requested so tests can assert that a
 * non-acknowledged source never reaches the network at all - "it failed" and
 * "it never tried" are different guarantees, and only the second one is safe.
 */
class FakeGateway implements Partial<INetworkGateway> {
  readonly requested: string[] = [];
  offline = false;
  status = 200;
  body: string = JSON.stringify(catalogDoc());
  throwOnFetch: Error | undefined;

  isOffline(): boolean {
    return this.offline;
  }

  async fetchBuffered(opts: { url: string }): Promise<{
    status: number;
    headers: Record<string, string>;
    url: string;
    body: Buffer;
  }> {
    this.requested.push(opts.url);
    if (this.offline) throw new NetworkBlockedError('extension catalog fetch');
    if (this.throwOnFetch) throw this.throwOnFetch;
    return {
      status: this.status,
      headers: {},
      url: opts.url,
      body: Buffer.from(this.body, 'utf-8'),
    };
  }
}

function makeService(gateway: FakeGateway): {
  service: ExtensionCatalogService;
  db: FakeSql;
} {
  const db = new FakeSql();
  initializeExtensionSchema(db);
  const service = new ExtensionCatalogService({
    db,
    gateway: gateway as unknown as INetworkGateway,
  });
  return { service, db };
}

let gateway: FakeGateway;

beforeEach(() => {
  gateway = new FakeGateway();
});

afterEach(() => {
  __clearDefaultCatalogUrlForTests();
});

// --- 1. Source management -------------------------------------------------

describe('ExtensionCatalogService — sources', () => {
  it('lists the configured default catalog without the user adding it', () => {
    __setDefaultCatalogUrlForTests(DEFAULT_CATALOG);
    const { service } = makeService(gateway);
    const sources = service.listSources();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.isDefault).toBe(true);
    // Shipping a default catalog *is* the app vouching for it, so it needs no
    // separate acknowledgement from the user.
    expect(sources[0]?.riskAcknowledgedAt).toBeDefined();
  });

  it('lists nothing on a build with no default catalog', () => {
    // Today's shipped state.
    __setDefaultCatalogUrlForTests(undefined);
    const { service } = makeService(gateway);
    expect(service.listSources()).toEqual([]);
  });

  it('rejects a non-https catalog URL', () => {
    const { service } = makeService(gateway);
    for (const url of ['http://x.example/c.json', 'file:///c.json', 'not a url']) {
      const res = service.addSource({ url, acknowledgeRisk: true });
      expect(res.ok, url).toBe(false);
      if (res.ok) continue;
      expect(res.code).toBe('InvalidUrl');
    }
  });

  it('rejects a duplicate source, including one that differs only by trailing slash or case', () => {
    const { service } = makeService(gateway);
    expect(service.addSource({ url: USER_CATALOG, acknowledgeRisk: true }).ok).toBe(true);
    const dup = service.addSource({
      url: USER_CATALOG.replace('someone-else', 'Someone-Else') + '/',
      acknowledgeRisk: true,
    });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.code).toBe('DuplicateSource');
  });

  it('stores an un-acknowledged source rather than discarding what the user typed', () => {
    const { service } = makeService(gateway);
    const added = service.addSource({ url: USER_CATALOG });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.source.riskAcknowledgedAt).toBeUndefined();
    expect(service.listSources()).toHaveLength(1);
  });

  it('acknowledgeRisk flips a stored source to fetchable', () => {
    const { service } = makeService(gateway);
    service.addSource({ url: USER_CATALOG });
    expect(service.acknowledgeRisk(USER_CATALOG).ok).toBe(true);
    expect(service.listSources()[0]?.riskAcknowledgedAt).toBeDefined();
  });

  it('acknowledgeRisk on an unknown source reports it instead of creating one', () => {
    const { service } = makeService(gateway);
    const res = service.acknowledgeRisk(USER_CATALOG);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('UnknownSource');
  });

  it('removing a source forgets the list, not the extensions installed from it', () => {
    const { service, db } = makeService(gateway);
    service.addSource({ url: USER_CATALOG, acknowledgeRisk: true });
    service.removeSource(USER_CATALOG);
    expect(service.listSources()).toEqual([]);
    // Provenance rows are untouched - re-adding the source must not change
    // what an already-installed extension says about where it came from.
    expect(db.extensions.size).toBe(0);
  });
});

// --- 2. The acknowledgement gate ------------------------------------------

describe('ExtensionCatalogService — risk acknowledgement gate', () => {
  it('never opens a socket for an un-acknowledged source', async () => {
    const { service } = makeService(gateway);
    service.addSource({ url: USER_CATALOG });

    const res = await service.refresh(USER_CATALOG);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('RiskNotAcknowledged');
    // The point: not merely "rejected", but "never attempted".
    expect(gateway.requested).toEqual([]);
  });

  it('fetches once the risk is acknowledged', async () => {
    const { service } = makeService(gateway);
    service.addSource({ url: USER_CATALOG, acknowledgeRisk: true });

    const res = await service.refresh(USER_CATALOG);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(gateway.requested).toEqual([normalizeCatalogUrl(USER_CATALOG)]);
  });

  it('never requires acknowledgement for the app default', async () => {
    __setDefaultCatalogUrlForTests(DEFAULT_CATALOG);
    const { service } = makeService(gateway);
    const res = await service.refresh(DEFAULT_CATALOG);
    expect(res.ok, JSON.stringify(res)).toBe(true);
  });

  it('refuses a source that was never added', async () => {
    const { service } = makeService(gateway);
    const res = await service.refresh(USER_CATALOG);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('UnknownSource');
    expect(gateway.requested).toEqual([]);
  });
});

// --- 3. Fetch, validation, caching ----------------------------------------

describe('ExtensionCatalogService — fetch', () => {
  it('caches a fetched catalog and serves it back without the network', async () => {
    const { service } = makeService(gateway);
    service.addSource({ url: USER_CATALOG, acknowledgeRisk: true });
    await service.refresh(USER_CATALOG);

    const cached = service.getCached(USER_CATALOG);
    expect(cached?.extensions).toHaveLength(1);
    expect(cached?.extensions[0]?.id).toBe('ext.example.hello');
  });

  it('reports offline mode without marking the catalog as broken', async () => {
    const { service } = makeService(gateway);
    service.addSource({ url: USER_CATALOG, acknowledgeRisk: true });
    await service.refresh(USER_CATALOG);
    gateway.offline = true;

    const res = await service.refresh(USER_CATALOG);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('Offline');
    // The user turned the network off on purpose; flagging the source as
    // failing would mislead them next time they open the list.
    expect(service.listSources()[0]?.lastError).toBeUndefined();
    // And the previously fetched document is still browsable.
    expect(service.getCached(USER_CATALOG)?.extensions).toHaveLength(1);
  });

  it('keeps the last good document when a later fetch fails', async () => {
    const { service } = makeService(gateway);
    service.addSource({ url: USER_CATALOG, acknowledgeRisk: true });
    await service.refresh(USER_CATALOG);

    gateway.status = 503;
    const res = await service.refresh(USER_CATALOG);
    expect(res.ok).toBe(false);
    expect(service.getCached(USER_CATALOG)?.extensions).toHaveLength(1);
    expect(service.listSources()[0]?.lastError).toContain('503');
  });

  it('rejects a document that is not JSON', async () => {
    gateway.body = 'not json at all';
    const { service } = makeService(gateway);
    service.addSource({ url: USER_CATALOG, acknowledgeRisk: true });

    const res = await service.refresh(USER_CATALOG);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('InvalidDocument');
  });

  it('rejects a document with an unknown format marker', async () => {
    gateway.body = JSON.stringify(catalogDoc({ format: 99 }));
    const { service } = makeService(gateway);
    service.addSource({ url: USER_CATALOG, acknowledgeRisk: true });

    const res = await service.refresh(USER_CATALOG);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('InvalidDocument');
    expect(res.detail?.join()).toContain('catalog.format');
  });

  it('drops a malformed listing but installs the rest of the catalog', async () => {
    gateway.body = JSON.stringify(
      catalogDoc({
        extensions: [
          { id: 'broken-entry-missing-everything' },
          {
            id: 'ext.example.good',
            version: '2.0.0',
            name: 'Good',
            downloadUrl: 'https://example.com/good.zip',
            sha256: GOOD_SHA,
          },
        ],
      }),
    );
    const { service } = makeService(gateway);
    service.addSource({ url: USER_CATALOG, acknowledgeRisk: true });
    await service.refresh(USER_CATALOG);

    expect(service.getCached(USER_CATALOG)?.extensions.map((e) => e.id)).toEqual([
      'ext.example.good',
    ]);
  });
});

// --- 4. Listings ----------------------------------------------------------

describe('ExtensionCatalogService — listings', () => {
  it('tags each listing with the catalog it came from', async () => {
    __setDefaultCatalogUrlForTests(DEFAULT_CATALOG);
    const { service } = makeService(gateway);
    service.addSource({ url: USER_CATALOG, acknowledgeRisk: true });
    await service.refresh(DEFAULT_CATALOG);
    await service.refresh(USER_CATALOG);

    const listings = service.listAvailable();
    expect(listings).toHaveLength(2);
    // Which catalog a listing came from determines its trust tier after
    // install, so the tag has to survive into the UI.
    expect(listings.filter((l) => l.fromDefaultCatalog)).toHaveLength(1);
  });

  it('keeps same-id listings from different catalogs separate', async () => {
    // Collapsing them would hide exactly the thing the user needs to see:
    // the same id offered by a vouched-for catalog and an unvouched one.
    __setDefaultCatalogUrlForTests(DEFAULT_CATALOG);
    const { service } = makeService(gateway);
    service.addSource({ url: USER_CATALOG, acknowledgeRisk: true });
    await service.refresh(DEFAULT_CATALOG);
    await service.refresh(USER_CATALOG);

    const hello = service.listAvailable().filter((l) => l.id === 'ext.example.hello');
    expect(hello).toHaveLength(2);
    expect(new Set(hello.map((l) => l.sourceUrl)).size).toBe(2);
  });

  it('findListing can pin the source', async () => {
    __setDefaultCatalogUrlForTests(DEFAULT_CATALOG);
    const { service } = makeService(gateway);
    service.addSource({ url: USER_CATALOG, acknowledgeRisk: true });
    await service.refresh(DEFAULT_CATALOG);
    await service.refresh(USER_CATALOG);

    const pinned = service.findListing('ext.example.hello', USER_CATALOG);
    expect(pinned?.sourceUrl).toBe(normalizeCatalogUrl(USER_CATALOG));
    expect(pinned?.fromDefaultCatalog).toBe(false);
  });

  it('refreshAll skips sources awaiting acknowledgement', async () => {
    const { service } = makeService(gateway);
    service.addSource({ url: USER_CATALOG, acknowledgeRisk: true });
    service.addSource({ url: 'https://third.example.com/c.json' });

    await service.refreshAll();
    expect(gateway.requested).toEqual([normalizeCatalogUrl(USER_CATALOG)]);
  });
});
