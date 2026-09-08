import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for the "Preferences persistence is dead code" bug.
 *
 * `usePreferencesStore.loadFromSession()` / `.applyAll()` existed but were
 * never called from `App.tsx` / `AppInitService.ts` - theme, global font
 * scale, UI control size, and typography never survived an app restart, even
 * though the Preferences dialog applied them live. Separately,
 * `useTextSettingsStore.loadFromSession()` unconditionally marked every
 * restored pane `customized: true`, which - once the `customized` flag was
 * actually wired into the session shape - would have permanently masked the
 * Typography section's sliders for every pane on every restart, regardless
 * of whether the user ever touched the Fonts section.
 *
 * These tests exercise `initializeApp()` end-to-end (with every store it
 * touches other than the two under test mocked out) to prove the actual
 * startup wiring - not just the store methods in isolation - restores
 * preferences and per-pane font settings correctly, and that a session saved
 * before the `customized` field existed does not regress the "sliders do
 * nothing" bug.
 */

vi.mock('./electronAPI', () => ({
  sessionAPI: {
    getOrCreateAutosave: vi.fn()
  }
}));

vi.mock('../stores/useBibleStore', () => ({
  useBibleStore: { getState: () => ({ loadSessionData: vi.fn() }) }
}));

vi.mock('../stores/bible/sessionMigration', () => ({
  biblePanelIdsFromLayout: () => []
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
  useNotesStore: {
    getState: () => ({
      restoreFromSession: vi.fn().mockResolvedValue(undefined),
      syncAllPanelsWithVerse: vi.fn()
    })
  }
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
  useBookStore: {
    getState: () => ({
      restoreFromSession: vi.fn().mockResolvedValue(undefined),
      preloadBackgroundTabs: vi.fn()
    })
  }
}));

vi.mock('../stores/useFileNotesStore', () => ({
  useFileNotesStore: { getState: () => ({ loadFromSession: vi.fn() }) }
}));

import { initializeApp } from './AppInitService';
import { sessionAPI } from './electronAPI';
import { usePreferencesStore, DEFAULT_TYPOGRAPHY } from '../stores/usePreferencesStore';
import { useTextSettingsStore } from '../stores/useTextSettingsStore';
import { useSessionStore } from '../stores/useSessionStore';

const mockGetOrCreateAutosave = sessionAPI.getOrCreateAutosave as unknown as ReturnType<typeof vi.fn>;

describe('initializeApp - preferences/text-settings session restore', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.cssText = '';

    usePreferencesStore.setState({
      theme: 'light',
      globalFontScale: 1.0,
      uiControlFontSize: 14,
      typography: { ...DEFAULT_TYPOGRAPHY }
    });

    useTextSettingsStore.setState({
      settings: {
        bible: { fontSize: 20, fontFamily: 'Georgia', lineHeight: 1.75, showRedLetter: true },
        commentary: { fontSize: 18, fontFamily: 'Georgia', lineHeight: 1.75 },
        book: { fontSize: 18, fontFamily: 'Georgia', lineHeight: 1.75 },
        dictionary: { fontSize: 16, fontFamily: 'Georgia', lineHeight: 1.75 }
      },
      customized: { bible: false, commentary: false, book: false, dictionary: false }
    });

    useSessionStore.setState({
      currentSessionId: null,
      currentSessionName: 'Untitled Session',
      isSessionLoaded: false,
      isDirty: false,
      lastSaveTime: null
    });

    mockGetOrCreateAutosave.mockReset();
  });

  it('restores theme/typography/per-pane customization from a full session (round trip)', async () => {
    mockGetOrCreateAutosave.mockResolvedValue({
      sessionId: 1,
      name: 'Autosave',
      sessionData: {
        dockviewState: { grid: {} }, // any truthy value makes hasSessionData true
        ui: {
          preferences: {
            theme: 'dark',
            globalFontScale: 1.2,
            uiControlFontSize: 16,
            typography: { ...DEFAULT_TYPOGRAPHY, bibleFontSize: 26, bibleFontFamily: 'lora' }
          },
          textSettings: {
            bible: { fontSize: 32, fontFamily: 'Merriweather', lineHeight: 1.6 }
          },
          textSettingsCustomized: {
            bible: true
          }
        }
      }
    });

    await initializeApp({ aborted: false });

    // Theme + typography actually landed in the store and on the DOM - this
    // is the part that was pure dead code before the fix.
    expect(usePreferencesStore.getState().theme).toBe('dark');
    expect(usePreferencesStore.getState().globalFontScale).toBe(1.2);
    expect(usePreferencesStore.getState().uiControlFontSize).toBe(16);
    expect(usePreferencesStore.getState().typography.bibleFontSize).toBe(26);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.getPropertyValue('--bible-font-size')).toBe('26px');

    // The explicitly-customized bible pane keeps its saved override...
    expect(useTextSettingsStore.getState().customized.bible).toBe(true);
    expect(useTextSettingsStore.getState().getSettings('bible').fontSize).toBe(32);

    // ...while panes absent from the saved textSettings stay un-customized
    // and follow the restored Typography values live.
    expect(useTextSettingsStore.getState().customized.commentary).toBe(false);
  });

  it('a session predating the `customized` field does not mark every pane customized (no sliders-frozen regression)', async () => {
    mockGetOrCreateAutosave.mockResolvedValue({
      sessionId: 2,
      name: 'Autosave',
      sessionData: {
        dockviewState: { grid: {} },
        ui: {
          // Legacy shape: textSettings present, no textSettingsCustomized,
          // no preferences at all.
          textSettings: {
            bible: { fontSize: 22, fontFamily: 'Georgia', lineHeight: 1.75 },
            commentary: { fontSize: 19, fontFamily: 'Georgia', lineHeight: 1.75 }
          }
        }
      }
    });

    await initializeApp({ aborted: false });

    // No `preferences` blob at all -> falls back to applying current
    // (default) state rather than crashing or leaving it unapplied.
    expect(usePreferencesStore.getState().theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    // The critical migration assertion: every pane restored from a
    // customized-less session must be treated as NOT customized, so it keeps
    // following the Typography section. The previous behavior forced
    // `customized: true` unconditionally here, which would have frozen the
    // Typography sliders for every returning user.
    expect(useTextSettingsStore.getState().customized.bible).toBe(false);
    expect(useTextSettingsStore.getState().customized.commentary).toBe(false);
    // The saved font values themselves are still restored (not discarded).
    expect(useTextSettingsStore.getState().getSettings('bible').fontSize).toBe(22);
  });

  it('a session with no data at all applies default preferences without crashing', async () => {
    mockGetOrCreateAutosave.mockResolvedValue({
      sessionId: 3,
      name: 'Autosave',
      sessionData: {}
    });

    await initializeApp({ aborted: false });

    expect(usePreferencesStore.getState().theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
