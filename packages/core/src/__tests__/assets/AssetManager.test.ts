import { describe, expect, it, vi } from 'vitest';
import { AssetManager } from '../../assets/AssetManager';
import { MemoryAssetRegistryStore, MemoryAssetStore } from '../../assets/memory';
import { sha256Hex } from '../../assets/sha256';
import { ASSET_REGISTRY_SCHEMA, AssetError } from '../../assets/types';
import type { AssetManifest, AssetProgress, InstalledAsset } from '../../assets/types';
import { FakeTransport, collect, createHarness, makeAsset, makeBytes, ref, until } from './fakes';
import type { Harness } from './fakes';

/** Turn a promise into its outcome without an unhandled rejection. */
const settled = <T>(p: Promise<T>): Promise<T | string> => p.then((v) => v, (e: AssetError) => e.code);

function entry(h: Harness, id: string) {
  return h.manager.getSnapshot().entries.find((e) => e.id === id);
}

async function commitFile(store: MemoryAssetStore, url: string, bytes: Uint8Array): Promise<void> {
  const p = await store.openPartial(ref(url, bytes.length));
  await p.append(bytes);
  await p.commit();
}

describe('install: fresh', () => {
  it('downloads, verifies, commits, registers and persists; the snapshot shows installed with size', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { id: 'voice', kind: 'tts-voice', files: { 'v.onnx': 700, 'v.json': 120 } });
    await h.manager.init();
    const got = await h.manager.install(a.manifest);
    expect(got).toMatchObject({ id: 'voice', version: '1', size: 820, verified: true, pinned: false });
    expect(got.files.map((f) => f.sha256)).toEqual(a.manifest.files.map((f) => f.sha256));
    expect(h.manager.installed('voice')).toBe(got);
    expect(h.store.peekFile(a.urls['v.onnx'])).toEqual(a.bodies['v.onnx']);
    expect(h.store.partialUrls()).toEqual([]);
    const snap = h.manager.getSnapshot();
    expect(snap.entries).toHaveLength(1);
    expect(snap.entries[0]).toMatchObject({ id: 'voice', status: 'installed', size: 820, storedBytes: 820, installedVersion: '1', verified: true, pinned: false });
    expect(snap.storedBytes).toBe(820);
    expect(snap.active).toBe(0);
    expect(h.registry.current?.schema).toBe(ASSET_REGISTRY_SCHEMA);
    expect(h.registry.current?.assets.map((x) => x.id)).toEqual(['voice']);
    // requests carry download=1
    expect(h.transport.requests.every((r) => r.url.endsWith('?download=1'))).toBe(true);
  });

  it('files download sequentially within an asset', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { files: { 'a.bin': 200, 'b.bin': 200, 'c.bin': 200 } });
    await h.manager.install(a.manifest);
    expect(h.transport.maxActive).toBe(1);
    expect(h.transport.requests.map((r) => r.url.replace('?download=1', ''))).toEqual(Object.values(a.urls));
  });

  it('pinned install pins; a second install at the same version is immediate and pins', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport);
    const first = await h.manager.install(a.manifest);
    expect(first.pinned).toBe(false);
    const n = h.transport.requests.length;
    const again = await h.manager.install(a.manifest, { pinned: true });
    expect(again.pinned).toBe(true);
    expect(h.transport.requests.length).toBe(n);
    expect(h.registry.current?.assets[0].pinned).toBe(true);
    expect(entry(h, 'asset-a')?.pinned).toBe(true);
  });

  it('installs a catalog entry by id; an unknown id is invalid-manifest', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport);
    h.manager.setCatalog([a.manifest]);
    expect((await h.manager.install('asset-a')).id).toBe('asset-a');
    await expect(h.manager.install('nope')).rejects.toMatchObject({ code: 'invalid-manifest' });
    await expect(h.manager.install({ ...a.manifest, files: [] })).rejects.toMatchObject({ code: 'invalid-manifest' });
  });

  it('reports progress: phases, file counters, resumed-inclusive loaded, throttled', async () => {
    const h = createHarness();
    h.transport.chunkSize = 16;
    const a = makeAsset(h.transport, { files: { 'a.bin': 400, 'b.bin': 300 } });
    const seen: AssetProgress[] = [];
    await h.manager.install(a.manifest, { onProgress: (p) => seen.push(p) });
    expect(seen[0].phase).toBe('queued');
    expect(seen.map((p) => p.phase)).toContain('verifying');
    expect(seen[seen.length - 1].phase).toBe('committing');
    expect(seen[seen.length - 1].loaded).toBe(700);
    expect(seen.every((p) => p.total === 700 && p.files === 2)).toBe(true);
    expect(Math.max(...seen.map((p) => p.file))).toBe(2);
    // the clock never advances: per-chunk updates (44 chunks) are throttled away
    expect(seen.length).toBeLessThan(15);
    // file 2 starts at file 1's bytes
    const second = seen.filter((p) => p.file === 2);
    expect(Math.min(...second.map((p) => p.loaded))).toBeGreaterThanOrEqual(400);
  });

  it('progress is emitted again once 100 ms pass', async () => {
    const h = createHarness();
    h.transport.chunkSize = 50;
    const a = makeAsset(h.transport, { files: { 'a.bin': 500 } });
    const seen: number[] = [];
    await h.manager.install(a.manifest, {
      onProgress: (p) => {
        if (p.phase === 'downloading') seen.push(p.loaded);
        h.clock.advance(100);
      },
    });
    expect(seen.length).toBeGreaterThan(5);
  });

  it('subscribe: status goes queued -> downloading -> installed; snapshot identity is stable between changes', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport);
    const statuses: string[] = [];
    let calls = 0;
    h.manager.subscribe(() => {
      calls++;
      const s = entry(h, 'asset-a')?.status;
      if (s && statuses[statuses.length - 1] !== s) statuses.push(s);
    });
    const before = h.manager.getSnapshot();
    expect(h.manager.getSnapshot()).toBe(before);
    await h.manager.install(a.manifest);
    expect(statuses).toEqual(['queued', 'downloading', 'installed']);
    expect(calls).toBeGreaterThan(2);
    const after = h.manager.getSnapshot();
    expect(after).not.toBe(before);
    expect(h.manager.getSnapshot()).toBe(after);
  });

  it('unsubscribe stops notifications; a throwing listener does not break others', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport);
    let n = 0;
    const off = h.manager.subscribe(() => {
      n++;
    });
    h.manager.subscribe(() => {
      throw new Error('bad listener');
    });
    off();
    await h.manager.install(a.manifest);
    expect(n).toBe(0);
  });
});

