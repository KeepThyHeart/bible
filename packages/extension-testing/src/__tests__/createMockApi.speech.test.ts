import { describe, expect, it } from 'vitest';

import { FakeSpeechApi, createFakeSpeechApi, createMockApi } from '../index';

describe('createMockApi speech', () => {
  it('defaults to an unavailable, ungranted fake', async () => {
    const api = createMockApi();
    expect(api.speech).toBeInstanceOf(FakeSpeechApi);
    expect(await api.speech.status()).toMatchObject({
      granted: { listen: false, speak: false },
      listen: 'unavailable',
      speak: 'unavailable',
    });
  });

  it('createFakeSpeechApi takes a script and grants', async () => {
    const s = createFakeSpeechApi({ script: [{ say: 'amen' }], granted: { listen: true, speak: true }, status: { listen: 'ready' } });
    expect((await s.status()).listen).toBe('ready');
    const { listenId } = await s.startListening({ language: 'en-US', maxDurationMs: 1 });
    const out = await s.nextUtterance(listenId, { noSpeechTimeoutMs: 1 });
    expect(out.kind).toBe('speech');
  });
});
