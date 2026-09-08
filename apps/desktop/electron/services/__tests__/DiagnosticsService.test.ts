/**
 * Unit tests for DiagnosticsService - the in-memory collection layer.
 *
 * Scope:
 *  - Payload shape for crash, manual (with / without diagnostics), feedback.
 *  - Sanitizer: home dir + username replacement in stack traces.
 *  - Per-session crash cap.
 *  - Duplicate suppression within a session.
 *  - Ring buffer FIFO eviction at the configured size.
 *
 * Notes:
 *  - `electron.app.getVersion()` is mocked so tests don't depend on the
 *    packaged app version.
 *  - `DIAGNOSTICS_RING_SIZE` and `DIAGNOSTICS_CRASHES_PER_SESSION_CAP` are
 *    imported so the test asserts against the real constants rather than
 *    hard-coding values that could drift.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import os from 'os';

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '9.9.9-test'),
  },
}));

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { DiagnosticsService } from '../DiagnosticsService';
import {
  DIAGNOSTICS_RING_SIZE,
  DIAGNOSTICS_CRASHES_PER_SESSION_CAP,
} from '../../config/constants';

describe('DiagnosticsService', () => {
  let svc: DiagnosticsService;

  beforeEach(() => {
    svc = new DiagnosticsService();
  });

  describe('crash payload shape', () => {
    it('produces a payload with required fields and no forbidden data', () => {
      const err = new TypeError("Cannot read properties of null (reading 'verse_text')");
      const payload = svc.captureMainError(err, 'BibleHandler.getVerse');
      expect(payload).not.toBeNull();
      if (!payload) return;

      expect(payload.type).toBe('crash');
      expect(payload.report_id).toMatch(/^[a-f0-9-]{8}$/i);
      expect(typeof payload.timestamp).toBe('string');
      expect(payload.app_version).toBe('9.9.9-test');
      expect(payload.error.message).toContain('Cannot read properties');
      expect(payload.error.type).toBe('TypeError');
      expect(payload.method?.name).toBe('BibleHandler.getVerse');
      expect(payload.pending_send).toBe(false);
      expect(payload.user_description).toBeNull();

      // Spot-check: the payload must not leak forbidden data. `os.homedir()`,
      // the runtime username, timezone strings, locale, or hostname should
      // never appear anywhere in the serialized form.
      const serialized = JSON.stringify(payload);
      const home = os.homedir();
      if (home) expect(serialized).not.toContain(home);
      const user = process.env.USER ?? process.env.USERNAME ?? process.env.LOGNAME;
      if (user) expect(serialized).not.toContain(user);
      // No timezone identifier (e.g. "America/New_York") and no hostname.
      expect(serialized).not.toContain(os.hostname());
    });

    it('omits build_id key when BUILD_ID is empty (dev builds)', () => {
      // In the vitest environment Vite's `define` isn't applied, so BUILD_ID
      // resolves to ''. The service must then drop the key entirely - the
      // alternative (emitting `build_id: ''`) would break the receiver's
      // version-dispatch logic.
      const payload = svc.captureMainError(new Error('x'), 'test');
      if (!payload) throw new Error('expected payload');
      expect(Object.prototype.hasOwnProperty.call(payload, 'build_id')).toBe(false);
    });
  });

  describe('manual payload shape', () => {
    it('includes state when includeDiagnostics=true', () => {
      const payload = svc.buildManualPayload({
        description: 'xref link does nothing',
        includeDiagnostics: true,
      });
      expect(payload.type).toBe('manual');
      expect(payload.user_description).toBe('xref link does nothing');
      expect(payload.state).toBeDefined();
      expect(payload.state?.memory_mb).toBeGreaterThan(0);
      expect(Array.isArray(payload.state?.recent_ipc)).toBe(true);
    });

    it('omits state when includeDiagnostics=false', () => {
      const payload = svc.buildManualPayload({
        description: 'no diag',
        includeDiagnostics: false,
      });
      expect(payload.state).toBeUndefined();
    });
  });

  describe('feedback payload shape', () => {
    it('never contains state or os/arch/electron_version keys', () => {
      const payload = svc.buildFeedbackPayload({
        description: 'bigger commentary font please',
      });
      expect(payload.type).toBe('feedback');
      expect(payload.user_description).toBe('bigger commentary font please');
      // Narrow keys only - anything beyond app_version is a leak per section 2.3.
      expect(Object.prototype.hasOwnProperty.call(payload, 'state')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(payload, 'os')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(payload, 'arch')).toBe(false);
      expect(
        Object.prototype.hasOwnProperty.call(payload, 'electron_version')
      ).toBe(false);
    });
  });

  describe('sanitizer', () => {
    it('replaces os.homedir() path with ~ in stack frames', () => {
      const home = os.homedir();
      const err = new Error('boom');
      err.stack = `Error: boom\n  at fn (${home}/Git/bible/foo.js:1:1)`;
      const payload = svc.captureMainError(err, 'test');
      if (!payload) throw new Error('expected payload');
      expect(payload.error.stack).not.toContain(home);
      expect(payload.error.stack).toMatch(/~[\/\\]Git[\/\\]bible/);
    });

    it('replaces POSIX /home/<user>/ and /Users/<user>/ paths with ~', () => {
      const err = new Error('boom');
      err.stack = [
        'Error: boom',
        '  at fn (/home/alice/app/a.js:1:1)',
        '  at fn (/Users/bob/app/b.js:1:1)',
      ].join('\n');
      const payload = svc.captureMainError(err, 'test');
      if (!payload) throw new Error('expected payload');
      expect(payload.error.stack).not.toMatch(/\/home\/alice/);
      expect(payload.error.stack).not.toMatch(/\/Users\/bob/);
      expect(payload.error.stack).toMatch(/~[\/\\]app[\/\\]a\.js/);
      expect(payload.error.stack).toMatch(/~[\/\\]app[\/\\]b\.js/);
    });

    it('replaces Windows C:\\Users\\<name>\\ paths with <user>', () => {
      const err = new Error('boom');
      err.stack = 'Error: boom\n  at fn (C:\\Users\\charlie\\app\\c.js:1:1)';
      const payload = svc.captureMainError(err, 'test');
      if (!payload) throw new Error('expected payload');
      expect(payload.error.stack).not.toContain('charlie');
      expect(payload.error.stack).toContain('C:\\Users\\<user>');
    });
  });

  describe('per-session crash cap', () => {
    it(`drops captures after ${DIAGNOSTICS_CRASHES_PER_SESSION_CAP} crashes`, () => {
      // Each captured error must be unique or the dedup guard will fire first
      // and swallow the call. We vary the message to exercise the cap cleanly.
      for (let i = 0; i < DIAGNOSTICS_CRASHES_PER_SESSION_CAP; i++) {
        const p = svc.captureMainError(new Error(`unique-${i}`), 'test');
        expect(p).not.toBeNull();
      }
      const overflow = svc.captureMainError(
        new Error('unique-overflow'),
        'test'
      );
      expect(overflow).toBeNull();
    });
  });

  describe('duplicate suppression', () => {
    it('suppresses a second capture with the same message + stack', () => {
      const mkErr = () => {
        const e = new Error('same message');
        e.stack = 'Error: same message\n  at fn (file.js:1:1)';
        return e;
      };
      const first = svc.captureMainError(mkErr(), 'test');
      const second = svc.captureMainError(mkErr(), 'test');
      expect(first).not.toBeNull();
      expect(second).toBeNull();
    });

    it('does NOT suppress distinct errors', () => {
      const e1 = new Error('msg-A');
      const e2 = new Error('msg-B');
      expect(svc.captureMainError(e1, 'test')).not.toBeNull();
      expect(svc.captureMainError(e2, 'test')).not.toBeNull();
    });
  });

  describe('IPC ring buffer', () => {
    it(`caps at ${DIAGNOSTICS_RING_SIZE} with FIFO eviction`, () => {
      const N = DIAGNOSTICS_RING_SIZE + 5;
      for (let i = 0; i < N; i++) {
        svc.recordIpc(`ch:${i}`);
      }
      const ring = svc.getRecentIpc();
      expect(ring.length).toBe(DIAGNOSTICS_RING_SIZE);
      // Oldest entries should have been dropped - the first surviving
      // channel is `ch:${N - DIAGNOSTICS_RING_SIZE}`.
      expect(ring[0]?.channel).toBe(`ch:${N - DIAGNOSTICS_RING_SIZE}`);
      expect(ring[ring.length - 1]?.channel).toBe(`ch:${N - 1}`);
    });

    it('records error flag when provided', () => {
      svc.recordIpc('ch:ok');
      svc.recordIpc('ch:err', { error: true });
      const ring = svc.getRecentIpc();
      expect(ring[0]?.error).toBeUndefined();
      expect(ring[1]?.error).toBe(true);
    });

    it('does not store safeArgs (it is intentionally dropped)', () => {
      svc.recordIpc('ch:x', { safeArgs: 'verse_id=43003016' });
      const ring = svc.getRecentIpc();
      expect(ring[0]?.channel).toBe('ch:x');
      // No arg fields of any kind should appear on a breadcrumb.
      expect(Object.keys(ring[0] ?? {}).sort()).toEqual(['channel', 'ts']);
    });
  });
});
