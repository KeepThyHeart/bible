/**
 * An `ITtsEngine` that loads its adapter code on first use.
 *
 * Engines are registered as `TtsEngineFactory`s so that a site which never
 * plays on-device speech never downloads an engine's code. The provider and the
 * settings screen still need the engine's capabilities and voice list up front,
 * and both are static (the factory declares the capabilities, the site
 * configuration lists the voices), so those answer without loading anything.
 * Everything else waits for the real engine.
 */

import type {
  AudioVoice,
  ITtsEngine,
  LoadProgress,
  SynthesisRequest,
  SynthesisResult,
  TtsEngineCapabilities,
  TtsEngineConfig,
  TtsEngineFactory,
} from '@bible/core/browser';

export class LazyTtsEngine implements ITtsEngine {
  readonly id: string;
  readonly label: string;
  readonly capabilities: TtsEngineCapabilities;
  private loaded: Promise<ITtsEngine> | null = null;

  constructor(private readonly factory: TtsEngineFactory, private readonly config: TtsEngineConfig) {
    this.id = factory.id;
    this.label = factory.label;
    this.capabilities = factory.capabilities;
  }

  private engine(): Promise<ITtsEngine> {
    if (!this.loaded) {
      this.loaded = this.factory.load(this.config);
      // A failed load may be retried by the next call.
      this.loaded.catch(() => { this.loaded = null; });
    }
    return this.loaded;
  }

  async listVoices(): Promise<AudioVoice[]> {
    return this.config.voices.map(({ files: _files, ...voice }) => voice);
  }

  async isSupported(): Promise<boolean> {
    try { return await (await this.engine()).isSupported(); } catch { return false; }
  }

  async isVoiceReady(voiceId: string): Promise<boolean> {
    return (await this.engine()).isVoiceReady(voiceId);
  }

  async prepare(voiceId: string, onProgress: (p: LoadProgress) => void, signal: AbortSignal): Promise<void> {
    return (await this.engine()).prepare(voiceId, onProgress, signal);
  }

  async synthesize(req: SynthesisRequest, signal: AbortSignal): Promise<SynthesisResult> {
    return (await this.engine()).synthesize(req, signal);
  }

  async evictVoice(voiceId: string): Promise<void> {
    return (await this.engine()).evictVoice(voiceId);
  }

  dispose(): void {
    const loaded = this.loaded;
    this.loaded = null;
    void loaded?.then(e => e.dispose(), () => {});
  }
}