describe('catalog and snapshot', () => {
  it('lists catalog and installed ids sorted by kind then title; first duplicate wins', async () => {
    const h = createHarness();
    const b = makeAsset(h.transport, { id: 'b', kind: 'tts-voice', title: 'Zed' });
    const a = makeAsset(h.transport, { id: 'a', kind: 'tts-voice', title: 'Amy' });
    const d = makeAsset(h.transport, { id: 'd', kind: 'data', title: 'Quiz' });
    const dup = { ...a.manifest, title: 'Dup' };
    h.manager.setCatalog([b.manifest, a.manifest, d.manifest, dup]);
    expect(h.manager.getSnapshot().entries.map((e) => `${e.kind}:${e.title}`)).toEqual(['data:Quiz', 'tts-voice:Amy', 'tts-voice:Zed']);
    expect(entry(h, 'a')?.status).toBe('available');
    expect(h.logs.some((l) => l.includes('duplicate'))).toBe(true);
  });

  it('an installed asset missing from the catalog still lists; setCatalog before init is safe', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport);
    await h.manager.install(a.manifest);
    h.manager.setCatalog([]);
    expect(entry(h, 'asset-a')).toMatchObject({ status: 'installed', version: '1' });
  });

  it('a failed install leaves an error entry that a new install clears', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport);
    h.transport.script(a.urls['a.bin'], { status: 404 });
    await expect(h.manager.install(a.manifest)).rejects.toMatchObject({ code: 'not-found' });
    expect(entry(h, 'asset-a')).toMatchObject({ status: 'error', error: { code: 'not-found' } });
    await h.manager.install(a.manifest);
    expect(entry(h, 'asset-a')?.error).toBeUndefined();
    expect(entry(h, 'asset-a')?.status).toBe('installed');
  });
});

describe('resume', () => {
  it('abort after N bytes, then the second install sends Range + If-Range and fetches size bytes in total', async () => {
    const h = createHarness();
    h.transport.chunkSize = 50;
    const a = makeAsset(h.transport, { files: { 'a.bin': 1000 } });
    const url = a.urls['a.bin'];
    h.transport.script(url, { stallAfter: 350 });
    const ctl = new AbortController();
    const p = h.manager.install(a.manifest, { signal: ctl.signal, onProgress: (pr) => {
        h.clock.advance(100);
        if (pr.loaded >= 350) ctl.abort();
      },
    });
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    await until(() => h.manager.getSnapshot().active === 0, 'job end');
    expect(h.store.peekPartial(url)?.length).toBe(350);
    expect(entry(h, 'asset-a')?.error).toBeUndefined();

    await h.manager.install(a.manifest);
    const second = h.transport.requestsFor(url)[1];
    expect(second.rangeStart).toBe(350);
    expect(second.ifRange).toBeTruthy();
    expect(h.transport.bytesServed).toBe(1000);
    expect(h.store.peekFile(url)).toEqual(a.bodies['a.bin']);
    expect(h.manager.installed('asset-a')?.files[0].sha256).toBe(sha256Hex(a.bodies['a.bin']));
  });

  it('server ignoring Range (200): restarts from zero and still verifies', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { files: { 'a.bin': 800 } });
    const url = a.urls['a.bin'];
    h.transport.script(url, { failAfter: 200 }, { mode: 'ignore-range' });
    await h.manager.install(a.manifest);
    expect(h.transport.requestsFor(url).map((r) => r.rangeStart)).toEqual([undefined, 200]);
    expect(h.store.peekFile(url)).toEqual(a.bodies['a.bin']);
    expect(h.manager.installed('asset-a')?.size).toBe(800);
  });
});

