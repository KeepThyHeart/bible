/**
 * Follow for chapter mode: keeps the view on the reader's place, using the two mechanisms
 * Commentary uses (not its controller):
 *  (a) the verse the reader picked, `currentVerseId` of this notes panel; and
 *  (b) the chapter the primary Bible panel has loaded, which stands down while a preview shows.
 * Both refs are seeded at mount so a restored position is not overwritten on startup. A
 * Follow-driven move never asks for focus, so the Bible pane keeps the keyboard.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useNotesStore } from '../../../stores/useNotesStore';
import { parseVerseId } from '../../../utils/verseReference';
import type { PrimaryBibleChapter } from './usePrimaryBibleChapter';

export interface ChapterFollowTarget {
  book: number;
  chapter: number;
  verseId?: number;
  focus: false;
}

export interface UseChapterFollowArgs {
  panelId: string;
  follow: boolean;
  /** The chapter currently shown. */
  book: number;
  chapter: number;
  primary: PrimaryBibleChapter;
  onTarget: (target: ChapterFollowTarget) => void;
}

export interface ChapterFollowResult {
  /** Set when Follow is off and the Bible pane is on another chapter. */
  notFollowing: { book: number; chapter: number } | null;
  /** Jump to the Bible's chapter (and the picked verse when it lies there). */
  goThere: () => void;
}

export function useChapterFollow({ panelId, follow, book, chapter, primary, onTarget }: UseChapterFollowArgs): ChapterFollowResult {
  const currentVerseId = useNotesStore(s => s.panels.get(panelId)?.currentVerseId) ?? null;

  const lastVerse = useRef<number | null>(currentVerseId);
  const lastChapter = useRef<number | null>(primary.firstVerseId);
  const latest = useRef({ onTarget, follow, previewActive: primary.previewActive });
  latest.current = { onTarget, follow, previewActive: primary.previewActive };

  // (a) the picked verse
  useEffect(() => {
    if (currentVerseId === lastVerse.current) return;
    lastVerse.current = currentVerseId;
    if (!latest.current.follow || currentVerseId === null) return;
    const p = parseVerseId(currentVerseId);
    if (p.verse < 1) return;
    latest.current.onTarget({ book: p.bookNumber, chapter: p.chapter, verseId: currentVerseId, focus: false });
  }, [currentVerseId]);

  // (b) the Bible's loaded chapter
  const { firstVerseId, previewActive } = primary;
  useEffect(() => {
    if (previewActive) return; // a glance at a cross-reference is not a move
    if (firstVerseId === lastChapter.current) return;
    lastChapter.current = firstVerseId;
    if (!latest.current.follow || firstVerseId === null) return;
    const p = parseVerseId(firstVerseId);
    latest.current.onTarget({ book: p.bookNumber, chapter: p.chapter, focus: false });
  }, [firstVerseId, previewActive]);

  const goThere = useCallback(() => {
    // The picked verse wins when it lies in the Bible's chapter (or the Bible's chapter is unknown).
    if (primary.book !== null && primary.chapter !== null) {
      const picked = currentVerseId !== null ? parseVerseId(currentVerseId) : null;
      const sameChapter = picked && picked.bookNumber === primary.book && picked.chapter === primary.chapter && picked.verse >= 1;
      onTarget({
        book: primary.book,
        chapter: primary.chapter,
        verseId: sameChapter ? currentVerseId! : undefined,
        focus: false,
      });
    } else if (currentVerseId !== null) {
      const p = parseVerseId(currentVerseId);
      if (p.verse >= 1) onTarget({ book: p.bookNumber, chapter: p.chapter, verseId: currentVerseId, focus: false });
    }
  }, [primary.book, primary.chapter, currentVerseId, onTarget]);

  const notFollowing =
    !follow && !primary.previewActive && primary.book !== null && primary.chapter !== null &&
    (primary.book !== book || primary.chapter !== chapter)
      ? { book: primary.book, chapter: primary.chapter }
      : null;

  return { notFollowing, goThere };
}
