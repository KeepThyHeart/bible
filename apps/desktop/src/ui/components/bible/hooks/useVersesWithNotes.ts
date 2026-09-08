import { useEffect, useState } from 'react';
import { getVersesWithNotes } from '../../../services/notesAPI';
import { useNotesStore } from '../../../stores/useNotesStore';
import { useToastStore } from '../../../stores/useToastStore';

/**
 * Loads the set of verse_ids in the current chapter that have user notes,
 * so the verse list can render note indicators. Reloads when the
 * chapter changes or any note is added/removed/updated.
 */
export function useVersesWithNotes(
  currentVerses: Array<{ verse_id: number }>,
  currentBook: number,
  currentChapter: number,
) {
  const [versesWithNotes, setVersesWithNotes] = useState<Set<number>>(new Set());
  const noteChangeCounter = useNotesStore(state => state.noteChangeCounter);

  useEffect(() => {
    if (currentVerses.length > 0) {
      const startVerseId = currentVerses[0].verse_id;
      const endVerseId = currentVerses[currentVerses.length - 1].verse_id;

      getVersesWithNotes(startVerseId, endVerseId)
        .then(verses => setVersesWithNotes(verses))
        .catch(err => {
          console.error('Failed to load verses with notes:', err);
          useToastStore.getState().addToast('Failed to load verses.', 'error'); // allow-getstate: error/event handler - imperative toast
        });
    }
  }, [currentBook, currentChapter, currentVerses.length, noteChangeCounter]);

  return versesWithNotes;
}
