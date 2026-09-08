import { create } from 'zustand';
import { updatePanelState } from './helpers/panelStateHelpers';
import { createPanelSlice } from './helpers/createPanelSlice';

import { markSessionDirty } from './helpers/sessionNotifier';

/**
 * Navigation stack entry types for the Topics Pane
 */
export type TopicsNavEntry =
  | { type: 'browse'; filter?: string; offset?: number }
  | { type: 'topic'; topicId: number; abbreviation: string }
  | { type: 'verse-topics'; verseId: number }
  | { type: 'entity'; entityId: string; entityCategory: string };

/**
 * View mode for the Topics Pane
 */
export type TopicsViewMode = 'browse' | 'topic' | 'verse-topics' | 'entity';

/**
 * Per-panel state for one Topics Pane instance
 */
export interface TopicsPanelState {
  currentView: TopicsViewMode;
  currentTopicId: number | null;
  currentTopicAbbreviation: string | null;
  currentVerseId: number | null;
  currentEntityId: string | null;
  currentEntityCategory: string | null;
  pinned: boolean;
  suggestionVerseId: number | null;
  /**
   * The verse the Bible pane is actually on, tracked whatever this pane is
   * showing and whether or not it is pinned.
   *
   * `currentVerseId` is where the pane *is*; this is where the reader is. The
   * two diverge the moment someone drills into a topic, and without this there
   * was no way back to "topics for the verse I am reading" short of pressing
   * Back until it happened to resurface - see `goHome`.
   */
  liveVerseId: number | null;
  navStack: TopicsNavEntry[];
  navIndex: number;
  sourceFilters: string[]; // abbreviations of enabled sources (empty = all)
  browseOffset: number;
  browseFilter: string;
}

function createDefaultPanelState(): TopicsPanelState {
  return {
    currentView: 'browse',
    currentTopicId: null,
    currentTopicAbbreviation: null,
    currentVerseId: null,
    currentEntityId: null,
    currentEntityCategory: null,
    pinned: false,
    suggestionVerseId: null,
    liveVerseId: null,
    navStack: [{ type: 'browse' }],
    navIndex: 0,
    sourceFilters: [],
    browseOffset: 0,
    browseFilter: '',
  };
}

interface TopicsStoreState {
  // Per-instance state
  panels: Map<string, TopicsPanelState>;

  // Panel lifecycle
  initPanel: (panelId: string) => void;
  destroyPanel: (panelId: string) => void;
  getPanelState: (panelId: string) => TopicsPanelState;

  // Verse sync (broadcast to all unpinned panels)
  syncAllPanelsWithVerse: (verseId: number) => void;

  /**
   * Offer a verse without navigating to it - preview navigation. See
   * `stores/bible/slices/previewSlice.ts`.
   */
  suggestPanelsWithVerse: (verseId: number) => void;

  // Per-panel actions
  navigateToTopic: (panelId: string, topicId: number, abbreviation: string) => void;
  navigateToEntity: (panelId: string, entityId: string, entityCategory: string) => void;
  navigateToBrowse: (panelId: string) => void;
  navigateToVerseTopics: (panelId: string, verseId: number) => void;
  /** Jump to the topics for the verse the Bible pane is on. */
  goHome: (panelId: string) => void;
  setSourceFilter: (panelId: string, sources: string[]) => void;
  setBrowseFilter: (panelId: string, filter: string) => void;
  setBrowseOffset: (panelId: string, offset: number) => void;
  goBack: (panelId: string) => void;
  goForward: (panelId: string) => void;
  togglePin: (panelId: string) => void;
  dismissSuggestion: (panelId: string) => void;
  acceptSuggestion: (panelId: string) => void;
}

const panelSlice = createPanelSlice(createDefaultPanelState);