describe('verification failure', () => {
  it('integrity: partial discarded, nothing committed, registry unchanged, previous version intact; next install from byte 0', async () => {
    const h = createHarness();
    const v1 = makeAsset(h.transport, { id: 'x', version: '1', files: { 'a.bin': 300 } });
    await h.manager.install(v1.manifest);
    const saves = h.registry.saves;

    // v2 re-uses v1's url (web-style key) with different bytes
    const newBody = makeBytes(300, 4242);
    const url = v1.urls['a.bin'];
    const v2: AssetManifest = {
      ...v1.manifest,
      version: '2',
      files: [{ path: 'a.bin', url, size: 300, sha256: sha256Hex(newBody) }],
    };
    const corrupt = newBody.slice();
    corrupt[10] ^= 1;
    h.transport.add(url, corrupt);
    const before = h.transport.requestsFor(url).length;

    await expect(h.manager.install(v2)).rejects.toMatchObject({ code: 'integrity' });
    expect(h.transport.requestsFor(url)).toHaveLength(before + 1); // not retried
    expect(h.store.partialUrls()).toEqual([]);
    expect(h.store.peekFile(url)).toEqual(v1.bodies['a.bin']);
    expect(h.manager.installed('x')?.version).toBe('1');
    expect(h.registry.saves).toBe(saves);
    expect(await h.manager.readFile('x', 'a.bin')).toEqual(v1.bodies['a.bin']);
    expect(entry(h, 'x')).toMatchObject({ status: 'update-available', installedVersion: '1', error: { code: 'integrity' } });

    h.transport.add(url, newBody);
    await h.manager.install(v2);
    expect(h.transport.requestsFor(url)[before + 1].rangeStart).toBeUndefined();
    expect(h.manager.installed('x')?.version).toBe('2');
    expect(h.store.peekFile(url)).toEqual(newBody);
  });

  it('size overrun and short body: size-mismatch, nothing kept', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { id: 'over', files: { 'a.bin': 200 } });
    h.transport.script(a.urls['a.bin'], { body: makeBytes(260, 1) });
    await expect(h.manager.install(a.manifest)).rejects.toMatchObject({ code: 'size-mismatch' });
    const b = makeAsset(h.transport, { id: 'short', files: { 'a.bin': 200 } });
    h.transport.script(b.urls['a.bin'], { body: makeBytes(150, 1) });
    await expect(h.manager.install(b.manifest)).rejects.toMatchObject({ code: 'size-mismatch' });
    expect(h.store.partialUrls()).toEqual([]);
    expect(h.store.fileUrls()).toEqual([]);
    expect(h.manager.installed('over')).toBeUndefined();
  });

  it('a later file failing leaves nothing registered (earlier files stay committed for reuse)', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { files: { 'a.bin': 100, 'b.bin': 100 } });
    h.transport.script(a.urls['b.bin'], { status: 404 });
    await expect(h.manager.install(a.manifest)).rejects.toMatchObject({ code: 'not-found' });
    expect(h.manager.installed('asset-a')).toBeUndefined();
    expect(h.registry.current).toBeNull();
    await h.manager.install(a.manifest);
    // a.bin was reused without a second download
    expect(h.transport.requestsFor(a.urls['a.bin'])).toHaveLength(1);
  });
});

describe('retries', () => {
  it('503 twice then 200: installed with backoff 1000/4000', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport);
    h.transport.script(a.urls['a.bin'], { status: 503 }, { status: 503 });
    await h.manager.install(a.manifest);
    expect(h.sleeps).toEqual([1000, 4000]);
  });

  it('404: not-found, no retry', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport);
    h.transport.script(a.urls['a.bin'], { status: 404 });
    await expect(h.manager.install(a.manifest)).rejects.toMatchObject({ code: 'not-found' });
    expect(h.sleeps).toEqual([]);
  });

  it('network error mid-body is retried and resumed', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { files: { 'a.bin': 600 } });
    h.transport.script(a.urls['a.bin'], { failAfter: 128 });
    await h.manager.install(a.manifest);
    expect(h.transport.requestsFor(a.urls['a.bin']).map((r) => r.rangeStart)).toEqual([undefined, 128]);
  });

  it('stall is retried as network', async () => {
    const h = createHarness({ stallTimeoutMs: 30 });
    const a = makeAsset(h.transport, { files: { 'a.bin': 600 } });
    h.transport.script(a.urls['a.bin'], { stallAfter: 192 });
    await h.manager.install(a.manifest);
    expect(h.sleeps).toEqual([1000]);
    expect(h.transport.requestsFor(a.urls['a.bin']).map((r) => r.rangeStart)).toEqual([undefined, 192]);
  });

  it('retries exhausted: error on the entry, status error, partial kept', async () => {
    const h = createHarness({ maxRetries: 2 });
    const a = makeAsset(h.transport, { files: { 'a.bin': 600 } });
    h.transport.script(a.urls['a.bin'], { status: 500 }, { status: 500 }, { status: 500 });
    await expect(h.manager.install(a.manifest)).rejects.toMatchObject({ code: 'http', status: 500 });
    expect(h.transport.requests).toHaveLength(3);
    expect(entry(h, 'asset-a')).toMatchObject({ status: 'error', error: { code: 'http' } });
  });

  it('offline is reported as such and not retried', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport);
    h.transport.script(a.urls['a.bin'], { throwOnGet: new AssetError('offline', 'off') });
    await expect(h.manager.install(a.manifest)).rejects.toMatchObject({ code: 'offline' });
    expect(h.sleeps).toEqual([]);
  });
});

