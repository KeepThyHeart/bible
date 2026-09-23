/**
 * `ModuleCatalogService.refreshAllCatalogs` - the master offline switch and
 * partial/total failure across several enabled sources.
 *
 * Fixes the bug `ModuleManagerDialog`'s Refresh button used to hit silently:
 * offline used to be attempted-and-swallowed per source (each one logging
 * its own `NetworkBlockedError` and the caller seeing a plain empty result),
 * which read as "no modules found" rather than "you're offline". See
 * `docs/features/module-management.md`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ModuleCatalog, type ISql, type ModuleCatalogRepository } from '@bible/core';

import { ModuleCatalogService } from '../ModuleCatalogService';
import { NetworkBlockedError } from '../NetworkGateway';
import { FakeNetworkGateway, fetchResult } from './fakeNetworkGateway';

const stubSql = {} as unknown as ISql;

/** Just enough of `ModuleCatalogRepository` for the refresh path. */
class FakeCatalogRepository {
  readonly sources: ModuleCatalog[] = [];
  private nextId = 1;

  getAll(): ModuleCatalog[] {
    return [...this.sources];
  }

  getEnabled(): ModuleCatalog[] {
    return this.sources.filter((source) => source.isEnabled);
  }

  getById(id: number): ModuleCatalog | undefined {
    return this.sources.find((source) => source.catalogId === id);
  }

  create(entity: ModuleCatalog): ModuleCatalog {
    entity.catalogId = this.nextId++;
    this.sources.push(entity);
    return entity;
  }

  update(entity: ModuleCatalog): ModuleCatalog {
    return entity;
  }
}

function catalogJson(name: string): string {
  return JSON.stringify({
    repository: { name, url: `https://${name}.example`, version: '1.0' },
    modules: [
      { module_id: `${name}-bible`, module_type: 'bible', name: `${name} Bible`, download_url: 'b.zip' },
    ],
  });
}

describe('ModuleCatalogService.refreshAllCatalogs', () => {
  let gateway: FakeNetworkGateway;
  let repo: FakeCatalogRepository;
  let service: ModuleCatalogService;

  beforeEach(() => {
    gateway = new FakeNetworkGateway();
    repo = new FakeCatalogRepository();
    service = new ModuleCatalogService(stubSql, gateway, {
      catalogRepository: repo as unknown as ModuleCatalogRepository,
    });
  });

  it('throws NetworkBlockedError up front when offline, before touching any source', async () => {
    repo.create(new ModuleCatalog({ name: 'A', url: 'https://a.example', type: 'third_party' }));
    gateway.offline = true;

    await expect(service.refreshAllCatalogs()).rejects.toThrow(NetworkBlockedError);
    // Not even the official-index sync, let alone the enabled source, was attempted.
    expect(gateway.fetchCalls).toHaveLength(0);
  });

  it('returns an empty list with no error when there are no enabled sources', async () => {
    // Nothing seeded - the official index sync itself will fail to reach
    // anything real and is swallowed by `syncOfficialIndexes` (never throws).
    await expect(service.refreshAllCatalogs()).resolves.toEqual([]);
  });

  it('returns the successful sources when only some fail (partial success)', async () => {
    repo.create(new ModuleCatalog({ name: 'A', url: 'https://a.example', type: 'third_party' }));
    repo.create(new ModuleCatalog({ name: 'B', url: 'https://b.example', type: 'third_party' }));

    // Exact-match by URL so an index probe (`.../index.json`) can never be
    // mistaken for the catalog document itself (both would otherwise share
    // the `https://a.example` prefix).
    gateway.fetchBufferedImpl = async (opts) => {
      if (opts.url === 'https://a.example/catalog.json') return fetchResult(200, catalogJson('A'));
      if (opts.url === 'https://b.example/catalog.json') return fetchResult(500); // recoverable failure
      return fetchResult(404); // .sig sidecars, index probes, official-index scopes
    };

    const refreshed = await service.refreshAllCatalogs();
    expect(refreshed.map((c) => c.name)).toEqual(['A']);
  });

  it('throws one summarizing error when every enabled source fails', async () => {
    repo.create(new ModuleCatalog({ name: 'A', url: 'https://a.example', type: 'third_party' }));
    repo.create(new ModuleCatalog({ name: 'B', url: 'https://b.example', type: 'third_party' }));

    gateway.fetchBufferedImpl = async (opts) => {
      if (opts.url === 'https://a.example/catalog.json' || opts.url === 'https://b.example/catalog.json') {
        return fetchResult(500);
      }
      return fetchResult(404);
    };

    await expect(service.refreshAllCatalogs()).rejects.toThrow(
      /Could not refresh any catalog: A: .*; B: .*/
    );
  });
});
