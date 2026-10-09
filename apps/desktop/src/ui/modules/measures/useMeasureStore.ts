/**
 * Weights, measures and money popups (task 0069): renderer state.
 *
 * Holds the reader's measure preferences (per device, saved in the session
 * blob like the keyword-mark switches) and, per Bible tab, the current
 * chapter's marks. Marks are computed at render time from the chapter on screen
 * and never stored as highlights.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
  loadChapterOccurrences,
  resolveMeasurePreferences,
  type InterlinearSpan,
  type MeasureOccurrence,
  type MeasurePreferences,
  type MeasureSurface,
} from '@bible/core/browser';
import { isEnabled } from '../../settings/featureFlags';
import { claimRestoredSessionSection, registerSessionSerializer } from '../../stores/helpers/sessionRegistry';
import { markSessionDirty } from '../../stores/helpers/sessionNotifier';
import { interlinearToSpans, type PaneVerse } from '../../extensions/chapterLayers';
import { computeMeasureChapter, type MeasureChapter } from './measureLayer';

import { MEASURES_SESSION_KEY } from './manifest';

export const MEASURES_SESSION_VERSION = 1;

export interface MeasuresSessionData {
  version: number;
  values: Record<string, unknown>;
}

export interface SyncMeasureParams {
  tabId: string;
  moduleId: number;
  /** Module abbreviation, used to fetch interlinear rows. */
  abbreviation: string;
  language: string;
  bookNumber: number;
  chapter: number;
  verses: readonly PaneVerse[];
  surface: MeasureSurface;
  uiLocale: string;
  /** Interlinear rows the surface already holds; when absent they are fetched if the chapter has occurrences. */
  interlinear?: InterlinearSpan[];
}

export interface MeasureDeps {
  loadOccurrences: (bookNumber: number, chapter: number, includeDrafts: boolean) => Promise<MeasureOccurrence[]>;
  fetchInterlinear: (abbreviation: string, bookNumber: number, chapter: number) => Promise<Parameters<typeof interlinearToSpans>[0]>;
  /** Feature flag `measureDrafts`. */
  includeDrafts: () => boolean;
}

export interface MeasureState {
  /** Raw `measures*` setting values (defaults fill in what is absent). */
  values: Record<string, unknown>;
  /** Current chapter marks per tab (transient). */
  chapters: Record<string, MeasureChapter | undefined>;

  setValue(key: string, value: unknown): void;
  loadFromSession(data: unknown): void;
  getSessionData(): MeasuresSessionData;
  resolvedPrefs(uiLocale: string): MeasurePreferences;

  syncChapter(params: SyncMeasureParams): void;
  clearChapter(tabId: string): void;
}

