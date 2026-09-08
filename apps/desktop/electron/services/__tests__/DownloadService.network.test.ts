/**
 * Tests for `DownloadService.startDownload` against the injected
 * `NetworkGateway` seam.
 *
 * The redirect-limit / https -> http-downgrade security assertions now live in
 * `NetworkGateway.test.ts` (the gateway owns redirect policy). Here we verify
 * the service's own behavior: scheme validation before touching the gateway,
 * streaming a successful response to disk, and - crucially - freeing the queue
 * slot when the gateway rejects (redirect/downgrade/offline) so a retry does
 * not hit "already in progress".
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { DownloadService } from '../DownloadService';
import { NetworkBlockedError } from '../NetworkGateway';
import { FakeNetworkGateway, downloadResult } from './fakeNetworkGateway';

let destination: string;
let gateway: FakeNetworkGateway;
let service: DownloadService;

describe('DownloadService via NetworkGateway', () => {
  beforeEach(() => {
    gateway = new FakeNetworkGateway();
    service = new DownloadService(gateway);
    destination = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bible-dl-')), 'module.db');
  });

  afterEach(() => {
    try {
      fs.rmSync(path.dirname(destination), { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it('rejects a non-http(s) URL before touching the gateway', async () => {
    await expect(
      service.startDownload(1, 'file:///C:/Windows/System32/calc.exe', destination)
    ).rejects.toThrow(/unsupported scheme/);
    expect(gateway.downloadCalls).toHaveLength(0);
    expect(service.getActiveDownloads()).toHaveLength(0);
  });

  it('requests the download through the gateway and resolves to the destination', async () => {
    gateway.downloadStreamImpl = async () =>
      downloadResult({ status: 200, chunks: ['module-bytes'] });
    await expect(service.startDownload(1, 'https://cdn.example/module.db', destination)).resolves.toBe(
      destination
    );
    expect(gateway.downloadCalls[0]!.url).toBe('https://cdn.example/module.db');
    expect(gateway.downloadCalls[0]!.context).toBe('download');
    // Slot freed after completion.
    expect(service.getActiveDownloads()).toHaveLength(0);
  });

  it('sends a Range header when a partial file already exists', async () => {
    fs.writeFileSync(destination, 'partial');
    gateway.downloadStreamImpl = async () => downloadResult({ status: 206, chunks: ['rest'] });
    await service.startDownload(2, 'https://cdn.example/module.db', destination);
    expect(gateway.downloadCalls[0]!.headers).toEqual({ Range: `bytes=${'partial'.length}-` });
  });

  it('rejects a duplicate queue id', async () => {
    gateway.downloadStreamImpl = () =>
      new Promise(() => {
        /* never resolves - keeps the slot occupied */
      });
    void service.startDownload(3, 'https://cdn.example/a.db', destination);
    await expect(
      service.startDownload(3, 'https://cdn.example/b.db', destination)
    ).rejects.toThrow(/already in progress/);
  });

  it('frees the queue slot when the gateway rejects (redirect/downgrade)', async () => {
    gateway.downloadStreamImpl = async () => {
      throw new Error('Refusing insecure redirect (https → http downgrade)');
    };
    await expect(
      service.startDownload(7, 'https://cdn.example/module.db', destination)
    ).rejects.toThrow(/downgrade/);
    // A failed hop must not leave a phantom entry behind, or a retry would hit
    // "already in progress" instead of retrying.
    expect(service.getActiveDownloads()).toHaveLength(0);
  });

  it('frees the queue slot and surfaces the master offline switch', async () => {
    gateway.offline = true;
    await expect(
      service.startDownload(8, 'https://cdn.example/module.db', destination)
    ).rejects.toThrow(NetworkBlockedError);
    expect(service.getActiveDownloads()).toHaveLength(0);
  });
});
