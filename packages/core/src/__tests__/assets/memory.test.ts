import { describe, expect, it } from 'vitest';
import { MemoryAssetRegistryStore, MemoryAssetStore } from '../../assets/memory';
import { ASSET_REGISTRY_SCHEMA } from '../../assets/types';
import type { AssetRegistrySnapshot } from '../../assets/types';
import { collect, describeAssetStoreContract, makeBytes, ref } from './fakes';

describeAssetStoreContract(() => new MemoryAssetStore(), 'MemoryAssetStore (contract)');

describe('MemoryAssetStore specifics', () => {
  it('committed files are keyed by url (same url = same file)', async () => {
    const s = new MemoryAssetStore();
    const a = ref('https://x.test/f', 0, { version: '1' });
    const b = ref('https://x.test/f', 0, { version: '2' });
    const p = await s.openPartial(a);
    await p.append(makeBytes(10));
    await p.commit();
    expect(await s.exists(b)).toBe(true);
  });

  it('read returns copies: mutating them does not change the store', async () => {
    const s = new MemoryAssetStore();
    const r = ref('https://x.test/f');
    const p = await s.openPartial(r);
    await p.append(makeBytes(8, 2));
    await p.commit();
    const first = await collect(await s.read(r));
    first.fill(0);
    expect(await collect(await s.read(r))).toEqual(makeBytes(8, 2));
  });

  it('append copies the chunk it is given', async () => {
    const s = new MemoryAssetStore();
    const p = await s.openPartial(ref('https://x.test/f'));
    const chunk = makeBytes(8, 3);
    await p.append(chunk);
    chunk.fill(0);
    expect(await collect(p.read())).toEqual(makeBytes(8, 3));
  });

  it('a committed or discarded partial rejects further writes', async () => {
    const s = new MemoryAssetStore();
    const r = ref('https://x.test/f');
    const p = await s.openPartial(r);
    await p.commit();
    await expect(p.append(makeBytes(1))).rejects.toMatchObject({ code: 'storage' });
    const q = await s.openPartial(r);
    await q.discard();
    await expect(q.append(makeBytes(1))).rejects.toMatchObject({ code: 'storage' });
    await q.close(); // no-op
  });

  it('capacityBytes: append over the limit throws quota; freeBytes reports the remainder', async () => {
    const s = new MemoryAssetStore({ capacityBytes: 100 });
    const p = await s.openPartial(ref('https://x.test/f'));
    await p.append(makeBytes(60));
    expect(await s.freeBytes?.()).toBe(40);
    await expect(p.append(makeBytes(41))).rejects.toMatchObject({ code: 'quota' });
    expect(p.size).toBe(60);
    await p.append(makeBytes(40));
    expect(await s.freeBytes?.()).toBe(0);
  });

  it('reportFreeBytes: false hides freeBytes but keeps the quota', async () => {
    const s = new MemoryAssetStore({ capacityBytes: 10, reportFreeBytes: false });
    expect(s.freeBytes).toBeUndefined();
    const p = await s.openPartial(ref('https://x.test/f'));
    await expect(p.append(makeBytes(11))).rejects.toMatchObject({ code: 'quota' });
  });

  it('sweepPartials uses the injected clock', async () => {
    let t = 0;
    const s = new MemoryAssetStore({ now: () => t });
    const p = await s.openPartial(ref('https://x.test/f'));
    await p.append(makeBytes(5));
    t = 1000;
    await s.sweepPartials(2000);
    expect(s.partialUrls()).toHaveLength(1);
    t = 3001;
    await s.sweepPartials(2000);
    expect(s.partialUrls()).toHaveLength(0);
  });
});

describe('MemoryAssetRegistryStore', () => {
  const snap: AssetRegistrySnapshot = { schema: ASSET_REGISTRY_SCHEMA, assets: [] };

  it('load is null until saved; save/load round trips without aliasing', async () => {
    const r = new MemoryAssetRegistryStore();
    expect(await r.load()).toBeNull();
    await r.save(snap);
    const a = await r.load();
    expect(a).toEqual(snap);
    expect(a).not.toBe(snap);
    expect(r.saves).toBe(1);
  });

  it('garbage raw text loads as null', async () => {
    const r = new MemoryAssetRegistryStore();
    r.raw = '{nope';
    expect(await r.load()).toBeNull();
    expect(r.current).toBeNull();
  });

  it('failSaves makes the next saves reject', async () => {
    const r = new MemoryAssetRegistryStore();
    r.failSaves = 1;
    await expect(r.save(snap)).rejects.toThrow();
    await r.save(snap);
    expect(r.current).toEqual(snap);
  });
});
