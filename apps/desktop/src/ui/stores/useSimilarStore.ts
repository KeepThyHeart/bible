import { create } from 'zustand';
import type {
  PassageRange, SimilarOptions, SimilarResult, SimilarRowDto, SimilarUnavailableReason, MatchReason,
} from '../../../electron/ipc/similarTypes';
import { similarAPI } from '../services/electronAPI';
import { useLayoutStore } from './useLayoutStore';

/**
 * Similar passages panels (task 0070): per-panel source range, filters, back stack and result.
 * Panel state is not persisted; a restored panel starts idle until a verse is selected.
 */

export const SIMILAR_PAGE_STEP = 10;
export const SIMILAR_MAX_RESULTS = 50;
export const SIMILAR_DEFAULT_RESULTS = 20;
export const SIMILAR_POLL_MS = 1000;
export const SIMILAR_MAX_POLLS = 60;

export type SimilarTestament = 'any' | 'other' | 'ot' | 'nt';
export type SimilarStatus = 'idle' | 'loading' | 'ready' | 'preparing' | 'unavailable' | 'error';

export interface SimilarFilters {
  hideKnownXrefs: boolean;
  testament: SimilarTestament;
}

export interface SimilarPanelState {
  source: PassageRange | null;
  linked: boolean;
  history: PassageRange[];
  filters: SimilarFilters;
  maxResults: number;
  result: (SimilarResult & { rows: SimilarRowDto[] }) | null;
  status: SimilarStatus;
  unavailableReason: SimilarUnavailableReason | null;
  /** 'timeout' when polling gave up, else an error message. */
  error: string | null;
}

function defaultPanelState(): SimilarPanelState {
  return {
    source: null,
    linked: true,
    history: [],
    filters: { hideKnownXrefs: false, testament: 'any' },
    maxResults: SIMILAR_DEFAULT_RESULTS,
    result: null,
    status: 'idle',
    unavailableReason: null,
    error: null,
  };
}

let resolveModule: () => string | undefined = () => undefined;
/** Wired by `storeSync`: the translation rows are shown in. */
export function setSimilarModuleResolver(fn: () => string | undefined): void {
  resolveModule = fn;
}

export function sameRange(a: PassageRange | null, b: PassageRange | null): boolean {
  return !!a && !!b && a.startVerseId === b.startVerseId && a.endVerseId === b.endVerseId;
}

export function explanationKey(source: PassageRange, row: PassageRange): string {
  return `${source.startVerseId}-${source.endVerseId}|${row.startVerseId}-${row.endVerseId}`;
}

interface SimilarStoreState {
  panels: Map<string, SimilarPanelState>;
  /** Lazily fetched "why" chips, by `explanationKey`. */
  explanations: Map<string, MatchReason[]>;

  getPanelState: (panelId: string) => SimilarPanelState;
  initPanel: (panelId: string) => void;
  destroyPanel: (panelId: string) => void;

  /** Open (or reveal) the panel and show passages similar to `range`. */
  openFor: (range: PassageRange) => void;
  /** A verse was selected in the Bible pane: linked panels follow. */
  followVerse: (verseId: number) => void;
  setLinked: (panelId: string, linked: boolean) => void;
  setFilters: (panelId: string, filters: Partial<SimilarFilters>) => void;
  showMore: (panelId: string) => void;
  moreLike: (panelId: string, range: PassageRange) => void;
  goBack: (panelId: string) => void;
  retry: (panelId: string) => void;
  requestExplanation: (panelId: string, row: PassageRange) => void;
}

// Request bookkeeping outside the store: timers and tokens are not state.
const pollTimers = new Map<string, ReturnType<typeof setTimeout>>();
const requestTokens = new Map<string, number>();
const explainInFlight = new Set<string>();

function cancelPoll(panelId: string): void {
  const t = pollTimers.get(panelId);
  if (t !== undefined) clearTimeout(t);
  pollTimers.delete(panelId);
}

function buildOptions(ps: SimilarPanelState): SimilarOptions {
  return {
    maxResults: ps.maxResults,
    crossRefs: ps.filters.hideKnownXrefs ? 'hide' : 'flag',
    testament: ps.filters.testament,
  };
}

