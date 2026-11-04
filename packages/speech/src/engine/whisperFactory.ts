import type { ISttEngine, SttEngineConfig, SttEngineFactory } from '@bible/core/speech';
import { WhisperEngine, type WhisperEngineOptions } from './WhisperEngine';

/** Registry entry for the Whisper engine. Ports supply the model-file source, ORT location and device probe. */
export function whisperFactory(deps: WhisperEngineOptions): SttEngineFactory {
  return {
    id: 'whisper',
    label: 'Whisper (on-device)',
    async load(c: SttEngineConfig): Promise<ISttEngine> {
      if (!c.enabled) throw new Error('Whisper engine is disabled');
      return new WhisperEngine(deps);
    },
  };
}
