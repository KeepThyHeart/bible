/**
 * Unit tests for DiagnosticsUploader.
 *
 * The uploader now performs its POST through the injected `NetworkGateway`
 * seam, so these tests inject a `FakeNetworkGateway` and script its
 * `fetchBuffered` responses. `electron` is still mocked for `app.getVersion` /
 * `app.getPath` (used by the config store and the wire headers). We call
 * `flushNow()` directly to exercise a single tick.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => os.tmpdir()),
    getVersion: vi.fn(() => '1.2.3'),
  },
}));

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { DiagnosticsUploader } from '../DiagnosticsUploader';
import { DiagnosticsQueue } from '../DiagnosticsQueue';
import { DiagnosticsConfig } from '../DiagnosticsConfig';
import type { FetchBufferedOptions, FetchBufferedResult } from '../NetworkGateway';
import { FakeNetworkGateway, fetchResult } from './fakeNetworkGateway';
import type { CrashPayload, FeedbackPayload } from '../DiagnosticsService';

function mkCrash(overrides: Partial<CrashPayload> = {}): CrashPayload {
  return {
    type: 'crash',
    report_id: overrides.report_id ?? 'rpt00001',
    timestamp: overrides.timestamp ?? '2026-04-13T14:30:00.000Z',
    app_version: '1.2.3',
    electron_version: '28.0.0',
    os: 'Linux 5.15',
    arch: 'x64',
    error: { message: 'boom', type: 'Error', stack: '' },
    method: { name: 'test' },
    recent_ipc: [],
    user_description: null,
    pending_send: true, // eligible by default; tests flip this when needed
    ...overrides,
  };
}

function mkFeedback(overrides: Partial<FeedbackPayload> = {}): FeedbackPayload {
  return {
    type: 'feedback',
    report_id: overrides.report_id ?? 'fbk00001',
    timestamp: overrides.timestamp ?? '2026-04-13T14:31:00.000Z',
    app_version: '1.2.3',
    user_description: 'hi',
    ...overrides,
  };
}

describe('DiagnosticsUploader', () => {
  let queueDir: string;
  let configDir: string;
  let queue: DiagnosticsQueue;
  let config: DiagnosticsConfig;
  let gateway: FakeNetworkGateway;
  let uploader: DiagnosticsUploader;

  /** Script the gateway's per-call fetchBuffered response. */
  function respondWith(
    fn: (opts: FetchBufferedOptions, idx: number) => FetchBufferedResult
  ): void {
    let i = 0;
    gateway.fetchBufferedImpl = async (opts) => fn(opts, i++);
  }

  beforeEach(() => {
    queueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-up-q-'));
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-up-c-'));
    queue = new DiagnosticsQueue(queueDir);
    config = new DiagnosticsConfig(path.join(configDir, 'config.json'));
    // Default: enabled, with a usable endpoint. Individual tests override.
    config.set({ enabled: true, endpointUrl: 'https://example.test/diag' });
    gateway = new FakeNetworkGateway();
    uploader = new DiagnosticsUploader(config, queue, gateway);
  });

  afterEach(() => {
    uploader.stop();
    try {
      fs.rmSync(queueDir, { recursive: true, force: true });
      fs.rmSync(configDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('200 OK deletes the file and increments counts.sent', async () => {
    const id = queue.enqueue(mkFeedback());
    respondWith(() => fetchResult(200));
    const counts = await uploader.flushNow();
    expect(counts.sent).toBe(1);
    expect(counts.failed).toBe(0);
    expect(queue.read(id)).toBeNull();
  });

  it('400 is a permanent failure: file is deleted and counts.failed is incremented', async () => {
    const id = queue.enqueue(mkFeedback());
    respondWith(() => fetchResult(400));
    const counts = await uploader.flushNow();
    expect(counts.failed).toBe(1);
    expect(counts.sent).toBe(0);
    expect(queue.read(id)).toBeNull();
  });

  it('500 leaves the file queued (transient) and increments counts.failed', async () => {
    const id = queue.enqueue(mkFeedback());
    respondWith(() => fetchResult(500));
    const counts = await uploader.flushNow();
    expect(counts.failed).toBe(1);
    expect(counts.sent).toBe(0);
    expect(queue.read(id)).not.toBeNull();
  });

  it('a network error is transient: file stays queued', async () => {
    const id = queue.enqueue(mkFeedback());
    gateway.fetchBufferedImpl = async () => {
      throw new Error('ECONNRESET');
    };
    const counts = await uploader.flushNow();
    expect(counts.failed).toBe(1);
    expect(queue.read(id)).not.toBeNull();
  });

  it('429 with Retry-After breaks the loop: remaining files untouched', async () => {
    const firstId = queue.enqueue(
      mkFeedback({ report_id: 'first', timestamp: '2026-04-13T14:30:00.000Z' })
    );
    const secondId = queue.enqueue(
      mkFeedback({ report_id: 'second', timestamp: '2026-04-13T14:30:01.000Z' })
    );

    respondWith((_opts, idx) =>
      idx === 0 ? fetchResult(429, '', { 'retry-after': '120' }) : fetchResult(200)
    );

    const counts = await uploader.flushNow();

    // Exactly one request was made - the loop broke on the 429.
    expect(gateway.fetchCalls).toHaveLength(1);
    expect(counts.sent).toBe(0);
    expect(queue.read(firstId)).not.toBeNull();
    expect(queue.read(secondId)).not.toBeNull();
  });

  it('does nothing when config.enabled=false', async () => {
    config.set({ enabled: false });
    queue.enqueue(mkFeedback());
    const counts = await uploader.flushNow();
    expect(counts).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(gateway.fetchCalls).toHaveLength(0);
  });

  it('does nothing when endpointUrl is empty', async () => {
    config.set({ endpointUrl: '' });
    queue.enqueue(mkFeedback());
    const counts = await uploader.flushNow();
    expect(counts).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(gateway.fetchCalls).toHaveLength(0);
  });

  it('does nothing when connectivity is offline', async () => {
    gateway.connected = false;
    queue.enqueue(mkFeedback());
    const counts = await uploader.flushNow();
    expect(counts).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(gateway.fetchCalls).toHaveLength(0);
  });

  it('does nothing when the master offline switch is engaged', async () => {
    gateway.offline = true;
    queue.enqueue(mkFeedback());
    const counts = await uploader.flushNow();
    expect(counts).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(gateway.fetchCalls).toHaveLength(0);
  });

  it('skips crash reports with pending_send=false (never sent without user consent)', async () => {
    const id = queue.enqueue(mkCrash({ pending_send: false }));
    const counts = await uploader.flushNow();
    expect(gateway.fetchCalls).toHaveLength(0);
    expect(counts.skipped).toBe(1);
    expect(counts.sent).toBe(0);
    expect(queue.read(id)).not.toBeNull();
  });

  it('uploads a crash report with pending_send=true', async () => {
    const id = queue.enqueue(mkCrash({ pending_send: true }));
    respondWith(() => fetchResult(200));
    const counts = await uploader.flushNow();
    expect(counts.sent).toBe(1);
    expect(queue.read(id)).toBeNull();
  });

  it('attaches generic, de-identified headers (no "Bible" branding)', async () => {
    queue.enqueue(mkFeedback({ report_id: 'hdrcheck' }));
    respondWith(() => fetchResult(200));
    await uploader.flushNow();

    const call = gateway.fetchCalls[0]!;
    expect(call.method).toBe('POST');
    const headers = call.headers ?? {};
    expect(headers['Content-Type']).toMatch(/application\/json/);
    // Generic UA + opaque header names - nothing says "Bible".
    expect(headers['User-Agent']).toMatch(/^App\//);
    expect(headers['X-Report-Type']).toBe('feedback');
    expect(headers['X-Report-Id']).toBe('hdrcheck');
    expect(headers['X-App-Version']).toBe('1.2.3');
    const headerBlob = JSON.stringify(headers);
    expect(headerBlob).not.toMatch(/Bible/i);
    expect(headerBlob).not.toMatch(/X-Bible-/);

    // Body is the JSON payload.
    const parsed = JSON.parse(String(call.body));
    expect(parsed.type).toBe('feedback');
    expect(parsed.report_id).toBe('hdrcheck');
  });
});
