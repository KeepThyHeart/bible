/**
 * Speech recognition contracts (engine level).
 *
 * Pure types, no behaviour. Engines that take PCM (Whisper, Moonshine) sit behind
 * ISttEngine; engines that capture the microphone themselves (Web Speech) sit
 * behind IListener. The extension-facing API is in ./apiTypes.
 */

import type { IAssetCache, IRegistry, LoadProgress } from '../audio/types';

export type { IAssetCache, IRegistry, LoadProgress };

/** How an engine can be biased toward expected words. */
export type SttBiasing = 'none' | 'prompt' | 'phrases';

export interface SttCapabilities {
  streaming: boolean;
  partials: boolean;
  wordTimestamps: boolean;
  wordConfidence: boolean;
  biasing: SttBiasing;
  onDevice: boolean;
  offline: boolean;
  needsDownload: boolean;
  /** BCP-47 tags. */
  languages: string[];
}

export interface SttModel {
  id: string;
  label: string;
  languages: string[];
  downloadBytes: number;
  quality: 'low' | 'medium' | 'high';
  license?: string;
}

export interface RecognizedWord {
  text: string;
  /** Seconds from the start of the audio. */
  start?: number;
  end?: number;
  /** 0..1 */
  confidence?: number;
}

export interface Transcript {
  text: string;
  words: RecognizedWord[];
  final: boolean;
  engineId: string;
  modelId: string;
  audioMs: number;
  decodeMs: number;
}

/** How much of the expected text is offered to the engine as a hint. */
export type SpeechBiasLevel = 'none' | 'names' | 'vocabulary' | 'full';

/** Names and rare words to favour; never in verse order except level 'full' (measurement only). */
export interface SpeechBias {
  phrases: string[];
  level?: SpeechBiasLevel;
}

export interface SttEngineConfig {
  id: string;
  enabled: boolean;
  /** Where the engine's runtime and model files are served from. */
  assetBase: string;
  /** Default model id per language subtag, e.g. `{ "en": "tiny.en" }`. */
  models?: Record<string, string>;
  cache?: IAssetCache;
}

/** PCM engines (Whisper, Moonshine, whisper.cpp). */
export interface ISttEngine {
  readonly id: string;
  readonly label: string;
  readonly capabilities: SttCapabilities;
  isSupported(): Promise<boolean>;
  listModels(): Promise<SttModel[]>;
  isModelReady(modelId: string): Promise<boolean>;
  prepare(modelId: string, onProgress: (p: LoadProgress) => void, signal: AbortSignal): Promise<void>;
  transcribe(
    pcm: Float32Array,
    req: { language: string; bias?: SpeechBias },
    signal: AbortSignal,
  ): Promise<Transcript>;
  dispose(): void;
}

/** 16 kHz mono Float32 frames. */
export interface IMicrophone {
  open(o: { echoCancellation: boolean; noiseSuppression: boolean }, signal: AbortSignal): Promise<MicStream>;
}

export interface MicStream {
  onFrame(cb: (f: Float32Array) => void): () => void;
  close(): void;
}

export interface IVoiceActivityDetector {
  reset(): void;
  process(frame: Float32Array): 'speech' | 'silence';
}

export interface ListenOptions {
  language: string;
  bias?: SpeechBias;
  /** Nobody spoke (default 8000). */
  noSpeechTimeoutMs: number;
  /** A pause that ends one utterance (default 1500). */
  endSilenceMs: number;
  maxDurationMs: number;
  /** Early stop: the caller says "last word reached"; end silence then drops to 700 ms. */
  isComplete?(partial: Transcript): boolean;
  onPartial?(t: Transcript): void;
}

export type ListenOutcome =
  | { kind: 'speech'; transcript: Transcript }
  | { kind: 'no-speech' }
  | { kind: 'aborted' }
  | { kind: 'error'; code: 'mic-denied' | 'mic-busy' | 'engine' | 'network'; message: string };

/** The main seam: one utterance in, one transcript out. */
export interface IListener {
  /** 'pcm:whisper', 'webspeech' */
  readonly id: string;
  readonly capabilities: SttCapabilities;
  listen(o: ListenOptions, signal: AbortSignal): Promise<ListenOutcome>;
}

/** Built on the audio Bible's ITtsEngine and IAudioOutput. */
export interface ISpeaker {
  speak(
    text: string,
    o: { language: string; voiceId?: string; rate?: number },
    signal: AbortSignal,
  ): Promise<void>;
  earcon(kind: 'listen' | 'ok' | 'miss' | 'done'): Promise<void>;
}

export interface SttEngineFactory {
  id: string;
  label: string;
  load(c: SttEngineConfig): Promise<ISttEngine>;
}

export type SttEngineRegistry = IRegistry<SttEngineFactory>;
export type ListenerRegistry = IRegistry<IListener>;
