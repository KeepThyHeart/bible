/**
 * A module download can be hundreds of MB. The service must not let the write
 * buffer grow without bound: when the file write stream is full it pauses the
 * response and resumes it once the buffer drains. And a cancel must settle the
 * promise `startDownload` returned (it used to hang forever).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ClientRequest, IncomingMessage } from 'electron';

import { DownloadService } from '../DownloadService';
import { FakeNetworkGateway } from './fakeNetworkGateway';

let dir: string;
let destination: string;
let gateway: FakeNetworkGateway;
let service: DownloadService;

function pausableResponse(): EventEmitter & { pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> } {
  const response = new EventEmitter() as EventEmitter & { pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> };
  response.pause = vi.fn();
  response.resume = vi.fn();
  return response;
}

describe('DownloadService backpressure and cancel', () => {
  beforeEach(() => {
    gateway = new FakeNetworkGateway();
    service = new DownloadService(gateway);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-dl-bp-'));
    destination = path.join(dir, 'module.db');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('pauses the response when the write buffer is full and resumes on drain', async () => {
    const response = pausableResponse();
    const request = { abort: vi.fn() };
    gateway.downloadStreamImpl = async () => ({
      status: 200,
      headers: {},
      url: '',
      response: response as unknown as IncomingMessage,
      request: request as unknown as ClientRequest,
    });
    const done = service.startDownload(1, 'https://cdn.example/m.db', destination);
    await new Promise((r) => setImmediate(r));

    // Far above the stream's high-water mark, so write() reports "full".
    response.emit('data', Buffer.alloc(4 * 1024 * 1024, 1));
    expect(response.pause).toHaveBeenCalledTimes(1);

    await vi.waitFor(() => expect(response.resume).toHaveBeenCalled());
    response.emit('end');
    await expect(done).resolves.toBe(destination);
    expect(fs.statSync(destination).size).toBe(4 * 1024 * 1024);
  });

  it('rejects the pending download when it is cancelled', async () => {
    const response = pausableResponse();
    const request = { abort: vi.fn() };
    gateway.downloadStreamImpl = async () => ({
      status: 200,
      headers: {},
      url: '',
      response: response as unknown as IncomingMessage,
      request: request as unknown as ClientRequest,
    });
    const done = service.startDownload(2, 'https://cdn.example/m.db', destination);
    await new Promise((r) => setImmediate(r));
    response.emit('data', Buffer.from('partial'));

    service.cancelDownload(2);
    await expect(done).rejects.toThrow(/cancelled/i);
    expect(request.abort).toHaveBeenCalled();
    await vi.waitFor(() => expect(fs.existsSync(destination)).toBe(false));
    expect(service.getActiveDownloads()).toHaveLength(0);
  });
});
