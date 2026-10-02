import { describe, expect, it } from 'vitest';
import {
  downloadFile,
  parseContentRangeStart,
  resolveExpectedSha,
  validatorOf,
  withDownloadParam,
} from '../../assets/downloadFile';
import type { DownloadEnv, DownloadPhase } from '../../assets/downloadFile';
import { MemoryAssetStore } from '../../assets/memory';
import { Sha256, sha256Hex } from '../../assets/sha256';
import { AssetError } from '../../assets/types';
import type { AssetFileRef, IHasher } from '../../assets/types';
import { FakeTransport, collect, makeBytes, ref as mkRef } from './fakes';

const URL1 = 'https://assets.test/data/a/1/a.bin';

interface Rig {
  transport: FakeTransport;
  store: MemoryAssetStore;
  sleeps: number[];
  phases: DownloadPhase[];
  held: number[];
  attempts: number[];
  hashed: number[];
  controller: AbortController;
  env: DownloadEnv;
  body: Uint8Array;
  ref: AssetFileRef;
  sha: string;
  run: (over?: { expected?: string | undefined; ref?: AssetFileRef; signal?: AbortSignal; onBytes?: (n: number) => void }) => Promise<{ sha256: string; size: number }>;
}

function rig(size = 1000, envOver: Partial<DownloadEnv> = {}, storeOpts = {}): Rig {
  const transport = new FakeTransport();
  const store = new MemoryAssetStore(storeOpts);
  const body = makeBytes(size, 7);
  transport.add(URL1, body);
  const sleeps: number[] = [];
  const hashed: number[] = [];
  const env: DownloadEnv = {
    transport,
    createHasher: () => {
      const h = new Sha256();
      const idx = hashed.push(0) - 1;
      const counted: IHasher = {
        update: (c) => {
          hashed[idx] += c.length;
          h.update(c);
        },
        digestHex: () => h.digestHex(),
      };
      return counted;
    },
    sleep: async (ms, signal) => {
      sleeps.push(ms);
      if (signal.aborted) throw new AssetError('aborted', 'aborted');
    },
    log: () => undefined,
    maxRetries: 3,
    retryDelaysMs: [1000, 4000, 10000],
    stallTimeoutMs: 0,
    ...envOver,
  };
  const r = mkRef(URL1, size);
  const sha = sha256Hex(body);
  const controller = new AbortController();
  const phases: DownloadPhase[] = [];
  const held: number[] = [];
  const attempts: number[] = [];
  const out: Rig = {
    transport, store, sleeps, phases, held, attempts, hashed, controller, env, body, ref: r, sha,
    run: (over = {}) =>
      downloadFile(store, over.ref ?? r, 'expected' in over ? over.expected : sha, env, {
        signal: over.signal ?? controller.signal,
        onBytes: (n) => {
          held.push(n);
          over.onBytes?.(n);
        },
        onPhase: (p) => phases.push(p),
        onAttempt: (n) => attempts.push(n),
      }),
  };
  return out;
}

async function seedPartial(r: Rig, bytes: Uint8Array, validator: string | null): Promise<void> {
  const p = await r.store.openPartial(r.ref);
  await p.reset(validator);
  await p.append(bytes);
  await p.close();
}

describe('helpers', () => {
  it('withDownloadParam', () => {
    expect(withDownloadParam('https://x/a.bin')).toBe('https://x/a.bin?download=1');
    expect(withDownloadParam('https://x/a.bin?v=2')).toBe('https://x/a.bin?v=2&download=1');
    expect(withDownloadParam('https://x/a.bin#f')).toBe('https://x/a.bin?download=1#f');
  });

  it('parseContentRangeStart', () => {
    expect(parseContentRangeStart('bytes 100-199/200')).toBe(100);
    expect(parseContentRangeStart('bytes 0-9/*')).toBe(0);
    expect(parseContentRangeStart('bytes */200')).toBeNull();
    expect(parseContentRangeStart('nope')).toBeNull();
    expect(parseContentRangeStart(undefined)).toBeNull();
  });

  it('validatorOf: strong etag, else last-modified, weak etag ignored', () => {
    const res = (headers: Record<string, string>) => ({ status: 200, headers, body: (async function* () {})() });
    expect(validatorOf(res({ etag: '"a"', lastModified: 'Mon' }))).toBe('"a"');
    expect(validatorOf(res({ etag: 'W/"a"', lastModified: 'Mon' }))).toBe('Mon');
    expect(validatorOf(res({ etag: 'W/"a"' }))).toBeNull();
    expect(validatorOf(res({}))).toBeNull();
  });
});

