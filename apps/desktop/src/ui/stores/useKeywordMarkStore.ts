/**
 * Keyword marks (task 0065): renderer state.
 *
 * Holds the keyword sets (via core's `KeywordSetService` over the IPC store),
 * per-Bible-tab switches, the colour-safe setting and, per tab, the current
 * chapter's match. Marks are computed at render time from the chapter on screen
 * and never stored as highlights; only the switches persist (session).
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
  KeywordSetService,
  nextFreeColor,
  newKeywordId,
  normalizeToken,
  occurrencesOf,
  suggestKeywords,
  type ChapterInput,
  type KeywordMark,
  type KeywordSet,
  type KeywordSuggestion,
  type KeywordValidationError,
  type IKeywordSetStore,
  type InterlinearSpan,
} from '@bible/core/browser';
import { registerSessionSerializer } from './helpers/sessionRegistry';
import { markSessionDirty } from './helpers/sessionNotifier';
import { keywordSetsAPI } from '../services/keywordSetsAPI';
import {
  DEFAULT_TAB_STATE,
  buildChapterInput,
  computeChapterMarks,
  interlinearToSpans,
  legendRowsFor,
  resolveActiveSetIds,
  resolveActiveSets,
  type ChapterMarks,
  type LegendRow,
  type PaneVerse,
  type TabKeywordState,
} from '../extensions/keywordMarkLayer';

export const USER_SET_NAME = 'My keywords';
export const KEYWORD_SESSION_VERSION = 1;

export interface KeywordSessionData {
  version: number;
  colorSafe: boolean;
  tabs: Record<string, TabKeywordState>;
}

export interface SyncChapterParams {
  tabId: string;
  moduleId: number;
  /** Module abbreviation, used to fetch interlinear rows. */
  abbreviation: string;
  language: string;
  bookNumber: number;
  chapter: number;
  verses: readonly PaneVerse[];
  /** Interlinear rows the surface already holds (Study); when absent they are fetched if a mark needs them. */
  interlinear?: InterlinearSpan[];
}

export interface KeywordMarkDeps {
  store: IKeywordSetStore;
  /** `{verseId: rows[]}` for a chapter, as `bible:getInterlinearWordsForChapter` returns it. */
  fetchInterlinear: (abbreviation: string, bookNumber: number, chapter: number) => Promise<Parameters<typeof interlinearToSpans>[0]>;
}

export interface KeywordMarkState {
  sets: KeywordSet[];
  loaded: boolean;
  colorSafe: boolean;
  tabs: Record<string, TabKeywordState>;
  /** Current chapter match per tab (transient). */
  chapters: Record<string, ChapterMarks | undefined>;

  load(): Promise<void>;
  loadFromSession(data: unknown): void;
  getSessionData(): KeywordSessionData;

  getTabState(tabId: string): TabKeywordState;
  toggleTab(tabId: string): void;
  setTabEnabled(tabId: string, enabled: boolean): void;
  setActiveSets(tabId: string, setIds: string[] | null): void;
  toggleMark(tabId: string, markId: string): void;
  setColorSafe(colorSafe: boolean): void;
  removeTab(tabId: string): void;

  /** Recompute the tab's marks for the chapter on screen (fetching interlinear rows when a mark needs them). */
  syncChapter(params: SyncChapterParams): void;
  clearChapter(tabId: string): void;

  // Selectors for the UI.
  getActiveSetIds(tabId: string): string[];
  getLegendRows(tabId: string): LegendRow[];
  getOccurrences(tabId: string, markId: string): { verseId: number; start: number; end: number }[];
  getSuggestions(tabId: string): KeywordSuggestion[];

  /**
   * Save an edited or new mark. Marks of a built-in (read-only) set are copied into "My keywords" under a new id
   * and the original is hidden for the tab; `setId` omitted means "My keywords".
   */
  saveMark(tabId: string, mark: KeywordMark, setId?: string): Promise<KeywordMark>;
  deleteMark(setId: string, markId: string): Promise<void>;
  duplicateSet(setId: string): Promise<KeywordSet>;
  removeSet(setId: string): Promise<void>;
  /** JSON text of a set, for the export file. */
  exportSet(setId: string): string;
  importSet(json: string): Promise<KeywordSet | KeywordValidationError[]>;

  /** Create or reuse a mark for a word / Strong's number in the user's "My keywords" set and switch the tab on. */
  addMarkFromWord(
    tabId: string,
    word: { text: string; strongs?: string },
    kind: 'word' | 'strongs',
  ): Promise<KeywordMark | null>;
}

interface PendingSync extends SyncChapterParams { rows?: InterlinearSpan[] }

function sameRule(a: KeywordMark['rule'], b: KeywordMark['rule']): boolean {
  if (a.kind === 'word' && b.kind === 'word') return a.forms.join('|') === b.forms.join('|');
  if (a.kind === 'strongs' && b.kind === 'strongs') return a.numbers.join('|') === b.numbers.join('|');
  return false;
}