describe('sidecars', () => {
  it('no sha256 in the manifest: fetches <url>.sha256, verifies, records the digest', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { sha: false, files: { 'a.bin': 300 } });
    const got = await h.manager.install(a.manifest);
    expect(h.transport.textRequests).toEqual([`${a.urls['a.bin']}.sha256`]);
    expect(got.verified).toBe(true);
    expect(got.files[0].sha256).toBe(sha256Hex(a.bodies['a.bin']));
  });

  it('sidecar that disagrees with the bytes: integrity', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { sha: false, files: { 'a.bin': 300 } });
    h.transport.setText(`${a.urls['a.bin']}.sha256`, `${'0'.repeat(64)}  a.bin\n`);
    await expect(h.manager.install(a.manifest)).rejects.toMatchObject({ code: 'integrity' });
  });

  it('sidecar 404 with allowUnverified: installs unverified with an empty digest', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { sha: false, sidecar: false, allowUnverified: true, files: { 'a.bin': 300 } });
    const got = await h.manager.install(a.manifest);
    expect(got.verified).toBe(false);
    expect(got.files[0].sha256).toBe('');
    expect(entry(h, 'asset-a')?.verified).toBe(false);
  });

  it('sidecar 404 without allowUnverified: unverifiable, nothing downloaded', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { sha: false, sidecar: false, files: { 'a.bin': 300 } });
    await expect(h.manager.install(a.manifest)).rejects.toMatchObject({ code: 'unverifiable' });
    expect(h.transport.requests).toHaveLength(0);
  });

  it('unknown sizes (0) work for allowUnverified manifests; the registry records actual bytes', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { sha: false, sidecar: false, allowUnverified: true, files: { 'a.bin': 300 } });
    const m: AssetManifest = { ...a.manifest, size: 0, files: [{ ...a.manifest.files[0], size: 0 }] };
    const got = await h.manager.install(m);
    expect(got.size).toBe(300);
    expect(got.files[0].size).toBe(300);
  });
});

describe('concurrency and dedupe', () => {
  it('3 installs: at most 2 run; the third starts when one ends', async () => {
    const h = createHarness();
    const as = ['a', 'b', 'c'].map((id) => makeAsset(h.transport, { id }));
    const releases = as.map((a) => h.transport.gate(a.urls['a.bin']));
    const ps = as.map((a) => settled(h.manager.install(a.manifest)));
    await until(() => h.transport.requests.length === 2, 'two requests');
    await new Promise((r) => setTimeout(r, 10));
    expect(h.transport.requests).toHaveLength(2);
    expect(h.manager.getSnapshot().entries.map((e) => e.status)).toEqual(['downloading', 'downloading', 'queued']);
    expect(h.manager.getSnapshot().active).toBe(3);
    releases[0]();
    await until(() => h.transport.requests.length === 3, 'third starts');
    releases[1]();
    releases[2]();
    expect((await Promise.all(ps)).every((r) => typeof r === 'object')).toBe(true);
    expect(h.transport.maxActive).toBeLessThanOrEqual(2);
    expect(h.manager.getSnapshot().active).toBe(0);
  });

  it('maxConcurrent counts jobs, not files', async () => {
    const h = createHarness({ maxConcurrent: 1 });
    const a = makeAsset(h.transport, { id: 'a', files: { '1.bin': 100, '2.bin': 100 } });
    const b = makeAsset(h.transport, { id: 'b', files: { '1.bin': 100 } });
    await Promise.all([h.manager.install(a.manifest), h.manager.install(b.manifest)]);
    expect(h.transport.maxActive).toBe(1);
    const order = h.transport.requests.map((r) => r.url.split('/')[4]);
    expect(order).toEqual(['a', 'a', 'b']);
  });

  it('two install(id) calls share one job: one request per file, same result', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { files: { 'a.bin': 100, 'b.bin': 100 } });
    const [x, y] = await Promise.all([h.manager.install(a.manifest), h.manager.install(a.manifest, { pinned: true })]);
    expect(x).toBe(y);
    expect(h.transport.requests).toHaveLength(2);
    expect(x.pinned).toBe(true); // a joining pinned caller pins the job
  });

  it('one caller aborting detaches only that caller', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport);
    const release = h.transport.gate(a.urls['a.bin']);
    const c1 = new AbortController();
    const p1 = settled(h.manager.install(a.manifest, { signal: c1.signal }));
    const p2 = settled(h.manager.install(a.manifest));
    await until(() => h.transport.requests.length === 1, 'request');
    c1.abort();
    expect(await p1).toBe('aborted');
    release();
    expect(await p2).toMatchObject({ id: 'asset-a' });
    expect(h.transport.requests).toHaveLength(1);
  });

  it('both callers aborting aborts the job; the partial is kept and no error is recorded', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { files: { 'a.bin': 800 } });
    const url = a.urls['a.bin'];
    h.manager.setCatalog([a.manifest]);
    h.transport.script(url, { stallAfter: 128 });
    const c1 = new AbortController();
    const c2 = new AbortController();
    const p1 = settled(h.manager.install(a.manifest, { signal: c1.signal }));
    const p2 = settled(h.manager.install(a.manifest, { signal: c2.signal }));
    await until(() => (h.store.peekPartial(url)?.length ?? 0) >= 128, 'bytes');
    c1.abort();
    expect(await p1).toBe('aborted');
    expect(h.manager.getSnapshot().active).toBe(1);
    c2.abort();
    expect(await p2).toBe('aborted');
    await until(() => h.manager.getSnapshot().active === 0, 'job end');
    expect(h.store.peekPartial(url)?.length).toBeGreaterThanOrEqual(128);
    expect(entry(h, 'asset-a')).toMatchObject({ status: 'available' });
    expect(entry(h, 'asset-a')?.error).toBeUndefined();
  });

  it('a pre-aborted signal rejects immediately without starting a job', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport);
    const c = new AbortController();
    c.abort();
    await expect(h.manager.install(a.manifest, { signal: c.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(h.transport.requests).toHaveLength(0);
  });

  it('cancel(id) rejects every caller with aborted and frees the slot', async () => {
    const h = createHarness({ maxConcurrent: 1 });
    const a = makeAsset(h.transport, { id: 'a' });
    const b = makeAsset(h.transport, { id: 'b' });
    h.transport.gate(a.urls['a.bin']);
    const pa1 = settled(h.manager.install(a.manifest));
    const pa2 = settled(h.manager.install(a.manifest));
    const pb = settled(h.manager.install(b.manifest));
    await until(() => h.transport.requests.length === 1, 'a requested');
    h.manager.cancel('a');
    expect(await pa1).toBe('aborted');
    expect(await pa2).toBe('aborted');
    expect(await pb).toMatchObject({ id: 'b' }); // queue moved on
    expect(h.manager.installed('a')).toBeUndefined();
    h.manager.cancel('nothing'); // no-op
  });

  it('a queued job whose only caller aborts leaves the queue without any request', async () => {
    const h = createHarness({ maxConcurrent: 1 });
    const a = makeAsset(h.transport, { id: 'a' });
    const b = makeAsset(h.transport, { id: 'b' });
    const release = h.transport.gate(a.urls['a.bin']);
    const pa = settled(h.manager.install(a.manifest));
    const c = new AbortController();
    const pb = settled(h.manager.install(b.manifest, { signal: c.signal }));
    await until(() => h.transport.requests.length === 1, 'a running');
    c.abort();
    expect(await pb).toBe('aborted');
    expect(h.manager.getSnapshot().active).toBe(1);
    release();
    await pa;
    expect(h.transport.requestsFor(b.urls['a.bin'])).toHaveLength(0);
    expect(entry(h, 'b')).toBeUndefined();
  });

  it('another version of a running id is busy', async () => {
    const h = createHarness();
    const v1 = makeAsset(h.transport, { version: '1' });
    const v2 = makeAsset(h.transport, { version: '2' });
    const release = h.transport.gate(v1.urls['a.bin']);
    const p = settled(h.manager.install(v1.manifest));
    await until(() => h.transport.requests.length === 1, 'request');
    await expect(h.manager.install(v2.manifest)).rejects.toMatchObject({ code: 'busy' });
    release();
    await p;
  });
});

