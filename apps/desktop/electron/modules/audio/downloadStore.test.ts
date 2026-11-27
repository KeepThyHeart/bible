import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDownloadStore, downloadSegments, type DownloadProgress } from './downloadStore';
import type { UpstreamResponse } from './audioProtocol';

const U = (rest: string) => `kth-audio://app/audio/v1/${rest}`;
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'dlstore-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const stream = (chunks: Uint8Array[], gate?: Promise<void>): ReadableStream<Uint8Array> => {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      if (i === 1 && gate) await gate;
      if (i < chunks.length) c.enqueue(chunks[i++]!); else c.close();
    },
  });
};

function make(handler: (url: string) => Promise<UpstreamResponse>, base: string | null = 'https://rec.test') {
  const urls: string[] = [];
  const store = createDownloadStore({
    downloadsRoot: () => root,
    recordingsBase: () => base,
    fetchUpstream: async (url) => { urls.push(url); return handler(url); },
  });
  return { store, urls };
}
const ok = (data: Uint8Array[]): UpstreamResponse => ({ status: 200, headers: {}, body: stream(data) });

async function finish(store: ReturnType<typeof make>['store'], jobId: string): Promise<DownloadProgress> {
  for (let i = 0; i < 200; i++) {
    const p = await store.progress(jobId);
    if (p.state !== 'running') return p;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timeout');
}

describe('downloadSegments', () => {
  it('maps and refuses', () => {
    expect(downloadSegments(U('kjv/john/1.opus'))).toEqual(['v1', 'kjv', 'john', '1.opus']);
    for (const bad of [
      'https://app/audio/v1/a', 'kth-audio://other/audio/v1/a', 'kth-audio://app/audio/tts/a', U('../x'), U('a/../b'),
      U('.hidden'), U('a/.b'), U('a\\b'), U('a/%2e%2e/b'), U('a//b'), U(''), U('a?x=1'), U('c:/x'),
    ]) expect(downloadSegments(bad), bad).toBeNull();
  });
});

describe('downloads', () => {
  it('downloads, verifies sha256, reports presence, usage and removes', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const sha = createHash('sha256').update(data).digest('hex');
    const { store, urls } = make(async () => ok([data.slice(0, 2), data.slice(2)]));
    const { jobId } = await store.fetchFiles([{ url: U('kjv/john/1.opus'), bytes: 5, sha256: sha }]);
    const p = await finish(store, jobId);
    expect(p).toMatchObject({ state: 'done', loaded: 5 });
    expect(urls).toEqual(['https://rec.test/v1/kjv/john/1.opus']);
    expect([...(await readFile(join(root, 'v1/kjv/john/1.opus')))]).toEqual([1, 2, 3, 4, 5]);
    expect(await store.present([U('kjv/john/1.opus'), U('kjv/john/2.opus'), 'bogus'])).toEqual([U('kjv/john/1.opus')]);
    expect(await store.usage()).toEqual({ bytes: 5, files: 1 });
    await store.remove([U('kjv/john/1.opus')]);
    expect(await store.present([U('kjv/john/1.opus')])).toEqual([]);
    expect(existsSync(join(root, 'v1/kjv'))).toBe(false);
    expect(existsSync(root)).toBe(true);
  });

  it('skips a file already present with the right size (resume)', async () => {
    await mkdir(join(root, 'v1/a'), { recursive: true });
    await writeFile(join(root, 'v1/a/1.opus'), Buffer.from([9, 9, 9]));
    const { store, urls } = make(async () => ok([new Uint8Array([1, 2])]));
    const { jobId } = await store.fetchFiles([{ url: U('a/1.opus'), bytes: 3 }, { url: U('a/2.opus'), bytes: 2 }]);
    expect(await finish(store, jobId)).toMatchObject({ state: 'done', loaded: 5 });
    expect(urls).toEqual(['https://rec.test/v1/a/2.opus']);
  });

  it('re-fetches a present file of the wrong size', async () => {
    await mkdir(join(root, 'v1/a'), { recursive: true });
    await writeFile(join(root, 'v1/a/1.opus'), Buffer.from([9]));
    const { store } = make(async () => ok([new Uint8Array([1, 2, 3])]));
    const { jobId } = await store.fetchFiles([{ url: U('a/1.opus'), bytes: 3 }]);
    expect((await finish(store, jobId)).state).toBe('done');
    expect((await readFile(join(root, 'v1/a/1.opus'))).length).toBe(3);
  });

  it('size mismatch and bad checksum leave no file', async () => {
    const { store } = make(async () => ok([new Uint8Array([1, 2, 3])]));
    let r = await finish(store, (await store.fetchFiles([{ url: U('a/1.opus'), bytes: 4 }])).jobId);
    expect(r).toMatchObject({ state: 'failed', code: 'size' });
    r = await finish(store, (await store.fetchFiles([{ url: U('a/2.opus'), bytes: 3, sha256: 'a'.repeat(64) }])).jobId);
    expect(r).toMatchObject({ state: 'failed', code: 'checksum' });
    expect(await readdir(join(root, 'v1/a'))).toEqual([]);
  });

  it('offline gives code offline; 404 and bad URL fail', async () => {
    const off = make(async () => { throw Object.assign(new Error('x'), { code: 'network_blocked' }); });
    expect(await finish(off.store, (await off.store.fetchFiles([{ url: U('a/1'), bytes: 1 }])).jobId)).toMatchObject({ state: 'failed', code: 'offline' });
    const nf = make(async () => ({ status: 404, headers: {}, body: null }));
    expect(await finish(nf.store, (await nf.store.fetchFiles([{ url: U('a/1'), bytes: 1 }])).jobId)).toMatchObject({ state: 'failed', code: 'not_found' });
    const bad = make(async () => ok([]));
    expect(await finish(bad.store, (await bad.store.fetchFiles([{ url: 'kth-audio://app/audio/v1/../x', bytes: 1 }])).jobId)).toMatchObject({ state: 'failed', code: 'bad_url' });
    expect(bad.urls).toEqual([]);
  });

  it('no recordings base fails with no_source', async () => {
    const { store } = make(async () => ok([]), null);
    expect(await finish(store, (await store.fetchFiles([{ url: U('a/1'), bytes: 1 }])).jobId)).toMatchObject({ state: 'failed', code: 'no_source' });
  });

  it('cancel aborts in flight, removes the .part, keeps finished files', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { store } = make(async (url) => url.endsWith('/1.opus')
      ? ok([new Uint8Array([1, 2])])
      : { status: 200, headers: {}, body: stream([new Uint8Array([1]), new Uint8Array([2])], gate) });
    const { jobId } = await store.fetchFiles([{ url: U('a/1.opus'), bytes: 2 }, { url: U('a/2.opus'), bytes: 2 }]);
    for (let i = 0; i < 100 && existsSync(join(root, 'v1/a/2.opus.part')) === false; i++) await new Promise((r) => setTimeout(r, 5));
    await store.cancel(jobId);
    release();
    expect((await finish(store, jobId)).state).toBe('cancelled');
    expect((await readdir(join(root, 'v1/a'))).sort()).toEqual(['1.opus']);
  });

  it('freeBytes creates the root and reports a number', async () => {
    const sub = join(root, 'new');
    const store = createDownloadStore({ downloadsRoot: () => sub, recordingsBase: () => null, fetchUpstream: async () => ok([]) });
    expect(typeof (await store.freeBytes())).toBe('number');
    expect(existsSync(sub)).toBe(true);
  });
});
