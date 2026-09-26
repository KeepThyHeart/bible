/**
 * Audio Bible contracts.
 *
 * Everything that renders, fetches, caches or times audio sits behind one of
 * the interfaces in this file, so that any one of them can be swapped without
 * touching the rest:
 *
 *   IAudioProvider    where a chapter's audio comes from (recorded files, or a TTS engine)
 *   ITtsEngine        a text-to-speech engine adapter (Piper first; Kokoro drops in later)
 *   IManifestSource   where recorded chapters' timing manifests come from
 *   IAudioLocator     the hosting / URL scheme of recorded files
 *   IAssetCache       where downloaded audio, manifests and models are kept
 *   ITextPreparer     verse markup to speakable text
 *   IAudioOutput      the thing that actually makes sound (an <audio> element today)
 *   IAudioPlayer      transport, position and verse events, over all of the above
 *   IMediaSessionBridge  lock-screen / hardware-key controls
 *   IAudioSourceResolver  which provider plays which translation
 *
 * The file is pure TypeScript: no DOM, no Node. It is part of the browser
 * barrel, so the web app (and, later, the desktop renderer) can share it. Types
 * that a browser has natively (`MediaMetadataInit`, `Response`) are replaced by
 * small structural equivalents here for that reason.
 */

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** A chapter of one translation. `book` is the 1-66 book number. */
export interface ChapterRef {
  moduleAbbr: string;
  book: number;
  chapter: number;
}

export interface VerseRef extends ChapterRef {
  verse: number;
}

/** Seconds, relative to the start of the segment that carries it. */
export interface VerseTiming {
  verse: number;
  start: number;
  end: number;
}

export interface RateRange {
  min: number;
  max: number;
  step: number;
}

export interface AudioCapabilities {
  /** null: the speed control is hidden. */
  rate: RateRange | null;
  /** `player`: HTMLMediaElement.playbackRate; `engine`: the engine's own length scale. */
  rateMode: 'player' | 'engine';
  /** Show a voice picker. */
  voices: boolean;
  /** Synthesized on this device: show the battery notice on phones. */
  onDevice: boolean;
  /** Can be cached for offline use. */
  offline: boolean;
  /** An engine or voice must be fetched before the first play. */
  needsDownload: boolean;
}

export interface AudioVoice {
  id: string;
  label: string;
  /** BCP-47, e.g. "en-US". */
  language: string;
  quality?: 'low' | 'medium' | 'high';
  downloadBytes?: number;
  license?: string;
  sampleUrl?: string;
}

export type LoadPhase = 'config' | 'engine' | 'voice' | 'manifest' | 'audio' | 'synthesis';

export interface LoadProgress {
  phase: LoadPhase;
  loaded: number;
  total?: number;
}

export type AudioErrorCode =
  | 'network'        // a fetch failed (offline, server error)
  | 'not-found'      // no recording / manifest for this chapter
  | 'decode'         // the media element could not play the data
  | 'unsupported'    // this browser cannot run the engine or codec
  | 'engine'         // the TTS engine failed
  | 'autoplay'       // the browser refused to start playback
  | 'aborted'        // cancelled by the caller (never shown to the user)
  | 'unknown';

export interface AudioError {
  code: AudioErrorCode;
  message: string;
  /** True when retrying the same request may succeed. */
  retryable: boolean;
}

/** Verse text as the text preparer receives it. */
export interface VerseText {
  verse: number;
  text: string;
  /** The module's markup, when the caller has it. */
  html?: string;
}

// ---------------------------------------------------------------------------
// Audio provider (recorded and TTS are both just providers)
// ---------------------------------------------------------------------------

export interface AudioSegment {
  id: string;
  /** https:, same-origin path, or blob: (a synthesized WAV). */
  url: string;
  mime: string;
  /** Where to start inside this segment, seconds. */
  offset: number;
  duration?: number;
  verses: VerseTiming[];
  /** Revoke blob URLs. Called once the segment is no longer needed. */
  release?(): void;
}

export interface IChapterAudio {
  readonly ref: ChapterRef;
  /** Verse numbers that have audio, ascending. */
  readonly verses: readonly number[];
  segmentFor(verse: number, signal: AbortSignal): Promise<AudioSegment>;
  /** The segment following `seg`, or null at the end of the chapter. */
  segmentAfter(seg: AudioSegment, signal: AbortSignal): Promise<AudioSegment | null>;
  dispose(): void;
}

export interface OpenChapterOptions {
  /** A narrator id (recorded) or a voice id (TTS). Undefined: the provider's default. */
  voiceId?: string;
  rate: number;
  /** Speak "Book, chapter N" first when starting at the chapter's first verse. Default true. */
  readIntro?: boolean;
  onProgress?(p: LoadProgress): void;
}

