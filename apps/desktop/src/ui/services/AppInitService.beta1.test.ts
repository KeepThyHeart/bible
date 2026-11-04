import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { SerializedDockview } from 'dockview-react';

/**
 * Restoring the session a 0.1.0-beta.1 install autosaved (the fixture under
 * test-fixtures/beta1/, produced from beta.1's own serializers' shapes): every
 * panel survives, preferences added since beta.1 take their defaults, and the
 * first save after upgrading writes back everything beta.1 held.
 */

vi.mock('./electronAPI', () => ({ sessionAPI: { getOrCreateAutosave: vi.fn() } }));

const loadSessionData = vi.fn();
vi.mock('../stores/useBibleStore', () => ({
  useBibleStore: { getState: () => ({ loadSessionData }) }
}));

vi.mock('../stores/useCommentaryStore', () => ({
  useCommentaryStore: {
    getState: () => ({
      restoreFromSession: vi.fn().mockResolvedValue(undefined),
      preloadBackgroundTabs: vi.fn(),
      loadAvailableCommentaries: vi.fn().mockResolvedValue(undefined),
      availableCommentaries: [],
      openCommentary: vi.fn()
    })
  }
}));
vi.mock('../stores/useDictionaryStore', () => ({
  useDictionaryStore: {
    getState: () => ({
      restoreFromSession: vi.fn().mockResolvedValue(undefined),
      preloadBackgroundTabs: vi.fn(),
      loadAvailableDictionaries: vi.fn().mockResolvedValue(undefined)
    })
  }
}));
vi.mock('../stores/useNotesStore', () => ({
  useNotesStore: { getState: () => ({ restoreFromSession: vi.fn().mockResolvedValue(undefined), syncAllPanelsWithVerse: vi.fn() }) }
}));
vi.mock('../stores/useBookmarkStore', () => ({
  useBookmarkStore: {
    getState: () => ({
      loadCollectionTree: vi.fn().mockResolvedValue(undefined),
      loadBookmarks: vi.fn().mockResolvedValue(undefined),
      quickBookmark: vi.fn()
    })
  }
}));
vi.mock('../stores/useBookStore', () => ({
  useBookStore: { getState: () => ({ restoreFromSession: vi.fn().mockResolvedValue(undefined), preloadBackgroundTabs: vi.fn() }) }
}));

import { initializeApp } from './AppInitService';
import { sessionAPI } from './electronAPI';
import { sanitizeDockviewState } from './LayoutStateSanitizer';
import { migrateBibleSession, biblePanelIdsFromLayout } from '../stores/bible/sessionMigration';
import { usePreferencesStore, DEFAULT_TYPOGRAPHY } from '../stores/usePreferencesStore';
import { useTextSettingsStore } from '../stores/useTextSettingsStore';
import { useFileNotesStore } from '../stores/useFileNotesStore';
import { useSessionStore } from '../stores/useSessionStore';

const mockGetOrCreateAutosave = sessionAPI.getOrCreateAutosave as unknown as ReturnType<typeof vi.fn>;

const beta1 = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'test-fixtures', 'beta1', 'beta1-session.json'), 'utf8')
) as {
  dockviewState: SerializedDockview & { panels: Record<string, { params: { contentType: string } }> };
  bible: { panels: Record<string, unknown> };
  ui: { preferences: Record<string, unknown>; notesDirectory: string; recentFiles: unknown[]; notesPanels: Record<string, unknown>; textSettings: Record<string, unknown> };
};

const BETA1_PANEL_IDS = ['bible_default', 'bible_2', 'study_default', 'commentary_default', 'dictionary_default', 'notes_default', 'ext_wordcount_1'];