export function createKeywordMarkStore(deps: KeywordMarkDeps): UseBoundStore<StoreApi<KeywordMarkState>> {
  const service = new KeywordSetService(deps.store);
  /** Interlinear rows per `abbreviation|book|chapter`; a failed or empty fetch is cached too, so it is not repeated. */
  const rowCache = new Map<string, InterlinearSpan[] | Promise<InterlinearSpan[]>>();
  /** Latest sync request per tab, so a late fetch recomputes the chapter now on screen, not a stale one. */
  const latest = new Map<string, PendingSync>();

  const useStore = create<KeywordMarkState>((set, get) => {
    const patchTab = (tabId: string, patch: Partial<TabKeywordState>): void => {
      set((s) => ({ tabs: { ...s.tabs, [tabId]: { ...(s.tabs[tabId] ?? DEFAULT_TAB_STATE), ...patch } } }));
      recompute(tabId);
      markSessionDirty();
    };

    /** Rebuild a tab's match from its latest request. */
    const recompute = (tabId: string): void => {
      const req = latest.get(tabId);
      const s = get();
      const tab = s.tabs[tabId] ?? DEFAULT_TAB_STATE;
      if (!req || !tab.enabled) {
        if (s.chapters[tabId]) set((st) => ({ chapters: { ...st.chapters, [tabId]: undefined } }));
        return;
      }
      const key = `${req.abbreviation}|${req.bookNumber}|${req.chapter}`;
      const cached = rowCache.get(key);
      const rows = req.interlinear ?? (Array.isArray(cached) ? cached : undefined);
      const input = buildChapterInput(req.moduleId, req.language, req.verses, rows);
      const sets = resolveActiveSets(s.sets, tab, req.language);
      const marks = computeChapterMarks(input, sets, { colorSafe: s.colorSafe, hiddenMarkIds: tab.hiddenMarkIds });
      set((st) => ({ chapters: { ...st.chapters, [tabId]: marks } }));

      const needsRows = marks.result.needsInterlinear || marks.result.wantsInterlinear;
      if (needsRows && !req.interlinear && cached === undefined && req.abbreviation) {
        const p = deps.fetchInterlinear(req.abbreviation, req.bookNumber, req.chapter)
          .then((byVerse) => interlinearToSpans(byVerse))
          .catch((): InterlinearSpan[] => []);
        rowCache.set(key, p);
        void p.then((spans) => {
          rowCache.set(key, spans);
          // Recompute every tab still looking at this chapter.
          for (const [id, r] of latest) {
            if (`${r.abbreviation}|${r.bookNumber}|${r.chapter}` === key) recompute(id);
          }
        });
      }
    };

    const recomputeAll = (): void => { for (const id of latest.keys()) recompute(id); };

    service.subscribe((sets) => {
      set({ sets });
      recomputeAll();
    });

    return {
      sets: [...service.all()],
      loaded: false,
      colorSafe: true,
      tabs: {},
      chapters: {},

      async load() {
        try { await service.load(); } catch (err) { console.warn('[keywordMarks] could not load keyword sets', err); }
        set({ loaded: true, sets: service.all() });
        recomputeAll();
      },

      loadFromSession(data) {
        const d = data as Partial<KeywordSessionData> | null | undefined;
        if (!d || typeof d !== 'object') return;
        const tabs: Record<string, TabKeywordState> = {};
        for (const [id, t] of Object.entries(d.tabs ?? {})) {
          if (!t || typeof t !== 'object') continue;
          tabs[id] = {
            enabled: t.enabled === true,
            activeSetIds: Array.isArray(t.activeSetIds) ? t.activeSetIds.filter((x) => typeof x === 'string') : null,
            hiddenMarkIds: Array.isArray(t.hiddenMarkIds) ? t.hiddenMarkIds.filter((x) => typeof x === 'string') : [],
          };
        }
        set({ tabs, colorSafe: d.colorSafe !== false });
        recomputeAll();
      },

      getSessionData() {
        const tabs: Record<string, TabKeywordState> = {};
        for (const [id, t] of Object.entries(get().tabs)) {
          // Untouched tabs carry nothing worth saving.
          if (t.enabled || t.activeSetIds || t.hiddenMarkIds.length > 0) tabs[id] = t;
        }
        return { version: KEYWORD_SESSION_VERSION, colorSafe: get().colorSafe, tabs };
      },

      getTabState: (tabId) => get().tabs[tabId] ?? DEFAULT_TAB_STATE,

      toggleTab(tabId) { get().setTabEnabled(tabId, !get().getTabState(tabId).enabled); },

      setTabEnabled(tabId, enabled) {
        if (enabled && !get().loaded) void get().load();
        patchTab(tabId, { enabled });
      },

      setActiveSets(tabId, setIds) { patchTab(tabId, { activeSetIds: setIds }); },

      toggleMark(tabId, markId) {
        const hidden = get().getTabState(tabId).hiddenMarkIds;
        patchTab(tabId, { hiddenMarkIds: hidden.includes(markId) ? hidden.filter((m) => m !== markId) : [...hidden, markId] });
      },

      setColorSafe(colorSafe) {
        set({ colorSafe });
        recomputeAll();
        markSessionDirty();
      },

      removeTab(tabId) {
        latest.delete(tabId);
        set((s) => {
          const tabs = { ...s.tabs };
          delete tabs[tabId];
          const chapters = { ...s.chapters };
          delete chapters[tabId];
          return { tabs, chapters };
        });
      },

      syncChapter(params) {
        latest.set(params.tabId, params);
        if (get().getTabState(params.tabId).enabled && !get().loaded) void get().load();
        recompute(params.tabId);
      },

      clearChapter(tabId) {
        latest.delete(tabId);
        if (get().chapters[tabId]) set((s) => ({ chapters: { ...s.chapters, [tabId]: undefined } }));
      },

      getActiveSetIds(tabId) {
        const req = latest.get(tabId);
        return resolveActiveSetIds(get().sets, get().getTabState(tabId), req?.language ?? '');
      },

      getLegendRows(tabId) {
        const marks = get().chapters[tabId];
        return marks ? legendRowsFor(marks, get().getTabState(tabId).hiddenMarkIds) : [];
      },

      getOccurrences(tabId, markId) {
        const marks = get().chapters[tabId];
        return marks ? occurrencesOf(marks.result, markId) : [];
      },

      getSuggestions(tabId) {
        const marks = get().chapters[tabId];
        return marks ? suggestKeywords(marks.input as ChapterInput) : [];
      },

      async saveMark(tabId, mark, setId) {
        await get().load();
        const source = setId ? service.get(setId) : undefined;
        let mine = source && !source.builtIn ? source : service.all().find((s) => !s.builtIn && s.name === USER_SET_NAME);
        let saved = mark;
        if (source?.builtIn) {
          saved = { ...mark, id: newKeywordId('mark') };
          const tab = get().getTabState(tabId);
          patchTab(tabId, { hiddenMarkIds: [...new Set([...tab.hiddenMarkIds, mark.id])] });
        }
        if (!mine) {
          await service.create(USER_SET_NAME, { marks: [saved] });
        } else {
          const marks = mine.marks.some((m) => m.id === saved.id)
            ? mine.marks.map((m) => (m.id === saved.id ? saved : m))
            : [...mine.marks, saved];
          await service.save({ ...mine, marks });
        }
        if (!get().getTabState(tabId).enabled) patchTab(tabId, { enabled: true });
        return saved;
      },

      async deleteMark(setId, markId) {
        const target = service.get(setId);
        if (!target || target.builtIn) return;
        await service.save({ ...target, marks: target.marks.filter((m) => m.id !== markId) });
      },

      duplicateSet: (setId) => service.duplicate(setId),
      removeSet: (setId) => service.remove(setId),
      exportSet: (setId) => service.export(setId),
      importSet: (json) => service.import(json),

      async addMarkFromWord(tabId, word, kind) {
        const text = word.text.trim();
        const rule: KeywordMark['rule'] | null =
          kind === 'strongs'
            ? (word.strongs ? { kind: 'strongs', numbers: [word.strongs.trim()] } : null)
            : (normalizeToken(text) ? { kind: 'word', forms: [normalizeToken(text)] } : null);
        if (!rule) return null;
        await get().load();

        const existing = service.all().flatMap((s) => s.marks.map((m) => ({ set: s, mark: m })))
          .find(({ set: s, mark }) => !s.builtIn && sameRule(mark.rule, rule));
        let target: { set: KeywordSet; mark: KeywordMark };
        if (existing) {
          target = existing;
        } else {
          const mark: KeywordMark = {
            id: newKeywordId('mark'),
            label: kind === 'strongs' ? (text || word.strongs!) : normalizeToken(text),
            rule,
            style: { color: nextFreeColor(resolveActiveSets(service.all(), get().getTabState(tabId), latest.get(tabId)?.language ?? '')), line: 'solid' },
            enabled: true,
          };
          let mine = service.all().find((s) => !s.builtIn && s.name === USER_SET_NAME);
          mine = mine ? await service.addMark(mine.id, mark) : await service.create(USER_SET_NAME, { marks: [mark] });
          target = { set: mine, mark };
        }

        const tab = get().getTabState(tabId);
        patchTab(tabId, {
          enabled: true,
          hiddenMarkIds: tab.hiddenMarkIds.filter((m) => m !== target.mark.id),
          ...(tab.activeSetIds && !tab.activeSetIds.includes(target.set.id)
            ? { activeSetIds: [...tab.activeSetIds, target.set.id] }
            : {}),
        });
        return target.mark;
      },
    };
  });
  return useStore;
}

export const useKeywordMarkStore = createKeywordMarkStore({
  store: keywordSetsAPI,
  fetchInterlinear: async (abbreviation, bookNumber, chapter) => {
    const { bibleAPI } = await import('../services/electronAPI');
    return (await bibleAPI.getInterlinearWordsForChapter(abbreviation, bookNumber, chapter)) as Awaited<ReturnType<KeywordMarkDeps['fetchInterlinear']>>;
  },
});

registerSessionSerializer('keywordMarks', () => useKeywordMarkStore.getState().getSessionData());
