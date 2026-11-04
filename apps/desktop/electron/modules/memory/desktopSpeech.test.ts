import { describe, it, expect, vi } from 'vitest';
import type { ISpeechApi } from '@bible/core/speech';
import { createDesktopSpeech, SPEECH_UNAVAILABLE } from './desktopSpeech';

describe('createDesktopSpeech', () => {
  it('is the unavailable stub when the hub has no service', async () => {
    const s = createDesktopSpeech(() => null);
    expect(await s.status()).toMatchObject({ granted: { listen: true, speak: true }, listen: 'unavailable', speak: 'unavailable' });
    await expect(s.speak('x')).rejects.toThrow(SPEECH_UNAVAILABLE);
    await expect(s.startListening({ language: 'en', maxDurationMs: 1 })).rejects.toThrow(SPEECH_UNAVAILABLE);
    await expect(s.stopListening('a')).resolves.toBeUndefined();
    await expect(s.cancel()).resolves.toBeUndefined();
  });

  it('delegates to the service and forces built-in grants', async () => {
    const real = {
      status: vi.fn(async () => ({ granted: { listen: false, speak: false }, listen: 'ready', speak: 'ready', languages: ['en'], engineLabel: 'W', onDevice: true })),
      speak: vi.fn(async () => ({ completed: true })),
      cancel: vi.fn(async () => undefined),
    } as unknown as ISpeechApi;
    const s = createDesktopSpeech(() => real);
    expect(await s.status()).toMatchObject({ granted: { listen: true, speak: true }, listen: 'ready' });
    expect(await s.speak('hi')).toEqual({ completed: true });
    await s.cancel();
    expect(real.cancel).toHaveBeenCalled();
  });
});
