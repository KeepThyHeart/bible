/**
 * `speech.*` host stub: status is ungated and reports `unavailable`; every other
 * method checks its permission, then rejects as not available in this build.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ISpeechApi } from '@bible/core/speech';

import type { Extensions } from '@bible/core';

import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import { buildGrant } from '../ExtensionPermissionGuard';
import { SpeechApiImpl, SPEECH_UNAVAILABLE_MESSAGE } from '../api-impl/speechApiImpl';

type RpcResponse = Extensions.RpcResponse;

function setup(perms: string[], speech?: () => ISpeechApi | null) {
  let hostHandler: ((env: unknown) => void) | null = null;
  const sent: unknown[] = [];
  const hostSide: IRpcTransport = {
    send(env) {
      sent.push(env);
    },
    onMessage(h) {
      hostHandler = h;
    },
    close() {
      hostHandler = null;
    },
  };
  const router = new ExtensionRpcRouter(hostSide);
  new SpeechApiImpl({ extensionId: 'test.speech', router, grant: buildGrant('test.speech', perms), ...(speech ? { speech } : {}) }).attach();
  let n = 0;
  return async (method: string, args: unknown[] = []): Promise<RpcResponse> => {
    const id = `r-${n++}`;
    const start = sent.length;
    hostHandler?.({ kind: 'request', id, method, args });
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setImmediate(r));
      const hit = sent.slice(start).find((e) => (e as RpcResponse).kind === 'response' && (e as RpcResponse).id === id);
      if (hit) return hit as RpcResponse;
    }
    throw new Error(`no response for ${method}`);
  };
}

describe('SpeechApiImpl stub', () => {
  it('status is ungated and reports unavailable with the grant', async () => {
    const call = setup([]);
    const r = await call('speech.status');
    expect(r.error).toBeUndefined();
    expect(r.result).toMatchObject({
      granted: { listen: false, speak: false },
      listen: 'unavailable',
      speak: 'unavailable',
    });
    const r2 = await setup(['speech:listen', 'speech:speak'])('speech.status');
    expect((r2.result as { granted: unknown }).granted).toEqual({ listen: true, speak: true });
  });

  it('listen methods are denied without speech:listen, unavailable with it', async () => {
    const denied = setup(['speech:speak']);
    for (const m of ['speech.startListening', 'speech.nextUtterance', 'speech.stopListening']) {
      const r = await denied(m, [{}]);
      expect(r.error?.message).toMatch(/speech:listen/);
    }
    const granted = setup(['speech:listen']);
    const r = await granted('speech.startListening', [{ language: 'en-US', maxDurationMs: 1 }]);
    expect(r.error?.message).toBe(SPEECH_UNAVAILABLE_MESSAGE);
    expect((await granted('speech.stopListening', ['x'])).error).toBeUndefined();
  });

  it('speak methods are denied without speech:speak, unavailable with it', async () => {
    const denied = setup(['speech:listen']);
    expect((await denied('speech.speak', ['hi'])).error?.message).toMatch(/speech:speak/);
    expect((await denied('speech.earcon', ['ok'])).error?.message).toMatch(/speech:speak/);
    const granted = setup(['speech:speak']);
    expect((await granted('speech.speak', ['hi'])).error?.message).toBe(SPEECH_UNAVAILABLE_MESSAGE);
  });

  it('cancel is an ungated no-op', async () => {
    expect((await setup([])('speech.cancel')).error).toBeUndefined();
  });
});

describe('SpeechApiImpl with a service', () => {
  const service = () =>
    ({
      status: vi.fn(async () => ({ granted: { listen: true, speak: true }, listen: 'ready', speak: 'ready', languages: ['en'], engineLabel: 'W', onDevice: true })),
      speak: vi.fn(async () => ({ completed: true })),
      earcon: vi.fn(async () => undefined),
      startListening: vi.fn(async () => ({ listenId: 'l1' })),
      nextUtterance: vi.fn(async () => ({ kind: 'no-speech' })),
      stopListening: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
    }) as unknown as ISpeechApi & Record<string, ReturnType<typeof vi.fn>>;

  it('checks the permission first, then forwards', async () => {
    const svc = service();
    const denied = setup(['speech:listen'], () => svc);
    expect((await denied('speech.speak', ['hi'])).error?.message).toMatch(/speech:speak/);
    expect(svc.speak).not.toHaveBeenCalled();
    const ok = setup(['speech:listen', 'speech:speak'], () => svc);
    expect((await ok('speech.speak', ['hi', { language: 'en' }])).result).toEqual({ completed: true });
    expect(svc.speak).toHaveBeenCalledWith('hi', { language: 'en' });
    expect((await ok('speech.startListening', [{ language: 'en', maxDurationMs: 5 }])).result).toEqual({ listenId: 'l1' });
    expect((await ok('speech.nextUtterance', ['l1', { noSpeechTimeoutMs: 5 }])).result).toEqual({ kind: 'no-speech' });
    await ok('speech.stopListening', ['l1']);
    expect(svc.stopListening).toHaveBeenCalledWith('l1');
    await ok('speech.cancel');
    expect(svc.cancel).toHaveBeenCalled();
  });

  it('status merges the service status with this extension\'s grants', async () => {
    const r = await setup(['speech:speak'], service)('speech.status');
    expect(r.result).toMatchObject({ listen: 'ready', engineLabel: 'W', granted: { listen: false, speak: true } });
  });

  it('falls back to unavailable when the service getter returns null', async () => {
    const call = setup(['speech:speak'], () => null);
    expect((await call('speech.status')).result).toMatchObject({ listen: 'unavailable' });
    expect((await call('speech.speak', ['x'])).error?.message).toBe(SPEECH_UNAVAILABLE_MESSAGE);
  });
});
