/** A deterministic engine for tests: a quiet sine whose length is known from the text. */

import type { AudioVoice, ITtsEngine, SynthesisRequest, SynthesisResult, TtsEngineCapabilities } from '../core';
import type { EngineDefinition } from '../engines/types';

export const FAKE_RATE = 16000;
/** Seconds per character: a 10-character verse is exactly 0.1 s. */
export const SECONDS_PER_CHAR = 0.01;

export class FakeEngine implements ITtsEngine {
  readonly id = 'fake';
  readonly label = 'Fake';
  readonly capabilities: TtsEngineCapabilities = { rate: null, nativeRate: false, languages: ['en'], backends: [], approxRuntimeBytes: 0 };
  readonly calls: SynthesisRequest[] = [];
  failOn?: (text: string) => boolean;
  /** Silence this long at both ends of every clip, seconds (to test trimming). */
  edgeSilence = 0;

  async isSupported(): Promise<boolean> { return true; }
  async listVoices(): Promise<AudioVoice[]> { return [{ id: 'v1', label: 'V1', language: 'en-US' }]; }
  async isVoiceReady(): Promise<boolean> { return true; }
  async prepare(): Promise<void> {}
  async synthesize(req: SynthesisRequest): Promise<SynthesisResult> {
    this.calls.push(req);
    if (this.failOn?.(req.text)) throw new Error(`fake engine failure on "${req.text}"`);
    const speech = Math.round(req.text.length * SECONDS_PER_CHAR * FAKE_RATE);
    const edge = Math.round(this.edgeSilence * FAKE_RATE);
    const pcm = new Float32Array(speech + 2 * edge);
    for (let i = 0; i < speech; i++) pcm[edge + i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / FAKE_RATE);
    return { pcm, sampleRate: FAKE_RATE };
  }
  async evictVoice(): Promise<void> {}
  dispose(): void {}
}

export const fakeDefinition: EngineDefinition = {
  id: 'fake',
  label: 'Fake',
  languages: ['en'],
  voices: [{ id: 'v1', label: 'V1', language: 'en-US' }, { id: 'v2', label: 'V2', language: 'en-US' }],
  defaultVoice: () => 'v1',
  checkVoice: id => (id === 'v1' || id === 'v2' ? undefined : `unknown fake voice ${id}`),
  modelLabel: () => 'fake-model',
  memoryMbPerJob: () => 1,
  nominalRtf: () => 0.1,
  async credits() {
    return {
      engine: { name: 'Fake engine', license: 'MIT' },
      model: { name: 'fake-model', license: 'MIT' },
      voice: { name: 'Fake voice', license: 'MIT' },
    };
  },
  create: () => new FakeEngine(),
};
