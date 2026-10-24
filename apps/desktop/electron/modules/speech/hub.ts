/**
 * Where the rest of main finds the speech service. One renderer engine is shared by Scripture
 * memory and every extension, so each caller gets a scoped view: it can only touch its own listens,
 * and `cancel()` stops only what it started.
 */
import type { ISpeechApi } from '@bible/core/speech';

let main: ISpeechApi | null = null;
let gone: (() => void) | null = null;

interface Activity {
  listens: Set<string>;
  speaking: number;
}
const activity = new Map<string, Activity>();

export function setMainSpeech(api: ISpeechApi | null, onWindowGone?: () => void): void {
  main = api;
  gone = onWindowGone ?? null;
  if (!api) activity.clear();
}

/** The shared service, or null when the `recite` flag is off or the module has not loaded. */
export function getMainSpeech(): ISpeechApi | null {
  return main;
}

/** The main window closed: reject pending calls and forget caller state. */
export function notifySpeechWindowGone(): void {
  activity.clear();
  gone?.();
}

function activityOf(callerId: string): Activity {
  let a = activity.get(callerId);
  if (!a) activity.set(callerId, (a = { listens: new Set(), speaking: 0 }));
  return a;
}

function othersActive(callerId: string): boolean {
  for (const [id, a] of activity) if (id !== callerId && (a.listens.size > 0 || a.speaking > 0)) return true;
  return false;
}

/** A view of the shared service for one caller, or null when it is not available. */
export function scopedSpeech(callerId: string): ISpeechApi | null {
  const base = main;
  if (!base) return null;
  const mine = activityOf(callerId);
  const speaking = async <T>(fn: () => Promise<T>): Promise<T> => {
    mine.speaking++;
    try {
      return await fn();
    } finally {
      mine.speaking--;
    }
  };
  return {
    status: () => base.status(),
    speak: (text, o) => speaking(() => base.speak(text, o)),
    earcon: (kind) => speaking(() => base.earcon(kind)),
    async startListening(o) {
      const r = await base.startListening(o);
      mine.listens.add(r.listenId);
      return r;
    },
    async nextUtterance(listenId, o) {
      if (!mine.listens.has(listenId)) throw new Error('Unknown listen id.');
      const r = await base.nextUtterance(listenId, o);
      if (r.kind === 'ended' || r.kind === 'error') mine.listens.delete(listenId);
      return r;
    },
    async stopListening(listenId) {
      if (!mine.listens.has(listenId)) return;
      mine.listens.delete(listenId);
      await base.stopListening(listenId);
    },
    async cancel() {
      const ids = [...mine.listens];
      mine.listens.clear();
      for (const id of ids) await base.stopListening(id);
      // The engine has one speech output: cancel it only when nobody else is using it.
      if (mine.speaking > 0 && !othersActive(callerId)) await base.cancel();
    },
  };
}
