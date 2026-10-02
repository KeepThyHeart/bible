/**
 * `speech.*` host stub: status is ungated and reports `unavailable`; every other
 * method checks its permission, then rejects as not available in this build.
 */

import { describe, it, expect } from 'vitest';

import type { Extensions } from '@bible/core';

import { ExtensionRpcRouter, type IRpcTransport } from '../ExtensionRpcRouter';
import { buildGrant } from '../ExtensionPermissionGuard';
import { SpeechApiImpl, SPEECH_UNAVAILABLE_MESSAGE } from '../api-impl/speechApiImpl';

type RpcResponse = Extensions.RpcResponse;

function setup(perms: string[]) {
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
  new SpeechApiImpl({ extensionId: 'test.speech', router, grant: buildGrant('test.speech', perms) }).attach();
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
