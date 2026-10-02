/** AssetService (task 0090): install through the fake gateway into a tmp store; resolvePath; remove. */
import { describe, it, expect, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { EventEmitter } from 'events';
import type { ClientRequest, IncomingMessage } from 'electron';
import type { AssetManifest } from '@bible/core/browser';
import { AssetService } from '../assets/AssetService';
import { FakeNetworkGateway, fetchResult } from './fakeNetworkGateway';

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await fsp.rm(d, { recursive: true, force: true });
});

const bytes = Buffer.from('hello asset store');
const manifest: AssetManifest = {
  id: 'demo', kind: 'data', version: '1', title: 'Demo', license: 'MIT', size: bytes.length,
  files: [{ path: 'd.bin', url: 'https://cdn.test/demo/d.bin', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }],
};

async function setup(devIndex?: string) {
  const root = await fsp.mkdtemp(join(tmpdir(), 'assetsvc-'));
  dirs.push(root);
  const gateway = new FakeNetworkGateway();
  gateway.downloadStreamImpl = async () => {
    const response = new EventEmitter();
    setImmediate(() => { response.emit('data', bytes); response.emit('end'); });
    return {
      status: 200, headers: { 'content-length': String(bytes.length) }, url: '',
      response: response as unknown as IncomingMessage,
      request: { abort() { /* noop */ } } as unknown as ClientRequest,
    };
  };
  if (devIndex) gateway.fetchBufferedImpl = async () => fetchResult(200, devIndex);
  const svc = new AssetService({
    root, gateway,
    getCatalogAssets: () => [manifest],
    getDevIndexUrl: () => (devIndex ? 'https://dev.test/assets/v1/index.json' : undefined),
  });
  return { svc, root };
}

describe('AssetService', () => {
  it('lists the catalog, installs pinned, resolves the path and removes', async () => {
    const { svc, root } = await setup();
    expect((await svc.list()).entries.map((e) => [e.id, e.status])).toEqual([['demo', 'available']]);
    expect(await svc.knows('demo')).toBe(true);
    expect(await svc.knows('nope')).toBe(false);

    await svc.install('demo');
    const entry = (await svc.list()).entries[0];
    expect(entry).toMatchObject({ status: 'installed', pinned: true, verified: true, storedBytes: bytes.length });

    const path = await svc.resolvePath('demo', 'd.bin');
    expect(path).toBe(join(root, 'files', 'data', 'demo', '1', 'd.bin'));
    expect(await fsp.readFile(path as string)).toEqual(bytes);
    expect(await svc.resolvePath('demo', 'other.bin')).toBeNull();

    expect(await svc.remove('demo')).toBe(true);
    expect(await svc.resolvePath('demo', 'd.bin')).toBeNull();
    expect(await svc.remove('demo')).toBe(false);
    expect(await svc.cancel('demo')).toBe(false);
  });

  it('merges the dev index; catalog entries win an id clash', async () => {
    const dev = JSON.stringify({
      schema: 'kth-asset-index/1',
      assets: [
        { ...manifest, title: 'From dev', files: [{ ...manifest.files[0], url: 'd.bin' }] },
        { ...manifest, id: 'devonly', files: [{ ...manifest.files[0], url: 'x/d.bin' }] },
      ],
    });
    const { svc } = await setup(dev);
    const entries = (await svc.list()).entries;
    expect(entries.map((e) => [e.id, e.title])).toEqual([['demo', 'Demo'], ['devonly', 'Demo']]);
  });
});
