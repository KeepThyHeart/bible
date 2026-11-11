/**
 * Fetching the text behind whatever the presenter has put on the wall.
 *
 * Two things matter here beyond the obvious:
 *
 *  - **Chapters are cached for the life of the page.** A presenter moving back
 *    and forth between two readings is the normal case, and a re-fetch that
 *    empties the screen for 200ms while it completes reads as a glitch.
 *  - **A failed fetch keeps the previous chapter on screen.** Same rule as the
 *    stream: nothing that goes wrong may blank the wall.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { API_BASE } from '../../../utils/apiUrl';
import type { PresentItem } from './protocol';

export interface ChapterVerse {
  verse_id: number;
  verse: number;
  text: string;
  text_html: string;
  is_paragraph_start?: boolean;
  section_heading?: string;
}

export interface Passage {
  key: string;
  module: string;
  book: number;
  chapter: number;
  bookName: string;
  verses: ChapterVerse[];
}

function passageKey(item: PresentItem | null): string | null {
  if (!item || item.kind !== 'passage') return null;
  return `${item.module}/${item.book}/${item.chapter}`;
}

/** Book names, fetched once. Falls back to the book number, which is never wrong. */
function useBookNames(): Map<number, string> {
  const [names, setNames] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/books`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((books: Array<{ book_number: number; book_name: string }>) => {
        if (cancelled) return;
        setNames(new Map(books.map(b => [b.book_number, b.book_name])));
      })
      .catch(() => {
        // The header falls back to "Book 43", which is ugly but readable, and
        // is better than an empty heading or a thrown error.
      });
    return () => { cancelled = true; };
  }, []);

  return names;
}

/** A passage whose chapter failed to load or came back empty. */
export interface UnavailablePassage {
  key: string;
  module: string;
  book: number;
  chapter: number;
  bookName: string;
}

export function usePassage(item: PresentItem | null): Passage | null {
  return usePassageState(item).passage;
}

/**
 * Like `usePassage`, but also says when the current item's chapter cannot be
 * shown (fetch failed, or the translation has no such text). `unavailable` is
 * null while loading, so "still loading" and "not available" stay distinct.
 * `passage` keeps its old behaviour of holding the previous chapter.
 */
export function usePassageState(item: PresentItem | null): { passage: Passage | null; unavailable: UnavailablePassage | null } {
  const [passage, setPassage] = useState<Passage | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const cache = useRef(new Map<string, ChapterVerse[]>());
  const bookNames = useBookNames();

  const key = passageKey(item);

  useEffect(() => {
    if (!item || item.kind !== 'passage' || !key) {
      // A non-passage item clears the passage, but only once something else is
      // genuinely on the wall -- `live: null` is handled by the lobby, not here.
      if (item === null) setPassage(null);
      return;
    }

    setFailedKey(null);
    const cached = cache.current.get(key);
    if (cached) {
      setPassage({
        key,
        module: item.module,
        book: item.book,
        chapter: item.chapter,
        bookName: bookNames.get(item.book) ?? `Book ${item.book}`,
        verses: cached,
      });
      return;
    }

    let cancelled = false;
    fetch(`${API_BASE}/api/bible/${encodeURIComponent(item.module)}/${item.book}/${item.chapter}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { verses: ChapterVerse[] }) => {
        if (cancelled || !Array.isArray(body.verses)) return;
        cache.current.set(key, body.verses);
        setPassage({
          key,
          module: item.module,
          book: item.book,
          chapter: item.chapter,
          bookName: bookNames.get(item.book) ?? `Book ${item.book}`,
          verses: body.verses,
        });
      })
      .catch(() => {
        // Leave whatever is on screen. The presenter will notice the wall did
        // not follow and try again; an empty screen helps nobody. The failure
        // is recorded only so the presenter's own preview can say so.
        if (!cancelled) setFailedKey(key);
      });

    return () => { cancelled = true; };
  }, [key, item, bookNames]);

  let unavailable: UnavailablePassage | null = null;
  if (item && item.kind === 'passage' && key) {
    const emptyLoaded = passage !== null && passage.key === key && passage.verses.length === 0;
    if (failedKey === key || emptyLoaded) {
      unavailable = {
        key, module: item.module, book: item.book, chapter: item.chapter,
        bookName: bookNames.get(item.book) ?? `Book ${item.book}`,
      };
    }
  }
  return { passage, unavailable };
}

/**
 * The verses a passage item actually asks for.
 *
 * A `verseStart`/`verseEnd` selection narrows the chapter without a second
 * fetch, because the whole chapter is already cached.
 */
export function selectedVerses(passage: Passage, item: PresentItem): ChapterVerse[] {
  if (item.kind !== 'passage') return passage.verses;
  const first = item.verseStart ?? 1;
  const last = item.verseEnd ?? Number.MAX_SAFE_INTEGER;
  return passage.verses.filter(v => v.verse >= first && v.verse <= last);
}