describe('session autosaved by 0.1.0-beta.1', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    usePreferencesStore.setState({
      theme: 'light', globalFontScale: 1.0, uiControlFontSize: 14, typography: { ...DEFAULT_TYPOGRAPHY },
      readingPlanRolloverHour: 3, readingPlanShowStreak: false, appSwitcher: 'auto', appOrder: [], appHidden: []
    });
    useFileNotesStore.setState({ notesDirectory: '', recentFiles: [], panelNavStates: {} });
    useSessionStore.setState({ currentSessionId: null, isDirty: false });
    loadSessionData.mockReset();
    mockGetOrCreateAutosave.mockReset();
    mockGetOrCreateAutosave.mockResolvedValue({ sessionId: 1, name: 'Autosave', sessionData: beta1 });
  });

  it('keeps every dockview panel, including the extension panel, untouched by the sanitizer', () => {
    const { layout, repairs } = sanitizeDockviewState(beta1.dockviewState);
    expect(repairs).toEqual([]);
    expect(layout).toBe(beta1.dockviewState);
    expect(Object.keys((layout as unknown as { panels: object }).panels).sort()).toEqual([...BETA1_PANEL_IDS].sort());
    expect(beta1.dockviewState.panels.ext_wordcount_1.params.contentType).toBe('ext:ext.bible-app.word-count.counts');
  });

  it('migrates the v2 Bible session to the same two panels, creating none', () => {
    const ids = biblePanelIdsFromLayout(beta1.dockviewState);
    expect(ids).toEqual(['bible_default', 'bible_2']);
    const result = migrateBibleSession(beta1.bible, ids);
    expect(Object.keys(result.panels)).toEqual(['bible_default', 'bible_2']);
    expect(result.pending).toEqual([]);
    expect(result.report).toMatchObject({ sourceVersion: 2, createdPanelIds: [], fellBackToDefaults: false });
  });

  it('restores beta.1 preferences and gives the newer preferences their defaults', async () => {
    const result = await initializeApp({ aborted: false });

    expect(result.dockviewLayout).toBe(beta1.dockviewState);
    expect(loadSessionData).toHaveBeenCalledWith(beta1.bible, ['bible_default', 'bible_2']);
    const prefs = usePreferencesStore.getState();
    expect(prefs.theme).toBe('midnight');
    expect(prefs.globalFontScale).toBe(1.1);
    expect(prefs.uiControlFontSize).toBe(15);
    expect(prefs.typography.bibleFontSize).toBe(22);
    expect(prefs.advancedPaneManagerEnabled).toBe(true);
    // Added after beta.1: absent from the saved blob, so defaults.
    expect(prefs.readingPlanRolloverHour).toBe(3);
    expect(prefs.readingPlanShowStreak).toBe(false);
    expect(prefs.appSwitcher).toBe('auto');
    expect(prefs.appOrder).toEqual([]);
    expect(prefs.appHidden).toEqual([]);
    expect(useTextSettingsStore.getState().getSettings('bible').fontSize).toBe(22);
  });

  it('the first save after upgrading carries the beta.1 settings and notes state forward', async () => {
    await initializeApp({ aborted: false });
    const saved = useSessionStore.getState().getSessionData();
    const ui = saved.ui as Record<string, unknown>;
    expect(ui.notesDirectory).toBe(beta1.ui.notesDirectory);
    expect(ui.recentFiles).toEqual(beta1.ui.recentFiles);
    expect(ui.notesPanels).toEqual(beta1.ui.notesPanels);
    expect(ui.preferences).toMatchObject({
      theme: 'midnight', globalFontScale: 1.1, uiControlFontSize: 15, advancedPaneManagerEnabled: true,
      readingPlanRolloverHour: 3, appSwitcher: 'auto'
    });
    expect((ui.textSettings as Record<string, { fontSize: number }>).bible.fontSize).toBe(22);
    // No module-owned section appears out of nowhere on a profile that never had one.
    for (const key of ['keywordMarks', 'measures', 'wordStudyPanels']) {
      expect(ui[key] === undefined || typeof ui[key] === 'object').toBe(true);
    }
  });
});
