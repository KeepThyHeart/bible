/**
 * A presentation session that lives entirely in this page.
 *
 * It runs the same pure reducer the server runs (`present/reducer.ts`), so a
 * local wall behaves exactly like a shared one: same clamping, same
 * highlight merging, same "a new item clears the highlights". There is no
 * server, no join code and no viewers; state persists in `localStorage` so a
 * reload lands back on the same verse.
 *
 * Two users, on purpose kept apart from any page UI:
 *  - the solo viewer (`/present/solo`, see `solo.tsx`);
 *  - the Presenter's pre-live preview, which rehearses against a local
 *    session before a real one exists.
 *
 * Framework-free (a plain store with `subscribe`), so it works from a preact
 * hook (`useLocalSession`) or from a store class alike, and is testable
 * without a DOM. `sink` keeps one identity for the life of the session.
 */

import { API_BASE } from '../../utils/apiUrl';
import type { PresentItem, PresentState } from '../protocol';
import { DEFAULT_FONT_STEP, MAX_FONT_STEP, MIN_FONT_STEP } from '../protocol';
import type { IntentSink } from '../intentSink';
import { applyIntent, validateHighlight, validateIntent, validateItem, type IntentContext } from '../reducer';

export const LOCAL_SESSION_STORAGE_KEY = 'present-local-session';
const STORAGE_VERSION = 1;

/** The state a fresh local session starts in: a real (non-null) state with nothing on the wall. */
export function initialLocalState(): PresentState {
  return {
    version: 0,
    live: null,
    position: { index: 0, highlights: [] },
    display: { fontStep: DEFAULT_FONT_STEP, blanked: false, theme: 'light' },
    session: { id: 'local', joinCode: '', joinsLocked: false, viewerCount: 0 },
  };
}

export interface LocalSessionOptions {
  /** Where to persist; default `window.localStorage` when reachable. `null` disables persistence. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  storageKey?: string;
  /** Chapter length / hymn slide count lookups for the reducer; default learns them over the network. */
  context?: IntentContext;
  /** Set false to skip the network-backed default context's prefetching (tests). */
  fetchLengths?: boolean;
}

export interface LocalSession {
  /** Current state. Replaced (never mutated) on every accepted intent. */
  getState(): PresentState;
  /** Called after every change; returns the unsubscribe. */
  subscribe(listener: (state: PresentState) => void): () => void;
  /** Feed an intent to the reducer. One stable identity for the session's life. */
  readonly sink: IntentSink;
  /** Back to an empty wall, and forget the saved copy. */
  reset(): void;
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // Blocked storage can throw on access itself.
  }
}

/**
 * Parse a saved copy, rebuilding it field by field rather than trusting it:
 * what comes back from storage may be from an older build, hand-edited or
 * truncated, and a wall must open on something valid or on nothing. Returns
 * null for anything unusable.
 */
export function parseSavedState(raw: string | null): PresentState | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as { v?: unknown; state?: Record<string, any> } | null;
    const s = data?.state;
    if (!data || data.v !== STORAGE_VERSION || !s || typeof s !== 'object') return null;

    const live: PresentItem | null = s.live === null ? null : validateItem(s.live);
    if (s.live !== null && !live) return null;

    const pos = s.position;
    if (!pos || !Number.isInteger(pos.index) || pos.index < 0 || pos.index > 200) return null;
    const highlights = Array.isArray(pos.highlights)
      ? pos.highlights.map(validateHighlight).filter((h: unknown): h is NonNullable<typeof h> => h !== null)
      : [];

    const d = s.display;
    const theme = d?.theme === 'dark' || d?.theme === 'max' ? d.theme : 'light';
    const fontStep = Number.isInteger(d?.fontStep)
      ? Math.min(MAX_FONT_STEP, Math.max(MIN_FONT_STEP, d.fontStep)) : DEFAULT_FONT_STEP;

    const base = initialLocalState();
    return {
      ...base,
      version: Number.isInteger(s.version) && s.version >= 0 ? s.version : 0,
      live,
      position: { index: pos.index, highlights },
      display: { fontStep, blanked: d?.blanked === true, theme },
    };
  } catch {
    return null;
  }
}

export function createLocalSession(options: LocalSessionOptions = {}): LocalSession {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const key = options.storageKey ?? LOCAL_SESSION_STORAGE_KEY;

  const chapterLengths = new Map<string, number>();
  const slideCounts = new Map<string, number>();
  const asked = new Set<string>();
  const context: IntentContext = options.context ?? {
    chapterLength: (module, book, chapter) => chapterLengths.get(`${module}/${book}/${chapter}`) ?? null,
    slideCount: (hymnId, order) => slideCounts.get(`${hymnId}|${(order ?? []).join(' ')}`) ?? null,
  };
  const learn = !options.context && options.fetchLengths !== false && typeof fetch === 'function';

  const listeners = new Set<(state: PresentState) => void>();

  const load = (): PresentState => {
    try {
      return parseSavedState(storage?.getItem(key) ?? null) ?? initialLocalState();
    } catch {
      return initialLocalState();
    }
  };
  let state = load();

  const save = (): void => {
    try {
      storage?.setItem(key, JSON.stringify({ v: STORAGE_VERSION, state }));
    } catch { /* Full or blocked storage: the session simply is not remembered. */ }
  };

  /** Learn the size of what is on the wall, so `next` knows where the end is. Best-effort. */
  const warm = (item: PresentItem | null): void => {
    if (!learn || !item) return;
    if (item.kind === 'passage') {
      const k = `${item.module}/${item.book}/${item.chapter}`;
      if (asked.has(k)) return;
      asked.add(k);
      fetch(`${API_BASE}/api/bible/${encodeURIComponent(item.module)}/${item.book}/${item.chapter}`)
        .then(res => (res.ok ? res.json() as Promise<{ verses?: unknown[] }> : null))
        .then(body => { if (Array.isArray(body?.verses) && body.verses.length > 0) chapterLengths.set(k, body.verses.length); })
        .catch(() => { /* The reducer's fallback cap applies instead. */ });
    } else if (item.kind === 'hymn') {
      const order = item.verseOrder ?? [];
      const k = `${item.hymnId}|${order.join(' ')}`;
      if (asked.has(k)) return;
      asked.add(k);
      const q = order.length ? `?order=${encodeURIComponent(order.join(' '))}` : '';
      fetch(`${API_BASE}/api/hymns/${encodeURIComponent(item.hymnId)}${q}`)
        .then(res => (res.ok ? res.json() as Promise<{ slides?: unknown[] }> : null))
        .then(body => { if (Array.isArray(body?.slides)) slideCounts.set(k, body.slides.length); })
        .catch(() => { /* Stays on slide 0, as an unknown hymn does. */ });
    }
  };

  const commit = (next: PresentState): void => {
    state = next;
    save();
    for (const listener of [...listeners]) listener(state);
  };

  // Stable for the life of the session: the viewer's pointer layer registers
  // key handlers against the sink, and must not re-register on every render.
  const sink: IntentSink = raw => {
    const intent = validateIntent(raw);
    if (!intent) return;
    if (intent.type === 'show') warm(intent.item);
    const next = applyIntent(state, intent, context);
    if (!next) return;
    // The server stamps the version; here we are the server.
    commit({ ...next, version: state.version + 1 } as PresentState);
  };

  warm(state.live);

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    sink,
    reset() {
      try { storage?.removeItem(key); } catch { /* ignore */ }
      commit(initialLocalState());
    },
  };
}
