import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { isAssetError } from '@bible/core/browser';
import type { AssetFileRef, IPartialFile } from '@bible/core/browser';
import { createFakeOpfs } from '../testing/fakeOpfs';
import { FLUSH_BYTES, OpfsModuleStore } from './OpfsModuleStore';
import { OpfsRegistryStore } from './OpfsRegistryStore';

const ref = (over: Partial<AssetFileRef> = {}): AssetFileRef => ({
  assetId: 'module.kjv', kind: 'module', version: 's1', path: 'KJV.db.gz', url: 'https://x.test/files/module.kjv/s1/KJV.db.gz', size: 0, ...over,
});

function sqliteFile(extra = 100): Uint8Array {
  const out = new Uint8Array(16 + extra);
  out.set(new TextEncoder().encode('SQLite format 3\0'));
  for (let i = 16; i < out.length; i++) out[i] = i % 251;
  return out;
}

async function collect(src: AsyncIterable<Uint8Array> | null): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const c of src!) parts.push(c);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function put(p: IPartialFile, bytes: Uint8Array, step = 1000): Promise<void> {
  for (let i = 0; i < bytes.length; i += step) await p.append(bytes.slice(i, i + step));
}

describe('OpfsModuleStore', () => {
  it('commit gunzips, validates the SQLite header and exposes modules/<abbr>.db', async () => {
    const root = createFakeOpfs();
    const store = new OpfsModuleStore(async () => root as never);
    const db = sqliteFile(5000);
    const gz = new Uint8Array(gzipSync(db));
    const p = await store.openPartial(ref());
    await put(p, gz);
    await p.commit();
    expect(root.peek('modules/KJV.db')).toEqual(db);
    expect(await store.exists(ref())).toBe(true);
    expect(await collect(await store.read(ref()))).toEqual(db);
    expect(root.list('modules')).not.toContain('KJV.db.tmp');
    expect(root.list('modules/.partial')).toEqual([]);
  });

  it('works where move() is missing (copy fallback)', async () => {
    const root = createFakeOpfs({ withoutMove: true });
    const store = new OpfsModuleStore(async () => root as never);
    const db = sqliteFile();
    const p = await store.openPartial(ref());
    await put(p, new Uint8Array(gzipSync(db)));
    await p.commit();
    expect(root.peek('modules/KJV.db')).toEqual(db);
    expect(root.list('modules')).not.toContain('KJV.db.tmp');
  });

  it('rejects a file without the SQLite header and leaves no final file', async () => {
    const root = createFakeOpfs();
    const store = new OpfsModuleStore(async () => root as never);
    const p = await store.openPartial(ref());
    await put(p, new Uint8Array(gzipSync(new TextEncoder().encode('<html>not a database at all</html>'))));
    const err = await p.commit().catch((e) => e);
    expect(isAssetError(err) && err.code).toBe('storage');
    expect(await store.exists(ref())).toBe(false);
    expect(root.list('modules')).not.toContain('KJV.db.tmp');
  });

  it('rejects bytes that are not gzip', async () => {
    const root = createFakeOpfs();
    const store = new OpfsModuleStore(async () => root as never);
    const p = await store.openPartial(ref());
    await put(p, new Uint8Array(200).fill(7));
    const err = await p.commit().catch((e) => e);
    expect(isAssetError(err) && err.code).toBe('storage');
    expect(await store.exists(ref())).toBe(false);
  });

  it('keeps flushed bytes and the validator across a reopen (resume)', async () => {
    const root = createFakeOpfs();
    const store = new OpfsModuleStore(async () => root as never);
    const p = await store.openPartial(ref());
    await p.reset('"etag-1"');
    const bytes = new Uint8Array(FLUSH_BYTES + 10).fill(3);
    await p.append(bytes);
    await p.append(new Uint8Array(5).fill(4));
    await p.close();
    expect(p.size).toBe(FLUSH_BYTES + 15);
    const again = await store.openPartial(ref());
    expect(again.size).toBe(FLUSH_BYTES + 15);
    expect(again.validator).toBe('"etag-1"');
    expect((await collect(again.read())).length).toBe(FLUSH_BYTES + 15);
    await again.reset('"etag-2"');
    expect(again.size).toBe(0);
    expect((await store.openPartial(ref())).validator).toBe('"etag-2"');
  });

  it('delete removes the file and partials, but not a newer committed version', async () => {
    const root = createFakeOpfs();
    const store = new OpfsModuleStore(async () => root as never);
    const p = await store.openPartial(ref({ version: 's2' }));
    await put(p, new Uint8Array(gzipSync(sqliteFile())));
    await p.commit();
    await store.delete([ref({ version: 's1' })]);
    expect(await store.exists(ref())).toBe(true);
    await store.delete([ref({ version: 's2' })]);
    expect(await store.exists(ref())).toBe(false);
    await store.delete([ref()]); // missing is ignored
  });

  it('sweepPartials drops old and orphaned partials only', async () => {
    const root = createFakeOpfs();
    let now = 1_000_000;
    const store = new OpfsModuleStore(async () => root as never, () => now);
    const old = await store.openPartial(ref({ assetId: 'module.old' }));
    await old.reset(null);
    await old.append(new Uint8Array(10));
    await old.close();
    now += 10_000;
    const fresh = await store.openPartial(ref({ assetId: 'module.new' }));
    await fresh.reset(null);
    await fresh.append(new Uint8Array(10));
    await fresh.close();
    const dir = await (await root.getDirectoryHandle('modules')).getDirectoryHandle('.partial');
    await (await dir.getFileHandle('orphan.s1', { create: true })).createWritable().then((w) => w.close());
    await store.sweepPartials(5000);
    expect(root.list('modules/.partial')).toEqual(['module.new.s1', 'module.new.s1.meta.json']);
  });

  it('freeBytes is quota minus usage, or null', async () => {
    const store = new OpfsModuleStore(async () => createFakeOpfs() as never);
    const nav = globalThis.navigator;
    const orig = nav.storage;
    Object.defineProperty(nav, 'storage', { value: { estimate: async () => ({ quota: 1000, usage: 400 }) }, configurable: true });
    expect(await store.freeBytes()).toBe(600);
    Object.defineProperty(nav, 'storage', { value: {}, configurable: true });
    expect(await store.freeBytes()).toBeNull();
    Object.defineProperty(nav, 'storage', { value: orig, configurable: true });
  });

  it('rejects paths that could leave modules/ and throws storage errors without OPFS', async () => {
    const store = new OpfsModuleStore(async () => createFakeOpfs() as never);
    await expect(store.exists(ref({ path: '../x.db.gz' }))).rejects.toMatchObject({ code: 'storage' });
    const nav = globalThis.navigator;
    const orig = nav.storage;
    Object.defineProperty(nav, 'storage', { value: undefined, configurable: true });
    expect(() => new OpfsModuleStore()).toThrowError(/not available/);
    Object.defineProperty(nav, 'storage', { value: orig, configurable: true });
  });
});

describe('OpfsRegistryStore', () => {
  it('round-trips a snapshot and treats garbage as empty', async () => {
    const root = createFakeOpfs();
    const reg = new OpfsRegistryStore(async () => root as never);
    expect(await reg.load()).toBeNull();
    const snap = { schema: 'kth-asset-registry/1' as const, assets: [] };
    await reg.save(snap);
    expect(await reg.load()).toEqual(snap);
    const w = await (await (await root.getDirectoryHandle('modules')).getFileHandle('.registry.json')).createWritable();
    await w.write('{nope');
    await w.close();
    expect(await reg.load()).toBeNull();
  });
});
