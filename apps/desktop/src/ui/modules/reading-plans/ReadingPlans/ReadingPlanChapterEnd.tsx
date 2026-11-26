/**
 * The `readerChapterEnd` slot item (task 0222 R3-6): what the reading plan adds at the end of a chapter.
 *  - A reading that goes on past this chapter (due, or the one opened from a plan): the link "Continue reading:
 *    Genesis 5 (chapter 2 of 3)", which goes to the next chapter like the reader's own next link.
 *  - Study and Parallel views have no per-verse slot, so the end block of a reading that ends in this chapter is
 *    drawn here. Standard and Reading modes draw it after the verse (`ReadingPlanVerseBlocks`).
 * Draws nothing for a reader with no plans.
 */
import React, { lazy, Suspense, useEffect } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import type { ReaderChapterEndProps } from '../../host/slots';
import { useI18n } from '../../../contexts/useI18n';
import { rpTextWith } from '../rpText';
import { useReadingPlanStore } from '../useReadingPlanStore';
import { todaySetFor, useActiveReadingStore } from '../useActiveReadingStore';
import { endModelsForChapter } from './ReadingPlanVerseBlocks';
import { useReadingPlanLabels } from './useReadingPlanLabels';

const EndOfReadingBlock = lazy(() => import('./ReadingBlocks').then((m) => ({ default: m.EndOfReadingBlock })));

const linkRow: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.75rem', margin: '0.5rem 0', fontSize: '0.875rem',
};

const ReadingPlanChapterEnd: React.FC<ReaderChapterEndProps> = ({ book, chapter, displayMode, onNext }) => {
  const { t } = useI18n();
  const labels = useReadingPlanLabels();
  const todays = useReadingPlanStore((s) => s.todays);
  const ensureLoaded = useReadingPlanStore((s) => s.ensureLoaded);
  const info = useActiveReadingStore((s) => s.info);
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  const tx = (key: string, fallback: string, params: Record<string, unknown> = {}) => rpTextWith(t, key, fallback, params);

  // Readings that continue past this chapter: due ones of today's set and the opened one.
  const continuing: { key: string; n: number; count: number; next: { book: number; chapter: number } | null }[] = [];
  const seen = new Set<string>();
  const consider = (key: string, reading: ReadingPlans.Reading, done: boolean, active: boolean) => {
    if ((done && !active) || ReadingPlans.endsInChapter(reading, book, chapter)) return;
    const at = ReadingPlans.chapterOf(reading, book, chapter);
    if (!at || at.n >= at.count || seen.has(key)) return;
    seen.add(key);
    continuing.push({ key, ...at, next: ReadingPlans.nextChapterIn(reading, book, chapter) });
  };
  for (const e of todaySetFor(todays)) {
    const active = !!info && info.enrollmentId === e.view.enrollmentId && info.day === e.r.day && info.index === e.r.index;
    consider(`${e.view.enrollmentId}:${e.r.day}:${e.r.index}`, e.r.reading, e.r.done, active);
  }
  if (info) consider(`${info.enrollmentId}:${info.day}:${info.index}`, info.reading, info.done, true);

  const ends = displayMode === 'study' || displayMode === 'parallel' ? endModelsForChapter(todays, info, book, chapter) : [];
  if (continuing.length === 0 && ends.length === 0) return null;

  const first = continuing[0];
  const nextName = first?.next ? `${labels.bookName(first.next.book)} ${first.next.chapter}` : `${labels.bookName(book)} ${chapter + 1}`;
  return (
    <div data-testid="reading-plan-chapter-end">
      {first ? (
        <div style={linkRow}>
          <button type="button" className="kth-link" data-testid="reading-plan-continue" onClick={onNext}>
            {tx('readingPlans.reader.continueChapter', 'Continue reading: {chapter}', { chapter: nextName })}
            {` (${tx('readingPlans.reader.chapterOf', 'chapter {n} of {count}', { n: first.n + 1, count: first.count })})`}
          </button>
        </div>
      ) : null}
      {ends.length > 0 ? (
        <Suspense fallback={null}>
          {ends.map((m) => <EndOfReadingBlock key={`${m.enrollmentId}:${m.day}:${m.index}`} model={m} inParagraph={false} />)}
        </Suspense>
      ) : null}
    </div>
  );
};

export default ReadingPlanChapterEnd;