export const useTopicsStore = create<TopicsStoreState>((set, get) => ({
  panels: new Map(),
  ...panelSlice(set as any, get as any),

  syncAllPanelsWithVerse: (verseId: number) => {
    const { panels } = get();
    for (const [panelId, ps] of panels.entries()) {
      // Recorded even for a pinned pane: pinning says "do not follow me
      // around", not "forget where I am". Home is an explicit request, and it
      // has to have somewhere to go.
      set({ panels: updatePanelState(get().panels, panelId, { liveVerseId: verseId }, createDefaultPanelState) });

      if (ps.pinned) continue;

      // If in browse view (no deep context), navigate directly
      if (ps.currentView === 'browse') {
        get().navigateToVerseTopics(panelId, verseId);
      } else {
        // Show suggestion banner
        set({ panels: updatePanelState(get().panels, panelId, { suggestionVerseId: verseId }, createDefaultPanelState) });
      }
    }
  },

  suggestPanelsWithVerse: (verseId: number) => {
    const { panels } = get();
    for (const [panelId, ps] of panels.entries()) {
      // Home still needs somewhere to go, so the live verse is recorded even
      // though the pane is not being moved.
      const alreadyShowing = ps.currentView === 'verse-topics' && ps.currentVerseId === verseId;
      set({
        panels: updatePanelState(get().panels, panelId, {
          liveVerseId: verseId,
          suggestionVerseId: alreadyShowing ? null : verseId,
        }, createDefaultPanelState),
      });
    }
  },

  navigateToTopic: (panelId: string, topicId: number, abbreviation: string) => {
    const ps = get().getPanelState(panelId);
    const entry: TopicsNavEntry = { type: 'topic', topicId, abbreviation };

    const newStack = [...ps.navStack.slice(0, ps.navIndex + 1), entry];
    const newIndex = newStack.length - 1;

    set({
      panels: updatePanelState(get().panels, panelId, {
        currentView: 'topic',
        currentTopicId: topicId,
        currentTopicAbbreviation: abbreviation,
        suggestionVerseId: null,
        navStack: newStack,
        navIndex: newIndex,
      }, createDefaultPanelState)
    });
    markSessionDirty();
  },

  navigateToEntity: (panelId: string, entityId: string, entityCategory: string) => {
    const ps = get().getPanelState(panelId);
    const entry: TopicsNavEntry = { type: 'entity', entityId, entityCategory };

    const newStack = [...ps.navStack.slice(0, ps.navIndex + 1), entry];
    const newIndex = newStack.length - 1;

    set({
      panels: updatePanelState(get().panels, panelId, {
        currentView: 'entity',
        currentEntityId: entityId,
        currentEntityCategory: entityCategory,
        suggestionVerseId: null,
        navStack: newStack,
        navIndex: newIndex,
      }, createDefaultPanelState)
    });
    markSessionDirty();
  },

  navigateToBrowse: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    const entry: TopicsNavEntry = { type: 'browse' };

    const newStack = [...ps.navStack.slice(0, ps.navIndex + 1), entry];
    const newIndex = newStack.length - 1;

    set({
      panels: updatePanelState(get().panels, panelId, {
        currentView: 'browse',
        currentTopicId: null,
        currentTopicAbbreviation: null,
        suggestionVerseId: null,
        navStack: newStack,
        navIndex: newIndex,
      }, createDefaultPanelState)
    });
    markSessionDirty();
  },

  navigateToVerseTopics: (panelId: string, verseId: number) => {
    const ps = get().getPanelState(panelId);
    const entry: TopicsNavEntry = { type: 'verse-topics', verseId };

    const newStack = [...ps.navStack.slice(0, ps.navIndex + 1), entry];
    const newIndex = newStack.length - 1;

    set({
      panels: updatePanelState(get().panels, panelId, {
        currentView: 'verse-topics',
        currentVerseId: verseId,
        suggestionVerseId: null,
        navStack: newStack,
        navIndex: newIndex,
      }, createDefaultPanelState)
    });
    markSessionDirty();
  },

  setSourceFilter: (panelId: string, sources: string[]) => {
    set({
      panels: updatePanelState(get().panels, panelId, {
        sourceFilters: sources,
        browseOffset: 0, // Reset offset when changing filters
      }, createDefaultPanelState)
    });
    markSessionDirty();
  },

  setBrowseFilter: (panelId: string, filter: string) => {
    set({
      panels: updatePanelState(get().panels, panelId, {
        browseFilter: filter,
        browseOffset: 0,
      }, createDefaultPanelState)
    });
  },

  setBrowseOffset: (panelId: string, offset: number) => {
    set({
      panels: updatePanelState(get().panels, panelId, { browseOffset: offset }, createDefaultPanelState)
    });
  },

  goBack: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    if (ps.navIndex <= 0) return;

    const newIndex = ps.navIndex - 1;
    const entry = ps.navStack[newIndex];

    const updates: Partial<TopicsPanelState> = { navIndex: newIndex };
    if (entry.type === 'browse') {
      updates.currentView = 'browse';
      updates.currentTopicId = null;
      updates.currentTopicAbbreviation = null;
    } else if (entry.type === 'topic') {
      updates.currentView = 'topic';
      updates.currentTopicId = entry.topicId;
      updates.currentTopicAbbreviation = entry.abbreviation;
    } else if (entry.type === 'verse-topics') {
      updates.currentView = 'verse-topics';
      updates.currentVerseId = entry.verseId;
    } else if (entry.type === 'entity') {
      updates.currentView = 'entity';
      updates.currentEntityId = entry.entityId;
      updates.currentEntityCategory = entry.entityCategory;
    }

    set({ panels: updatePanelState(get().panels, panelId, updates, createDefaultPanelState) });
    markSessionDirty();
  },

  goForward: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    if (ps.navIndex >= ps.navStack.length - 1) return;

    const newIndex = ps.navIndex + 1;
    const entry = ps.navStack[newIndex];

    const updates: Partial<TopicsPanelState> = { navIndex: newIndex };
    if (entry.type === 'browse') {
      updates.currentView = 'browse';
      updates.currentTopicId = null;
      updates.currentTopicAbbreviation = null;
    } else if (entry.type === 'topic') {
      updates.currentView = 'topic';
      updates.currentTopicId = entry.topicId;
      updates.currentTopicAbbreviation = entry.abbreviation;
    } else if (entry.type === 'verse-topics') {
      updates.currentView = 'verse-topics';
      updates.currentVerseId = entry.verseId;
    } else if (entry.type === 'entity') {
      updates.currentView = 'entity';
      updates.currentEntityId = entry.entityId;
      updates.currentEntityCategory = entry.entityCategory;
    }

    set({ panels: updatePanelState(get().panels, panelId, updates, createDefaultPanelState) });
    markSessionDirty();
  },

  togglePin: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    set({
      panels: updatePanelState(get().panels, panelId, {
        pinned: !ps.pinned,
        suggestionVerseId: null,
      }, createDefaultPanelState)
    });
    markSessionDirty();
  },

  dismissSuggestion: (panelId: string) => {
    set({ panels: updatePanelState(get().panels, panelId, { suggestionVerseId: null }, createDefaultPanelState) });
  },

  acceptSuggestion: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    if (ps.suggestionVerseId) {
      get().navigateToVerseTopics(panelId, ps.suggestionVerseId);
    }
  },

  goHome: (panelId: string) => {
    const ps = get().getPanelState(panelId);
    // Prefer the live verse; fall back to a pending suggestion, and finally to
    // whatever verse this pane last showed topics for, so Home does something
    // sensible even before the Bible pane has broadcast anything.
    const verseId = ps.liveVerseId ?? ps.suggestionVerseId ?? ps.currentVerseId;
    if (verseId === null) return;
    get().navigateToVerseTopics(panelId, verseId);
  },
}));
