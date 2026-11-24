/**
 * Audio Bible, desktop (task 0223): the contract between the main process and the
 * renderer. Type-only; the renderer imports it with `import type`.
 *
 * Everything audio the renderer loads comes from one privileged scheme served by the
 * main process (`audioProtocol.ts`), laid out exactly like the web app's `/audio` tree:
 *
 *   kth-audio://app/audio/v1/{module}/...        recordings: a downloaded copy on disk if there
 *                                               is one, else the configured recordings base,
 *                                               fetched through NetworkGateway (Range passed on)
 *   kth-audio://app/audio/tts/piper/{path}       files of the installed Piper assets
 *                                               (`runtime/...` of `piper-runtime`, `voices/<id>.*` of voice `<id>`)
 *   kth-audio://app/audio/pronunciation/{path}   files of the installed `piper-pronunciation` asset
 */
import type { AudioSiteConfig } from '@bible/core/browser';

export const AUDIO_SCHEME = 'kth-audio';
/** The base the renderer's `AudioSiteConfig` uses: recordings, `tts/` and `pronunciation/` live under it. */
export const AUDIO_BASE_URL = `${AUDIO_SCHEME}://app/audio`;
export const PIPER_ASSET_BASE_URL = `${AUDIO_BASE_URL}/tts/piper`;

/** Asset ids registered with the main-process AssetManager (built-in manifests, flag `audio`). */
export const PIPER_RUNTIME_ASSET_ID = 'piper-runtime';
export const PIPER_PRONUNCIATION_ASSET_ID = 'piper-pronunciation';

/** What the renderer needs to build its `AudioSiteConfig` (no site config on desktop). */
export interface DesktopAudioInfo {
  /**
   * The raw `audio` block, in the site-config shape (`parseAudioSiteConfig` input):
   * `{ base: AUDIO_BASE_URL, recorded, tts: { engines: [{ id: 'piper', assetBase, defaultVoices, voices }] } }`.
   * `recorded` is true only when a recordings base is configured.
   */
  audio: unknown;
  /** The configured recordings origin+path (display only), or null: no default host until recordings are published. */
  recordingsBase: string | null;
  /** Bytes of the Piper runtime plus the pronunciation overlay (for the download gate). */
  runtimeBytes: number;
}

/** Channels `module:audio:<method>`; implemented by `./index.ts`, called by `createModuleClient<AudioModuleApi>('audio')`. */
export interface AudioModuleApi {
  getInfo(): Promise<DesktopAudioInfo>;
  /** Which of these `kth-audio://app/audio/v1/...` URLs are stored complete. */
  downloadsPresent(urls: string[]): Promise<string[]>;
  /** Start fetching files one after another (resumes: complete files are skipped). Poll `downloadsProgress`. */
  downloadsFetch(files: { url: string; bytes: number; sha256?: string }[]): Promise<{ jobId: string }>;
  /** `code`: 'offline' | 'network' | 'not_found' | 'size' | 'checksum' | 'no_source' | 'bad_url'. A finished job is forgotten after one read. */
  downloadsProgress(jobId: string): Promise<{ state: 'running' | 'done' | 'failed' | 'cancelled'; loaded: number; error?: string; code?: string }>;
  /** Abort the in-flight request, drop its partial file, keep finished files. */
  downloadsCancel(jobId: string): Promise<void>;
  downloadsRemove(urls: string[]): Promise<void>;
  /** Free bytes on the volume holding the downloads, or null. */
  downloadsFreeBytes(): Promise<number | null>;
  downloadsUsage(): Promise<{ bytes: number; files: number }>;
}

export type { AudioSiteConfig };
