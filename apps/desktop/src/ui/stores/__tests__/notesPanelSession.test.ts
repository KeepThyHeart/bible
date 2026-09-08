/**
 * Unit tests for "remember the note I was working on".
 *
 * The Writing pane's position (which view, which sidebar sub-tab, which folder,
 * which note) lives per dockview panel id in `useFileNotesStore.panelNavStates`
 * and rides to disk inside the single `session.session_data` JSON blob, under
 * `ui.notesPanels`. These tests cover that round trip end to end - including
 * the two ways it can go wrong that no type can catch:
 *
 *  - the blob comes back from an older build, or corrupt, and must degrade to
 *    "browser view at the notes root" instead of throwing on startup;
 *  - panel ids accumulate across restarts, so entries for panels the restored
 *    layout no longer contains have to be pruned.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../helpers/sessionNotifier', () => ({
  markSessionDirty: vi.fn(),
}));

import { markSessionDirty } from '../helpers/sessionNotifier';
import {
  useFileNotesStore,
  setNotesPanelNavState,
  getNotesPanelNavState,
  pruneNotesPanelNavStates,
  sanitizeNotesPanelNavStates,
  type NotesPanelNavState,
} from '../useFileNotesStore';
import { panelIdsFromLayout } from '../helpers/panelStateHelpers';

const PANEL = 'notes_default';
const OTHER_PANEL = 'notes_1712345678';

const NAV: NotesPanelNavState = {
  view: 'editor',
  sideTab: 'recent',
  currentPath: 'Documents/Sermons',
  currentNotePath: 'Documents/Sermons/Romans 8.bn',
};

/** Round-trip through JSON the way `session.session_data` does. */
function throughSessionBlob(): unknown {
  const fileNotes = useFileNotesStore.getState().getSessionData();
  const sessionData = {
    ui: {
      notesDirectory: fileNotes.notesDirectory,
      recentFiles: fileNotes.recentFiles,
      notesPanels: fileNotes.notesPanels,
    },
  };
  return JSON.parse(JSON.stringify(sessionData));
}

function uiOf(blob: unknown): { notesPanels?: unknown } {
  return (blob as { ui: { notesPanels?: unknown } }).ui;
}

