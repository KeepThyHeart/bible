import { DEFAULT_DISPLAY_MODE, type DisplayMode } from './types';

/**
 * A Bible panel's passage encoded as a dockview panel parameter.
 *
 * Format: `abbreviation|bookNumber|chapter|verseId|displayMode`
 *
 * This is the *seed* for a newly created panel (from "+ New tab", a Ctrl-click
 * on a scripture link, or a pop-out). It is deliberately not the persistence
 * mechanism: the full passage state - navigation history, per-passage toggles -
 * round-trips through `sessionData.bible.panels`, keyed by panel id.
 */
export interface BiblePassageSeed {
  abbreviation: string;
  book: number;
  chapter: number;
  selectedVerseId?: number | null;
  displayMode?: DisplayMode;
}

export function encodeBibleContentKey(seed: BiblePassageSeed): string {
  return [
    seed.abbreviation,
    seed.book,
    seed.chapter,
    seed.selectedVerseId ?? '',
    seed.displayMode ?? DEFAULT_DISPLAY_MODE,
  ].join('|');
}

export function decodeBibleContentKey(contentKey: string | undefined): BiblePassageSeed | undefined {
  if (!contentKey) return undefined;
  const parts = contentKey.split('|');
  if (parts.length < 3) return undefined;
  const book = parseInt(parts[1], 10);
  const chapter = parseInt(parts[2], 10);
  if (Number.isNaN(book) || Number.isNaN(chapter)) return undefined;
  const verseId = parts[3] ? parseInt(parts[3], 10) : undefined;
  return {
    abbreviation: parts[0],
    book,
    chapter,
    selectedVerseId: Number.isNaN(verseId as number) ? null : verseId ?? null,
    displayMode: (parts[4] as DisplayMode) || DEFAULT_DISPLAY_MODE,
  };
}
