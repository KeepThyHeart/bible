import { create } from 'zustand';
import { registerSessionSerializer } from './helpers/sessionRegistry';

const MAX_RECENT_FILES = 20;

export interface RecentFile {
  path: string;   // absolute path
  title: string;  // note title
  openedAt: string; // ISO 8601
}

export type NotesPanelView = 'browser' | 'editor';
export type NotesSideTab = 'browse' | 'recent';

/**
 * Where one notes panel was last sitting: which view it was showing, which
 * sidebar sub-tab was selected, which folder it had open, and which note (if
 * any) was being edited.
 *
 * `sideTab` is optional because it is absent from sessions saved before it was
 * persisted, and from pop-out payloads produced by older builds. Everything
 * that reads it must tolerate `undefined` rather than assuming 'browse'.
 */
export interface NotesPanelNavState {
  view: NotesPanelView;
  sideTab?: NotesSideTab;
  currentPath: string;
  currentNotePath: string;
}

interface FileNotesSessionData {
  notesDirectory: string;
  recentFiles: RecentFile[];
  notesPanels: Record<string, NotesPanelNavState>;
}

interface FileNotesState {
  notesDirectory: string;
  recentFiles: RecentFile[];
  /**
   * Per-dockview-panel notes navigation state, keyed by panel id.
   *
   * This is real store state, not a module-level `Map` outside Zustand,
   * because it has to survive a restart, not just let `DockviewTabRenderer`
   * hand a popped-out window the position of the pane it came from: it is
   * serialized into `SessionData.ui.notesPanels` and restored on startup,
   * which is what makes the app come back to the note you were writing.
   *
   * Keyed by the *dockview* panel id (e.g. `notes_default`), never
   * `DEFAULT_PANEL_ID` - no dockview-hosted pane registers under `_default`.
   */
  panelNavStates: Record<string, NotesPanelNavState>;

  setNotesDirectory: (dir: string) => void;
  addRecentFile: (path: string, title: string) => void;
  removeRecentFile: (path: string) => void;
  clearRecentFiles: () => void;

  setPanelNavState: (panelId: string, state: NotesPanelNavState) => void;
  getPanelNavState: (panelId: string) => NotesPanelNavState | undefined;
  clearPanelNavState: (panelId: string) => void;
  /**
   * Drop every panel entry whose id is not in `keepPanelIds`.
   * Called on session restore so the map cannot grow without bound across
   * restarts as panels are opened and closed.
   */
  prunePanelNavStates: (keepPanelIds: readonly string[]) => void;

  // Session integration
  getSessionData: () => FileNotesSessionData;
  loadFromSession: (data: {
    notesDirectory?: string;
    recentFiles?: RecentFile[];
    notesPanels?: unknown;
  }) => void;
}

import { markSessionDirty } from './helpers/sessionNotifier';

/**
 * Coerce one persisted panel entry into a `NotesPanelNavState`.
 *
 * The blob comes off disk and may have been written by an older build (or
 * hand-edited), so every field is validated rather than trusted; anything
 * unrecognizable degrades to the browser view at the notes root, which is
 * exactly what a panel with no saved state does. Returns `undefined` when the
 * value isn't an object at all, so a corrupt entry is dropped instead of
 * resurrected as a bogus panel.
 */
export function sanitizeNotesPanelNavState(raw: unknown): NotesPanelNavState | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const sanitized: NotesPanelNavState = {
    view: value.view === 'editor' ? 'editor' : 'browser',
    currentPath: typeof value.currentPath === 'string' ? value.currentPath : '',
    currentNotePath: typeof value.currentNotePath === 'string' ? value.currentNotePath : '',
  };
  if (value.sideTab === 'browse' || value.sideTab === 'recent') {
    sanitized.sideTab = value.sideTab;
  }
  return sanitized;
}

/** Sanitize a whole `ui.notesPanels` map, dropping entries that make no sense. */
export function sanitizeNotesPanelNavStates(raw: unknown): Record<string, NotesPanelNavState> {
  if (typeof raw !== 'object' || raw === null) return {};
  const out: Record<string, NotesPanelNavState> = {};
  for (const [panelId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!panelId) continue;
    const state = sanitizeNotesPanelNavState(value);
    if (state) out[panelId] = state;
  }
  return out;
}