export interface IAudioProvider {
  /** `recorded`, `tts:piper`, `tts:kokoro`, ... */
  readonly id: string;
  readonly kind: 'recorded' | 'tts';
  readonly label: string;
  capabilities(moduleAbbr: string): AudioCapabilities;
  supports(moduleAbbr: string, language: string): Promise<boolean>;
  voices(moduleAbbr: string, language: string): Promise<AudioVoice[]>;
  /** False: the first play downloads something. */
  isReady(voiceId?: string): Promise<boolean>;
  prepare(voiceId: string | undefined, onProgress: (p: LoadProgress) => void, signal: AbortSignal): Promise<void>;
  openChapter(ref: ChapterRef, opts: OpenChapterOptions, signal: AbortSignal): Promise<IChapterAudio>;
  prefetch?(ref: ChapterRef, opts: OpenChapterOptions, signal: AbortSignal): Promise<void>;
}

// ---------------------------------------------------------------------------
// Recorded channel: manifest, index, URL scheme, cache
// ---------------------------------------------------------------------------

export const CHAPTER_MANIFEST_SCHEMA = 'kth-audio-chapter/1';
export const AUDIO_INDEX_SCHEMA = 'kth-audio-index/1';

export interface ManifestFile {
  codec: string;
  /** e.g. `audio/ogg; codecs=opus`, `audio/mpeg`. */
  mime: string;
  /** Path relative to the chapter's directory. */
  path: string;
  bytes: number;
  sha256?: string;
}

/** `[verse, start, end]`, seconds from the start of the file. Psalm titles are verse 0. */
export type ManifestVerse = [verse: number, start: number, end: number];

export interface ChapterManifest {
  schema: typeof CHAPTER_MANIFEST_SCHEMA;
  module: string;
  book: number;
  chapter: number;
  narrator: string;
  /** The audio build; part of the immutable URL. */
  rev: string;
  /** Hash of the chapter text the audio was made from; detects module text changes. */
  textHash?: string;
  duration: number;
  files: ManifestFile[];
  /** The spoken "Book, chapter N" lead-in, when the recording has one. */
  intro?: [start: number, end: number];
  verses: ManifestVerse[];
}

export interface AudioNarrator {
  id: string;
  label: string;
  /** BCP-47. */
  language: string;
  /** The current audio build for this narrator. */
  rev: string;
  /** Books (1-66) with every chapter recorded. */
  books: number[];
  /** Partial books: book number (as a string key) to the chapters recorded. */
  chapters?: Record<string, number[]>;
}

/** `index.json` of one translation: the only mutable file of a published build. */
export interface TranslationAudioIndex {
  schema: typeof AUDIO_INDEX_SCHEMA;
  module: string;
  narrators: AudioNarrator[];
}

export interface IManifestSource {
  /** null: this translation has no recordings. */
  translationIndex(moduleAbbr: string, signal: AbortSignal): Promise<TranslationAudioIndex | null>;
  /** null: this chapter is not recorded. */
  chapter(ref: ChapterRef, narrator: AudioNarrator, signal: AbortSignal): Promise<ChapterManifest | null>;
}

/** The hosting / URL scheme. Swap it to move recordings to another host or layout. */
export interface IAudioLocator {
  indexUrl(moduleAbbr: string): string;
  manifestUrl(ref: ChapterRef, narratorId: string, rev: string): string;
  fileUrl(manifest: ChapterManifest, file: ManifestFile): string;
}

/** The subset of `Response` the audio code reads, so core needs no DOM types. */
export interface CachedResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  blob(): Promise<Blob>;
  arrayBuffer(): Promise<ArrayBuffer>;
  clone(): CachedResponse;
}

