import type { CommentaryEntryData } from '../types';

/**
 * Determine whether a commentary entry is a passage-level entry
 * (covers multiple verses or a full chapter) rather than verse-specific.
 */
export function isPassageEntry(entry: CommentaryEntryData): boolean {
  return entry.entry_level === 'passage' || entry.entry_level === 'chapter' ||
    !!(entry.verse_id_end && entry.verse_id_end !== entry.verse_id_start);
}

/**
 * Filter and split commentary entries for a highlighted verse into
 * verse-specific entries and passage-level entries (sorted by specificity).
 *
 * If no verse is highlighted, returns only chapter-level entries as `verse`.
 */
export function filterCommentaryEntries(
  entries: CommentaryEntryData[],
  highlightedVerse: number | null | undefined,
): { verse: CommentaryEntryData[]; passage: CommentaryEntryData[] } {
  if (!highlightedVerse) {
    return {
      verse: entries.filter(e => e.entry_level === 'chapter'),
      passage: [],
    };
  }

  const filtered = entries.filter(entry =>
    entry.verse_id_start <= highlightedVerse &&
    (entry.verse_id_end ? entry.verse_id_end >= highlightedVerse : entry.verse_id_start === highlightedVerse)
  );

  const verse: CommentaryEntryData[] = [];
  const passage: CommentaryEntryData[] = [];

  for (const entry of filtered) {
    if (isPassageEntry(entry)) {
      passage.push(entry);
    } else {
      verse.push(entry);
    }
  }

  // Sort passage entries by specificity (narrower range first)
  passage.sort((a, b) => {
    const spanA = (a.verse_id_end ?? a.verse_id_start) - a.verse_id_start;
    const spanB = (b.verse_id_end ?? b.verse_id_start) - b.verse_id_start;
    return spanA - spanB;
  });

  return { verse, passage };
}
