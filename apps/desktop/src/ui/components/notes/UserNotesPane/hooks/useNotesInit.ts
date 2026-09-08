import { useEffect, useState } from 'react';
import * as fileNotesAPI from '../../../../services/fileNotesAPI';
import { BnFile } from '../../../../services/fileNotesAPI';
import {
  useFileNotesStore,
  setNotesPanelNavState,
  getNotesPanelNavState,
  type NotesPanelNavState,
  type NotesSideTab,
} from '../../../../stores/useFileNotesStore';
import { useNoteEditorStore } from '../../../../stores/useNoteEditorStore';
import { useLayoutStore } from '../../../../stores/useLayoutStore';
import { isAbsolutePath } from '../utils';

interface UseNotesInitArgs {
  panelId: string;
  isDetached: boolean;
  initialView: 'browser' | 'editor' | undefined;
  initialSideTab: NotesSideTab | undefined;
  initialCurrentPath: string | undefined;
  initialCurrentNotePath: string | undefined;
  view: 'browser' | 'editor';
  sideTab: NotesSideTab;
  currentPath: string;
  currentNotePath: string;
  currentNote: BnFile | null;
  loadDirectory: (path: string) => void;
  setShowSetup: (open: boolean) => void;
  setCurrentNote: (note: BnFile | null) => void;
  setCurrentNotePath: (path: string) => void;
  setView: (view: 'browser' | 'editor') => void;
  setSideTab: (tab: NotesSideTab) => void;
}

/**
 * Mount-time initialisation for UserNotesPane:
 *  - notes-folder bootstrap (initialize, ensure verse-notes folder)
 *  - restore where this panel was left: the detached window's handover state,
 *    or the position the session remembered for this dockview panel id
 *  - dynamic dockview tab subtitle following the open note title
 *  - register navigation state (for pop-out *and* for the next restart)
 */
export function useNotesInit(args: UseNotesInitArgs): void {
  const {
    panelId,
    isDetached,
    initialView,
    initialSideTab,
    initialCurrentPath,
    initialCurrentNotePath,
    view,
    sideTab,
    currentPath,
    currentNotePath,
    currentNote,
    loadDirectory,
    setShowSetup,
    setCurrentNote,
    setCurrentNotePath,
    setView,
    setSideTab,
  } = args;

  // Registration of this panel's position is held back until the restore below
  // has run. Without the gate the registration effect - which fires on the very
  // first commit, before any await in the bootstrap has resolved - would
  // overwrite the session's remembered position with this pane's mount-time
  // defaults (browser view, notes root) and the restore would find nothing.
  // It's state rather than a ref because the effect has to re-run when it flips.
  const [restoreDone, setRestoreDone] = useState(false);

  // Notes-folder bootstrap + position restore (runs once on mount).
  useEffect(() => {
    // Both of these are read *synchronously*, before the registration effect
    // below has had any chance to run. See the comment on `restoreDone`.
    // allow-getstate: mount-once init effect - one-shot read of persisted notes directory
    const savedDir = useFileNotesStore.getState().notesDirectory;
    const restore = resolveRestoreTarget({
      panelId,
      isDetached,
      initialView,
      initialSideTab,
      initialCurrentPath,
      initialCurrentNotePath,
    });

    const checkInit = async () => {
      try {
        if (savedDir) {
          await fileNotesAPI.initialize(savedDir);
        }
        const initialized = await fileNotesAPI.isInitialized();
        if (!initialized) {
          setShowSetup(true);
          return;
        }

        await fileNotesAPI.ensureVerseNotesFolder();

        // The sidebar sub-tab is pure UI - restore it whether or not the note
        // below can be reopened.
        if (restore?.sideTab) {
          setSideTab(restore.sideTab);
        }

        const notePath = restore?.currentNotePath;
        const folderPath = restore?.currentPath || '';

        if (!notePath || restore?.view !== 'editor') {
          loadDirectory(folderPath);
          return;
        }

        // A remembered note may well be gone - renamed, moved, deleted, or on
        // a notes folder that isn't there any more. That is an ordinary
        // outcome of restoring a session, not an error: fall back to its
        // folder (and thence the root) silently. Startup must never open with
        // an error banner about a file the user has already moved on from.
        try {
          const note = isAbsolutePath(notePath)
            ? await fileNotesAPI.readNoteAbsolute(notePath)
            : await fileNotesAPI.readNote(notePath);
          if (note) {
            setCurrentNote(note);
            setCurrentNotePath(notePath);
            setView('editor');
            useNoteEditorStore.getState().resetContent(note.content || ''); // allow-getstate: restore async callback - imperative store reset outside render
            useFileNotesStore.getState().addRecentFile(notePath, note.title); // allow-getstate: restore async callback - imperative store update outside render
          } else {
            loadDirectory(folderPath);
          }
        } catch (err) {
          console.warn('[UserNotesPane] Could not reopen the remembered note:', notePath, err);
          loadDirectory(folderPath);
        }
      } catch (err) {
        console.error('Failed to check notes initialization:', err);
        setShowSetup(true);
      } finally {
        setRestoreDone(true);
      }
    };

    checkInit();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Dockview tab subtitle follows the open note title.
  useEffect(() => {
    if (view === 'editor' && currentNote?.title) {
      useLayoutStore.getState().setDynamicSubtitle(panelId, currentNote.title); // allow-getstate: effect - imperative dockview subtitle update outside render
    } else {
      useLayoutStore.getState().setDynamicSubtitle(panelId, null); // allow-getstate: effect - imperative dockview subtitle clear outside render
    }
  }, [panelId, view, currentNote?.title]);

  // Register this panel's position. Read back by DockviewTabRenderer when the
  // pane is popped out, and serialized into the session (ui.notesPanels) so the
  // next launch lands on the same note.
  //
  // Deliberately *not* cleared on unmount: a dockview panel unmounts whenever
  // its tab is switched away from or the layout is rebuilt, and the position
  // has to outlive that as well as a quit. Stale entries for panels that really
  // did go away are pruned on the next session restore (AppInitService).
  useEffect(() => {
    if (isDetached || !restoreDone) return;
    setNotesPanelNavState(panelId, { view, sideTab, currentPath, currentNotePath });
  }, [panelId, view, sideTab, currentPath, currentNotePath, isDetached, restoreDone]);
}

/**
 * Where this pane should open: the state handed over by a pop-out, or the
 * position the session remembered for this dockview panel.
 *
 * Detached windows never consult the session map - they are given their
 * position explicitly, and they share `DEFAULT_PANEL_ID` as a panel id, so a
 * lookup would be both wrong and cross-contaminating.
 */
function resolveRestoreTarget(args: {
  panelId: string;
  isDetached: boolean;
  initialView: 'browser' | 'editor' | undefined;
  initialSideTab: NotesSideTab | undefined;
  initialCurrentPath: string | undefined;
  initialCurrentNotePath: string | undefined;
}): NotesPanelNavState | undefined {
  const { panelId, isDetached, initialView, initialSideTab, initialCurrentPath, initialCurrentNotePath } = args;

  if (!isDetached) return getNotesPanelNavState(panelId);

  if (initialCurrentNotePath === undefined && initialCurrentPath === undefined) return undefined;
  return {
    // A pop-out that carried a note path is opening that note, even when the
    // (older) payload didn't say which view it was in.
    view: initialView ?? (initialCurrentNotePath ? 'editor' : 'browser'),
    sideTab: initialSideTab,
    currentPath: initialCurrentPath ?? '',
    currentNotePath: initialCurrentNotePath ?? '',
  };
}
