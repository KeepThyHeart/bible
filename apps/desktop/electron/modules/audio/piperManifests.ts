/**
 * Pinned built-in asset manifests for the desktop Piper TTS (task 0223): the runtime, the pronunciation
 * overlay and three voices. Sizes and sha256 were measured against the published files; the app verifies
 * every download against them. The three base URLs can be overridden (mirrors, tests); files and digests stay.
 */
import type { AssetManifest } from '@bible/core/browser';
import { PIPER_PRONUNCIATION_ASSET_ID, PIPER_RUNTIME_ASSET_ID } from './types';

export const DEFAULT_RUNTIME_BASE = 'https://cdn.jsdelivr.net/npm';
export const DEFAULT_VOICES_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
export const PRONUNCIATION_REF = '38b394c89c1318de02c91f1442a675a7199b5d30';
export const DEFAULT_PRONUNCIATION_BASE = `https://raw.githubusercontent.com/KeepThyHeart/bible-scripts/${PRONUNCIATION_REF}/pronunciation`;

export const ENV_RUNTIME_BASE = 'BIBLE_PIPER_RUNTIME_BASE';
export const ENV_VOICES_BASE = 'BIBLE_PIPER_VOICES_BASE';
export const ENV_PRONUNCIATION_BASE = 'BIBLE_PRONUNCIATION_BASE';

interface Pin { size: number; sha256: string }

interface RuntimeFile extends Pin { path: string; from: string }

const ORT = 'onnxruntime-web@1.22.0/dist';
const PHON = '@diffusionstudio/piper-wasm@1.0.0/build';

const RUNTIME_FILES: readonly RuntimeFile[] = [
  { path: 'runtime/ort.wasm.min.mjs', from: `${ORT}/ort.wasm.min.mjs`, size: 48259, sha256: '6ef726f355b791129f7ddf3f62e7877a16b9b777abe87004b8ab306e6b9cf265' },
  { path: 'runtime/ort-wasm-simd-threaded.mjs', from: `${ORT}/ort-wasm-simd-threaded.mjs`, size: 20856, sha256: '30dd851d9c00622940500f71ddd2ff8820c5cb65270816080175b958705385a8' },
  { path: 'runtime/ort-wasm-simd-threaded.wasm', from: `${ORT}/ort-wasm-simd-threaded.wasm`, size: 11210254, sha256: '71aef04959c5c1b6de461b6538e2058e306610034a85aad2742d0c7fd4533fe4' },
  { path: 'runtime/piper_phonemize.js', from: `${PHON}/piper_phonemize.js`, size: 120714, sha256: 'fef0c2fc442d24fdef5c7c7cc37d5da2314407640fe11ab1bfe347c723dff19b' },
  { path: 'runtime/piper_phonemize.wasm', from: `${PHON}/piper_phonemize.wasm`, size: 635212, sha256: 'b777cd107a91d2bcc6a1ea46f2c26a662a7407394fe84589198aeaa83dd7a9d6' },
  { path: 'runtime/piper_phonemize.data', from: `${PHON}/piper_phonemize.data`, size: 18077249, sha256: '29f1025eb23a5b5c192cd14a6efbce4509402ff265405072ee6f7d1a09b78f8c' },
];

const OVERLAY_FILES: ReadonlyArray<Pin & { path: string }> = [
  { path: 'en/KJV.json', size: 133505, sha256: 'c9577c93a7306b2e0bf177fe6ac28d30732b7f5eb647e434fe2b17f3eb75162b' },
  { path: 'en-us/lexicon.json', size: 72290, sha256: '241362332c208b817f6c2b39e6a05871027176affe1b3c3ea3b335fb9933e358' },
];

export interface PiperVoiceInfo {
  id: string;
  label: string;
  /** BCP-47. */
  language: string;
  quality: 'low' | 'medium' | 'high';
  onnx: Pin;
  json: Pin;
  /** Path under the voices base: `en/en_US/amy/low`. */
  dir: string;
}