describe('remove', () => {
  it('deletes files, partials and the registry entry', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { files: { 'a.bin': 100, 'b.bin': 100 } });
    await h.manager.install(a.manifest);
    h.manager.setCatalog([a.manifest]);
    await h.manager.remove('asset-a');
    expect(h.store.fileUrls()).toEqual([]);
    expect(h.manager.installed('asset-a')).toBeUndefined();
    expect(h.registry.current?.assets).toEqual([]);
    expect(entry(h, 'asset-a')?.status).toBe('available');
    await h.manager.remove('asset-a'); // no-op
    await h.manager.remove('unknown');
  });

  it('cancels a running job first and clears its partial', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { files: { 'a.bin': 600 } });
    const url = a.urls['a.bin'];
    h.transport.script(url, { stallAfter: 128 });
    const p = settled(h.manager.install(a.manifest));
    await until(() => (h.store.peekPartial(url)?.length ?? 0) >= 128, 'bytes');
    await h.manager.remove('asset-a');
    expect(await p).toBe('aborted');
    expect(h.store.partialUrls()).toEqual([]);
    expect(h.manager.getSnapshot().active).toBe(0);
    expect(entry(h, 'asset-a')).toBeUndefined();
  });

  it('removes an error entry and the partials left by a failed install', async () => {
    const h = createHarness({ maxRetries: 0 });
    const a = makeAsset(h.transport, { files: { 'a.bin': 600 } });
    h.transport.script(a.urls['a.bin'], { failAfter: 100 });
    await expect(h.manager.install(a.manifest)).rejects.toMatchObject({ code: 'network' });
    expect(h.store.partialUrls()).toHaveLength(1);
    await h.manager.remove('asset-a');
    expect(h.store.partialUrls()).toEqual([]);
    expect(entry(h, 'asset-a')).toBeUndefined();
  });
});

