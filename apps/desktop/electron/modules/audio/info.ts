import { AUDIO_BASE_URL, PIPER_ASSET_BASE_URL, type DesktopAudioInfo } from './types';
import {
  DEFAULT_VOICES, OVERLAY_BYTES, PIPER_VOICES, RUNTIME_BYTES, VOICE_LICENSE, voiceBytes, type Env,
} from './piperManifests';

export const ENV_RECORDINGS_BASE = 'BIBLE_AUDIO_RECORDINGS_BASE';

declare const __BIBLE_AUDIO_RECORDINGS_BASE__: string | undefined;
/** Baked in at build time (`BIBLE_AUDIO_RECORDINGS_BASE` or branding `audioRecordingsBase`); '' when none. */
const BUILT_RECORDINGS_BASE = typeof __BIBLE_AUDIO_RECORDINGS_BASE__ === 'string' ? __BIBLE_AUDIO_RECORDINGS_BASE__ : '';

const normalizeBase = (v: string | undefined): string | null => {
  const t = v?.trim();
  if (!t || !/^https?:\/\/[^\s/]+/i.test(t)) return null;
  return t.replace(/\/+$/, '');
};

/**
 * The recordings base (http/https only, no trailing slash), or null. There is no default host: the
 * environment variable (read at run time), else the value the build baked in.
 */
export function recordingsBaseFrom(env: Env = process.env, built: string = BUILT_RECORDINGS_BASE): string | null {
  return normalizeBase(env[ENV_RECORDINGS_BASE]) ?? normalizeBase(built);
}

/**
 * `hasDownloads`: books are on disk. The recorded channel then stays on without a host, so downloaded
 * books keep playing (the scheme serves them; anything else answers 404 and Auto falls back to Piper).
 */
export function buildAudioInfo(env: Env = process.env, opts: { hasDownloads?: boolean; built?: string } = {}): DesktopAudioInfo {
  const recordingsBase = recordingsBaseFrom(env, opts.built);
  return {
    audio: {
      base: AUDIO_BASE_URL,
      recorded: recordingsBase !== null || opts.hasDownloads === true,
      tts: {
        engines: [{
          id: 'piper',
          enabled: true,
          assetBase: PIPER_ASSET_BASE_URL,
          defaultVoices: { ...DEFAULT_VOICES },
          voices: PIPER_VOICES.map((v) => ({
            id: v.id,
            label: v.label,
            language: v.language,
            quality: v.quality,
            downloadBytes: voiceBytes(v),
            files: [`voices/${v.id}.onnx`, `voices/${v.id}.onnx.json`],
            license: VOICE_LICENSE,
          })),
        }],
      },
    },
    recordingsBase,
    runtimeBytes: RUNTIME_BYTES + OVERLAY_BYTES,
  };
}