export const PIPER_VOICES: readonly PiperVoiceInfo[] = [
  {
    id: 'en_US-amy-low', label: 'Amy', language: 'en-US', quality: 'low', dir: 'en/en_US/amy/low',
    onnx: { size: 63104526, sha256: 'a5a91abb7de0f104358a25aded480ddacf1ff0762886325886ec406a2e86aab3' },
    json: { size: 4164, sha256: '2250a9a605b8dc35a116717fadc5056695dd809e34a15d02f72a0f52d53d3ebb' },
  },
  {
    id: 'en_US-hfc_female-medium', label: 'HFC female', language: 'en-US', quality: 'medium', dir: 'en/en_US/hfc_female/medium',
    onnx: { size: 63221984, sha256: '5b3d6e36a33a1eb0e50b54900c229127e3059400885eb5e8f128ff04b31cd73c' },
    json: { size: 6385, sha256: '8c7ed7408e7a37602ad6aff4785f44ecb69616b0153ec6a23e920713eba51fac' },
  },
  {
    id: 'es_ES-davefx-medium', label: 'Davefx', language: 'es-ES', quality: 'medium', dir: 'es/es_ES/davefx/medium',
    onnx: { size: 63221984, sha256: 'd2c9224e122321aac3c33343957fff4d0f465226cb74c66b0f520ca3f8c0dd07' },
    json: { size: 6175, sha256: '7d82d069eccca0f87963bd23c33166fe1ef6d24a6b231543931bfe692397f256' },
  },
];

export const DEFAULT_VOICES: Readonly<Record<string, string>> = { en: 'en_US-amy-low', es: 'es_ES-davefx-medium' };

export const RUNTIME_LICENSE = 'MIT (ONNX Runtime, piper-wasm); GPL-3.0 (espeak-ng)';
export const VOICE_LICENSE = "see the voice's MODEL_CARD (rhasspy/piper-voices)";
export const PRONUNCIATION_LICENSE = 'GPL-3.0-or-later';

export const RUNTIME_BYTES = RUNTIME_FILES.reduce((n, f) => n + f.size, 0);
export const OVERLAY_BYTES = OVERLAY_FILES.reduce((n, f) => n + f.size, 0);

export type Env = Record<string, string | undefined>;

const trimBase = (s: string): string => s.replace(/\/+$/, '');
function baseFrom(env: Env, name: string, fallback: string): string {
  const v = env[name]?.trim();
  return trimBase(v && /^https?:\/\//i.test(v) ? v : fallback);
}

export function voiceBytes(v: PiperVoiceInfo): number {
  return v.onnx.size + v.json.size;
}

/** The built-in Piper manifests (runtime, pronunciation overlay, voices). */
export function piperManifests(env: Env = process.env): AssetManifest[] {
  const rt = baseFrom(env, ENV_RUNTIME_BASE, DEFAULT_RUNTIME_BASE);
  const vb = baseFrom(env, ENV_VOICES_BASE, DEFAULT_VOICES_BASE);
  const pb = baseFrom(env, ENV_PRONUNCIATION_BASE, DEFAULT_PRONUNCIATION_BASE);
  const out: AssetManifest[] = [
    {
      id: PIPER_RUNTIME_ASSET_ID,
      kind: 'tts-runtime',
      version: '1',
      title: 'Piper speech engine',
      description: 'ONNX Runtime and the phonemizer for the built-in voices',
      license: RUNTIME_LICENSE,
      size: RUNTIME_BYTES,
      files: RUNTIME_FILES.map((f) => ({ path: f.path, url: `${rt}/${f.from}`, size: f.size, sha256: f.sha256 })),
    },
    {
      id: PIPER_PRONUNCIATION_ASSET_ID,
      kind: 'tts-runtime',
      version: PRONUNCIATION_REF,
      title: 'Bible pronunciation lexicon',
      description: 'Pronunciations for Bible names',
      license: PRONUNCIATION_LICENSE,
      size: OVERLAY_BYTES,
      files: OVERLAY_FILES.map((f) => ({ path: f.path, url: `${pb}/${f.path}`, size: f.size, sha256: f.sha256 })),
    },
  ];
  for (const v of PIPER_VOICES) {
    out.push({
      id: v.id,
      kind: 'tts-voice',
      version: '1',
      title: `${v.label} (${v.language}, ${v.quality})`,
      license: VOICE_LICENSE,
      languages: [v.language],
      size: voiceBytes(v),
      files: [
        { path: `voices/${v.id}.onnx`, url: `${vb}/${v.dir}/${v.id}.onnx`, size: v.onnx.size, sha256: v.onnx.sha256 },
        { path: `voices/${v.id}.onnx.json`, url: `${vb}/${v.dir}/${v.id}.onnx.json`, size: v.json.size, sha256: v.json.sha256 },
      ],
    });
  }
  return out;
}
