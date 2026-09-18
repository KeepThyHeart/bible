/**
 * The official catalog's trust path through `ModuleCatalogService.fetchCatalog`:
 * pinned keys, multiple signatures, and user-approved vouched keys.
 *
 * The pinned set is swapped for a key the test holds, so every signature here
 * is real Ed25519 over the served bytes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ISql } from '@bible/core';

import { MemoryApprovedCatalogKeyStore } from '../ApprovedCatalogKeys';
import { ModuleCatalogService, type VouchedKeyApprovalRequest } from '../ModuleCatalogService';
import { OFFICIAL_CATALOG_URL_PREFIXES, __setOfficialPublicKeysForTests } from '../trustedCatalogKeys';
import { FakeNetworkGateway, fetchResult } from './fakeNetworkGateway';
import {
  makeKey,
  makeVouch,
  signatureDocument,
  vouchDocument,
  type TestKey,
} from './catalogSigningTestHelpers';

// The catalog repository is only touched by the persistence methods.
const stubSql = {} as unknown as ISql;

const SCOPE = OFFICIAL_CATALOG_URL_PREFIXES[0];
const OFFICIAL_URL = `${SCOPE}catalog.json`;
const THIRD_PARTY_URL = 'https://repo.example/catalog.json';

const CATALOG_JSON = JSON.stringify({
  // Deliberately ancient: a publish date is recorded, never a reason to reject.
  repository: { name: 'Official', url: SCOPE, version: '1.0', published: '2000-01-01T00:00:00Z' },
  modules: [
    { module_id: 'kjv', module_type: 'bible', name: 'King James Version', download_url: 'kjv.zip' },
  ],
});
const CATALOG = Buffer.from(CATALOG_JSON, 'utf-8');

describe('ModuleCatalogService - official catalog trust', () => {
  let pinned: TestKey;
  let gateway: FakeNetworkGateway;
  let store: MemoryApprovedCatalogKeyStore;
  let approvals: VouchedKeyApprovalRequest[];
  let approve: boolean;
  let service: ModuleCatalogService;

  beforeEach(() => {
    pinned = makeKey();
    __setOfficialPublicKeysForTests([pinned.publicKeyHex]);
    gateway = new FakeNetworkGateway();
    store = new MemoryApprovedCatalogKeyStore();
    approvals = [];
    approve = true;
    service = new ModuleCatalogService(stubSql, gateway, {
      approvedKeys: store,
      approveVouchedKey: async (request) => {
        approvals.push(request);
        return approve;
      },
    });
  });

  afterEach(() => {
    __setOfficialPublicKeysForTests(undefined);
  });

  /** Serve `files` by URL; anything else is a 404. */
  function serve(files: Record<string, string>): void {
    gateway.fetchBufferedImpl = async ({ url }) =>
      files[url] === undefined ? fetchResult(404) : fetchResult(200, files[url]);
  }

  it('accepts the official catalog signed by a pinned key without asking, whatever its age', async () => {
    serve({ [OFFICIAL_URL]: CATALOG_JSON, [`${OFFICIAL_URL}.sig`]: signatureDocument(CATALOG, pinned) });

    const fetched = await service.fetchCatalog(OFFICIAL_URL);

    expect(fetched.signature.status).toBe('verified');
    expect(fetched.signature.publicKey).toBe(pinned.publicKeyHex);
    expect(fetched.catalog.repository.published).toBe('2000-01-01T00:00:00Z');
    expect(approvals).toHaveLength(0);
  });

  it('holds the official catalog to its pins even when the caller passes no key', async () => {
    // Adding a catalog passes no expected key; an unsigned official catalog
    // must still be refused.
    serve({ [OFFICIAL_URL]: CATALOG_JSON });

    await expect(service.fetchCatalog(OFFICIAL_URL)).rejects.toThrow(/signature check failed/);
  });

  it('refuses a catalog signed by an unknown key when no vouch is served', async () => {
    serve({ [OFFICIAL_URL]: CATALOG_JSON, [`${OFFICIAL_URL}.sig`]: signatureDocument(CATALOG, makeKey()) });

    await expect(service.fetchCatalog(OFFICIAL_URL)).rejects.toThrow(/different key/);
    expect(approvals).toHaveLength(0);
  });

  it('asks before trusting a vouched key, then remembers the approval', async () => {
    const next = makeKey();
    serve({
      [OFFICIAL_URL]: CATALOG_JSON,
      [`${OFFICIAL_URL}.sig`]: signatureDocument(CATALOG, next),
      [`${OFFICIAL_URL}.vouches`]: vouchDocument(makeVouch(pinned, next.publicKeyHex, SCOPE)),
    });

    const first = await service.fetchCatalog(OFFICIAL_URL);

    expect(first.signature.status).toBe('verified');
    expect(first.signature.publicKey).toBe(next.publicKeyHex);
    expect(approvals).toHaveLength(1);
    expect(approvals[0].newKey).toBe(next.publicKeyHex);
    expect(approvals[0].chain[0].vouchingKey).toBe(pinned.publicKeyHex);
    expect(store.list(SCOPE)).toEqual([next.publicKeyHex]);

    await service.fetchCatalog(OFFICIAL_URL);
    expect(approvals).toHaveLength(1);
  });

  it('refuses the catalog when the user declines the vouched key', async () => {
    approve = false;
    const next = makeKey();
    serve({
      [OFFICIAL_URL]: CATALOG_JSON,
      [`${OFFICIAL_URL}.sig`]: signatureDocument(CATALOG, next),
      [`${OFFICIAL_URL}.vouches`]: vouchDocument(makeVouch(pinned, next.publicKeyHex, SCOPE)),
    });

    await expect(service.fetchCatalog(OFFICIAL_URL)).rejects.toThrow(/did not approve/);
    expect(approvals).toHaveLength(1);
    expect(store.list(SCOPE)).toEqual([]);
  });

  it('never asks when a pinned key also signed the catalog', async () => {
    const next = makeKey();
    serve({
      [OFFICIAL_URL]: CATALOG_JSON,
      [`${OFFICIAL_URL}.sig`]: signatureDocument(CATALOG, next, pinned),
      [`${OFFICIAL_URL}.vouches`]: vouchDocument(makeVouch(pinned, next.publicKeyHex, SCOPE)),
    });

    const fetched = await service.fetchCatalog(OFFICIAL_URL);

    expect(fetched.signature.status).toBe('verified');
    expect(fetched.signature.publicKey).toBe(pinned.publicKeyHex);
    expect(approvals).toHaveLength(0);
  });

  it('does not ask when the vouch is not by a trusted key', async () => {
    const rogue = makeKey();
    const next = makeKey();
    serve({
      [OFFICIAL_URL]: CATALOG_JSON,
      [`${OFFICIAL_URL}.sig`]: signatureDocument(CATALOG, next),
      [`${OFFICIAL_URL}.vouches`]: vouchDocument(makeVouch(rogue, next.publicKeyHex, SCOPE)),
    });

    await expect(service.fetchCatalog(OFFICIAL_URL)).rejects.toThrow(/different key/);
    expect(approvals).toHaveLength(0);
  });

  it('ignores vouches for a catalog that is not official', async () => {
    const recorded = makeKey();
    const next = makeKey();
    serve({
      [THIRD_PARTY_URL]: CATALOG_JSON,
      [`${THIRD_PARTY_URL}.sig`]: signatureDocument(CATALOG, next),
      [`${THIRD_PARTY_URL}.vouches`]: vouchDocument(
        makeVouch(recorded, next.publicKeyHex, 'https://repo.example/'),
      ),
    });

    await expect(service.fetchCatalog(THIRD_PARTY_URL, recorded.publicKeyHex, true)).rejects.toThrow(
      /different key/,
    );
    expect(approvals).toHaveLength(0);
  });
});
