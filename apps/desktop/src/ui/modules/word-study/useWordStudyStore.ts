import { create } from 'zustand';
import { groupFromQuery } from '@bible/core/browser';
import type {
  WordGroup,
  WordKeyCandidate,
  WordOccurrencePage,
  WordStudyOptions,
  WordStudyOverview,
  WordStudySubject,
} from '@bible/core/browser';
import { wordStudyApi } from './wordStudyApi';
import { createPanelSlice } from '../../stores/helpers/createPanelSlice';
import { panelIdsFromLayout, updatePanelState } from '../../stores/helpers/panelStateHelpers';
import { getStagedSession, registerSessionSerializer } from '../../stores/helpers/sessionRegistry';
import { markSessionDirty } from '../../stores/helpers/sessionNotifier';
import { resolveActiveBibleModule } from '../../stores/crossStoreBridge';

/** Occurrences are fetched this many at a time; "load more" appends the next page. */
export const WORD_STUDY_PAGE_SIZE = 100;

export interface WordStudyPanelFilters {
  book?: number;
  form?: string;
}

/** Everything about a pane that survives a restart. Fetched data never does. */
export interface WordStudyPersistedState {
  subject: WordStudySubject | null;
  options: WordStudyOptions;
  filters: WordStudyPanelFilters;
}

export interface WordStudyPanelState extends WordStudyPersistedState {
  query: string;
  candidates: WordKeyCandidate[];
  overview: WordStudyOverview | null;
  occurrences: WordOccurrencePage | null;
  loading: boolean;
  occurrencesLoading: boolean;
  error?: string;
  editingGroup: WordGroup | null;
  /** Subjects studied in this pane, oldest first; `trailIndex` is the one on screen. */
  trail: WordStudySubject[];
  trailIndex: number;
}

export function createDefaultWordStudyPanelState(): WordStudyPanelState {
  return {
    subject: null,
    options: {},
    filters: {},
    query: '',
    candidates: [],
    overview: null,
    occurrences: null,
    loading: false,
    occurrencesLoading: false,
    error: undefined,
    editingGroup: null,
    trail: [],
    trailIndex: -1,
  };
}

/** What a lookup-box submission resolves to. */
export type WordStudyQueryKind = 'strongs' | 'group' | 'lookup';

const STRONGS_PATTERN = /^([GgHh])0*(\d{1,5})$/;
/** Separators that can only mean "a list of words". */
const GROUP_SEPARATORS = /[,;|*\n]/;

/**
 * Decide how to treat lookup-box text without touching the network.
 *
 * - `strongs`: a Strong's number (`G25`, `h0430`); `strongs` holds its normal form.
 * - `group`: an explicit list, wildcard or phrase (`love, loved`, `lov*`, `loving kindness`).
 * - `lookup`: one plain word; ask `wordStudyApi.resolve` whether it names lexicon entries.
 */
export function classifyWordStudyQuery(text: string): { kind: WordStudyQueryKind; strongs?: string } {
  const trimmed = text.trim();
  const m = STRONGS_PATTERN.exec(trimmed);
  if (m) return { kind: 'strongs', strongs: `${m[1].toUpperCase()}${m[2]}` };
  if (GROUP_SEPARATORS.test(trimmed) || /\s/.test(trimmed)) return { kind: 'group' };
  return { kind: 'lookup' };
}

export function sameSubject(a: WordStudySubject | null, b: WordStudySubject | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'strongs' && b.kind === 'strongs') return a.strongs === b.strongs;
  if (a.kind === 'group' && b.kind === 'group') return JSON.stringify(a.group) === JSON.stringify(b.group);
  return false;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Latest request per pane; an older response that arrives after a newer request is dropped. */
const requestSeq = new Map<string, number>();
function bumpSeq(panelId: string): number {
  const n = (requestSeq.get(panelId) ?? 0) + 1;
  requestSeq.set(panelId, n);
  return n;
}
const isStale = (panelId: string, seq: number): boolean => requestSeq.get(panelId) !== seq;

interface WordStudyStoreState {
  panels: Map<string, WordStudyPanelState>;
  /** Saved word groups (shared by every pane). */
  savedGroups: WordGroup[];

