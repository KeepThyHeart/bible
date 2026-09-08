import { create } from 'zustand';
import { updatePanelState } from './helpers/panelStateHelpers';
import { createPanelSlice } from './helpers/createPanelSlice';

import { markSessionDirty } from './helpers/sessionNotifier';

/**
 * `localStorage` key holding the verse each Study panel was last showing.
 *
 * The Study pane's verse is deliberately NOT part of `SessionData`: that
 * interface lives in `@bible/core` and is shared with the session database, and
 * the Study pane does not own a slot in it. `localStorage` is the same place the
 * web app keeps its Study pane state (`bible-reader-study`), so the two apps
 * restore in the same way and neither needs a schema change.
 */
const STORAGE_KEY_STUDY_VERSES = 'study-pane-verses';

/** Read the persisted panelId -> verseId map. Never throws. */
function readPersistedVerses(): Record<string, number> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_STUDY_VERSES);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = value;
    }
    return out;
  } catch {
    // Corrupt or unavailable storage is never fatal - the pane just starts
    // from the Bible pane's verse instead.
    return {};
  }
}

/** Remember the verse a panel is showing, so the next launch can restore it. */
function persistPanelVerse(panelId: string, verseId: number | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const map = readPersistedVerses();
    if (verseId && verseId > 0) map[panelId] = verseId;
    else delete map[panelId];
    window.localStorage.setItem(STORAGE_KEY_STUDY_VERSES, JSON.stringify(map));
  } catch {
    // Hardened/private contexts can refuse writes; losing the restore point is
    // not worth failing navigation over.
  }
}

/** Test seam: forget every persisted Study verse. */
export function clearPersistedStudyVerses(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_STUDY_VERSES);
  } catch {
    /* ignore */
  }
}

/**
 * Navigation stack entry types for the Study Pane
 */
export type StudyNavEntry =
  | { type: 'verse'; verseId: number }
  | { type: 'commentary-detail'; verseId: number; commentaryAbbreviation: string; entryId: number };

/**
 * Per-panel state for one Study Pane instance
 */
export interface StudyPanelState {
  currentVerseId: number | null;
  pinned: boolean;
  suggestionVerseId: number | null;
  navStack: StudyNavEntry[];
  navIndex: number; // current position in navStack (-1 = empty)
  sectionsCollapsed: Record<string, boolean>;
}

function createDefaultPanelState(): StudyPanelState {
  return {
    currentVerseId: null,
    pinned: false,
    suggestionVerseId: null,
    navStack: [],
    navIndex: -1,
    sectionsCollapsed: {},
  };
}

interface StudyStoreState {
  // Per-instance state
  panels: Map<string, StudyPanelState>;

  // Panel lifecycle
  initPanel: (panelId: string) => void;
  destroyPanel: (panelId: string) => void;
  getPanelState: (panelId: string) => StudyPanelState;

  // Verse sync (broadcast to all unpinned panels)
  syncAllPanelsWithVerse: (verseId: number) => void;

  /**
   * Offer a verse without moving to it.
   *
   * Used for preview navigation - the reader followed a cross-reference or a
   * topic's passage and is glancing at it, so this pane keeps showing what it
   * was showing and raises the suggestion banner instead. See
   * `stores/bible/slices/previewSlice.ts`.
   */
  suggestPanelsWithVerse: (verseId: number) => void;

  // Give a freshly opened panel something to show
  seedInitialVerse: (panelId: string, fallbackVerseId: number | null) => void;

  // Per-panel actions
  navigateToVerse: (panelId: string, verseId: number) => void;
  clearVerse: (panelId: string) => void;
  dismissSuggestion: (panelId: string) => void;
  acceptSuggestion: (panelId: string) => void;
  goBack: (panelId: string) => void;
  goForward: (panelId: string) => void;
  togglePin: (panelId: string) => void;
  openCommentaryDetail: (panelId: string, verseId: number, abbreviation: string, entryId: number) => void;
  toggleSection: (panelId: string, sectionKey: string) => void;
}

const panelSlice = createPanelSlice(createDefaultPanelState);

