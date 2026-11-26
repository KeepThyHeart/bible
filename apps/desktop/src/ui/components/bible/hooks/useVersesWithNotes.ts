import { useEffect, useState } from 'react';
import { getVersesWithNotes } from '../../../services/notesAPI';
import { listVerseNotesInChapter, onNoteSaved } from '../../../services/fileNotesAPI';
import { onVerseNotesChanged, isVerseNotePath } from '../../../services/verseNoteMarkerEvents';
import { useNotesStore } from '../../../stores/useNotesStore';
import { useFileNotesStore } from '../../../stores/useFileNotesStore';
import { useToastStore } from '../../../stores/useToastStore';
import { getBookNameFromCache } from '../../../utils/verseReference';

/**
 * Loads the set of verse_ids in the current chapter that have user notes,
 * so the verse list can render note indicators. Reloads when the
 * chapter changes or any note is added/removed/updated.
 *
 * Covers both stores: database notes, and the per-verse `.bn` files the Notes
 * pane writes (`Verse Notes/<Book>/<chapter>/<verse>.bn`). A file counts only
 * when it has real content (the main process filters, see `noteHasContent`), so
 * a note cleared to empty or deleted loses its marker.
 */
export function useVersesWithNotes(
  currentVerses: Array<{ verse_id: number }>,
  currentBook: number,
  currentChapter: number,
) {
  const [versesWithNotes, setVersesWithNotes] = useState<Set<number>>(new Set());
  const noteChangeCounter = useNotesStore(state => state.noteChangeCounter);
  // A verse note file is opened (and so created) through addRecentFile.
  const recentFiles = useFileNotesStore(state => state.recentFiles);
  // A verse note was deleted, moved, or saved to/from empty (this window), or
  // saved by another window: the marker set may have changed.
  const [verseNoteTick, setVerseNoteTick] = useState(0);
  useEffect(() => {
    const bump = () => setVerseNoteTick(n => n + 1);
    const offLocal = onVerseNotesChanged(bump);
    const offRemote = onNoteSaved(e => { if (isVerseNotePath(e.absolutePath)) bump(); });
    return () => { offLocal(); offRemote(); };
  }, []);

  useEffect(() => {
    if (currentVerses.length > 0) {
      const startVerseId = currentVerses[0].verse_id;
      const endVerseId = currentVerses[currentVerses.length - 1].verse_id;
      let cancelled = false;

      const fileVerses = (): Promise<number[]> => {
        const bookName = getBookNameFromCache(currentBook);
        if (bookName === 'Unknown') return Promise.resolve([]);
        return listVerseNotesInChapter(bookName, currentChapter)
          .then(entries => entries
            .filter(e => !e.isDirectory)
            .map(e => parseInt(e.name, 10))
            .filter(n => !Number.isNaN(n))
            .map(n => currentBook * 1000000 + currentChapter * 1000 + n))
          .catch(() => []);
      };

      Promise.all([getVersesWithNotes(startVerseId, endVerseId), fileVerses()])
        .then(([dbVerses, fileVs]) => {
          if (!cancelled) setVersesWithNotes(new Set([...dbVerses, ...fileVs]));
        })
        .catch(err => {
          console.error('Failed to load verses with notes:', err);
          useToastStore.getState().addToast('Failed to load verses.', 'error'); // allow-getstate: error/event handler - imperative toast
        });
      return () => { cancelled = true; };
    }
    return undefined;
  }, [currentBook, currentChapter, currentVerses.length, noteChangeCounter, recentFiles, verseNoteTick]);

  return versesWithNotes;
}