export const useSimilarStore = create<SimilarStoreState>((set, get) => {
  const patch = (panelId: string, changes: Partial<SimilarPanelState>) => {
    const panels = new Map(get().panels);
    const current = panels.get(panelId);
    if (!current) return;
    panels.set(panelId, { ...current, ...changes });
    set({ panels });
  };

  /** Fetch for the panel's current source; polls while the main process prepares data. */
  const load = (panelId: string, polls = 0): void => {
    cancelPoll(panelId);
    const ps = get().panels.get(panelId);
    if (!ps?.source) return;
    const token = (requestTokens.get(panelId) ?? 0) + 1;
    requestTokens.set(panelId, token);
    if (polls === 0) patch(panelId, { status: 'loading', error: null, unavailableReason: null });

    similarAPI.find(ps.source, buildOptions(ps), resolveModule()).then(
      (resp) => {
        if (requestTokens.get(panelId) !== token || !get().panels.has(panelId)) return;
        if (resp.status === 'preparing') {
          if (polls >= SIMILAR_MAX_POLLS) {
            patch(panelId, { status: 'error', error: 'timeout' });
            return;
          }
          patch(panelId, { status: 'preparing' });
          pollTimers.set(panelId, setTimeout(() => load(panelId, polls + 1), SIMILAR_POLL_MS));
        } else if (resp.status === 'unavailable') {
          patch(panelId, { status: 'unavailable', unavailableReason: resp.unavailableReason ?? 'no-data', result: null });
        } else {
          patch(panelId, { status: 'ready', result: resp.result ?? null });
        }
      },
      (err: unknown) => {
        if (requestTokens.get(panelId) !== token || !get().panels.has(panelId)) return;
        patch(panelId, { status: 'error', error: err instanceof Error ? err.message : String(err) });
      },
    );
  };

  const setSource = (panelId: string, range: PassageRange, history: PassageRange[]) => {
    patch(panelId, { source: range, history, maxResults: SIMILAR_DEFAULT_RESULTS });
    load(panelId);
  };

  return {
    panels: new Map(),
    explanations: new Map(),

    getPanelState: (panelId) => get().panels.get(panelId) ?? defaultPanelState(),

    initPanel: (panelId) => {
      if (get().panels.has(panelId)) return;
      const panels = new Map(get().panels);
      panels.set(panelId, defaultPanelState());
      set({ panels });
    },

    destroyPanel: (panelId) => {
      cancelPoll(panelId);
      requestTokens.delete(panelId);
      if (!get().panels.has(panelId)) return;
      const panels = new Map(get().panels);
      panels.delete(panelId);
      set({ panels });
    },

    openFor: (range) => {
      const panelId = useLayoutStore.getState().openSimilarPanel(); // allow-getstate: imperative panel creation
      if (!panelId) return;
      get().initPanel(panelId);
      setSource(panelId, range, []);
    },

    followVerse: (verseId) => {
      const range = { startVerseId: verseId, endVerseId: verseId };
      for (const [panelId, ps] of get().panels) {
        if (!ps.linked || sameRange(ps.source, range)) continue;
        setSource(panelId, range, []);
      }
    },

    setLinked: (panelId, linked) => patch(panelId, { linked }),

    setFilters: (panelId, filters) => {
      const ps = get().panels.get(panelId);
      if (!ps) return;
      patch(panelId, { filters: { ...ps.filters, ...filters }, maxResults: SIMILAR_DEFAULT_RESULTS });
      load(panelId);
    },

    showMore: (panelId) => {
      const ps = get().panels.get(panelId);
      if (!ps || ps.maxResults >= SIMILAR_MAX_RESULTS) return;
      patch(panelId, { maxResults: Math.min(SIMILAR_MAX_RESULTS, ps.maxResults + SIMILAR_PAGE_STEP) });
      load(panelId);
    },

    moreLike: (panelId, range) => {
      const ps = get().panels.get(panelId);
      if (!ps) return;
      const history = ps.source ? [...ps.history, ps.source] : ps.history;
      setSource(panelId, range, history);
    },

    goBack: (panelId) => {
      const ps = get().panels.get(panelId);
      if (!ps || ps.history.length === 0) return;
      const history = ps.history.slice(0, -1);
      setSource(panelId, ps.history[ps.history.length - 1], history);
    },

    retry: (panelId) => load(panelId),

    requestExplanation: (panelId, row) => {
      const source = get().panels.get(panelId)?.source;
      if (!source) return;
      const key = explanationKey(source, row);
      if (get().explanations.has(key) || explainInFlight.has(key)) return;
      explainInFlight.add(key);
      similarAPI.explain(source, row, resolveModule()).then(
        (reasons) => {
          explainInFlight.delete(key);
          const explanations = new Map(get().explanations);
          explanations.set(key, reasons);
          set({ explanations });
        },
        () => {
          explainInFlight.delete(key);
        },
      );
    },
  };
});
