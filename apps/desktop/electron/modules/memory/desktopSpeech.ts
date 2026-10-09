/**
 * The memory core's speech port on desktop (task 0114).
 *
 * A built-in module needs no permissions, so both are granted. The desktop
 * has no speech engines in this build (the extension host's `speech` is the
 * same stub), so listening and speaking report `unavailable` and the recite
 * screens explain that. When an engine lands, this adapter is where it plugs
 * in; the core does not change.
 */

import type { ISpeechApi } from '@bible/core/speech';

export const SPEECH_UNAVAILABLE = 'Speech recognition is not available in this build yet.';

export function createDesktopSpeech(): ISpeechApi {
  const unavailable = async (): Promise<never> => {
    throw new Error(SPEECH_UNAVAILABLE);
  };
  return {
    status: async () => ({
      granted: { listen: true, speak: true },
      listen: 'unavailable',
      speak: 'unavailable',
      languages: [],
      engineLabel: '',
      onDevice: true,
    }),
    speak: unavailable,
    earcon: unavailable,
    startListening: unavailable,
    nextUtterance: unavailable,
    stopListening: async () => undefined,
    cancel: async () => undefined,
  };
}