describe('notes panel session persistence', () => {
  beforeEach(() => {
    useFileNotesStore.setState({ notesDirectory: '', recentFiles: [], panelNavStates: {} });
    vi.mocked(markSessionDirty).mockClear();
  });

  it('round-trips a panel position through the session blob', () => {
    useFileNotesStore.getState().setNotesDirectory('C:/Users/pete/Notes');
    setNotesPanelNavState(PANEL, NAV);

    const blob = throughSessionBlob();

    // Shape check: this is the contract with SessionData.ui.notesPanels.
    expect(uiOf(blob).notesPanels).toEqual({
      [PANEL]: {
        view: 'editor',
        sideTab: 'recent',
        currentPath: 'Documents/Sermons',
        currentNotePath: 'Documents/Sermons/Romans 8.bn',
      },
    });

    // Restart: a fresh store loads the blob back.
    useFileNotesStore.setState({ notesDirectory: '', recentFiles: [], panelNavStates: {} });
    useFileNotesStore.getState().loadFromSession({
      notesDirectory: 'C:/Users/pete/Notes',
      notesPanels: uiOf(blob).notesPanels,
    });

    expect(getNotesPanelNavState(PANEL)).toEqual(NAV);
  });

  it('keeps panels independent', () => {
    setNotesPanelNavState(PANEL, NAV);
    setNotesPanelNavState(OTHER_PANEL, { ...NAV, currentPath: 'Journal', currentNotePath: '' });

    useFileNotesStore.getState().loadFromSession({
      notesPanels: uiOf(throughSessionBlob()).notesPanels,
    });

    expect(getNotesPanelNavState(PANEL)?.currentNotePath).toBe('Documents/Sermons/Romans 8.bn');
    expect(getNotesPanelNavState(OTHER_PANEL)?.currentPath).toBe('Journal');
  });

  it('loads a session saved before notesPanels existed without throwing', () => {
    expect(() =>
      useFileNotesStore.getState().loadFromSession({
        notesDirectory: 'C:/Users/pete/Notes',
        recentFiles: [{ path: 'a.bn', title: 'A', openedAt: '2026-01-01T00:00:00.000Z' }],
      })
    ).not.toThrow();

    expect(useFileNotesStore.getState().panelNavStates).toEqual({});
    expect(getNotesPanelNavState(PANEL)).toBeUndefined();
  });

  it('degrades a corrupt or half-written entry instead of throwing', () => {
    useFileNotesStore.getState().loadFromSession({
      notesPanels: {
        good: NAV,
        // Written by a build that only knew about `view`.
        partial: { view: 'editor' },
        // Values of the wrong type, or values no build ever wrote.
        nonsense: { view: 'timeline', sideTab: 7, currentPath: 42, currentNotePath: null },
        notAnObject: 'nope',
      },
    });

    expect(getNotesPanelNavState('good')).toEqual(NAV);
    expect(getNotesPanelNavState('partial')).toEqual({
      view: 'editor',
      currentPath: '',
      currentNotePath: '',
    });
    // Unrecognisable view/sub-tab fall back to the browser at the notes root.
    expect(getNotesPanelNavState('nonsense')).toEqual({
      view: 'browser',
      currentPath: '',
      currentNotePath: '',
    });
    expect(getNotesPanelNavState('notAnObject')).toBeUndefined();
  });

  it('sanitizes a non-object notesPanels to an empty map', () => {
    expect(sanitizeNotesPanelNavStates(undefined)).toEqual({});
    expect(sanitizeNotesPanelNavStates(null)).toEqual({});
    expect(sanitizeNotesPanelNavStates('{}')).toEqual({});
  });

  it('does not mark the session dirty for an unchanged re-registration', () => {
    setNotesPanelNavState(PANEL, NAV);
    expect(markSessionDirty).toHaveBeenCalledTimes(1);

    // The pane re-registers on every navigation-shaped render.
    setNotesPanelNavState(PANEL, { ...NAV });
    expect(markSessionDirty).toHaveBeenCalledTimes(1);

    setNotesPanelNavState(PANEL, { ...NAV, sideTab: 'browse' });
    expect(markSessionDirty).toHaveBeenCalledTimes(2);
  });

  describe('pruning stale panel ids', () => {
    it('drops entries for panels the restored layout no longer contains', () => {
      setNotesPanelNavState(PANEL, NAV);
      setNotesPanelNavState(OTHER_PANEL, NAV);
      setNotesPanelNavState('notes_closed_last_week', NAV);

      pruneNotesPanelNavStates([PANEL, OTHER_PANEL]);

      expect(Object.keys(useFileNotesStore.getState().panelNavStates).sort()).toEqual(
        [OTHER_PANEL, PANEL].sort()
      );
      expect(getNotesPanelNavState('notes_closed_last_week')).toBeUndefined();
    });

    it('is a no-op (and leaves the session clean) when nothing is stale', () => {
      setNotesPanelNavState(PANEL, NAV);
      vi.mocked(markSessionDirty).mockClear();

      pruneNotesPanelNavStates([PANEL]);

      expect(getNotesPanelNavState(PANEL)).toEqual(NAV);
      expect(markSessionDirty).not.toHaveBeenCalled();
    });

    it('finds every notes panel id in a serialized dockview layout', () => {
      const dockviewState = {
        panels: {
          bible_default: { params: { contentType: 'bible' } },
          notes_default: { params: { contentType: 'notes' } },
          notes_1712345678: { params: { contentType: 'notes' } },
          search_1: { params: { contentType: 'search' } },
          broken: null,
          paramless: {},
        },
      };

      expect(panelIdsFromLayout(dockviewState, ['notes']).sort()).toEqual(
        ['notes_1712345678', 'notes_default'].sort()
      );
      expect(panelIdsFromLayout(undefined, ['notes'])).toEqual([]);
      expect(panelIdsFromLayout({ panels: 'nope' }, ['notes'])).toEqual([]);
    });
  });
});
