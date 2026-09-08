import React, { useMemo } from 'react';
import { VerseIdHelper } from '@bible/core';
import type { CommentaryEntrySummary } from '../../stores/useCommentaryStore';
import { useI18n } from '../../contexts/useI18n';

interface CommentaryEmptyVerseGridProps {
  /** All entry summaries for the current commentary module. */
  summaries: CommentaryEntrySummary[];
  /** The current verse the user is viewing (used to derive book+chapter). */
  currentVerseId: number;
  /** Called with the verse_id to jump to. */
  onSelectVerse: (verseId: number) => void;
}

/**
 * Grid of verse numbers in the current chapter that DO have commentary entries.
 * Rendered when the current commentary has no entry for the selected verse -
 * gives the user a fast way to jump to the nearest entry within the same
 * chapter without having to open the full tree view.
 *
 * A summary covers a verse if `verse_id_start <= verseId <= (verse_id_end ?? verse_id_start)`.
 */
const CommentaryEmptyVerseGrid: React.FC<CommentaryEmptyVerseGridProps> = ({ summaries, currentVerseId, onSelectVerse }) => {
  const { t } = useI18n();
  const parsed = VerseIdHelper.parse(currentVerseId);

  // Compute the set of verse numbers in the current chapter that have coverage.
  // Each summary may cover a range; we expand within the current chapter only.
  const { verseNumbers, verseToStart } = useMemo(() => {
    const numbers = new Set<number>();
    const startByVerse = new Map<number, number>(); // verse-num -> verse_id to open
    for (const s of summaries) {
      const startVid = s.verse_id_start;
      const endVid = s.verse_id_end ?? s.verse_id_start;
      const startParsed = VerseIdHelper.parse(startVid);
      const endParsed = VerseIdHelper.parse(endVid);
      // Only include entries that overlap the current book+chapter.
      if (startParsed.bookNumber > parsed.bookNumber || endParsed.bookNumber < parsed.bookNumber) continue;
      // Clamp the range to the current chapter
      const overlapStartVerse =
        startParsed.bookNumber === parsed.bookNumber && startParsed.chapter === parsed.chapter
          ? startParsed.verse
          : (startParsed.bookNumber < parsed.bookNumber || startParsed.chapter < parsed.chapter ? 1 : -1);
      const overlapEndVerse =
        endParsed.bookNumber === parsed.bookNumber && endParsed.chapter === parsed.chapter
          ? endParsed.verse
          : (endParsed.bookNumber > parsed.bookNumber || endParsed.chapter > parsed.chapter ? 176 : -1);
      if (overlapStartVerse < 1 || overlapEndVerse < 1) continue;
      for (let v = overlapStartVerse; v <= overlapEndVerse; v++) {
        if (!numbers.has(v)) {
          numbers.add(v);
          // Prefer the original entry start when it lands within this chapter,
          // otherwise open at the clamped verse in the current chapter.
          const targetVerseId =
            startParsed.bookNumber === parsed.bookNumber && startParsed.chapter === parsed.chapter
              ? startVid
              : VerseIdHelper.calculate(parsed.bookNumber, parsed.chapter, v);
          startByVerse.set(v, targetVerseId);
        }
      }
    }
    const sorted = Array.from(numbers).sort((a, b) => a - b);
    return { verseNumbers: sorted, verseToStart: startByVerse };
  }, [summaries, parsed.bookNumber, parsed.chapter]);

  if (verseNumbers.length === 0) {
    return null;
  }

  return (
    <div className="mt-md" data-testid="commentary-empty-verse-grid">
      <div className="text-xs text-text-secondary mb-sm">
        {t('commentaryEmptyVerseGrid.versesInChapterWithEntries', { v1: parsed.chapter })}
      </div>
      <div
        className="flex flex-wrap gap-1"
        role="list"
        aria-label={`Verses in chapter ${parsed.chapter} with commentary entries`}
      >
        {verseNumbers.map(v => {
          const targetVid = verseToStart.get(v) ?? VerseIdHelper.calculate(parsed.bookNumber, parsed.chapter, v);
          const isCurrent = v === parsed.verse;
          return (
            <button
              key={v}
              role="listitem"
              data-testid={`commentary-empty-verse-btn-${v}`}
              onClick={() => onSelectVerse(targetVid)}
              className={`text-xs rounded transition-colors ${
                isCurrent
                  ? 'bg-accent text-text-on-accent'
                  : 'bg-background-tertiary text-text-primary hover:bg-accent hover:text-text-on-accent'
              }`}
              style={{ minWidth: '32px', padding: '4px 8px' }}
              title={`Jump to verse ${v}`}
            >
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CommentaryEmptyVerseGrid;
export type { CommentaryEmptyVerseGridProps };
