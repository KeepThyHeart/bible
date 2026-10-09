import { DEFAULT_SPEECH_PREFS, type SpeechPrefs, type SpeechPrefsStore } from '../types';

export const SPEECH_PREFS_KEY = 'bible.speech.prefs';

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function sanitize(raw: unknown): SpeechPrefs {
  const r = (raw ?? {}) as Partial<SpeechPrefs>;
  return {
    model: r.model === 'base' || r.model === 'tiny' ? r.model : DEFAULT_SPEECH_PREFS.model,
    device: r.device === 'webgpu' || r.device === 'wasm' ? r.device : DEFAULT_SPEECH_PREFS.device,
  };
}

/** localStorage-backed prefs; a missing or throwing storage degrades to memory. */
export class LocalSpeechPrefs implements SpeechPrefsStore {
  private mem: SpeechPrefs | null = null;

  constructor(private readonly storage?: () => StorageLike | undefined) {}

  private store(): StorageLike | undefined {
    try {
      return this.storage ? this.storage() : globalThis.localStorage;
    } catch {
      return undefined;
    }
  }

  get(): SpeechPrefs {
    if (this.mem) return { ...this.mem };
    try {
      const raw = this.store()?.getItem(SPEECH_PREFS_KEY);
      if (raw) return sanitize(JSON.parse(raw));
    } catch {
      /* fall through to defaults */
    }
    return { ...DEFAULT_SPEECH_PREFS };
  }

  set(prefs: SpeechPrefs): void {
    const clean = sanitize(prefs);
    try {
      const s = this.store();
      if (!s) throw new Error('no storage');
      s.setItem(SPEECH_PREFS_KEY, JSON.stringify(clean));
      this.mem = null;
    } catch {
      this.mem = clean;
    }
  }
}

export function createSpeechPrefs(): SpeechPrefsStore {
  return new LocalSpeechPrefs();
}
