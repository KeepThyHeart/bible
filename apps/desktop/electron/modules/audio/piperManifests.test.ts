import { describe, it, expect } from 'vitest';
import { parseAssetIndex, parseAudioSiteConfig } from '@bible/core/browser';
import { piperManifests, PIPER_VOICES, RUNTIME_BYTES, OVERLAY_BYTES } from './piperManifests';
import { buildAudioInfo, recordingsBaseFrom } from './info';
import { isAudioEnabled } from './flag';
import { audioMainManifest } from './manifest';
import { MAIN_MODULES } from '../mainModules';
import { PIPER_ASSET_BASE_URL } from './types';

describe('piper manifests', () => {
  const ms = piperManifests({});
  it('has the pinned shape', () => {
    expect(ms.map((m) => `${m.kind}:${m.id}`)).toEqual([
      'tts-runtime:piper-runtime', 'tts-runtime:piper-pronunciation',
      'tts-voice:en_US-amy-low', 'tts-voice:en_US-hfc_female-medium', 'tts-voice:es_ES-davefx-medium',
    ]);
    for (const m of ms) {
      expect(m.size).toBe(m.files.reduce((n, f) => n + f.size, 0));
      for (const f of m.files) {
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(f.url).toMatch(/^https:\/\//);
      }
    }
    const paths = ms.flatMap((m) => m.files.map((f) => `${m.id}/${f.path}`));
    expect(new Set(paths).size).toBe(paths.length);
    expect(ms[0]!.files.map((f) => f.path)).toContain('runtime/piper_phonemize.data');
    expect(ms[1]!.version).toBe('38b394c89c1318de02c91f1442a675a7199b5d30');
    expect(ms[2]!.files[0]!.url).toBe('https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/low/en_US-amy-low.onnx');
  });
  it('passes the core asset-index validation', () => {
    const { assets, rejected } = parseAssetIndex({ schema: 'kth-asset-index/1', assets: ms }, 'https://x.test/index.json');
    expect(rejected).toEqual([]);
    expect(assets).toHaveLength(5);
  });
  it('honours base overrides, ignoring non-http values', () => {
    const o = piperManifests({ BIBLE_PIPER_RUNTIME_BASE: 'http://mirror.test/npm/', BIBLE_PIPER_VOICES_BASE: 'file:///x', BIBLE_PRONUNCIATION_BASE: 'https://m.test/p' });
    expect(o[0]!.files[0]!.url).toBe('http://mirror.test/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.mjs');
    expect(o[1]!.files[0]!.url).toBe('https://m.test/p/en/KJV.json');
    expect(o[2]!.files[0]!.url.startsWith('https://huggingface.co/')).toBe(true);
  });
});

describe('audio flag and registration', () => {
  it('is off by default and on with KTH_FLAGS (unpackaged only)', () => {
    expect(isAudioEnabled(false, {})).toBe(false);
    expect(isAudioEnabled(false, { KTH_FLAGS: 'audio' })).toBe(true);
    expect(isAudioEnabled(true, { KTH_FLAGS: 'audio' })).toBe(false);
    expect(isAudioEnabled(true, {}, 'audio')).toBe(true); // a build with the flag, as the module host reads it
  });
  it('is registered behind the audio flag', () => {
    expect(audioMainManifest.flag).toBe('audio');
    expect(MAIN_MODULES.some((m) => m.manifest.id === 'audio')).toBe(true);
  });
});

describe('getInfo', () => {
  it('parses into the piper engine with three voices', () => {
    const info = buildAudioInfo({});
    expect(info.recordingsBase).toBeNull();
    expect(info.runtimeBytes).toBe(RUNTIME_BYTES + OVERLAY_BYTES);
    const cfg = parseAudioSiteConfig(info.audio, { allowSchemes: ['kth-audio'] });
    expect(cfg.base).toBe('kth-audio://app/audio');
    expect(cfg.recorded).toBe(false);
    expect(cfg.engines).toHaveLength(1);
    const e = cfg.engines[0]!;
    expect(e.id).toBe('piper');
    expect(e.assetBase).toBe(PIPER_ASSET_BASE_URL);
    expect(e.voices.map((v) => v.id)).toEqual(PIPER_VOICES.map((v) => v.id));
    expect(e.defaultVoices).toEqual({ en: 'en_US-amy-low', es: 'es_ES-davefx-medium' });
    expect(e.voices[0]!.downloadBytes).toBe(63104526 + 4164);
    expect(e.voices[0]!.files).toEqual(['voices/en_US-amy-low.onnx', 'voices/en_US-amy-low.onnx.json']);
  });
  it('reads the recordings base from the environment (http/https only)', () => {
    expect(recordingsBaseFrom({ BIBLE_AUDIO_RECORDINGS_BASE: 'https://rec.test/audio/' })).toBe('https://rec.test/audio');
    expect(recordingsBaseFrom({ BIBLE_AUDIO_RECORDINGS_BASE: 'file:///etc' })).toBeNull();
    expect(recordingsBaseFrom({})).toBeNull();
    expect(recordingsBaseFrom({}, 'https://built.test/audio')).toBe('https://built.test/audio');
    expect(recordingsBaseFrom({ BIBLE_AUDIO_RECORDINGS_BASE: 'https://env.test/a' }, 'https://built.test/audio')).toBe('https://env.test/a');
    expect(buildAudioInfo({}, { hasDownloads: true }).audio).toMatchObject({ recorded: true });
    expect(buildAudioInfo({}).audio).toMatchObject({ recorded: false });
    const info = buildAudioInfo({ BIBLE_AUDIO_RECORDINGS_BASE: 'https://rec.test/audio' });
    expect(info.recordingsBase).toBe('https://rec.test/audio');
    expect((info.audio as { recorded: boolean }).recorded).toBe(true);
  });
});
