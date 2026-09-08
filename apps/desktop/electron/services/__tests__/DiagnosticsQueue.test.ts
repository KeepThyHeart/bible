/**
 * Unit tests for DiagnosticsQueue - the filesystem-backed report queue.
 *
 * Uses a temp dir per test (via `fs.mkdtemp`) so tests are hermetic and can
 * run in parallel. The queue's `app.getPath('userData')` default is never
 * exercised here because we pass an explicit dir to the constructor.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => os.tmpdir()) },
}));

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { DiagnosticsQueue } from '../DiagnosticsQueue';
import type {
  CrashPayload,
  FeedbackPayload,
  ManualPayload,
} from '../DiagnosticsService';

function mkCrash(overrides: Partial<CrashPayload> = {}): CrashPayload {
  return {
    type: 'crash',
    report_id: overrides.report_id ?? 'abcd1234',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    app_version: '1.0.0',
    electron_version: '28.0.0',
    os: 'Linux 5.15',
    arch: 'x64',
    error: { message: 'boom', type: 'Error', stack: '' },
    method: { name: 'test' },
    recent_ipc: [],
    user_description: null,
    pending_send: false,
    ...overrides,
  };
}

function mkFeedback(overrides: Partial<FeedbackPayload> = {}): FeedbackPayload {
  return {
    type: 'feedback',
    report_id: overrides.report_id ?? '11112222',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    app_version: '1.0.0',
    user_description: 'hi',
    ...overrides,
  };
}

function mkManual(overrides: Partial<ManualPayload> = {}): ManualPayload {
  return {
    type: 'manual',
    report_id: overrides.report_id ?? 'aaaabbbb',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    app_version: '1.0.0',
    electron_version: '28.0.0',
    os: 'Linux 5.15',
    arch: 'x64',
    user_description: 'x',
    ...overrides,
  };
}

describe('DiagnosticsQueue', () => {
  let dir: string;
  let q: DiagnosticsQueue;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-q-'));
    q = new DiagnosticsQueue(dir);
  });

  afterEach(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('enqueue → list → read round-trips the payload', () => {
    const payload = mkCrash({ report_id: 'cafeba11' });
    const id = q.enqueue(payload);
    expect(id).toContain('crash');
    expect(id).toContain('cafeba11');

    const listed = q.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(id);
    expect(listed[0]?.type).toBe('crash');

    const read = q.read(id);
    expect(read).not.toBeNull();
    expect(read?.type).toBe('crash');
    expect(read?.report_id).toBe('cafeba11');
  });

  it('writes files using the `{ISOts}-{type}-{shortId}.json` filename shape', () => {
    const ts = '2026-04-13T14:30:00.000Z';
    const id = q.enqueue(mkCrash({ report_id: 'deadbeef', timestamp: ts }));
    // Colons and dots in the ISO timestamp must be replaced with `-` for
    // filesystem safety (Windows rejects `:`).
    const expectedSafeTs = ts.replace(/[:.]/g, '-');
    expect(id).toBe(`${expectedSafeTs}-crash-deadbeef`);
    const files = fs.readdirSync(dir);
    expect(files).toContain(`${id}.json`);
    // Filename should not contain `:` or `.` in the ts portion.
    expect(id).not.toMatch(/[:]/);
    // The only '.' in the filename should be the `.json` extension, which is
    // not part of `id`. So `id` itself is colon/period-free.
    expect(id).not.toMatch(/\./);
  });

  it('delete(id) removes the file', () => {
    const id = q.enqueue(mkCrash());
    expect(q.delete(id)).toBe(true);
    expect(q.list()).toHaveLength(0);
    // Second delete of the same id is a no-op and returns false.
    expect(q.delete(id)).toBe(false);
  });

  it('deleteAll clears the directory and returns the count', () => {
    q.enqueue(mkCrash({ report_id: '00000001' }));
    q.enqueue(mkFeedback({ report_id: '00000002' }));
    q.enqueue(mkManual({ report_id: '00000003' }));
    expect(q.list()).toHaveLength(3);
    const deleted = q.deleteAll();
    expect(deleted).toBe(3);
    expect(q.list()).toHaveLength(0);
  });

  it('evictOldestIfFull respects the provided cap (tested at cap=3)', () => {
    // Seed with 3 entries; cap=3 means the next enqueue must evict the oldest.
    // Use monotonically increasing timestamps so lex sort aligns with
    // insertion order.
    q.enqueue(mkCrash({ report_id: 'a', timestamp: '2026-01-01T00:00:00.000Z' }));
    q.enqueue(mkCrash({ report_id: 'b', timestamp: '2026-01-02T00:00:00.000Z' }));
    q.enqueue(mkCrash({ report_id: 'c', timestamp: '2026-01-03T00:00:00.000Z' }));
    expect(q.list()).toHaveLength(3);

    q.evictOldestIfFull(3);
    expect(q.list()).toHaveLength(2);
    const remaining = q.list().map((e) => e.id);
    expect(remaining.some((id) => id.endsWith('-a'))).toBe(false);
    expect(remaining.some((id) => id.endsWith('-b'))).toBe(true);
    expect(remaining.some((id) => id.endsWith('-c'))).toBe(true);
  });

  it('list() parses the type token correctly for all three payload kinds', () => {
    q.enqueue(mkCrash({ report_id: 'c0000001' }));
    q.enqueue(mkManual({ report_id: 'm0000001' }));
    q.enqueue(mkFeedback({ report_id: 'f0000001' }));
    const types = q.list()
      .map((e) => e.type)
      .sort();
    expect(types).toEqual(['crash', 'feedback', 'manual']);
  });

  it('update() overwrites an existing queued report', () => {
    const id = q.enqueue(mkCrash({ report_id: 'updateme' }));
    const existing = q.read(id);
    expect(existing).not.toBeNull();
    if (!existing || existing.type !== 'crash') throw new Error('bad type');
    existing.user_description = 'user typed this';
    existing.pending_send = true;
    expect(q.update(id, existing)).toBe(true);

    const reloaded = q.read(id);
    if (!reloaded || reloaded.type !== 'crash') throw new Error('bad type');
    expect(reloaded.user_description).toBe('user typed this');
    expect(reloaded.pending_send).toBe(true);
  });

  it('read() returns null for an unknown id', () => {
    expect(q.read('nope-nope-nope')).toBeNull();
  });

  it('list() returns [] when queue dir is empty or missing', () => {
    expect(q.list()).toEqual([]);
  });
});
