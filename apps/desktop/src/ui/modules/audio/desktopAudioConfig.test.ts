import { describe, it, expect } from 'vitest';
import { hasPlayableAudio, parseDesktopAudioInfo } from './desktopAudioConfig';

const info = (audio: unknown) => ({ audio, recordingsBase: null, runtimeBytes: 7 });

describe('desktop audio config', () => {
  it('accepts the kth-audio scheme', () => {
    const { config, runtimeBytes } = parseDesktopAudioInfo(info({
      base: 'kth-audio://app/audio', recorded: false,
      tts: { engines: [{ id: 'piper', assetBase: 'kth-audio://app/audio/tts/piper', voices: [{ id: 'v', language: 'en' }] }] },
    }));
    expect(config.base).toBe('kth-audio://app/audio');
    expect(config.engines[0].assetBase).toBe('kth-audio://app/audio/tts/piper');
    expect(hasPlayableAudio(config)).toBe(true);
    expect(runtimeBytes).toBe(7);
  });

  it('nothing playable when no recordings and no engines', () => {
    const { config } = parseDesktopAudioInfo(info({ base: 'kth-audio://app/audio', recorded: false, tts: { engines: [] } }));
    expect(hasPlayableAudio(config)).toBe(false);
  });

  it('a foreign scheme is not accepted', () => {
    const { config } = parseDesktopAudioInfo(info({ base: 'evil://x/audio', recorded: true }));
    expect(config.base.startsWith('evil:')).toBe(false);
  });
});
