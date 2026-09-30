/**
 * The registry entry for Piper. It declares what is known without loading any
 * engine code (speed range, languages), so the speed control and the settings
 * screen render first; `load` pulls in `PiperEngine` on first use.
 */

import type { TtsEngineFactory } from '@bible/core/browser';
import { PIPER_LANGUAGES, PIPER_RUNTIME_BYTES } from './piperConfig';

export const piperFactory: TtsEngineFactory = {
  id: 'piper',
  label: 'Piper',
  capabilities: {
    // length_scale is divided by the rate, so speed changes without pitch artefacts.
    rate: { min: 0.5, max: 2, step: 0.1 },
    nativeRate: true,
    languages: PIPER_LANGUAGES,
    backends: ['wasm'],
    approxRuntimeBytes: PIPER_RUNTIME_BYTES,
  },
  async load(config) {
    const { PiperEngine } = await import('./PiperEngine');
    return new PiperEngine(config);
  },
};