describe('eviction', () => {
  async function installAll(h: Harness, specs: Array<{ id: string; size: number; pinned?: boolean; gap?: number }>) {
    const made = [];
    for (const s of specs) {
      const a = makeAsset(h.transport, { id: s.id, files: { 'a.bin': s.size } });
      await h.manager.install(a.manifest, { pinned: s.pinned });
      h.clock.advance(s.gap ?? 10);
      made.push(a);
    }
    return made;
  }

  it('LRU order; stops when enough is freed', async () => {
    const h = createHarness();
    await installAll(h, [{ id: 'a', size: 100 }, { id: 'b', size: 100 }, { id: 'c', size: 100 }]);
    const r = await h.manager.evict(150);
    expect(r).toEqual({ removed: ['a', 'b'], freedBytes: 200 });
    expect(h.manager.installed('c')).toBeDefined();
    expect(h.registry.current?.assets.map((x) => x.id)).toEqual(['c']);
    expect(h.store.fileUrls()).toHaveLength(1);
  });

  it('readFile refreshes recency', async () => {
    const h = createHarness();
    await installAll(h, [{ id: 'a', size: 100 }, { id: 'b', size: 100 }]);
    await h.manager.readFile('a', 'a.bin');
    const r = await h.manager.evict(50);
    expect(r.removed).toEqual(['b']);
  });

  it('ties: larger first, then id', async () => {
    const h = createHarness();
    await installAll(h, [{ id: 'b', size: 100, gap: 0 }, { id: 'a', size: 100, gap: 0 }, { id: 'c', size: 300, gap: 0 }]);
    const r = await h.manager.evict(1000);
    expect(r.removed).toEqual(['c', 'a', 'b']);
  });

  it('pinned, protected and running assets are skipped; may free less than asked', async () => {
    const h = createHarness();
    await installAll(h, [
      { id: 'pinned', size: 100, pinned: true },
      { id: 'protected', size: 100 },
      { id: 'running', size: 100 },
      { id: 'free', size: 100 },
    ]);
    // a running upgrade job for 'running'
    const up = makeAsset(h.transport, { id: 'running', version: '2', files: { 'a.bin': 100 } });
    const release = h.transport.gate(up.urls['a.bin']);
    const p = settled(h.manager.install(up.manifest));
    await until(() => h.transport.requests.some((r) => r.url.includes('/running/2/')), 'upgrade running');
    const r = await h.manager.evict(10_000, ['protected']);
    expect(r).toEqual({ removed: ['free'], freedBytes: 100 });
    expect(h.manager.installed('pinned')).toBeDefined();
    expect(h.manager.installed('protected')).toBeDefined();
    expect(h.manager.installed('running')).toBeDefined();
    release();
    await p;
    expect((await h.manager.evict(0)).removed).toEqual([]);
  });

  it('budgetBytes: an install evicts unpinned assets first; pinned ones make it a soft cap', async () => {
    const h = createHarness({ budgetBytes: 700 });
    await installAll(h, [{ id: 'a', size: 400 }]);
    await installAll(h, [{ id: 'b', size: 400, pinned: true }]);
    expect(h.manager.installed('a')).toBeUndefined(); // evicted before b started
    await installAll(h, [{ id: 'c', size: 400 }]);
    expect(h.manager.installed('b')).toBeDefined();
    expect(h.manager.installed('c')).toBeDefined(); // nothing evictable: proceeds
  });

  it('known free space: an install evicts to make room, else fails with quota', async () => {
    const h = createHarness({ storeOptions: { capacityBytes: 1000 } });
    await installAll(h, [{ id: 'a', size: 600 }]);
    await installAll(h, [{ id: 'b', size: 600 }]);
    expect(h.manager.installed('a')).toBeUndefined();
    expect(h.manager.installed('b')).toBeDefined();

    const h2 = createHarness({ storeOptions: { capacityBytes: 1000 } });
    await installAll(h2, [{ id: 'a', size: 600, pinned: true }]);
    const b = makeAsset(h2.transport, { id: 'b', files: { 'a.bin': 600 } });
    await expect(h2.manager.install(b.manifest)).rejects.toMatchObject({ code: 'quota' });
    expect(h2.transport.requestsFor(b.urls['a.bin'])).toHaveLength(0);
    expect(entry(h2, 'b')).toMatchObject({ status: 'error', error: { code: 'quota' } });
    expect(h2.manager.installed('a')).toBeDefined();
  });

  it('store quota on append: evict, retry once, succeed', async () => {
    const h = createHarness({ storeOptions: { capacityBytes: 1000, reportFreeBytes: false } });
    await installAll(h, [{ id: 'a', size: 600 }]);
    const b = makeAsset(h.transport, { id: 'b', files: { 'a.bin': 600 } });
    await h.manager.install(b.manifest);
    expect(h.manager.installed('a')).toBeUndefined();
    expect(h.store.peekFile(b.urls['a.bin'])).toEqual(b.bodies['a.bin']);
    expect(h.sleeps).toEqual([]);
  });

  it('store quota with nothing evictable: quota error', async () => {
    const h = createHarness({ storeOptions: { capacityBytes: 500, reportFreeBytes: false } });
    await installAll(h, [{ id: 'a', size: 400, pinned: true }]);
    const b = makeAsset(h.transport, { id: 'b', files: { 'a.bin': 400 } });
    await expect(h.manager.install(b.manifest)).rejects.toMatchObject({ code: 'quota' });
    expect(h.manager.installed('a')).toBeDefined();
  });
});

describe('upgrade and diff', () => {
  it('v1 -> v2: v2 registered, v1-only files deleted, shared keys kept; diffForUpdate lists it first', async () => {
    const h = createHarness();
    const shared = makeBytes(150, 77);
    const v1 = makeAsset(h.transport, { id: 'x', version: '1', files: { 'a.bin': 200, 'b.bin': shared } });
    const v2 = makeAsset(h.transport, { id: 'x', version: '2', files: { 'a.bin': 250, 'b.bin': shared } });
    // v2's b.bin lives at the same url as v1's (a key both versions share)
    v2.manifest.files[1] = { ...v2.manifest.files[1], url: v1.urls['b.bin'] };
    await h.manager.install(v1.manifest, { pinned: true });
    h.manager.setCatalog([v2.manifest]);
    expect(h.manager.diffForUpdate()).toEqual([{ id: 'x', from: '1', to: '2', size: 400 }]);
    expect(entry(h, 'x')).toMatchObject({ status: 'update-available', installedVersion: '1', version: '2' });

    await h.manager.install('x');
    const got = h.manager.installed('x') as InstalledAsset;
    expect(got.version).toBe('2');
    expect(got.pinned).toBe(true); // upgrade keeps the pin
    expect(h.store.fileUrls()).toEqual([v1.urls['b.bin'], v2.urls['a.bin']].sort());
    expect(h.transport.requestsFor(v1.urls['b.bin'])).toHaveLength(1); // reused, not re-downloaded
    expect(h.manager.diffForUpdate()).toEqual([]);
    expect(entry(h, 'x')?.status).toBe('installed');
    expect(h.registry.current?.assets[0].version).toBe('2');
  });

  it('a failed registry save leaves v1 installed and its files in place', async () => {
    const h = createHarness();
    const v1 = makeAsset(h.transport, { id: 'x', version: '1' });
    const v2 = makeAsset(h.transport, { id: 'x', version: '2' });
    await h.manager.install(v1.manifest);
    h.registry.failSaves = 1;
    await expect(h.manager.install(v2.manifest)).rejects.toMatchObject({ code: 'storage' });
    expect(h.manager.installed('x')?.version).toBe('1');
    expect(h.store.peekFile(v1.urls['a.bin'])).toBeDefined();
    expect(h.registry.current?.assets[0].version).toBe('1');
  });

  it('diffForUpdate ignores equal versions and assets missing from the catalog', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { id: 'a' });
    const b = makeAsset(h.transport, { id: 'b' });
    await h.manager.install(a.manifest);
    await h.manager.install(b.manifest);
    h.manager.setCatalog([a.manifest]);
    expect(h.manager.diffForUpdate()).toEqual([]);
  });
});

