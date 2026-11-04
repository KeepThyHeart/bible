/** Shared types for the on-device speech engine. */

export type SpeechDevice = 'webgpu' | 'wasm';
export type WhisperModelId = 'base' | 'tiny';
export type WhisperVariant = 'q8' | 'f16';

export interface SpeechPrefs {
  model: 'auto' | WhisperModelId;
  device: 'auto' | SpeechDevice;
}

export interface SpeechPrefsStore {
  get(): SpeechPrefs;
  set(prefs: SpeechPrefs): void;
}

export const DEFAULT_SPEECH_PREFS: SpeechPrefs = { model: 'auto', device: 'auto' };