export const useStudyStore = create<StudyStoreState>((set, get) => ({
  panels: new Map(),
  ...panelSlice(set as any, get as any),

  /**
   * Follow the Bible pane's verse.
   *
   * An unpinned Study pane tracks the selected verse directly - that is the
   * whole point of the pane, and it is what the web app does
   * (`studyStore.loadForVerse` returns early only when pinned). Raising a
   * "See study for X" banner instead would mean the pane silently showed
   * stale data for every verse after the first.
   *
   * A pinned pane stays where the user pinned it and gets the banner, which is
   * the desktop equivalent of the web's "Pinned to X - Sync to Y" bar.
   */
  syncAllPanelsWithVerse: (verseId: number) => {
    const { panels } = get();
    for (const [panelId, ps] of panels.entries()) {
      if (ps.pinned) {
        // Nothing to offer when the pin is already on this verse.
        const suggestion = ps.currentVerseId === verseId ? null : verseId;
        set({ panels: updatePanelState(get().panels, panelId, { suggestionVerseId: suggestion }, createDefaultPanelState) });
        continue;
      }
      if (ps.currentVerseId === verseId) continue;
      get().navigateToVerse(panelId, verseId);
    }
  },

  suggestPanelsWithVerse: (verseId: number) => {
    const { panels } = get();
    for (const [panelId, ps] of panels.entries()) {
      // Nothing to offer when this pane is already on that verse.
      const suggestion = ps.currentVerseId === verseId ? null : verseId;
      set({ panels: updatePanelState(get().panels, panelId, { suggestionVerseId: suggestion }, createDefaultPanelState) });
    }
  },

  /**
   * Give a newly mounted panel a verse to show.
   *
   * Preference order: the verse this panel was showing when the app last
   * closed, then whatever the Bible pane is anchored on. A panel that already
   * has a verse is left alone, so this is safe to call from an effect that
   * re-runs as the Bible pane loads.
   */
  seedInitialVerse: (panelId: string, fallbackVerseId: number | null) => {
    const ps = get().getPanelState(panelId);
    if (ps.currentVerseId !== null) return;

    const remembered = readPersistedVerses()[panelId];
    const verseId = remembered ?? fallbackVerseId;
    if (!verseId || verseId <= 0) return;

    get().navigateToVerse(panelId, verseId);
  },

  navigateToVerse: (panelId: string, verseId: number) => {
    const ps = get().getPanelState(panelId);
    const entry: StudyNavEntry = { type: 'verse', verseId };

    // Truncate forward history and push
    const newStack = [...ps.navStack.slice(0, ps.navIndex + 1), entry];
    const newIndex = newStack.length - 1;

    set({
      panels: updatePanelState(get().panels, panelId, {
        currentVerseId: verseId,
        suggestionVerseId: null,
        navStack: newStack,
        navIndex: newIndex,
      }, createDefaultPanelState)
    });
    persistPanelVerse(panelId, verseId);
    markSessionDirty();
  },

  /**
   * Drop back to the empty state and forget the restore point, so the next
   * launch does not resurrect a verse the user explicitly cleared.
   */
  clearVerse: (panelId: string) => {
    set({
      panels: updatePanelState(get().panels, panelId, {
        currentVerseId: null,
        suggestionVerseId: null,
        navStack: [],
        navIndex: -1,
      }, createDefaultPanelState)
    });
    persistPanelVerse(panelId, null);
    markSessionDirty();
  },

  dismissSuggestion: (panelId: string) => {
    set({ panels: updatePanelState(get().panels, panelId, { suggestionVerseId: null }, createDefaultPanelState) });
  },

  /**
   * Take the offered verse. A pinned pane is released first - the offer only
   * appears because the pin is holding the pane back, and accepting it is the
   * same gesture as the web's "Sync to X" button, which calls `unpin()`.
   */
  acceptSuggestion: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    if (!ps.suggestionVerseId) return;
    if (ps.pinned) {
      set({ panels: updatePanelState(get().panels, panelId, { pinned: false }, createDefaultPanelState) });
    }
    get().navigateToVerse(panelId, ps.suggestionVerseId);
  },

  goBack: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    if (ps.navIndex <= 0) return;

    const newIndex = ps.navIndex - 1;
    const entry = ps.navStack[newIndex];
    const verseId = entry.type === 'verse' ? entry.verseId : entry.verseId;

    set({
      panels: updatePanelState(get().panels, panelId, {
        navIndex: newIndex,
        currentVerseId: verseId,
      }, createDefaultPanelState)
    });
    persistPanelVerse(panelId, verseId);
    markSessionDirty();
  },

  goForward: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    if (ps.navIndex >= ps.navStack.length - 1) return;

    const newIndex = ps.navIndex + 1;
    const entry = ps.navStack[newIndex];
    const verseId = entry.type === 'verse' ? entry.verseId : entry.verseId;

    set({
      panels: updatePanelState(get().panels, panelId, {
        navIndex: newIndex,
        currentVerseId: verseId,
      }, createDefaultPanelState)
    });
    persistPanelVerse(panelId, verseId);
    markSessionDirty();
  },

  togglePin: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    set({
      panels: updatePanelState(get().panels, panelId, {
        pinned: !ps.pinned,
        suggestionVerseId: null, // Clear suggestion when toggling pin
      }, createDefaultPanelState)
    });
    markSessionDirty();
  },

  openCommentaryDetail: (panelId: string, verseId: number, abbreviation: string, entryId: number) => {
    const ps = get().getPanelState(panelId);
    const entry: StudyNavEntry = { type: 'commentary-detail', verseId, commentaryAbbreviation: abbreviation, entryId };

    const newStack = [...ps.navStack.slice(0, ps.navIndex + 1), entry];
    const newIndex = newStack.length - 1;

    set({
      panels: updatePanelState(get().panels, panelId, {
        navStack: newStack,
        navIndex: newIndex,
      }, createDefaultPanelState)
    });
    markSessionDirty();
  },

  toggleSection: (panelId: string, sectionKey: string) => {
    const ps = get().getPanelState(panelId);
    set({
      panels: updatePanelState(get().panels, panelId, {
        sectionsCollapsed: {
          ...ps.sectionsCollapsed,
          [sectionKey]: !ps.sectionsCollapsed[sectionKey],
        },
      }, createDefaultPanelState)
    });
  },
}));
