import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import * as fileNotesAPI from '../../../../services/fileNotesAPI';
import { DEFAULT_CHAPTER_STATE, type ChapterModeNavState } from '../../../../stores/notesChapterNavState';
import { getBookNameFromCache } from '../../../../utils/verseReference';
import { VERSE_NOTES_FOLDER } from '../utils';
import { chapterFromPath } from '../chapterPaneHelpers';
import { usePrimaryBibleChapter } from '../../chapter/usePrimaryBibleChapter';
import type { ChapterNotesHandle } from '../../chapter/ChapterNotesView';

export type PaneView = 'browser' | 'editor' | 'chapter';

interface UseChapterModeArgs {
  isDetached: boolean;
  initialChapter?: ChapterModeNavState;
  view: PaneView;
  currentPath: string;
  currentNotePath: string;
  editorIsDirty: boolean;
  handleSaveNote: () => void | Promise<void>;
  setView: (view: PaneView) => void;
  /** The navigation hook's loadDirectory (a ref, because that hook needs this one's output first). */
  loadDirectoryRef: MutableRefObject<((path: string) => void | Promise<void>) | null>;
  /** The verse-note opener's function (a ref, because the opener is created after this hook). */
  openVerseRef: MutableRefObject<((verseId?: number) => Promise<void>) | null>;
}

/**
 * Pane-side wiring of Chapter mode: its state, entering from a verse note or a
 * Verse Notes folder, leaving through "Single note", and routing an explicit
 * "Add/Edit note" from the Bible into the chapter view.
 */
export function useChapterMode(args: UseChapterModeArgs) {
  const { isDetached, initialChapter, view, currentPath, currentNotePath, editorIsDirty, handleSaveNote, setView, loadDirectoryRef, openVerseRef } = args;

  const [chapterState, setChapterState] = useState<ChapterModeNavState | null>(initialChapter ?? null);
  const handleRef = useRef<ChapterNotesHandle | null>(null);
  const primary = usePrimaryBibleChapter(isDetached);

  const latest = useRef({ view, chapterState, currentPath, currentNotePath, editorIsDirty, primary });
  latest.current = { view, chapterState, currentPath, currentNotePath, editorIsDirty, primary };
  /** While leaving the chapter view the opener must open a single note, not route back. */
  const leavingRef = useRef(false);

  const onStateChange = useCallback((update: (prev: ChapterModeNavState) => ChapterModeNavState) => {
    setChapterState(prev => (prev ? update(prev) : prev));
  }, []);

  const flushChapter = useCallback(async () => { await handleRef.current?.flush(); }, []);
  const deactivateChapter = useCallback(() => { handleRef.current?.deactivate(); }, []);

  const setChapterView = useCallback(() => setView('chapter'), [setView]);

  /** open-verse-note while in chapter view: stay there and focus the verse. */
  const routeToChapter = useCallback((verseId: number): boolean => {
    if (leavingRef.current || latest.current.view !== 'chapter' || !handleRef.current) return false;
    handleRef.current.openVerse(verseId, { focus: true });
    return true;
  }, []);

  const enterChapter = useCallback(async () => {
    const cur = latest.current;
    if (cur.view === 'editor' && cur.editorIsDirty) await handleSaveNote();
    const from = (cur.view === 'editor' ? chapterFromPath(cur.currentNotePath) : null)
      ?? chapterFromPath(cur.currentPath)
      ?? (cur.primary.book && cur.primary.chapter ? { book: cur.primary.book, chapter: cur.primary.chapter } : null)
      ?? { book: 1, chapter: 1 };
    const prev = latest.current.chapterState;
    const next: ChapterModeNavState = {
      ...DEFAULT_CHAPTER_STATE(from.book, from.chapter),
      ...(prev ? { translation: prev.translation, follow: prev.follow, onlyWithNotes: prev.onlyWithNotes } : {}),
      ...(from.verse ? { activeVerse: from.verse } : {}),
    };
    setChapterState(next);
    setView('chapter');
  }, [handleSaveNote, setView]);

  const exitToSingle = useCallback(async (verseId: number | null) => {
    leavingRef.current = true;
    try {
      if (verseId && openVerseRef.current) {
        await openVerseRef.current(verseId);
        return;
      }
      const s = latest.current.chapterState;
      const folder = s ? `${VERSE_NOTES_FOLDER}/${getBookNameFromCache(s.book)}/${s.chapter}` : '';
      let target = '';
      if (folder) {
        try {
          target = (await fileNotesAPI.listDirectory(folder)).length > 0 ? folder : '';
        } catch {
          target = '';
        }
      }
      await loadDirectoryRef.current?.(target);
    } finally {
      leavingRef.current = false;
    }
  }, [loadDirectoryRef, openVerseRef]);

  return { chapterState, setChapterState, handleRef, onStateChange, flushChapter, deactivateChapter, setChapterView, routeToChapter, enterChapter, exitToSingle };
}
