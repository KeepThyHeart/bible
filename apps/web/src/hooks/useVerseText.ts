import { useState, useEffect } from 'preact/hooks';
import { bibleStore } from '../stores/bibleStore';
import { useStore } from './useStore';
import type { IBibleDataProvider } from '../providers/interfaces';

/**
 * Fetches the plain text of a verse, first checking the already-loaded
 * Bible pane data (instant) then falling back to the API.
 */
export function useVerseText(verseId: number | null | undefined, bibleProvider?: IBibleDataProvider): string {
  const [verseText, setVerseText] = useState('');
  const bibleVerses = useStore(bibleStore, () => bibleStore.getActiveTab()?.verses);

  useEffect(() => {
    if (!verseId) {
      setVerseText('');
      return;
    }
    // Try to get verse text from the already-loaded Bible pane data (instant, no API call)
    if (bibleVerses) {
      const cached = bibleVerses.find(v => v.verse_id === verseId);
      if (cached) {
        const raw = cached.text_html || cached.text || '';
        setVerseText(raw.replace(/<[^>]*>/g, '').trim());
        return;
      }
    }
    // Fallback: fetch from API if not in local cache
    if (bibleProvider) {
      const moduleAbbr = bibleStore.getActiveTab()?.moduleAbbr || 'KJV';
      bibleProvider.getVerse(moduleAbbr, verseId).then(data => {
        const raw = data.text_html || data.text || '';
        setVerseText(raw.replace(/<[^>]*>/g, '').trim());
      }).catch(() => setVerseText(''));
    }
  }, [bibleProvider, verseId, bibleVerses]);

  return verseText;
}
