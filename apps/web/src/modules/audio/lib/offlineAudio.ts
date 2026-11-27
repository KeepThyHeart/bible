/**
 * Which translations and books have recorded audio saved on this device (the downloads dialog's
 * "downloaded" books), kept in localStorage so it is known at once, offline, before any manifest
 * loads. The downloads model is the truth: every time it (re)reads a translation's books, that
 * translation's entry is rewritten, so an entry the browser has since evicted corrects itself.
 */
import { Store } from '@bible/audio';
import type { AudioDownloadsModel } from '@bible/audio';

const KEY = 'kth.audio.offlineBooks';

class OfflineAudioStore extends Store {
  /** Translation → books (ascending) with audio on this device. */
  byModule: Record<string, number[]> = load();

  set(module: string, books: number[]): void {
    const cur = this.byModule[module] ?? [];
    if (cur.length === books.length && cur.every((b, i) => b === books[i])) return;
    const next = { ...this.byModule };
    if (books.length) next[module] = books; else delete next[module];
    this.byModule = next;
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: in-memory only */ }
    this.notify();
  }

  has(module: string | null | undefined, book?: number | null): boolean {
    const books = module ? this.byModule[module] : undefined;
    return !!books && (book == null || books.includes(book));
  }

  /** Everything saved, as [translation, books] pairs (translations in name order). */
  entries(): Array<[string, number[]]> {
    return Object.entries(this.byModule).sort(([a], [b]) => a.localeCompare(b));
  }
}

function load(): Record<string, number[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const out: Record<string, number[]> = {};
    for (const [m, v] of Object.entries(raw ?? {})) {
      if (Array.isArray(v)) out[m] = v.filter((b): b is number => Number.isInteger(b)).sort((a, b) => a - b);
    }
    return out;
  } catch { return {}; }
}

export const offlineAudio = new OfflineAudioStore();

/** Keep `offlineAudio` in step with what the downloads model reads. Returns the unsubscribe. */
export function trackDownloads(model: AudioDownloadsModel): () => void {
  const sync = () => {
    // Only once every book has been checked: a half-read (or offline, unreadable) list must not wipe the record.
    if (model.loading || !model.module || model.rows.length === 0 || model.run === 'running') return;
    if (model.rows.some(r => r.bytes === null)) return;
    offlineAudio.set(model.module, model.rows.filter(r => r.state === 'downloaded').map(r => r.book).sort((a, b) => a - b));
  };
  sync();
  return model.subscribe(sync);
}

/** True when the browser says it is offline. */
export const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;
