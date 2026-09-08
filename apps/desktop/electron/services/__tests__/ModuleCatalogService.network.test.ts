/**
 * Tests for `ModuleCatalogService.fetchCatalog` against the injected
 * `NetworkGateway` seam.
 *
 * The redirect-limit / https -> http-downgrade / size-cap security assertions
 * live in `NetworkGateway.test.ts` (they are enforced by the gateway, which
 * this service delegates to). Here we verify
 * that the service issues the right request, parses/validates the JSON it gets
 * back, and surfaces the gateway's errors - including the master offline
 * switch - to the caller.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ISql } from '@bible/core';

import { CATALOG_MAX_RESPONSE_BYTES } from '../../config/constants';
import { ModuleCatalogService } from '../ModuleCatalogService';
import { NetworkBlockedError } from '../NetworkGateway';
import { FakeNetworkGateway, fetchResult } from './fakeNetworkGateway';

// The catalog repository is only touched by the persistence methods, so the
// fetch tests can hand the service an inert ISql.
const stubSql = {} as unknown as ISql;

const VALID_CATALOG = JSON.stringify({
  repository: { name: 'Test', url: 'https://repo.example', version: '1.0' },
  modules: [
    {
      module_id: 'kjv',
      module_type: 'bible',
      name: 'King James Version',
      download_url: 'https://repo.example/kjv.zip',
    },
  ],
});

describe('ModuleCatalogService via NetworkGateway', () => {
  let gateway: FakeNetworkGateway;
  let service: ModuleCatalogService;

  beforeEach(() => {
    gateway = new FakeNetworkGateway();
    service = new ModuleCatalogService(stubSql, gateway);
  });

  /** No `.sig` served - the common case for a catalog that isn't signed. */
  function withUnsignedSignature(
    catalogImpl: (opts: { url: string }) => Promise<ReturnType<typeof fetchResult>> | ReturnType<typeof fetchResult>
  ) {
    return async (opts: { url: string }) => {
      if (opts.url.endsWith('.sig')) {
        return fetchResult(404);
      }
      return catalogImpl(opts);
    };
  }

  it('requests catalog.json with the size cap and returns the parsed catalog', async () => {
    gateway.fetchBufferedImpl = withUnsignedSignature(async () => fetchResult(200, VALID_CATALOG));

    await expect(service.fetchCatalog('https://repo.example')).resolves.toMatchObject({
      catalog: { repository: { name: 'Test' } },
      signature: { status: 'unsigned' },
    });

    expect(gateway.fetchCalls).toHaveLength(2);
    const call = gateway.fetchCalls[0]!;
    expect(call.url).toBe('https://repo.example/catalog.json');
    expect(call.maxResponseBytes).toBe(CATALOG_MAX_RESPONSE_BYTES);
    expect(call.context).toBe('catalog fetch');
    expect(gateway.fetchCalls[1]!.url).toBe('https://repo.example/catalog.json.sig');
  });

  it('accepts a URL that already points at a .json document', async () => {
    gateway.fetchBufferedImpl = withUnsignedSignature(async () => fetchResult(200, VALID_CATALOG));
    await expect(service.fetchCatalog('https://repo.example/custom.json')).resolves.toBeDefined();
    expect(gateway.fetchCalls[0]!.url).toBe('https://repo.example/custom.json');
  });

  it('rejects a non-200 status', async () => {
    gateway.fetchBufferedImpl = async () => fetchResult(404);
    await expect(service.fetchCatalog('https://repo.example')).rejects.toThrow(/HTTP 404/);
  });

  it('rejects a body that is not valid JSON', async () => {
    gateway.fetchBufferedImpl = async () => fetchResult(200, 'not json at all');
    await expect(service.fetchCatalog('https://repo.example')).rejects.toThrow(
      /Failed to parse catalog JSON/
    );
  });

  it('rejects a well-formed JSON body that is not a valid catalog', async () => {
    gateway.fetchBufferedImpl = async () => fetchResult(200, JSON.stringify({ nope: true }));
    await expect(service.fetchCatalog('https://repo.example')).rejects.toThrow(
      /Invalid catalog format/
    );
  });

  it('propagates a gateway error (e.g. redirect/downgrade) to the caller', async () => {
    gateway.fetchBufferedImpl = async () => {
      throw new Error('Refusing insecure redirect (https → http downgrade)');
    };
    await expect(service.fetchCatalog('https://repo.example')).rejects.toThrow(
      /https → http downgrade/
    );
  });

  it('surfaces the master offline switch (NetworkBlockedError)', async () => {
    gateway.offline = true;
    await expect(service.fetchCatalog('https://repo.example')).rejects.toThrow(NetworkBlockedError);
    // Offline is refused before any fetch body work.
    expect(gateway.fetchCalls).toHaveLength(1);
  });
});
