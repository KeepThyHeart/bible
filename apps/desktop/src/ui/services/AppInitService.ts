// AppInitService
//
// Owns the imperative startup logic for the desktop app: session restore,
// default initialization fallback, and the "save before close" wiring.
//
// Why a service: Zustand's `.getState()` is the right tool for one-shot
// startup orchestration (we don't want components to re-render on every
// store update during init), but `.getState()` calls inside React component
// bodies defeat reactivity and mix patterns. Centralizing the startup
// `.getState()` calls here keeps `App.tsx` small and reactive, and makes
// "no `.getState()` outside services" a rule the component tree can hold to.
//
// Components consume stores via hooks (`useXxxStore(s => s.value)`). This
// service is allowed to call `.getState()` because it runs outside of React
// rendering.

import { useBibleStore } from '../stores/useBibleStore';
import { biblePanelIdsFromLayout } from '../stores/bible/sessionMigration';
import { useCommentaryStore, type CommentaryModule } from '../stores/useCommentaryStore';
import { useDictionaryStore } from '../stores/useDictionaryStore';
import { useNotesStore } from '../stores/useNotesStore';
import { useBookmarkStore } from '../stores/useBookmarkStore';
import { useBookStore } from '../stores/useBookStore';
import { useSearchStore } from '../stores/useSearchStore';
import { useSessionStore } from '../stores/useSessionStore';
import { usePreferencesStore } from '../stores/usePreferencesStore';
import { useTextSettingsStore } from '../stores/useTextSettingsStore';
import { useFileNotesStore, type RecentFile } from '../stores/useFileNotesStore';
import { sessionAPI } from './electronAPI';
import { flushActiveNote } from './activeNoteFlush';
import { DEFAULT_PANEL_ID, panelIdFromLayout, panelIdsFromLayout } from '../stores/helpers/panelStateHelpers';
import { BOOK_DICT_PANEL_TYPES } from '../stores/helpers/bookDictPanelTypes';
import { DEFAULT_COMMENTARY_ABBREVIATION, DEFAULT_VERSE_ID } from '../constants';

/**
 * Dockview panel IDs created by `createDefaultLayout` in DockviewLayout.
 * Both the default-init and session-restore paths must target these, or the
 * state lands in a panel no component renders.
 */
const BIBLE_PANEL_ID = 'bible_default';
const COMMENTARY_PANEL_ID = 'commentary_default';

/**
 * Pick the commentary to open on a fresh profile.
 *
 * Prefers `DEFAULT_COMMENTARY_ABBREVIATION` (matched on the abbreviation,
 * which is stable, rather than the localizable display name). Lean builds
 * may not ship it, so fall back to the first available commentary - an empty
 * Commentary pane with no explanation is worse than an unexpected module.
 *
 * @returns The chosen module, or undefined when no commentaries are installed.
 */
export function pickDefaultCommentary(
  commentaries: readonly CommentaryModule[]
): CommentaryModule | undefined {
  const preferred = DEFAULT_COMMENTARY_ABBREVIATION.toLowerCase();
  return (
    commentaries.find(c => c.abbreviation.toLowerCase() === preferred) ?? commentaries[0]
  );
}

/** The slice of `SessionData.ui` the file-notes store owns. */
interface FileNotesSessionUi {
  notesDirectory?: string;
  recentFiles?: RecentFile[];
  /** `SessionData.ui.notesPanels` - validated inside the store, so `unknown` here. */
  notesPanels?: unknown;
}

/**
 * Restore the file-notes settings (notes directory, recent files) and the
 * per-panel notes navigation state - which view/sub-tab/folder/note each
 * Writing pane was left on. Each `UserNotesPane` claims its own entry when it
 * mounts (see `useNotesInit`), the same way a Bible panel claims its passage.
 *
 * Exported for tests: the surrounding `initializeApp` needs half the app
 * mocked, and the interesting behaviour here is entirely in *which* entries
 * survive.
 *
 * @param ui             `sessionData.ui`, of any vintage (or absent).
 * @param dockviewState  The restored layout, used to prune entries for notes
 *                       panels it no longer contains so the map cannot grow
 *                       without bound across restarts. Pruning is skipped when
 *                       the layout has no notes panels at all: that is equally
 *                       consistent with a session predating layout
 *                       persistence, and discarding the entries there would
 *                       lose the position of a pane the default layout is
 *                       about to recreate.
 */
export function restoreFileNotesFromSession(
  ui: FileNotesSessionUi | undefined,
  dockviewState: unknown
): void {
  if (!ui) return;
  if (!ui.notesDirectory && !ui.recentFiles && !ui.notesPanels) return;

  useFileNotesStore.getState().loadFromSession({
    notesDirectory: ui.notesDirectory,
    recentFiles: ui.recentFiles,
    notesPanels: ui.notesPanels,
  });

  const notesPanelIds = panelIdsFromLayout(dockviewState, ['notes']);
  if (notesPanelIds.length > 0) {
    useFileNotesStore.getState().prunePanelNavStates(notesPanelIds);
  }
}

