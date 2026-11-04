/**
 * Whisper model catalogue (single source of truth) and the pinned file table.
 * The pins come from `scripts/speech/pin-whisper-models.mjs` (Hugging Face tree API, sha256 = LFS oid).
 */

import type { AssetManifest } from '@bible/core/assets';
import type { SpeechDevice, WhisperModelId, WhisperVariant } from '../types';

export interface PinnedFile {
  size: number;
  sha256: string;
}

export interface WhisperModelInfo {
  id: WhisperModelId;
  label: string;
  repo: string;
  revision: string;
  license: string;
}

export interface WhisperVariantInfo {
  variant: WhisperVariant;
  device: SpeechDevice;
  /** transformers.js dtype per ONNX session. */
  dtype: { encoder_model: string; decoder_model_merged: string };
  /** ONNX files, relative to the repo root. */
  onnx: [encoder: string, decoder: string];
}

export const DEFAULT_MODEL_BASE = 'https://huggingface.co/';

export const WHISPER_MODELS: Record<WhisperModelId, WhisperModelInfo> = {
  base: {
    id: 'base',
    label: 'Whisper base',
    repo: 'onnx-community/whisper-base',
    revision: '1846881b6b3a3024392c1eea3ad983695bc23925',
    license: 'MIT',
  },
  tiny: {
    id: 'tiny',
    label: 'Whisper tiny',
    repo: 'onnx-community/whisper-tiny',
    revision: 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7',
    license: 'MIT',
  },
};

/** Variant table: data, so a perf pass can change a dtype without code changes. */
export const WHISPER_VARIANTS: Record<WhisperVariant, WhisperVariantInfo> = {
  q8: {
    variant: 'q8',
    device: 'wasm',
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
    onnx: ['onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'],
  },
  f16: {
    variant: 'f16',
    device: 'webgpu',
    dtype: { encoder_model: 'fp16', decoder_model_merged: 'fp16' },
    onnx: ['onnx/encoder_model_fp16.onnx', 'onnx/decoder_model_merged_fp16.onnx'],
  },
};

export const SMALL_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
] as const;

/** repo -> path -> size and sha256 (pinned at the revisions above). */
export const WHISPER_PINS: Record<string, Record<string, PinnedFile>> = {
  'onnx-community/whisper-base': {
    'config.json': { size: 2243, sha256: 'f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b' },
    'generation_config.json': { size: 3832, sha256: '61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0' },
    'onnx/decoder_model_merged_fp16.onnx': { size: 104727818, sha256: '2078fb08b753e3a74120e6a52446eef1b98f6152d1da43658731367a93fd71a4' },
    'onnx/decoder_model_merged_quantized.onnx': { size: 53693315, sha256: 'fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b' },
    'onnx/encoder_model_fp16.onnx': { size: 41332612, sha256: 'ffba51b20185377c1b89362b1128148d0132de936a32b200af973da2a11a5369' },
    'onnx/encoder_model_quantized.onnx': { size: 23201314, sha256: '5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46' },
    'preprocessor_config.json': { size: 339, sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d' },
    'tokenizer.json': { size: 2480466, sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566' },
    'tokenizer_config.json': { size: 282682, sha256: '2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573' },
  },
  'onnx-community/whisper-tiny': {
    'config.json': { size: 2243, sha256: '46aeea0a406afbeb563fc8e59ca10609203df4299af6a83f73752fef369efd2d' },
    'generation_config.json': { size: 3772, sha256: 'f5c67e5a4f7102f8cb4d058bc95da276bbc19eeec997267c3bb0f25ef68facd1' },
    'onnx/decoder_model_merged_fp16.onnx': { size: 59593896, sha256: 'a1aac8aa5f4e9e835e343025edf5e4d1644ab6f629c0f8c21e121868e60b3f6c' },
    'onnx/decoder_model_merged_quantized.onnx': { size: 30719241, sha256: '25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3' },
    'onnx/encoder_model_fp16.onnx': { size: 16519192, sha256: 'fc4bf9f3fadc450b128c3ef0711a4e61a55797447b6a700abe7fb97d9f549518' },
    'onnx/encoder_model_quantized.onnx': { size: 10124990, sha256: '2af4a414ca47aa30f61246017e5fe82b0a8d229281d1255ba666a2a7f6b84d19' },
    'preprocessor_config.json': { size: 339, sha256: 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d' },
    'tokenizer.json': { size: 2480466, sha256: '27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566' },
    'tokenizer_config.json': { size: 282683, sha256: '2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce' },
  },
};

export const WHISPER_MODEL_IDS = Object.keys(WHISPER_MODELS) as WhisperModelId[];
export const WHISPER_VARIANT_IDS = Object.keys(WHISPER_VARIANTS) as WhisperVariant[];

export function assetIdFor(model: WhisperModelId, variant: WhisperVariant): string {
  return `whisper-${model}-${variant}`;
}

/** `${modelBase}${repo}/resolve/${revision}/${path}`; a missing trailing slash on modelBase is added. */
export function fileUrl(modelBase: string, repo: string, rev: string, path: string): string {
  const base = modelBase || DEFAULT_MODEL_BASE;
  return `${base.endsWith('/') ? base : base + '/'}${repo}/resolve/${rev}/${path}`;
}

export function whisperFilePaths(variant: WhisperVariant): string[] {
  return [...SMALL_FILES, ...WHISPER_VARIANTS[variant].onnx];
}

/** One `stt-model` manifest per model and variant (4 in all). */
export function whisperManifests(modelBase: string = DEFAULT_MODEL_BASE): AssetManifest[] {
  const out: AssetManifest[] = [];
  for (const model of WHISPER_MODEL_IDS) {
    const m = WHISPER_MODELS[model];
    for (const variant of WHISPER_VARIANT_IDS) {
      const v = WHISPER_VARIANTS[variant];
      const files = whisperFilePaths(variant).map((path) => {
        const pin = WHISPER_PINS[m.repo]?.[path];
        if (!pin) throw new Error(`whisper pin missing: ${m.repo} ${path}`);
        return { path, url: fileUrl(modelBase, m.repo, m.revision, path), size: pin.size, sha256: pin.sha256 };
      });
      out.push({
        id: assetIdFor(model, variant),
        kind: 'stt-model',
        version: m.revision.slice(0, 12),
        title: `${m.label} (${variant})`,
        description: `Speech recognition, ${v.device === 'webgpu' ? 'WebGPU' : 'WASM'} build`,
        license: m.license,
        languages: ['en'],
        size: files.reduce((n, f) => n + f.size, 0),
        files,
        meta: { model, variant, dtype: v.dtype, repo: m.repo, revision: m.revision },
      });
    }
  }
  return out;
}