describe('init', () => {
  it('registry round trip across a restart', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport);
    await h.manager.install(a.manifest, { pinned: true });
    const m2 = h.restart();
    expect(m2.installed('asset-a')).toBeUndefined();
    await m2.init();
    expect(m2.installed('asset-a')).toMatchObject({ id: 'asset-a', pinned: true, size: 300 });
    expect(m2.getSnapshot().entries[0].status).toBe('installed');
    expect(await m2.readFile('asset-a', 'a.bin')).toEqual(a.bodies['a.bin']);
  });

  it('drops an entry whose file is gone and deletes its remaining files', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { files: { 'a.bin': 100, 'b.bin': 100 } });
    await h.manager.install(a.manifest);
    await h.store.delete([ref(a.urls['a.bin'])]);
    const m2 = h.restart();
    await m2.init();
    expect(m2.installed('asset-a')).toBeUndefined();
    expect(h.store.fileUrls()).toEqual([]);
    expect(h.registry.current?.assets).toEqual([]);
  });

  it('a corrupt or foreign registry starts empty', async () => {
    const h = createHarness();
    h.registry.raw = '{garbage';
    await h.manager.init();
    expect(h.manager.getSnapshot().entries).toEqual([]);

    const h2 = createHarness();
    h2.registry.raw = JSON.stringify({ schema: 'other/9', assets: [{ id: 'x' }] });
    await h2.manager.init();
    expect(h2.manager.installed('x')).toBeUndefined();
    expect(h2.logs.some((l) => l.includes('unknown schema'))).toBe(true);
  });

  it('invalid registry entries are dropped, valid ones kept', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport);
    await h.manager.install(a.manifest);
    const doc = h.registry.current as { assets: unknown[] };
    doc.assets.push({ id: 'broken' }, 42);
    h.registry.raw = JSON.stringify(doc);
    const m2 = h.restart();
    await m2.init();
    expect(m2.getSnapshot().entries.map((e) => e.id)).toEqual(['asset-a']);
    expect((h.registry.current?.assets ?? []).length).toBe(1);
  });

  it('a registry load failure starts empty', async () => {
    const h = createHarness();
    h.registry.load = async () => {
      throw new Error('disk');
    };
    await h.manager.init();
    expect(h.manager.getSnapshot().entries).toEqual([]);
  });

  it('sweeps partials older than 7 days, keeps fresh ones', async () => {
    const h = createHarness();
    const oldRef = ref('https://assets.test/old');
    const p = await h.store.openPartial(oldRef);
    await p.append(makeBytes(10));
    await p.close();
    h.clock.advance(8 * 24 * 3600 * 1000);
    const fresh = await h.store.openPartial(ref('https://assets.test/fresh'));
    await fresh.append(makeBytes(10));
    await fresh.close();
    await h.manager.init();
    expect(h.store.partialUrls()).toEqual(['https://assets.test/fresh']);
  });

  it('install called before init settles waits for it', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport);
    await h.manager.install(a.manifest);
    const m2 = h.restart();
    void m2.init();
    const again = await m2.install(a.manifest); // already installed after init: no download
    expect(again.id).toBe('asset-a');
    expect(h.transport.requests).toHaveLength(1);
  });

  it('init is idempotent', async () => {
    const h = createHarness();
    const p1 = h.manager.init();
    expect(h.manager.init()).toBe(p1);
    await p1;
  });
});

describe('adopt', () => {
  it('files present with matching digests: registered pinned, no transport call', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { files: { 'a.bin': 200, 'b.bin': 100 } });
    await commitFile(h.store, a.urls['a.bin'], a.bodies['a.bin']);
    await commitFile(h.store, a.urls['b.bin'], a.bodies['b.bin']);
    expect(await h.manager.adopt(a.manifest)).toBe(true);
    expect(h.transport.requests).toHaveLength(0);
    expect(h.transport.textRequests).toHaveLength(0);
    expect(h.manager.installed('asset-a')).toMatchObject({ pinned: true, verified: true, size: 300 });
    expect(h.registry.current?.assets).toHaveLength(1);
    expect(entry(h, 'asset-a')?.status).toBe('installed');
    expect(await h.manager.adopt(a.manifest)).toBe(true); // already installed
  });

  it('a bad file is deleted and adopt returns false; missing file returns false', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { files: { 'a.bin': 200, 'b.bin': 100 } });
    await commitFile(h.store, a.urls['a.bin'], a.bodies['a.bin']);
    expect(await h.manager.adopt(a.manifest)).toBe(false); // b.bin missing
    expect(h.store.peekFile(a.urls['a.bin'])).toBeDefined();
    const bad = a.bodies['b.bin'].slice();
    bad[0] ^= 1;
    await commitFile(h.store, a.urls['b.bin'], bad);
    expect(await h.manager.adopt(a.manifest)).toBe(false);
    expect(h.store.peekFile(a.urls['b.bin'])).toBeUndefined();
    expect(h.manager.installed('asset-a')).toBeUndefined();
  });

  it('wrong size is rejected and deleted', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { files: { 'a.bin': 200 } });
    const m = { ...a.manifest, files: [{ ...a.manifest.files[0], size: 199 }], size: 199 };
    await commitFile(h.store, a.urls['a.bin'], a.bodies['a.bin']);
    expect(await h.manager.adopt(m)).toBe(false);
    expect(h.store.peekFile(a.urls['a.bin'])).toBeUndefined();
  });

  it('no digest: only with allowUnverified (then verified false); the sidecar is not fetched', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { sha: false, files: { 'a.bin': 200 } });
    await commitFile(h.store, a.urls['a.bin'], a.bodies['a.bin']);
    expect(await h.manager.adopt(a.manifest)).toBe(false);
    expect(h.store.peekFile(a.urls['a.bin'])).toBeDefined(); // not deleted, just unverifiable
    expect(await h.manager.adopt({ ...a.manifest, allowUnverified: true })).toBe(true);
    expect(h.manager.installed('asset-a')).toMatchObject({ verified: false });
    expect(h.transport.textRequests).toHaveLength(0);
  });
});

