/**
 * Unit tests for `ipcHandler` - the Result<T> envelope helper. Verifies
 * success wrapping, classified errors via
 * IpcKnownError, and fallback "internal" classification for unexpected
 * errors. ipcMain is mocked so handlers can be invoked directly without
 * spinning up Electron.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock electron BEFORE importing the module under test. The handler-helper
// captures ipcMain.handle at import time.
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { ipcHandler, IpcKnownError } from '../handler-helper';
import type { Result } from '../result';

async function invoke<T>(channel: string, ...args: unknown[]): Promise<Result<T>> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler for ${channel}`);
  return (await fn({}, ...args)) as Result<T>;
}

describe('ipcHandler', () => {
  beforeEach(() => {
    handlers.clear();
  });

  describe('success envelope', () => {
    it('wraps synchronous return value in { ok: true, value }', async () => {
      ipcHandler<[number, number], number>('math:add', (a, b) => a + b);
      const res = await invoke<number>('math:add', 2, 3);
      expect(res).toEqual({ ok: true, value: 5 });
    });

    it('awaits promises and wraps the resolved value', async () => {
      ipcHandler<[string], string>('echo:async', async (s) => {
        return Promise.resolve(`hi ${s}`);
      });
      const res = await invoke<string>('echo:async', 'world');
      expect(res).toEqual({ ok: true, value: 'hi world' });
    });

    it('wraps undefined as a valid success', async () => {
      ipcHandler<[], void>('void:channel', () => undefined);
      const res = await invoke<void>('void:channel');
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value).toBeUndefined();
    });

    it('passes through complex payloads unchanged', async () => {
      const payload = { id: 1, items: [1, 2, 3], nested: { a: 'b' } };
      ipcHandler<[], typeof payload>('complex', () => payload);
      const res = await invoke<typeof payload>('complex');
      expect(res).toEqual({ ok: true, value: payload });
    });
  });

  describe('error envelope - IpcKnownError', () => {
    it('classifies IpcKnownError with its code and message', async () => {
      ipcHandler<[number], unknown>('notes:get', (id) => {
        throw new IpcKnownError('not_found', `Note ${id} not found`);
      });
      const res = await invoke<unknown>('notes:get', 42);
      expect(res).toEqual({
        ok: false,
        error: { code: 'not_found', message: 'Note 42 not found' },
      });
    });

    it.each([
      'not_found',
      'invalid_input',
      'unauthorized',
      'conflict',
      'unavailable',
    ] as const)('preserves error code %s verbatim', async (code) => {
      ipcHandler<[], unknown>(`err:${code}`, () => {
        throw new IpcKnownError(code, `test ${code}`);
      });
      const res = await invoke<unknown>(`err:${code}`);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe(code);
    });

    it('handles IpcKnownError thrown from async handler', async () => {
      ipcHandler<[], unknown>('async:bad', async () => {
        throw new IpcKnownError('invalid_input', 'bad input');
      });
      const res = await invoke<unknown>('async:bad');
      expect(res).toEqual({
        ok: false,
        error: { code: 'invalid_input', message: 'bad input' },
      });
    });
  });

  describe('error envelope - unexpected errors', () => {
    it('classifies plain Error as internal', async () => {
      ipcHandler<[], unknown>('boom', () => {
        throw new Error('DB exploded');
      });
      const res = await invoke<unknown>('boom');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('internal');
        expect(res.error.message).toBe('DB exploded');
      }
    });

    it('classifies string throws as internal', async () => {
      ipcHandler<[], unknown>('string-throw', () => {
        // eslint-disable-next-line no-throw-literal
        throw 'uh oh';
      });
      const res = await invoke<unknown>('string-throw');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('internal');
        expect(res.error.message).toBe('uh oh');
      }
    });

    it('classifies rejected promises as internal', async () => {
      ipcHandler<[], unknown>('reject', async () => {
        throw new Error('async boom');
      });
      const res = await invoke<unknown>('reject');
      expect(res).toEqual({
        ok: false,
        error: { code: 'internal', message: 'async boom' },
      });
    });
  });

  it('each call gets a fresh envelope (no mutation between invocations)', async () => {
    let counter = 0;
    ipcHandler<[], number>('counter', () => ++counter);
    const a = await invoke<number>('counter');
    const b = await invoke<number>('counter');
    expect(a).toEqual({ ok: true, value: 1 });
    expect(b).toEqual({ ok: true, value: 2 });
  });
});