  initPanel: (panelId: string) => void;
  detachPanel: (panelId: string) => void;
  destroyPanel: (panelId: string) => void;
  getPanelState: (panelId: string) => WordStudyPanelState;

  setQuery: (panelId: string, query: string) => void;
  setEditingGroup: (panelId: string, group: WordGroup | null) => void;
  /** Study a subject: resets filters, pushes onto the trail and loads. */
  study: (panelId: string, subject: WordStudySubject, options?: WordStudyOptions) => Promise<void>;
  /** Load the pane's subject if it has one and nothing is loaded yet (after a restore). */
  ensureLoaded: (panelId: string) => Promise<void>;
  setModule: (panelId: string, module: string) => Promise<void>;
  setRenderingMode: (panelId: string, mode: 'head' | 'phrase') => Promise<void>;
  setFilters: (panelId: string, filters: WordStudyPanelFilters) => Promise<void>;
  loadMore: (panelId: string) => Promise<void>;
  submitQuery: (panelId: string, text: string) => Promise<void>;
  pickCandidate: (panelId: string, strongs: string) => Promise<void>;
  goBack: (panelId: string) => Promise<void>;
  goForward: (panelId: string) => Promise<void>;

  loadGroups: () => Promise<void>;
  saveGroup: (panelId: string, group: WordGroup) => Promise<void>;
  deleteGroup: (panelId: string, id: string) => Promise<void>;

  /** What a session stores: per-pane subject, options and filters. */
  serializePanels: () => Record<string, WordStudyPersistedState>;
  /** Put saved state into the panes the restored layout contains; ids without a saved entry are left alone. */
  restoreFromSession: (data: unknown, layoutPanelIds: readonly string[]) => void;
}

const panelSlice = createPanelSlice(createDefaultWordStudyPanelState, {
  // A component unmount is not a close: keep what identifies the study, drop fetched data.
  retainOnDetach: (s) => ({
    subject: s.subject,
    options: s.options,
    filters: s.filters,
    query: s.query,
    trail: s.trail,
    trailIndex: s.trailIndex,
  }),
  onDestroy: (panelId) => {
    requestSeq.delete(panelId);
  },
});