/** Cache API wrapper shared by manifests, audio and engine models. */
export interface IAssetCache {
  get(key: string): Promise<CachedResponse | undefined>;
  put(key: string, res: CachedResponse): Promise<void>;
  has(key: string): Promise<boolean>;
  /** Delete every entry whose key starts with `prefix`; returns how many. */
  delete(prefix: string): Promise<number>;
  /** Bytes held under `prefix`, for the settings screen. */
  usage(prefix: string): Promise<number>;
  /** Keys under `prefix`, least recently stored or touched first. */
  keys(prefix: string): Promise<string[]>;
  /** Mark `key` as just used, so a size-limited cleanup evicts it last. */
  touch(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// TTS engine adapter
// ---------------------------------------------------------------------------

export interface TtsEngineCapabilities {
  rate: RateRange | null;
  /** True: the engine changes speed without pitch artefacts. */
  nativeRate: boolean;
  /** BCP-47 language subtags the engine can speak. */
  languages: string[];
  backends: Array<'wasm' | 'webgpu'>;
  approxRuntimeBytes: number;
}

export interface SynthesisRequest {
  text: string;
  voiceId: string;
  rate: number;
}

export interface SynthesisResult {
  pcm: Float32Array;
  sampleRate: number;
  /** Optional sentence boundaries, seconds. */
  sentences?: Array<{ start: number; end: number }>;
}

export interface ITtsEngine {
  /** `piper`, `kokoro`, ... */
  readonly id: string;
  readonly label: string;
  readonly capabilities: TtsEngineCapabilities;
  /** WASM, memory and WebGPU checks. */
  isSupported(): Promise<boolean>;
  /** From app config, filtered to what the engine can run. */
  listVoices(): Promise<AudioVoice[]>;
  isVoiceReady(voiceId: string): Promise<boolean>;
  prepare(voiceId: string, onProgress: (p: LoadProgress) => void, signal: AbortSignal): Promise<void>;
  synthesize(req: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult>;
  evictVoice(voiceId: string): Promise<void>;
  dispose(): void;
}

/** Verse markup to speakable text; per language. */
export interface ITextPreparer {
  /** "John, chapter 3." */
  chapterIntro(ref: ChapterRef, bookName: string): string;
  /** Strips notes, Strong's numbers and tags. */
  verse(raw: VerseText, language: string): string;
}

// ---------------------------------------------------------------------------
// Playback layer
// ---------------------------------------------------------------------------

export type PlayerStatus = 'idle' | 'preparing' | 'buffering' | 'playing' | 'paused' | 'error';

export interface PlayerState {
  status: PlayerStatus;
  providerId: string | null;
  voiceId: string | null;
  current: VerseRef | null;
  /** Chapter-relative seconds. */
  position: number;
  duration: number | null;
  rate: number;
  progress: LoadProgress | null;
  error: AudioError | null;
}

export interface IAudioPlayer {
  readonly state: PlayerState;
  play(from: VerseRef, provider: IAudioProvider, opts: OpenChapterOptions): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  seekVerse(delta: 1 | -1): Promise<void>;
  seekChapter(delta: 1 | -1): Promise<void>;
  setRate(rate: number): void;
  on(e: 'state', cb: (s: PlayerState) => void): () => void;
  on(e: 'verse', cb: (v: VerseRef) => void): () => void;
  on(e: 'chapterEnd', cb: (next: ChapterRef | null) => void): () => void;
}

/** HtmlAudioOutput today; a Web Audio output is possible behind the same seam. */
export interface IAudioOutput {
  load(seg: AudioSegment): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  readonly currentTime: number;
  rate: number;
  onTime(cb: (t: number) => void): () => void;
  onEnded(cb: () => void): () => void;
  onError(cb: (e: AudioError) => void): () => void;
}

/** What the lock screen shows. Structurally a `MediaMetadataInit`. */
export interface AudioMediaMetadata {
  title: string;
  artist: string;
  album: string;
  artwork?: Array<{ src: string; sizes?: string; type?: string }>;
}

export interface IMediaSessionBridge {
  attach(player: IAudioPlayer, describe: (v: VerseRef) => AudioMediaMetadata): () => void;
}

// ---------------------------------------------------------------------------
// Registries, configuration and source resolution
// ---------------------------------------------------------------------------

export interface IRegistry<T extends { id: string }> {
  /** Returns an unregister function, like the plugin registries. */
  register(item: T): () => void;
  get(id: string): T | undefined;
  list(): T[];
}

/** One voice as the site configuration names it; `files` are relative to the engine's `assetBase`. */
export interface TtsVoiceConfig extends AudioVoice {
  files: string[];
}

export interface TtsEngineConfig {
  id: string;
  enabled: boolean;
  /** Where the engine's runtime and voice files are served from (same origin by default). */
  assetBase: string;
  voices: TtsVoiceConfig[];
  /** Language subtag to voice id, e.g. `{ "en": "en_US-amy-medium" }`. */
  defaultVoices?: Record<string, string>;
}

/** The `audio` block of `/api/config`. */
export interface AudioSiteConfig {
  /** Base URL of recordings, e.g. `/audio`. */
  base: string;
  /** The recorded channel is registered when true. */
  recorded: boolean;
  /** Enabled engines, in order of preference. */
  engines: TtsEngineConfig[];
}

export interface TtsEngineFactory {
  id: string;
  label: string;
  /** Lazy: the engine code loads on first use. */
  load(config: TtsEngineConfig): Promise<ITtsEngine>;
}

export type AudioSourceChoice = 'auto' | 'recorded' | `tts:${string}`;

export interface AudioPrefs {
  source: AudioSourceChoice;
  perTranslation: Record<string, { source?: AudioSourceChoice; voiceId?: string }>;
  /** `piper:en` to voice id. */
  voiceByEngineLang: Record<string, string>;
  rate: number;
  /** Highlight the verse being read (the real selection never moves). */
  followAlong: boolean;
  /** Scroll to the playing verse; pauses for a few seconds after the user scrolls. */
  autoScroll: boolean;
  continueAfterChapter: 'next-chapter' | 'stop';
  readChapterIntro: boolean;
  /** Per engine id: the battery notice has been acknowledged. */
  phoneBatteryNoticeSeen: Record<string, boolean>;
}

export interface SourceResolution {
  provider: IAudioProvider;
  voiceId?: string;
  reason: 'preferred' | 'auto-recorded' | 'auto-tts' | 'fallback';
  /** Shown when a preference could not be honoured. */
  notice?: string;
}

export interface IAudioSourceResolver {
  /** null: nothing can play this translation. */
  resolve(moduleAbbr: string, language: string, prefs: AudioPrefs): Promise<SourceResolution | null>;
  options(moduleAbbr: string, language: string): Promise<Array<{ provider: IAudioProvider; voices: AudioVoice[] }>>;
}
