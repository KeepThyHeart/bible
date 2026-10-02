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
    gateway.downloadStreamImpl = async () => downloadResult({ status: 206, headers: { 'content-range': 'bytes 7-10/11' }, chunks: ['rest'] });
    await service.startDownload(2, 'https://cdn.example/module.db', destination);
    expect(gateway.downloadCalls[0]!.headers).toEqual({ Range: `bytes=${'partial'.length}-` });
  });

  it('restarts from zero when the server answers 200 to a Range request', async () => {
    fs.writeFileSync(destination, 'partial');
    gateway.downloadStreamImpl = async () => downloadResult({ status: 200, chunks: ['whole-file'] });
    await service.startDownload(3, 'https://cdn.example/module.db', destination);
    expect(fs.readFileSync(destination, 'utf-8')).toBe('whole-file');
  });

  it('appends a 206 body to the partial', async () => {
    fs.writeFileSync(destination, 'partial');
    gateway.downloadStreamImpl = async () => downloadResult({ status: 206, headers: { 'content-range': 'bytes 7-11/12' }, chunks: ['-rest'] });
    await service.startDownload(4, 'https://cdn.example/module.db', destination);
    expect(fs.readFileSync(destination, 'utf-8')).toBe('partial-rest');
  });

  it('fails retryably and deletes the partial when a 206 starts at the wrong offset', async () => {
    fs.writeFileSync(destination, 'partial');
    fs.writeFileSync(`${destination}.etag`, '"v1"');
    gateway.downloadStreamImpl = async () =>
      downloadResult({ status: 206, headers: { 'content-range': 'bytes 0-11/12' }, chunks: ['whole-file!!'] });
    await expect(service.startDownload(10, 'https://cdn.example/module.db', destination)).rejects.toThrow(
      /resume mismatch/
    );
    expect(fs.existsSync(destination)).toBe(false);
    expect(fs.existsSync(`${destination}.etag`)).toBe(false);
    expect(service.getActiveDownloads()).toHaveLength(0);

    // The retry starts clean from zero.
    gateway.downloadStreamImpl = async () => downloadResult({ status: 200, chunks: ['whole-file!!'] });
    await service.startDownload(10, 'https://cdn.example/module.db', destination);
    expect(gateway.downloadCalls[1]!.headers).toBeUndefined();
    expect(fs.readFileSync(destination, 'utf-8')).toBe('whole-file!!');
  });

  it('treats a 206 with no parseable Content-Range as a mismatch', async () => {
    fs.writeFileSync(destination, 'partial');
    gateway.downloadStreamImpl = async () => downloadResult({ status: 206, chunks: ['rest'] });
    await expect(service.startDownload(11, 'https://cdn.example/module.db', destination)).rejects.toThrow(
      /resume mismatch/
    );
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('stores the ETag beside the file and removes it on completion', async () => {
    let sidecarDuring: string | undefined;
    gateway.downloadStreamImpl = async () => {
      const r = downloadResult({ status: 200, headers: { etag: '"abc"' }, chunks: ['data'] });
      (r.response as unknown as NodeJS.EventEmitter).once('data', () => {
        sidecarDuring = fs.readFileSync(`${destination}.etag`, 'utf-8');
      });
      return r;
    };
    await service.startDownload(12, 'https://cdn.example/module.db', destination);
    expect(sidecarDuring).toBe('"abc"');
    expect(fs.existsSync(`${destination}.etag`)).toBe(false);
  });

  it('sends If-Range with the stored strong ETag on resume', async () => {
    fs.writeFileSync(destination, 'partial');
    fs.writeFileSync(`${destination}.etag`, '"abc"');
    gateway.downloadStreamImpl = async () =>
      downloadResult({ status: 206, headers: { 'content-range': 'bytes 7-11/12' }, chunks: ['-rest'] });
    await service.startDownload(13, 'https://cdn.example/module.db', destination);
    expect(gateway.downloadCalls[0]!.headers).toEqual({ Range: 'bytes=7-', 'If-Range': '"abc"' });
    expect(fs.existsSync(`${destination}.etag`)).toBe(false);
  });

  it('removes the ETag sidecar when a 200 restarts the download or on cancel', async () => {
    fs.writeFileSync(destination, 'partial');
    fs.writeFileSync(`${destination}.etag`, '"old"');
    gateway.downloadStreamImpl = async () =>
      downloadResult({ status: 200, headers: { etag: '"new"' }, chunks: ['whole'] });
    await service.startDownload(14, 'https://cdn.example/module.db', destination);
    expect(fs.readFileSync(destination, 'utf-8')).toBe('whole');
    expect(fs.existsSync(`${destination}.etag`)).toBe(false);

    fs.writeFileSync(destination, 'p');
    fs.writeFileSync(`${destination}.etag`, '"x"');
    gateway.downloadStreamImpl = () => new Promise(() => {});
    void service.startDownload(15, 'https://cdn.example/module.db', destination);
    service.cancelDownload(15);
    expect(fs.existsSync(`${destination}.etag`)).toBe(false);
  });

  it('drops the partial on 416 so a retry starts clean', async () => {
    fs.writeFileSync(destination, 'partial');
    gateway.downloadStreamImpl = async () => downloadResult({ status: 416, chunks: [] });
    await expect(service.startDownload(5, 'https://cdn.example/module.db', destination)).rejects.toThrow(/416/);
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('creates the destination folder when a fresh profile has none', async () => {
    const nested = path.join(path.dirname(destination), 'temp', 'downloads', 'module.db.gz');
    gateway.downloadStreamImpl = async () => downloadResult({ status: 200, chunks: ['module-bytes'] });

    await expect(service.startDownload(9, 'https://cdn.example/module.db.gz', nested)).resolves.toBe(nested);

    expect(fs.readFileSync(nested, 'utf-8')).toBe('module-bytes');
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