export const useWordStudyStore = create<WordStudyStoreState>((set, get) => {
  const patch = (panelId: string, partial: Partial<WordStudyPanelState>): void => {
    set({ panels: updatePanelState(get().panels, panelId, partial, createDefaultWordStudyPanelState) });
  };

  const fetchOccurrences = async (panelId: string, append: boolean, seq: number): Promise<void> => {
    const ps = get().getPanelState(panelId);
    const module = ps.overview?.module;
    if (!ps.subject || !module) {
      patch(panelId, { occurrences: null, occurrencesLoading: false });
      return;
    }
    const offset = append ? ps.occurrences?.items.length ?? 0 : 0;
    patch(panelId, { occurrencesLoading: true, ...(append ? {} : { occurrences: null }) });
    try {
      const page = await wordStudyApi.getOccurrences(ps.subject, {
        module,
        book: ps.filters.book,
        form: ps.filters.form,
        renderingMode: ps.options.renderingMode,
        offset,
        limit: WORD_STUDY_PAGE_SIZE,
      });
      if (isStale(panelId, seq)) return;
      const prior = append ? get().getPanelState(panelId).occurrences : null;
      patch(panelId, {
        occurrences: prior ? { total: page.total, items: [...prior.items, ...page.items] } : page,
        occurrencesLoading: false,
      });
    } catch (e) {
      if (isStale(panelId, seq)) return;
      patch(panelId, { occurrencesLoading: false, error: errorMessage(e) });
    }
  };

  const load = async (panelId: string): Promise<void> => {
    const ps = get().getPanelState(panelId);
    if (!ps.subject) return;
    const seq = bumpSeq(panelId);
    patch(panelId, { loading: true, error: undefined, overview: null, occurrences: null, occurrencesLoading: false });
    try {
      const auto = ps.options.module ? undefined : resolveActiveBibleModule();
      let overview = await wordStudyApi.getOverview(ps.subject, auto ? { ...ps.options, module: auto } : ps.options);
      // The Bible the reader has open may not suit the study (no Strong's tagging): let the service pick.
      if (auto && (overview.notice === 'not-tagged' || overview.notice === 'no-module')) {
        overview = await wordStudyApi.getOverview(ps.subject, ps.options);
      }
      if (isStale(panelId, seq)) return;
      patch(panelId, { overview, loading: false });
    } catch (e) {
      if (isStale(panelId, seq)) return;
      patch(panelId, { loading: false, error: errorMessage(e) });
      return;
    }
    await fetchOccurrences(panelId, false, seq);
  };

  return {
    panels: new Map(),
    savedGroups: [],
    ...panelSlice(set as never, get as never),

    setQuery: (panelId, query) => patch(panelId, { query }),
    setEditingGroup: (panelId, group) => patch(panelId, { editingGroup: group }),

    study: async (panelId, subject, options) => {
      const ps = get().getPanelState(panelId);
      let { trail, trailIndex } = ps;
      if (!sameSubject(trail[trailIndex] ?? null, subject)) {
        trail = [...trail.slice(0, trailIndex + 1), subject];
        trailIndex = trail.length - 1;
      }
      patch(panelId, {
        subject,
        options: options ?? ps.options,
        filters: {},
        candidates: [],
        trail,
        trailIndex,
        query: subject.kind === 'strongs' ? subject.strongs : subject.group.terms.join(', '),
      });
      markSessionDirty();
      await load(panelId);
    },

    ensureLoaded: async (panelId) => {
      const ps = get().getPanelState(panelId);
      if (ps.subject && !ps.overview && !ps.loading && !ps.error) await load(panelId);
    },

    setModule: async (panelId, module) => {
      const ps = get().getPanelState(panelId);
      patch(panelId, { options: { ...ps.options, module }, filters: {} });
      markSessionDirty();
      await load(panelId);
    },

    setRenderingMode: async (panelId, mode) => {
      const ps = get().getPanelState(panelId);
      patch(panelId, { options: { ...ps.options, renderingMode: mode }, filters: { book: ps.filters.book } });
      markSessionDirty();
      await load(panelId);
    },

    setFilters: async (panelId, filters) => {
      patch(panelId, { filters });
      markSessionDirty();
      await fetchOccurrences(panelId, false, bumpSeq(panelId));
    },

    loadMore: async (panelId) => {
      const ps = get().getPanelState(panelId);
      if (ps.occurrencesLoading || !ps.occurrences || ps.occurrences.items.length >= ps.occurrences.total) return;
      await fetchOccurrences(panelId, true, requestSeq.get(panelId) ?? bumpSeq(panelId));
    },

    submitQuery: async (panelId, text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      patch(panelId, { query: trimmed, candidates: [], error: undefined });
      const kind = classifyWordStudyQuery(trimmed);
      if (kind.kind === 'strongs') {
        await get().study(panelId, { kind: 'strongs', strongs: kind.strongs! });
        return;
      }
      if (kind.kind === 'lookup') {
        let candidates: WordKeyCandidate[] = [];
        try {
          candidates = await wordStudyApi.resolve(trimmed);
        } catch {
          // A failed lexicon lookup is not fatal: fall through to studying the word itself.
        }
        if (candidates.length === 1) {
          await get().study(panelId, { kind: 'strongs', strongs: candidates[0].strongs });
          return;
        }
        if (candidates.length > 1) {
          patch(panelId, { candidates });
          return;
        }
      }
      await get().study(panelId, { kind: 'group', group: groupFromQuery(trimmed) });
    },

    pickCandidate: async (panelId, strongs) => {
      await get().study(panelId, { kind: 'strongs', strongs });
    },

    goBack: async (panelId) => {
      const ps = get().getPanelState(panelId);
      if (ps.trailIndex <= 0) return;
      const index = ps.trailIndex - 1;
      patch(panelId, { subject: ps.trail[index], trailIndex: index, filters: {}, candidates: [] });
      markSessionDirty();
      await load(panelId);
    },

    goForward: async (panelId) => {
      const ps = get().getPanelState(panelId);
      if (ps.trailIndex >= ps.trail.length - 1) return;
      const index = ps.trailIndex + 1;
      patch(panelId, { subject: ps.trail[index], trailIndex: index, filters: {}, candidates: [] });
      markSessionDirty();
      await load(panelId);
    },

    loadGroups: async () => {
      try {
        set({ savedGroups: await wordStudyApi.listGroups() });
      } catch (e) {
        console.error('[wordStudy] listGroups failed:', e);
      }
    },

    saveGroup: async (panelId, group) => {
      try {
        const saved = await wordStudyApi.saveGroup({
          ...group,
          ...(group.id ? {} : { id: undefined }),
        } as Partial<WordGroup> & { terms: string[] });
        patch(panelId, { editingGroup: null });
        await get().loadGroups();
        await get().study(panelId, { kind: 'group', group: saved });
      } catch (e) {
        patch(panelId, { error: errorMessage(e) });
      }
    },

    deleteGroup: async (panelId, id) => {
      try {
        await wordStudyApi.deleteGroup(id);
        patch(panelId, { editingGroup: null });
        await get().loadGroups();
      } catch (e) {
        patch(panelId, { error: errorMessage(e) });
      }
    },

    serializePanels: () => {
      const out: Record<string, WordStudyPersistedState> = {};
      for (const [panelId, ps] of get().panels) {
        if (!ps.subject) continue;
        out[panelId] = { subject: ps.subject, options: ps.options, filters: ps.filters };
      }
      return out;
    },

    restoreFromSession: (data, layoutPanelIds) => {
      if (typeof data !== 'object' || data === null) return;
      const entries = data as Record<string, unknown>;
      for (const panelId of layoutPanelIds) {
        const saved = sanitizePersisted(entries[panelId]);
        if (!saved) continue;
        patch(panelId, {
          ...saved,
          query: saved.subject?.kind === 'strongs' ? saved.subject.strongs : saved.subject?.group.terms.join(', ') ?? '',
          trail: saved.subject ? [saved.subject] : [],
          trailIndex: saved.subject ? 0 : -1,
        });
      }
    },
  };
});

