/**
 * @bible/audio: the Audio Bible engine shared by the web and desktop apps. No UI and no
 * app code: each app adapts its reader (`ports.ts`), supplies its config and asset
 * environment (`bootstrap.ts`, `createPiperFactory`) and draws its own player.
 * Piper's engine and worker are behind `@bible/audio/piper` and a lazy import, so a
 * page that never speaks never loads them.
 */
export * from './Store';
export * from './ports';
export * from './AudioStore';
export * from './AudioPlayer';
export * from './AudioSourceResolver';
export * from './AssetCache';
export * from './audioPrefs';
export * from './passageQueue';
export * from './audioSettings';
export * from './audioShortcuts';
export * from './audioStorage';
export * from './bootstrap';
export * from './CdnAudioLocator';
export * from './HtmlAudioOutput';
export { HttpManifestSource, networkError, type FetchFn } from './HttpManifestSource';
export * from './MediaSessionBridge';
export * from './RecordedAudioProvider';
export * from './registries';
export * from './sourceChoice';
export * from './wav';
export * from './tts/LazyTtsEngine';
export * from './tts/pronunciationStore';
export * from './tts/TtsAudioProvider';
export { TtsChapterAudio, type LookAhead, type TtsChapterOptions } from './tts/TtsChapterAudio';
export * from './tts/ttsErrors';
export * from './tts/visibility';
export * from './tts/WorkerTtsEngine';
export type * from './tts/ttsWorkerProtocol';
export * from './tts/piper/piperConfig';
export * from './tts/piper/piperAssets';
export { piperFactory, createPiperFactory, type PiperEnv } from './tts/piper/piperFactory';
export type { PiperAssetPort, PiperEngineOptions } from './tts/piper/PiperEngine';
export type { PiperStorage } from './tts/piper/piperHandlers';
export * from './downloads/audioDownloads';
export * from './downloads/cacheDownloadStore';
export { AUDIO_CACHE_NAMES, AUDIO_DOWNLOADS_CACHE } from './cacheNames';