describe('downloadFile: fresh download', () => {
  it('downloads, verifies, commits; progress is monotone and phases ordered', async () => {
    const r = rig(1000);
    const res = await r.run();
    expect(res).toEqual({ sha256: r.sha, size: 1000 });
    expect(await collect(await r.store.read(r.ref))).toEqual(r.body);
    expect(r.store.partialUrls()).toEqual([]);
    expect(r.phases).toEqual(['verifying', 'committing']);
    expect(r.held[0]).toBe(0);
    expect(r.held[r.held.length - 1]).toBe(1000);
    expect([...r.held].sort((a, b) => a - b)).toEqual(r.held);
    expect(r.transport.requests).toEqual([{ url: `${URL1}?download=1`, rangeStart: undefined, ifRange: undefined }]);
  });

  it('unknown size (0): no size checks, digest still verified', async () => {
    const r = rig(500);
    const res = await r.run({ ref: mkRef(URL1, 0) });
    expect(res.size).toBe(500);
    await expect(rig(500).run({ ref: mkRef(URL1, 0), expected: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'integrity' });
  });

  it('unverified (no expected digest): commits and still reports the digest', async () => {
    const r = rig(400);
    const res = await r.run({ expected: undefined });
    expect(res.sha256).toBe(r.sha);
    expect(await r.store.exists(r.ref)).toBe(true);
  });

  it('a pre-aborted signal throws aborted without any request', async () => {
    const r = rig(100);
    r.controller.abort();
    await expect(r.run()).rejects.toMatchObject({ code: 'aborted' });
    expect(r.transport.requests).toHaveLength(0);
  });
});

describe('downloadFile: resume', () => {
  it('abort after N bytes, then 206 from N with If-Range; partial re-hashed; fetched once in total', async () => {
    const r = rig(1000);
    r.transport.script(URL1, { stallAfter: 384 });
    await expect(r.run({ onBytes: (n) => n >= 384 && r.controller.abort() })).rejects.toMatchObject({ code: 'aborted' });
    expect(r.store.peekPartial(URL1)).toEqual(r.body.subarray(0, 384));
    expect(r.store.fileUrls()).toEqual([]);
    expect(r.sleeps).toEqual([]);
    const firstServed = r.transport.bytesServed;
    expect(firstServed).toBe(384);

    const hashedBefore = r.hashed.length;
    const res = await downloadFile(r.store, r.ref, r.sha, r.env, { signal: new AbortController().signal, onBytes: () => undefined, onPhase: () => undefined, onAttempt: () => undefined });
    expect(res.sha256).toBe(r.sha);
    const second = r.transport.requests[1];
    expect(second.rangeStart).toBe(384);
    expect(second.ifRange).toMatch(/^"e-/);
    expect(r.transport.bytesServed).toBe(1000); // 384 + 616, not 1000 + 384
    // the partial was re-hashed into a fresh hasher, then the tail appended: 384 + 616 bytes
    expect(r.hashed.length).toBeGreaterThan(hashedBefore);
    expect(r.hashed[r.hashed.length - 1]).toBe(1000);
    expect(await collect(await r.store.read(r.ref))).toEqual(r.body);
  });

  it('server ignores Range (200): partial reset, full body written, digest correct', async () => {
    const r = rig(800);
    await seedPartial(r, r.body.subarray(0, 300), '"e-stale"');
    r.transport.script(URL1, { mode: 'ignore-range' });
    const res = await r.run();
    expect(res.sha256).toBe(r.sha);
    expect(r.transport.requests[0].rangeStart).toBe(300);
    expect(r.transport.bytesServed).toBe(800);
    expect(await collect(await r.store.read(r.ref))).toEqual(r.body);
  });

  it('changed entity (If-Range mismatch) answers 200 and restarts', async () => {
    const r = rig(600);
    await seedPartial(r, makeBytes(200, 99), '"old-etag"'); // bytes from another entity
    const res = await r.run();
    expect(r.transport.requests[0]).toMatchObject({ rangeStart: 200, ifRange: '"old-etag"' });
    expect(res.sha256).toBe(r.sha);
  });

  it('no validator: Range without If-Range', async () => {
    const r = rig(600);
    await seedPartial(r, r.body.subarray(0, 200), null);
    await r.run();
    expect(r.transport.requests[0]).toMatchObject({ rangeStart: 200, ifRange: undefined });
  });

  it('wrong Content-Range start: reset and restart without Range', async () => {
    const r = rig(600);
    await seedPartial(r, r.body.subarray(0, 200), null);
    r.transport.script(URL1, { mode: 'wrong-range', wrongStart: 50 });
    const res = await r.run();
    expect(res.sha256).toBe(r.sha);
    expect(r.transport.requests.map((q) => q.rangeStart)).toEqual([200, undefined]);
    expect(r.sleeps).toEqual([]);
    expect(r.attempts).toEqual([0, 1]);
  });

  it('416: reset, retry once from byte 0; a second 416 is an http error', async () => {
    const r = rig(600);
    await seedPartial(r, r.body.subarray(0, 200), null);
    r.transport.script(URL1, { status: 416 });
    await expect(r.run()).resolves.toMatchObject({ size: 600 });
    expect(r.transport.requests.map((q) => q.rangeStart)).toEqual([200, undefined]);

    const r2 = rig(600);
    r2.transport.script(URL1, { status: 416 }, { status: 416 });
    await expect(r2.run()).rejects.toMatchObject({ code: 'http', status: 416 });
  });

  it('partial larger than the declared size is reset', async () => {
    const r = rig(500);
    await seedPartial(r, makeBytes(700, 5), '"x"');
    const res = await r.run();
    expect(res.sha256).toBe(r.sha);
    expect(r.transport.requests[0].rangeStart).toBeUndefined();
  });

  it('partial already complete: no request, commits', async () => {
    const r = rig(300);
    await seedPartial(r, r.body, '"x"');
    const res = await r.run();
    expect(res.sha256).toBe(r.sha);
    expect(r.transport.requests).toHaveLength(0);
    expect(await collect(await r.store.read(r.ref))).toEqual(r.body);
  });

  it('complete but corrupt partial: integrity, discarded', async () => {
    const r = rig(300);
    const bad = r.body.slice();
    bad[5] ^= 0xff;
    await seedPartial(r, bad, '"x"');
    await expect(r.run()).rejects.toMatchObject({ code: 'integrity' });
    expect(r.store.partialUrls()).toEqual([]);
  });
});

describe('downloadFile: verification and size', () => {
  it('integrity failure: discarded, nothing committed, old committed bytes kept, next run starts at 0', async () => {
    const r = rig(400);
    const old = makeBytes(123, 50);
    const c = await r.store.openPartial(r.ref);
    await c.append(old);
    await c.commit();

    const bad = r.body.slice();
    bad[399] ^= 1;
    r.transport.script(URL1, { body: bad });
    await expect(r.run()).rejects.toMatchObject({ code: 'integrity', retryable: false });
    expect(r.transport.requests).toHaveLength(1); // never retried
    expect(r.sleeps).toEqual([]);
    expect(r.store.partialUrls()).toEqual([]);
    expect(r.store.peekFile(URL1)).toEqual(old);

    const res = await r.run();
    expect(res.sha256).toBe(r.sha);
    expect(r.transport.requests[1].rangeStart).toBeUndefined();
    expect(r.store.peekFile(URL1)).toEqual(r.body);
  });

  it('more bytes than declared: size-mismatch, partial discarded', async () => {
    const r = rig(400);
    r.transport.script(URL1, { body: concatLong(r.body, 50) });
    await expect(r.run()).rejects.toMatchObject({ code: 'size-mismatch' });
    expect(r.store.partialUrls()).toEqual([]);
    expect(r.store.fileUrls()).toEqual([]);
  });

  it('fewer bytes than declared: size-mismatch, partial discarded', async () => {
    const r = rig(400);
    r.transport.script(URL1, { body: r.body.subarray(0, 350) });
    await expect(r.run()).rejects.toMatchObject({ code: 'size-mismatch' });
    expect(r.store.partialUrls()).toEqual([]);
    expect(r.store.fileUrls()).toEqual([]);
  });
});

function concatLong(a: Uint8Array, extra: number): Uint8Array {
  const out = new Uint8Array(a.length + extra);
  out.set(a);
  out.fill(1, a.length);
  return out;
}

describe('downloadFile: retries', () => {
  it('503 twice then 200: installed, sleeps 1000 then 4000', async () => {
    const r = rig(300);
    r.transport.script(URL1, { status: 503 }, { status: 503 });
    const res = await r.run();
    expect(res.sha256).toBe(r.sha);
    expect(r.sleeps).toEqual([1000, 4000]);
    expect(r.transport.requests).toHaveLength(3);
    expect(r.attempts).toEqual([0, 1, 2]);
  });

  it('408 and 429 are retried', async () => {
    const r = rig(100);
    r.transport.script(URL1, { status: 408 }, { status: 429 });
    await r.run();
    expect(r.sleeps).toEqual([1000, 4000]);
  });

  it('404 and 410: not-found, no retry', async () => {
    const r = rig(100);
    r.transport.script(URL1, { status: 404 });
    await expect(r.run()).rejects.toMatchObject({ code: 'not-found', status: 404 });
    const r2 = rig(100);
    r2.transport.script(URL1, { status: 410 });
    await expect(r2.run()).rejects.toMatchObject({ code: 'not-found' });
    expect(r.sleeps).toEqual([]);
    expect(r.transport.requests).toHaveLength(1);
  });

  it('other 4xx: http, not retried', async () => {
    const r = rig(100);
    r.transport.script(URL1, { status: 403 });
    await expect(r.run()).rejects.toMatchObject({ code: 'http', status: 403, retryable: false });
    expect(r.sleeps).toEqual([]);
  });

  it('network error mid-body: retried and resumed from the partial', async () => {
    const r = rig(1000);
    r.transport.script(URL1, { failAfter: 320 });
    const res = await r.run();
    expect(res.sha256).toBe(r.sha);
    expect(r.transport.requests.map((q) => q.rangeStart)).toEqual([undefined, 320]);
    expect(r.transport.bytesServed).toBe(1000);
    expect(r.sleeps).toEqual([1000]);
  });

  it('stall: the attempt is aborted as network and retried (resuming)', async () => {
    const r = rig(1000, { stallTimeoutMs: 30 });
    r.transport.script(URL1, { stallAfter: 256 });
    const res = await r.run();
    expect(res.sha256).toBe(r.sha);
    expect(r.transport.requests.map((q) => q.rangeStart)).toEqual([undefined, 256]);
    expect(r.sleeps).toEqual([1000]);
  });

  it('retries exhausted: the last error, partial kept, delays 1000/4000/10000', async () => {
    const r = rig(1000);
    r.transport.script(URL1, { failAfter: 64 }, { failAfter: 64 }, { failAfter: 64 }, { failAfter: 64 });
    await expect(r.run()).rejects.toMatchObject({ code: 'network' });
    expect(r.transport.requests).toHaveLength(4);
    expect(r.sleeps).toEqual([1000, 4000, 10000]);
    expect(r.store.peekPartial(URL1)?.length).toBe(4 * 64);
    expect(r.store.fileUrls()).toEqual([]);
  });

  it('the last delay repeats beyond the list', async () => {
    const r = rig(100, { maxRetries: 4, retryDelaysMs: [5, 7] });
    r.transport.script(URL1, { status: 500 }, { status: 500 }, { status: 500 }, { status: 500 });
    await r.run();
    expect(r.sleeps).toEqual([5, 7, 7, 7]);
  });

  it('offline from the transport is not retried', async () => {
    const r = rig(100);
    r.transport.script(URL1, { throwOnGet: new AssetError('offline', 'offline') });
    await expect(r.run()).rejects.toMatchObject({ code: 'offline' });
    expect(r.sleeps).toEqual([]);
  });

  it('a network error thrown by get() is retried', async () => {
    const r = rig(100);
    r.transport.script(URL1, { throwOnGet: new AssetError('network', 'dns', true) });
    await r.run();
    expect(r.sleeps).toEqual([1000]);
  });

  it('a non-AssetError from the store becomes storage', async () => {
    const r = rig(100);
    const p = await r.store.openPartial(r.ref);
    p.append = async () => {
      throw new Error('disk on fire');
    };
    r.store.openPartial = async () => p;
    await expect(r.run()).rejects.toMatchObject({ code: 'storage' });
  });
});

describe('downloadFile: abort', () => {
  it('abort mid-body keeps the bytes and does not sleep or retry', async () => {
    const r = rig(1000);
    await expect(
      r.run({ onBytes: (n) => n >= 192 && r.controller.abort() }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(r.store.peekPartial(URL1)?.length).toBeGreaterThanOrEqual(192);
    expect(r.sleeps).toEqual([]);
    expect(r.transport.requests).toHaveLength(1);
  });

  it('abort while waiting to retry wakes the backoff', async () => {
    const r = rig(100, {
      sleep: (_ms, signal) =>
        new Promise<void>((_res, rej) => {
          signal.addEventListener('abort', () => rej(new AssetError('aborted', 'aborted')), { once: true });
          queueMicrotask(() => r.controller.abort());
        }),
    });
    r.transport.script(URL1, { status: 503 });
    await expect(r.run()).rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('downloadFile: crash recovery and upgrades', () => {
  it('a committed file with the right digest is reused without network', async () => {
    const r = rig(400);
    const c = await r.store.openPartial(r.ref);
    await c.append(r.body);
    await c.commit();
    const res = await r.run();
    expect(res).toEqual({ sha256: r.sha, size: 400 });
    expect(r.transport.requests).toHaveLength(0);
    expect(r.store.partialUrls()).toEqual([]);
  });

  it('a committed file with another digest (old version at the same url) is replaced atomically', async () => {
    const r = rig(400);
    const old = makeBytes(400, 33);
    const c = await r.store.openPartial(r.ref);
    await c.append(old);
    await c.commit();
    await r.run();
    expect(r.transport.requests).toHaveLength(1);
    expect(r.store.peekFile(URL1)).toEqual(r.body);
  });

  it('unverified downloads never reuse a committed file', async () => {
    const r = rig(400);
    const c = await r.store.openPartial(r.ref);
    await c.append(r.body);
    await c.commit();
    await r.run({ expected: undefined });
    expect(r.transport.requests).toHaveLength(1);
  });
});

describe('downloadFile: quota', () => {
  it('quota continue path re-opens and re-hashes the partial like a retry', async () => {
    const r = rig(400, {}, { capacityBytes: 500, reportFreeBytes: false });
    const blocker = await r.store.openPartial(mkRef('https://assets.test/other'));
    await blocker.append(makeBytes(300, 4));
    await blocker.commit();
    r.env.onQuota = async () => {
      await r.store.delete([mkRef('https://assets.test/other')]);
      return true;
    };
    const before = r.hashed.length;
    const res = await r.run();
    expect(res.sha256).toBe(r.sha);
    // initial hasher + one fresh hasher from the quota re-hash
    expect(r.hashed.length - before).toBeGreaterThanOrEqual(2);
  });

  it('200 at offset 0 replaces a stale validator with the response one', async () => {
    const r = rig(300);
    await seedPartial(r, new Uint8Array(0), '"old-etag"');
    r.transport.script(URL1, { failAfter: 100 });
    const res = await r.run();
    expect(res.sha256).toBe(r.sha);
    expect(r.transport.requests[1].rangeStart).toBe(100);
    expect(r.transport.requests[1].ifRange).toBeDefined();
    expect(r.transport.requests[1].ifRange).not.toBe('"old-etag"');
  });

  it('append quota: onQuota frees space, the write is retried once and succeeds', async () => {
    const r = rig(400, {}, { capacityBytes: 500, reportFreeBytes: false });
    const blocker = await r.store.openPartial(mkRef('https://assets.test/other'));
    await blocker.append(makeBytes(300, 4));
    await blocker.commit();
    const calls: number[] = [];
    r.env.onQuota = async (need) => {
      calls.push(need);
      await r.store.delete([mkRef('https://assets.test/other')]);
      return true;
    };
    const res = await r.run();
    expect(res.sha256).toBe(r.sha);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeGreaterThan(0);
    expect(r.sleeps).toEqual([]);
  });

  it('nothing freed (or no onQuota): quota error; a second quota after the retry is thrown', async () => {
    const r = rig(400, {}, { capacityBytes: 100, reportFreeBytes: false });
    r.env.onQuota = async () => false;
    await expect(r.run()).rejects.toMatchObject({ code: 'quota' });

    const r2 = rig(400, {}, { capacityBytes: 100, reportFreeBytes: false });
    await expect(r2.run()).rejects.toMatchObject({ code: 'quota' });

    const r3 = rig(400, {}, { capacityBytes: 100, reportFreeBytes: false });
    let n = 0;
    r3.env.onQuota = async () => {
      n++;
      return true; // claims success but nothing changed
    };
    await expect(r3.run()).rejects.toMatchObject({ code: 'quota' });
    expect(n).toBe(1);
  });

  it('commit quota is retried once after onQuota', async () => {
    const r = rig(200);
    const real = await r.store.openPartial(r.ref);
    await real.close();
    let failed = false;
    const origOpen = r.store.openPartial.bind(r.store);
    r.store.openPartial = async (rf) => {
      const p = await origOpen(rf);
      const commit = p.commit.bind(p);
      p.commit = async () => {
        if (!failed) {
          failed = true;
          throw new AssetError('quota', 'full');
        }
        await commit();
      };
      return p;
    };
    r.env.onQuota = async () => true;
    await expect(r.run()).resolves.toMatchObject({ size: 200 });
  });
});

describe('resolveExpectedSha', () => {
  const file = { path: 'a.bin', url: URL1, size: 10 };
  const sig = new AbortController().signal;

  it('uses file.sha256 (lower-cased) without a request', async () => {
    const r = rig();
    const sha = await resolveExpectedSha({ ...file, sha256: 'A'.repeat(64) }, {}, r.env, sig);
    expect(sha).toBe('a'.repeat(64));
    expect(r.transport.textRequests).toEqual([]);
  });

  it('fetches <url>.sha256 otherwise', async () => {
    const r = rig();
    r.transport.setText(`${URL1}.sha256`, `${'b'.repeat(64)}  a.bin\n`);
    expect(await resolveExpectedSha(file, {}, r.env, sig)).toBe('b'.repeat(64));
    expect(r.transport.textRequests).toEqual([`${URL1}.sha256`]);
  });

  it('missing sidecar: undefined with allowUnverified, else unverifiable; junk counts as missing', async () => {
    const r = rig();
    expect(await resolveExpectedSha(file, { allowUnverified: true }, r.env, sig)).toBeUndefined();
    await expect(resolveExpectedSha(file, {}, r.env, sig)).rejects.toMatchObject({ code: 'unverifiable' });
    r.transport.setText(`${URL1}.sha256`, '<html>not found</html>');
    await expect(resolveExpectedSha(file, {}, r.env, sig)).rejects.toMatchObject({ code: 'unverifiable' });
  });

  it('retries a network failure of the sidecar fetch', async () => {
    const r = rig();
    let calls = 0;
    r.env.transport = {
      get: r.transport.get.bind(r.transport),
      getText: async () => {
        if (calls++ === 0) throw new AssetError('network', 'reset', true);
        return `${'c'.repeat(64)}\n`;
      },
    };
    expect(await resolveExpectedSha(file, {}, r.env, sig)).toBe('c'.repeat(64));
    expect(r.sleeps).toEqual([1000]);
  });
});
