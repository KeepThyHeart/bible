import { describe, it, expect } from 'vitest';
import { audioExternalOrigins, parseAudioSiteConfig } from '../audio';

const voice = { id: 'en_US-amy-medium', label: 'Amy', language: 'en-US', files: ['en/amy.onnx', 'en/amy.onnx.json'] };

describe('parseAudioSiteConfig', () => {
  it('defaults to same-origin /audio, recordings on, no engines', () => {
    for (const raw of [undefined, null, {}, 'x', []]) {
      expect(parseAudioSiteConfig(raw)).toEqual({ base: '/audio', recorded: true, engines: [] });
    }
  });

  it('honours base, trims trailing slashes and rejects unusable bases', () => {
    expect(parseAudioSiteConfig({ base: '/media/audio/' }).base).toBe('/media/audio');
    expect(parseAudioSiteConfig({ base: 'https://cdn.example.com/a/' }).base).toBe('https://cdn.example.com/a');
    for (const bad of ['//evil.example', 'ftp://x', 'javascript:alert(1)', '', 5, 'has space']) {
      expect(parseAudioSiteConfig({ base: bad }).base, String(bad)).toBe('/audio');
    }
  });

  it('can switch the recorded channel off', () => {
    expect(parseAudioSiteConfig({ recorded: false }).recorded).toBe(false);
  });

  it('keeps enabled engines in order and defaults their assetBase', () => {
    const cfg = parseAudioSiteConfig({
      base: '/a',
      tts: { engines: [
        { id: 'piper', voices: [voice], defaultVoices: { en: voice.id } },
        { id: 'kokoro', enabled: false, voices: [voice] },
        { id: 'other', assetBase: 'https://models.example.com/x/', voices: [] },
      ] },
    });
    expect(cfg.engines.map(e => e.id)).toEqual(['piper', 'other']);
    expect(cfg.engines[0].assetBase).toBe('/a/tts/piper');
    expect(cfg.engines[0].defaultVoices).toEqual({ en: voice.id });
    expect(cfg.engines[1].assetBase).toBe('https://models.example.com/x');
  });

  it('drops broken engines, duplicate engines, unsafe voices and dangling defaults', () => {
    const cfg = parseAudioSiteConfig({
      tts: { engines: [
        { id: '' }, 42, null,
        { id: 'piper', voices: [
          voice,
          voice,
          { ...voice, id: 'escape', files: ['../../etc/passwd'] },
          { ...voice, id: 'abs', files: ['/etc/passwd'] },
          { ...voice, id: 'url', files: ['https://evil.example/m.onnx'] },
          { ...voice, id: 'nofiles', files: [] },
          { id: 'nolang', files: ['x'] },
        ], defaultVoices: { en: voice.id, de: 'missing' } },
        { id: 'piper', voices: [] },
      ] },
    });
    expect(cfg.engines).toHaveLength(1);
    expect(cfg.engines[0].voices.map(v => v.id)).toEqual([voice.id]);
    expect(cfg.engines[0].defaultVoices).toEqual({ en: voice.id });
  });

  it('never returns a config whose engines list is shared with the input', () => {
    const raw = { tts: { engines: [{ id: 'piper', voices: [voice] }] } };
    const a = parseAudioSiteConfig(raw);
    a.engines[0].voices.length = 0;
    expect(parseAudioSiteConfig(raw).engines[0].voices).toHaveLength(1);
  });
});

describe('audioExternalOrigins', () => {
  it('is empty for the default same-origin setup', () => {
    expect(audioExternalOrigins(parseAudioSiteConfig({ tts: { engines: [{ id: 'piper', voices: [voice] }] } }))).toEqual([]);
  });

  it('lists each remote origin once, lowercased, without path', () => {
    const cfg = parseAudioSiteConfig({
      base: 'https://Audio.Example.com/v1',
      tts: { engines: [
        { id: 'piper', assetBase: 'https://audio.example.com/tts', voices: [] },
        { id: 'kokoro', assetBase: 'https://models.example.org/k', voices: [] },
      ] },
    });
    expect(audioExternalOrigins(cfg).sort()).toEqual(['https://audio.example.com', 'https://models.example.org']);
  });
});
