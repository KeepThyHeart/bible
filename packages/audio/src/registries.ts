/**
 * The two registries the audio feature is assembled from.
 *
 * `providerRegistry` holds every `IAudioProvider` (the recorded channel and one
 * `tts:<engine>` provider per enabled engine); `engineRegistry` holds the lazy
 * factories that build TTS engines. Both have the shape of the plugin
 * registries, so a plugin can register into them once the interfaces settle.
 * Only `bootstrap.ts` knows the concrete classes that go in.
 */

import { Registry } from '@bible/core/browser';
import type { IAudioProvider, TtsEngineFactory } from '@bible/core/browser';

export type AudioProviderRegistry = Registry<IAudioProvider>;
export type TtsEngineRegistry = Registry<TtsEngineFactory>;

export function createProviderRegistry(): AudioProviderRegistry {
  return new Registry<IAudioProvider>();
}

export function createEngineRegistry(): TtsEngineRegistry {
  return new Registry<TtsEngineFactory>();
}
