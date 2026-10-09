/**
 * The memory core's speech port on desktop (tasks 0114, 0151).
 *
 * A built-in module needs no permissions, so both are granted. When the `recite` flag has the
 * speech module running, calls go to the shared renderer engine through the speech hub; otherwise
 * listening and speaking report `unavailable` and the recite screens explain that.
 */

import type { ISpeechApi } from '@bible/core/speech';
import { scopedSpeech } from '../speech/hub';

export const SPEECH_UNAVAILABLE = 'Speech recognition is not available in this build yet.';

const GRANTED = { listen: true, speak: true } as const;

export function createDesktopSpeech(get: () => ISpeechApi | null = () => scopedSpeech('app:memory')): ISpeechApi {
  const use = <T>(fn: (s: ISpeechApi) => Promise<T>): Promise<T> => {
    const s = get();
    return s ? fn(s) : Promise.reject(new Error(SPEECH_UNAVAILABLE));
  };
  return {
    status: async () => {
      const s = get();
      if (s) return { ...(await s.status()), granted: { ...GRANTED } };
      return {
        granted: { ...GRANTED },
        listen: 'unavailable',
        speak: 'unavailable',
        languages: [],
        engineLabel: '',
        onDevice: true,
      };
    },
    speak: (text, o) => use((s) => s.speak(text, o)),
    earcon: (kind) => use((s) => s.earcon(kind)),
    startListening: (o) => use((s) => s.startListening(o)),
    nextUtterance: (id, o) => use((s) => s.nextUtterance(id, o)),
    stopListening: async (id) => void (await get()?.stopListening(id)),
    cancel: async () => void (await get()?.cancel()),
  };
}