describe('crash recovery', () => {
  it('a committed-but-unregistered file with the right digest is reused without network', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { files: { 'a.bin': 200 } });
    await commitFile(h.store, a.urls['a.bin'], a.bodies['a.bin']);
    const got = await h.manager.install(a.manifest);
    expect(h.transport.requests).toHaveLength(0);
    expect(got.size).toBe(200);
    expect(h.manager.installed('asset-a')).toBeDefined();
  });

  it('a corrupt committed leftover is re-downloaded and replaced', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { files: { 'a.bin': 200 } });
    await commitFile(h.store, a.urls['a.bin'], makeBytes(200, 1234));
    await h.manager.install(a.manifest);
    expect(h.transport.requests).toHaveLength(1);
    expect(h.store.peekFile(a.urls['a.bin'])).toEqual(a.bodies['a.bin']);
  });
});

describe('readFile and markUsed', () => {
  it('returns the bytes and bumps lastUsedAt; absent asset or path is not-found', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport, { files: { 'a.bin': 200, 'sub/b.bin': 50 } });
    await h.manager.install(a.manifest);
    const t0 = h.manager.installed('asset-a')?.lastUsedAt as number;
    h.clock.advance(5000);
    expect(await h.manager.readFile('asset-a', 'sub/b.bin')).toEqual(a.bodies['sub/b.bin']);
    expect(h.manager.installed('asset-a')?.lastUsedAt).toBe(t0 + 5000);
    await expect(h.manager.readFile('nope', 'a.bin')).rejects.toMatchObject({ code: 'not-found' });
    await expect(h.manager.readFile('asset-a', 'zzz')).rejects.toMatchObject({ code: 'not-found' });
    await h.store.delete([ref(a.urls['a.bin'])]);
    await expect(h.manager.readFile('asset-a', 'a.bin')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('markUsed saves after 5 s (debounced); flush saves now', async () => {
    const h = createHarness();
    const a = makeAsset(h.transport);
    await h.manager.install(a.manifest);
    vi.useFakeTimers();
    try {
      const saves = h.registry.saves;
      h.manager.markUsed('asset-a');
      h.manager.markUsed('asset-a');
      h.manager.markUsed('unknown');
      expect(h.registry.saves).toBe(saves);
      await vi.advanceTimersByTimeAsync(4999);
      expect(h.registry.saves).toBe(saves);
      await vi.advanceTimersByTimeAsync(2);
      expect(h.registry.saves).toBe(saves + 1);
      h.manager.markUsed('asset-a');
      await h.manager.flush();
      expect(h.registry.saves).toBe(saves + 2);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(h.registry.saves).toBe(saves + 2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('registry saves are serialised', () => {
  it('never two saves in flight; the last document has every asset', async () => {
    const registry = new MemoryAssetRegistryStore();
    let inFlight = 0;
    let maxInFlight = 0;
    const realSave = registry.save.bind(registry);
    registry.save = async (s) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      await realSave(s);
      inFlight--;
    };
    const h = createHarness({ registry, maxConcurrent: 4 });
    const as = ['a', 'b', 'c', 'd'].map((id) => makeAsset(h.transport, { id }));
    await Promise.all(as.map((a) => h.manager.install(a.manifest)));
    expect(maxInFlight).toBe(1);
    expect(registry.current?.assets.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(registry.saves).toBeLessThanOrEqual(4);
  });
});

describe('construction', () => {
  it('defaults (real sleep, Sha256, Date.now) work end to end', async () => {
    const transport = new FakeTransport();
    const a = makeAsset(transport, { files: { 'a.bin': 100 } });
    const m = new AssetManager({ transport, store: new MemoryAssetStore(), registry: new MemoryAssetRegistryStore() });
    await m.init();
    transport.script(a.urls['a.bin'], { status: 503 });
    const t0 = Date.now();
    await m.install(a.manifest);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900); // the default 1000 ms backoff really waited
  }, 10_000);

  it('the injected hasher is used', async () => {
    const h = createHarness({
      createHasher: () => ({ update: () => undefined, digestHex: () => '0'.repeat(64) }),
    });
    const a = makeAsset(h.transport);
    await expect(h.manager.install(a.manifest)).rejects.toMatchObject({ code: 'integrity' });
  });
});