function sanitizePersisted(raw: unknown): WordStudyPersistedState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const s = r.subject as Record<string, unknown> | null | undefined;
  let subject: WordStudySubject | null = null;
  if (s && s.kind === 'strongs' && typeof s.strongs === 'string') {
    subject = { kind: 'strongs', strongs: s.strongs };
  } else if (s && s.kind === 'group' && typeof s.group === 'object' && s.group !== null) {
    const g = s.group as Partial<WordGroup>;
    if (Array.isArray(g.terms) && g.terms.every((t) => typeof t === 'string') && g.terms.length > 0) {
      subject = { kind: 'group', group: g as WordGroup };
    }
  }
  if (!subject) return null;
  const o = (typeof r.options === 'object' && r.options !== null ? r.options : {}) as Record<string, unknown>;
  const f = (typeof r.filters === 'object' && r.filters !== null ? r.filters : {}) as Record<string, unknown>;
  const options: WordStudyOptions = {};
  if (typeof o.module === 'string') options.module = o.module;
  if (o.renderingMode === 'head' || o.renderingMode === 'phrase') options.renderingMode = o.renderingMode;
  const filters: WordStudyPanelFilters = {};
  if (typeof f.book === 'number') filters.book = f.book;
  if (typeof f.form === 'string') filters.form = f.form;
  return { subject, options, filters };
}

// Register the session serializer so useSessionStore doesn't import us directly.
registerSessionSerializer('wordStudy', () => ({
  wordStudyPanels: useWordStudyStore.getState().serializePanels(),
}));

// This code loads when a Word study pane first needs it, after the session was read: put the
// panes the restored layout holds back on the subject each one was on (the data is fetched again
// when the pane mounts). The session blob is staged by startup (`stageSessionForModules`).
{
  const staged = getStagedSession();
  const paneIds = panelIdsFromLayout(staged?.dockviewState, ['wordStudy']);
  if (staged && paneIds.length > 0) {
    useWordStudyStore.getState().restoreFromSession(
      (staged.ui as { wordStudyPanels?: unknown } | undefined)?.wordStudyPanels,
      paneIds,
    );
  }
}
