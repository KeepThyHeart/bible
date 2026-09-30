/** Desktop asset store (task 0090): the shared IAssetStore contract plus fs-specific behaviour. */
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fsp, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AssetError, type AssetRegistrySnapshot } from '@bible/core/browser';
import { FsAssetStore, FsAssetRegistryStore } from '../assets/FsAssetStore';
import {
  describeAssetStoreContract,
  ref,
  makeBytes,
  collect,
} from '../../../../../packages/core/src/__tests__/assets/fakes';

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await fsp.mkdtemp(join(tmpdir(), 'fsassets-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await fsp.rm(d, { recursive: true, force: true });
});

describeAssetStoreContract(async () => {
  const root = await tmp();
  return { store: new FsAssetStore(root), cleanup: () => fsp.rm(root, { recursive: true, force: true }) };
}, 'FsAssetStore contract');

describe('FsAssetStore (fs specifics)', () => {
  const f = ref('https://x.test/a.bin', 0, { path: 'sub/a.bin' });

  it('commits under files/<kind>/<id>/<version>/<path> and pathOf agrees', async () => {
    const root = await tmp();
    const store = new FsAssetStore(root);
    const p = await store.openPartial(f);
    await p.append(makeBytes(300));
    await p.commit();
    expect(store.pathOf(f)).toBe(join(root, 'files', 'data', 'a', '1', 'sub', 'a.bin'));
    expect((await fsp.stat(store.pathOf(f))).size).toBe(300);
    expect(existsSync(join(root, 'partial', 'data', 'a', '1', 'sub'))).toBe(false); // pruned
    expect((await collect(await store.read(f))).length).toBe(300);
  });

  it('rejects a path that escapes the store', async () => {
    const store = new FsAssetStore(await tmp());
    for (const path of ['../x', 'a/../../x', '/etc/passwd', 'a\\b']) {
      expect(() => store.pathOf(ref('u', 0, { path }))).toThrow(AssetError);
      await expect(store.openPartial(ref('u', 0, { path }))).rejects.toBeInstanceOf(AssetError);
    }
    expect(() => store.pathOf(ref('u', 0, { assetId: '..' }))).toThrow(AssetError);
  });

  it('delete removes files and partials and prunes empty directories', async () => {
    const root = await tmp();
    const store = new FsAssetStore(root);
    const p = await store.openPartial(f);
    await p.append(makeBytes(10));
    await p.commit();
    const g = ref('https://x.test/b.bin', 0, { path: 'b.bin' });
    const q = await store.openPartial(g);
    await q.append(makeBytes(5));
    await q.close();
    await store.delete([f, g]);
    expect(await store.exists(f)).toBe(false);
    expect(await fsp.readdir(join(root, 'files'))).toEqual([]);
    expect(await fsp.readdir(join(root, 'partial'))).toEqual([]);
    await store.delete([f]); // missing ones are ignored
  });

  it('ENOSPC on append becomes quota', async () => {
    const store = new FsAssetStore(await tmp());
    const p = await store.openPartial(f);
    // Force the handle open, then make its write fail.
    await p.append(makeBytes(1));
    const handle = (p as unknown as { handle: { appendFile: () => Promise<void> } }).handle;
    handle.appendFile = () => Promise.reject(Object.assign(new Error('full'), { code: 'ENOSPC' }));
    await expect(p.append(makeBytes(1))).rejects.toMatchObject({ code: 'quota' });
  });

  it('sweepPartials removes old partials only', async () => {
    const root = await tmp();
    const store = new FsAssetStore(root);
    const old = await store.openPartial(f);
    await old.append(makeBytes(10));
    await old.close();
    const metaPath = join(root, 'partial', 'data', 'a', '1', 'sub', 'a.bin.part.json');
    await fsp.writeFile(metaPath, JSON.stringify({ validator: null, touchedAt: Date.now() - 10_000 }));
    const fresh = ref('https://x.test/c.bin', 0, { path: 'c.bin' });
    const keep = await store.openPartial(fresh);
    await keep.append(makeBytes(10));
    await keep.close();
    await store.sweepPartials(5_000);
    expect((await store.openPartial(f)).size).toBe(0);
    expect((await store.openPartial(fresh)).size).toBe(10);
  });

  it('freeBytes reports a number', async () => {
    const store = new FsAssetStore(await tmp());
    const free = await store.freeBytes();
    expect(typeof free).toBe('number');
    expect(free as number).toBeGreaterThan(0);
  });

  it('pruneOtherVersions drops stale version dirs of installed assets only', async () => {
    const root = await tmp();
    const store = new FsAssetStore(root);
    for (const [id, v] of [['a', '1'], ['a', '2'], ['orphan', '1']] as const) {
      const r = ref('https://x.test/' + id + v, 0, { assetId: id, version: v, path: 'f.bin' });
      const p = await store.openPartial(r);
      await p.append(makeBytes(3));
      await p.commit();
    }
    await store.pruneOtherVersions([{ kind: 'data', id: 'a', version: '2' }]);
    expect(await fsp.readdir(join(root, 'files', 'data', 'a'))).toEqual(['2']);
    expect(await fsp.readdir(join(root, 'files', 'data', 'orphan'))).toEqual(['1']);
  });
});

describe('FsAssetRegistryStore', () => {
  const snap: AssetRegistrySnapshot = { schema: 'kth-asset-registry/1', assets: [] };

  it('round-trips via tmp + rename and returns null when absent or corrupt', async () => {
    const root = await tmp();
    const file = join(root, 'sub', 'registry.json');
    const reg = new FsAssetRegistryStore(file);
    expect(await reg.load()).toBeNull();
    await reg.save(snap);
    expect(existsSync(`${file}.tmp`)).toBe(false);
    expect(await reg.load()).toEqual(snap);
    await fsp.writeFile(file, '{not json');
    expect(await reg.load()).toBeNull();
  });
});
