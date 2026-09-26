import { describe, it, expect, beforeEach } from 'vitest';
import { setClientConfig } from '../utils/clientConfig';
import { getAudioConfig, isAudioEnabled } from './config';
import { createEngineRegistry, createProviderRegistry } from './registries';
import type { IAudioProvider } from '@bible/core/browser';

describe('getAudioConfig', () => {
  beforeEach(() => setClientConfig({}));

  it('is null when the server sent no audio block', () => {
    expect(getAudioConfig()).toBeNull();
    expect(isAudioEnabled()).toBe(false);
  });

  it('normalizes what the server sent', () => {
    setClientConfig({ audio: { base: '/audio/', tts: { engines: [{ id: 'piper', voices: [] }] } } });
    const cfg = getAudioConfig();
    expect(cfg?.base).toBe('/audio');
    expect(cfg?.engines[0].id).toBe('piper');
    expect(isAudioEnabled()).toBe(true);
  });

  it('treats a garbage block as defaults rather than throwing', () => {
    setClientConfig({ audio: 'yes' });
    expect(getAudioConfig()).toEqual({ base: '/audio', recorded: true, engines: [] });
  });
});

describe('registries', () => {
  it('start empty and are independent', () => {
    const providers = createProviderRegistry();
    const engines = createEngineRegistry();
    providers.register({ id: 'recorded' } as IAudioProvider);
    expect(providers.list()).toHaveLength(1);
    expect(engines.list()).toHaveLength(0);
  });
});