export function createMeasureStore(deps: MeasureDeps): UseBoundStore<StoreApi<MeasureState>> {
  const occCache = new Map<string, Promise<MeasureOccurrence[]>>();
  const rowCache = new Map<string, InterlinearSpan[] | Promise<InterlinearSpan[]>>();
  /** Latest sync request per tab, so a late load recomputes the chapter now on screen. */
  const latest = new Map<string, SyncMeasureParams>();

  return create<MeasureState>((set, get) => {
    const setChapter = (tabId: string, chapter: MeasureChapter | undefined): void => {
      if (chapter === undefined && !get().chapters[tabId]) return;
      set((s) => ({ chapters: { ...s.chapters, [tabId]: chapter } }));
    };

    const recompute = (tabId: string, occurrences: MeasureOccurrence[]): void => {
      const req = latest.get(tabId);
      if (!req) return;
      const prefs = get().resolvedPrefs(req.uiLocale);
      if (!prefs.enabled || prefs.display === 'off' || occurrences.length === 0) {
        setChapter(tabId, undefined);
        return;
      }
      const cached = rowCache.get(`${req.abbreviation}|${req.bookNumber}|${req.chapter}`);
      const rows = req.interlinear ?? (Array.isArray(cached) ? cached : undefined);
      setChapter(tabId, computeMeasureChapter({
        moduleId: req.moduleId, language: req.language, verses: req.verses, occurrences,
        ...(rows ? { interlinear: rows } : {}),
        uiLocale: req.uiLocale, prefs, surface: req.surface,
      }));
    };

    const run = (tabId: string): void => {
      const req = latest.get(tabId);
      if (!req) return;
      const prefs = get().resolvedPrefs(req.uiLocale);
      if (!prefs.enabled || prefs.display === 'off' || req.verses.length === 0) {
        setChapter(tabId, undefined);
        return;
      }
      const drafts = deps.includeDrafts();
      const occKey = `${req.bookNumber}|${req.chapter}|${drafts}`;
      let occP = occCache.get(occKey);
      if (!occP) {
        occP = deps.loadOccurrences(req.bookNumber, req.chapter, drafts).catch((): MeasureOccurrence[] => []);
        occCache.set(occKey, occP);
      }
      void occP.then(async (occurrences) => {
        if (latest.get(tabId) !== req) return; // a newer chapter or surface is on screen
        const key = `${req.abbreviation}|${req.bookNumber}|${req.chapter}`;
        if (occurrences.length > 0 && !req.interlinear && req.abbreviation && !rowCache.has(key)) {
          const p = deps.fetchInterlinear(req.abbreviation, req.bookNumber, req.chapter)
            .then((byVerse) => interlinearToSpans(byVerse))
            .catch((): InterlinearSpan[] => []);
          rowCache.set(key, p);
          const spans = await p;
          rowCache.set(key, spans);
          if (latest.get(tabId) !== req) return;
        } else if (rowCache.get(key) instanceof Promise) {
          await rowCache.get(key);
          if (latest.get(tabId) !== req) return;
        }
        recompute(tabId, occurrences);
      });
    };

    return {
      values: {},
      chapters: {},

      setValue(key, value) {
        set((s) => ({ values: { ...s.values, [key]: value } }));
        for (const id of latest.keys()) run(id);
        markSessionDirty();
      },

      loadFromSession(data) {
        const d = data as Partial<MeasuresSessionData> | null | undefined;
        if (!d || typeof d !== 'object' || !d.values || typeof d.values !== 'object') return;
        const values: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(d.values)) if (k.startsWith('measures')) values[k] = v;
        set({ values });
        for (const id of latest.keys()) run(id);
      },

      getSessionData() {
        return { version: MEASURES_SESSION_VERSION, values: get().values };
      },

      resolvedPrefs(uiLocale) {
        return resolveMeasurePreferences(get().values, uiLocale, { includeDrafts: deps.includeDrafts() });
      },

      syncChapter(params) {
        latest.set(params.tabId, params);
        run(params.tabId);
      },

      clearChapter(tabId) {
        latest.delete(tabId);
        setChapter(tabId, undefined);
      },
    };
  });
}

export const useMeasureStore = createMeasureStore({
  loadOccurrences: (bookNumber, chapter, includeDrafts) => {
    return loadChapterOccurrences(bookNumber, chapter, { includeDrafts });
  },
  fetchInterlinear: async (abbreviation, bookNumber, chapter) => {
    const { bibleAPI } = await import('../../services/electronAPI');
    return (await bibleAPI.getInterlinearWordsForChapter(abbreviation, bookNumber, chapter)) as Awaited<ReturnType<MeasureDeps['fetchInterlinear']>>;
  },
  includeDrafts: () => isEnabled('measureDrafts'),
});

registerSessionSerializer(MEASURES_SESSION_KEY, () => useMeasureStore.getState().getSessionData());
// The saved preferences arrive when the session is restored (or at once, when it already was).
claimRestoredSessionSection(MEASURES_SESSION_KEY, (data) => useMeasureStore.getState().loadFromSession(data));