function navStatesEqual(a: NotesPanelNavState | undefined, b: NotesPanelNavState): boolean {
  return (
    !!a &&
    a.view === b.view &&
    a.sideTab === b.sideTab &&
    a.currentPath === b.currentPath &&
    a.currentNotePath === b.currentNotePath
  );
}

export const useFileNotesStore = create<FileNotesState>((set, get) => ({
  notesDirectory: '',
  recentFiles: [],
  panelNavStates: {},

  setNotesDirectory: (dir) => {
    set({ notesDirectory: dir });
    markSessionDirty();
  },

  addRecentFile: (path, title) => {
    const { recentFiles } = get();
    // Remove existing entry for this path (if any)
    const filtered = recentFiles.filter(f => f.path !== path);
    // Prepend new entry
    const updated = [
      { path, title, openedAt: new Date().toISOString() },
      ...filtered
    ].slice(0, MAX_RECENT_FILES);
    set({ recentFiles: updated });
    markSessionDirty();
  },

  removeRecentFile: (path) => {
    set(state => ({
      recentFiles: state.recentFiles.filter(f => f.path !== path)
    }));
    markSessionDirty();
  },

  clearRecentFiles: () => {
    set({ recentFiles: [] });
    markSessionDirty();
  },

  setPanelNavState: (panelId, state) => {
    // The notes pane re-registers on every navigation-shaped render, so an
    // unchanged write must not touch the store (it would re-render every
    // subscriber) or mark the session dirty (it would defeat the dirty check
    // that keeps autosave from writing an identical blob every 30s).
    if (navStatesEqual(get().panelNavStates[panelId], state)) return;
    set(prev => ({ panelNavStates: { ...prev.panelNavStates, [panelId]: state } }));
    markSessionDirty();
  },

  getPanelNavState: (panelId) => get().panelNavStates[panelId],

  clearPanelNavState: (panelId) => {
    if (!(panelId in get().panelNavStates)) return;
    set(prev => {
      const next = { ...prev.panelNavStates };
      delete next[panelId];
      return { panelNavStates: next };
    });
    markSessionDirty();
  },

  prunePanelNavStates: (keepPanelIds) => {
    const keep = new Set(keepPanelIds);
    const current = get().panelNavStates;
    const next: Record<string, NotesPanelNavState> = {};
    let removed = false;
    for (const [panelId, state] of Object.entries(current)) {
      if (keep.has(panelId)) next[panelId] = state;
      else removed = true;
    }
    if (!removed) return;
    set({ panelNavStates: next });
    markSessionDirty();
  },

  getSessionData: () => {
    const { notesDirectory, recentFiles, panelNavStates } = get();
    return { notesDirectory, recentFiles, notesPanels: panelNavStates };
  },

  loadFromSession: (data) => {
    set({
      notesDirectory: data.notesDirectory || '',
      recentFiles: data.recentFiles || [],
      panelNavStates: sanitizeNotesPanelNavStates(data.notesPanels)
    });
  }
}));

// Register session serializer so useSessionStore doesn't import us directly
registerSessionSerializer('fileNotes', () => {
  return useFileNotesStore.getState().getSessionData();
});

// -- Notes panel navigation registry -----------------------------------------
// Thin function wrappers over the store above, kept because the consumers
// (DockviewTabRenderer's pop-out, useNotesInit) want an imperative read/write
// and not a subscription.

export function setNotesPanelNavState(panelId: string, state: NotesPanelNavState): void {
  useFileNotesStore.getState().setPanelNavState(panelId, state);
}

export function getNotesPanelNavState(panelId: string): NotesPanelNavState | undefined {
  return useFileNotesStore.getState().getPanelNavState(panelId);
}

export function clearNotesPanelNavState(panelId: string): void {
  useFileNotesStore.getState().clearPanelNavState(panelId);
}

export function pruneNotesPanelNavStates(keepPanelIds: readonly string[]): void {
  useFileNotesStore.getState().prunePanelNavStates(keepPanelIds);
}