/**
 * Result of a startup initialization run.
 * `dockviewLayout` is forwarded to React state by the caller so DockviewLayout
 * can render with the saved layout.
 */
export interface AppInitResult {
  dockviewLayout: Record<string, unknown> | null;
}

/**
 * Run the full app startup sequence. Safe to call once at mount time.
 *
 * Behavior is identical to the previous inline `initializeApp()` in App.tsx:
 *   1. Load (or create) the autosave session.
 *   2. If the session has data, restore tabs / settings / dockview layout.
 *   3. Otherwise perform default initialization (default commentary, etc.).
 *   4. On unexpected error, fall back to default initialization.
 *
 * @param signal AbortSignal-like flag from the calling effect; if it returns
 *   true at any await boundary, the operation aborts cleanly and returns the
 *   layout collected so far (or null).
 */
export async function initializeApp(signal: { aborted: boolean }): Promise<AppInitResult> {
  let dockviewLayout: Record<string, unknown> | null = null;

  // Default-init helper, used both when there's no session data and as the
  // catch-all error fallback. Kept inline so the closure captures the same
  // semantics the original inline code had.
  const runDefaultInit = async () => {
    const commentaryStore = useCommentaryStore.getState();
    const dictionaryStore = useDictionaryStore.getState();
    const bookmarkStore = useBookmarkStore.getState();
    const notesStore = useNotesStore.getState();

    await Promise.all([
      commentaryStore.loadAvailableCommentaries().then(() => {
        // After loading commentaries, put the default one in the Commentary
        // pane created by createDefaultLayout - so a commentary is one click
        // away, not so it is what the reader is looking at.
        //
        // `activate: false` matters: this runs after the pane has mounted, and
        // an activating open would take the pane off Overview. A first-time
        // user would then meet one commentary rather than the list of every
        // commentary that covers the verse, which is what Overview is for.
        const defaultCommentary = pickDefaultCommentary(
          useCommentaryStore.getState().availableCommentaries
        );
        if (defaultCommentary) {
          useCommentaryStore.getState().openCommentary(
            COMMENTARY_PANEL_ID,
            defaultCommentary.abbreviation,
            defaultCommentary.name,
            { activate: false }
          );
        }
      }),
      dictionaryStore.loadAvailableDictionaries(),
      bookmarkStore.loadCollectionTree(),
      // The flat list the bookmarks UI reads. Loaded at startup so the Bible
      // pane's gutter markers are right on the first chapter drawn, rather
      // than appearing a beat later.
      bookmarkStore.loadBookmarks(),
    ]);

    // Sync notes to the default starting verse (John 3:16).
    notesStore.syncAllPanelsWithVerse(DEFAULT_VERSE_ID);
  };

  try {
    const session = await sessionAPI.getOrCreateAutosave();
    if (signal.aborted) return { dockviewLayout };

    const hasSessionData = !!(
      session &&
      session.sessionData &&
      (session.sessionData.dockviewState ||
        session.sessionData.bible?.panels ||
        session.sessionData.bible?.openTabs?.length > 0 ||
        session.sessionData.commentary?.openTabs?.length > 0 ||
        session.sessionData.dictionary?.openTabs?.length > 0 ||
        session.sessionData.book?.openTabs?.length > 0 ||
        session.sessionData.notes?.selectedNoteId)
    );

    if (hasSessionData) {
      const { sessionData } = session;

      // Restore theme/typography preferences and per-pane text settings
      // immediately (synchronous, no IPC) - before any of the async work
      // below - so the user's real theme lands as early in startup as
      // possible instead of sitting on the light-theme/default-typography
      // CSS that `:root` (themes.css) and the usePreferencesStore module-load
      // bootstrap apply before session data is available.
      if (sessionData.ui?.preferences) {
        usePreferencesStore.getState().loadFromSession(sessionData.ui.preferences);
      } else {
        // No saved preferences on this session (e.g. it predates this field) -
        // (re-)apply current (default) state explicitly rather than relying on
        // the module-load bootstrap having already done so.
        usePreferencesStore.getState().applyAll();
      }

      if (sessionData.ui?.textSettings) {
        useTextSettingsStore.getState().loadFromSession(
          sessionData.ui.textSettings,
          sessionData.ui.textSettingsCustomized
        );
      }

      // Restore file notes settings (notes directory, recent files) and the
      // per-panel notes navigation state.
      restoreFileNotesFromSession(sessionData.ui, sessionData.dockviewState);

      // Restore dockview layout if saved.
      if (sessionData.dockviewState) {
        dockviewLayout = sessionData.dockviewState;
      }

      // Bible panels restore themselves: one dockview panel is one passage, so
      // the session is staged here (migrating a v1 session on the way through)
      // and each BiblePane claims its own entry when it mounts. Passages a v1
      // session held only as sub-tabs arrive as `pendingPanelCreations`, which
      // DockviewLayout turns into real panels once dockview is ready.
      const layoutBiblePanelIds = biblePanelIdsFromLayout(sessionData.dockviewState);
      useBibleStore.getState().loadSessionData(
        sessionData.bible,
        layoutBiblePanelIds.length > 0 ? layoutBiblePanelIds : [BIBLE_PANEL_ID]
      );

      // Phase 1: Restore active/visible tabs in parallel for fast render.
      // Panel IDs match the default dockview panel IDs from DockviewLayout.
      const commentaryPanelId = COMMENTARY_PANEL_ID;
      // Books and Dictionary tabs both live in one dockview panel (BookPane
      // renders both content types), so either one is a candidate. Which panel
      // it is has to come from the restored layout: the default layout's
      // Dictionary pane has a fixed id, but a Books pane the user opened
      // themselves carries a generated one, and a session saved before the
      // default gained a Dictionary slot has neither.
      const bookDictPanelId = panelIdFromLayout(sessionData.dockviewState, BOOK_DICT_PANEL_TYPES);
      await Promise.all([
        sessionData.commentary
          ? useCommentaryStore.getState().restoreFromSession(commentaryPanelId, sessionData.commentary)
          : Promise.resolve(),
        sessionData.dictionary && bookDictPanelId
          ? useDictionaryStore.getState().restoreFromSession(bookDictPanelId, sessionData.dictionary)
          : Promise.resolve(),
        sessionData.book && bookDictPanelId
          ? useBookStore.getState().restoreFromSession(bookDictPanelId, sessionData.book)
          : Promise.resolve(),
        sessionData.notes
          ? useNotesStore.getState().restoreFromSession(DEFAULT_PANEL_ID, sessionData.notes)
          : Promise.resolve(),
      ]);

      // Phase 2: Preload background tabs (fire-and-forget, non-blocking).
      useCommentaryStore.getState().preloadBackgroundTabs(commentaryPanelId);
      if (bookDictPanelId) {
        useBookStore.getState().preloadBackgroundTabs(bookDictPanelId);
        useDictionaryStore.getState().preloadBackgroundTabs(bookDictPanelId);
      }

      // Mark session as loaded.
      useSessionStore.setState({
        currentSessionId: session.sessionId,
        currentSessionName: session.name,
        isSessionLoaded: true,
      });

      // Load dictionaries and bookmarks in parallel (these aren't part of the
      // restore-from-session path above, so they still need to happen).
      await Promise.all([
        useDictionaryStore.getState().loadAvailableDictionaries(),
        useBookmarkStore.getState().loadCollectionTree(),
        useBookmarkStore.getState().loadBookmarks(),
      ]);
    } else {
      // No session data (fresh profile). Preferences/typography are already
      // applied to the DOM via each store's module-load bootstrap, but apply
      // explicitly here too so this path's behavior doesn't silently depend
      // on that side effect.
      usePreferencesStore.getState().applyAll();

      // No session data, perform default initialization.
      await runDefaultInit();

      // Mark session as loaded (will be saved on first change).
      if (session) {
        useSessionStore.setState({
          currentSessionId: session.sessionId,
          currentSessionName: session.name,
          isSessionLoaded: true,
        });
      }
    }
  } catch (error) {
    console.error('Failed to initialize session:', error);
    // Fall back to default initialization on error.
    await runDefaultInit();

    // Mark session as loaded even on this fallback path. Panes gate their
    // "no content yet" empty state on `isSessionLoaded` (see BibleVerseList,
    // CommentaryPane, DictionaryPane) to avoid flashing it during normal
    // startup restore; without this, a startup error here would leave that
    // flag false forever and every pane would show its loading skeleton
    // indefinitely instead of ever reaching a real (if empty) state.
    if (!useSessionStore.getState().isSessionLoaded) {
      useSessionStore.setState({ isSessionLoaded: true });
    }
  }

  return { dockviewLayout };
}

/**
 * Wire the main-process "save requested before close" IPC bridge. The handler
 * pulls the current session from the store and persists it via sessionAPI.
 * No-op if the preload bridge isn't available (e.g., in some test contexts).
 */
export function registerSaveBeforeCloseHandler(): void {
  const onSaveRequested = window.electron?.session?.onSaveRequested;
  if (!onSaveRequested) return;

  onSaveRequested(async () => {
    // Flush any in-progress .bn note edit first. The main-process close handler
    // destroys the renderer right after this replies, so the notes pane's
    // save-on-unmount cleanup never runs during a real quit - without this a
    // just-typed paragraph is lost. flushActiveNote never throws, so it can't
    // block the session save below.
    await flushActiveNote();

    const store = useSessionStore.getState();
    if (store.currentSessionId) {
      const sessionData = store.getSessionData();
      await sessionAPI.update(store.currentSessionId, { sessionData });
      return { success: true, message: 'Session saved' };
    }
    return { success: false, message: 'No session ID' };
  });
}

/**
 * Kick off the (non-blocking) semantic search availability check. Result is
 * stored in `useSearchStore` for downstream components to read reactively.
 */
export function checkSemanticAvailability(): void {
  useSearchStore.getState().checkSemanticAvailability();
}
