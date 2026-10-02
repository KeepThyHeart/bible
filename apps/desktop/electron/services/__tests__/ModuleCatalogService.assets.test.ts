/** `getAvailableAssets` (task 0090): valid absolute-url entries kept, relative/invalid dropped. */
import { describe, it, expect } from 'vitest';
import { ModuleCatalog, type ISql, type ModuleCatalogRepository } from '@bible/core';
import { ModuleCatalogService } from '../ModuleCatalogService';
import { FakeNetworkGateway } from './fakeNetworkGateway';

const SHA = 'a'.repeat(64);
const good = (id: string, url = `https://cdn.test/${id}/f.bin`) => ({
  id, kind: 'data', version: '1', title: id, license: 'MIT', size: 10,
  files: [{ path: 'f.bin', url, size: 10, sha256: SHA }],
});

function service(catalogs: unknown[]): ModuleCatalogService {
  const entries = catalogs.map((c, i) => {
    const e = new ModuleCatalog({ name: `C${i}`, url: `https://c${i}.test/catalog.json`, type: 'third_party', isEnabled: true });
    e.catalogId = i + 1;
    e.setCatalog(c as never);
    return e;
  });
  const repo = { getEnabled: () => entries } as unknown as ModuleCatalogRepository;
  return new ModuleCatalogService({} as ISql, new FakeNetworkGateway(), { catalogRepository: repo });
}

const base = { repository: { name: 'r', url: 'https://c.test', version: '1' }, modules: [] };

describe('ModuleCatalogService.getAvailableAssets', () => {
  it('keeps valid entries, drops relative and invalid ones, first catalog wins an id', () => {
    const svc = service([
      { ...base, assets: [good('one'), good('rel', 'f.bin'), { id: 'Bad id' }, good('dup')] },
      { ...base, assets: [{ ...good('dup'), title: 'second' }, good('two')] },
      base,
    ]);
    const out = svc.getAvailableAssets();
    expect(out.map((a) => a.id)).toEqual(['one', 'dup', 'two']);
    expect(out.find((a) => a.id === 'dup')?.title).toBe('dup');
  });

  it('is empty when no catalog has an assets section', () => {
    expect(service([base]).getAvailableAssets()).toEqual([]);
  });
});
