/**
 * The `readerVerseBlocks` slot item (task 0196, reworked in task 0222 R3-6): called for every verse the reader
 * draws, so it stays cheap and loads the block UI only for the verses that need it. The start block belongs to
 * the reading opened from a plan; the end block to any of today's readings whose last verse is this one (ticked
 * or not), plus the opened reading (so a read-ahead keeps its block). Today's set is flattened once per plan-store
 * refresh (`todaySetFor`), not per verse.
 */
import React, { lazy, Suspense, useEffect } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import type { ReaderVerseBlockProps } from '../../host/slots';
import { useReadingPlanStore } from '../useReadingPlanStore';
import { todaySetFor, useActiveReadingStore, type ActiveReadingInfo, type TodayEntry } from '../useActiveReadingStore';
import type { EndBlockModel } from './ReadingBlocks';

const StartOfReadingBlock = lazy(() => import('./ReadingBlocks').then((m) => ({ default: m.StartOfReadingBlock })));
const EndOfReadingBlock = lazy(() => import('./ReadingBlocks').then((m) => ({ default: m.EndOfReadingBlock })));

/** The end-block model of one of today's readings, for the chapter on screen. */
export function endModelOf(e: TodayEntry, book: number, chapter: number): EndBlockModel {
  return {
    enrollmentId: e.view.enrollmentId, planKey: e.view.planKey, planName: e.view.planName,
    day: e.r.day, index: e.r.index, reading: e.r.reading, done: e.r.done, next: e.next, nextDay: e.nextDay,
    chapter: ReadingPlans.chapterOf(e.r.reading, book, chapter),
  };
}

/** The end-block model of the opened reading when it is not one of today's (a read-ahead). */
export function activeEndModel(info: ActiveReadingInfo, book: number, chapter: number): EndBlockModel {
  return {
    enrollmentId: info.enrollmentId, planKey: info.planKey, planName: info.planName, day: info.day, index: info.index,
    reading: info.reading, done: info.done, next: info.next, nextDay: info.day < info.dayCount ? info.day + 1 : null,
    chapter: ReadingPlans.chapterOf(info.reading, book, chapter),
  };
}

/** End-block models for readings that end in this chapter: today's set, then the opened reading unless it is in it. */
export function endModelsForChapter(
  todays: readonly ReadingPlans.TodayView[], info: ActiveReadingInfo | null, book: number, chapter: number,
): EndBlockModel[] {
  const set = todaySetFor(todays);
  const out = set.filter((e) => ReadingPlans.endsInChapter(e.r.reading, book, chapter)).map((e) => endModelOf(e, book, chapter));
  if (info && ReadingPlans.endsInChapter(info.reading, book, chapter)
    && !set.some((e) => e.view.enrollmentId === info.enrollmentId && e.r.day === info.day && e.r.index === info.index)) {
    out.push(activeEndModel(info, book, chapter));
  }
  return out;
}

const ReadingPlanVerseBlocks: React.FC<ReaderVerseBlockProps> = ({ verseId, prevVerseId, nextVerseId, position, inParagraph }) => {
  const info = useActiveReadingStore((s) => s.info);
  const todays = useReadingPlanStore((s) => s.todays);
  const ensureLoaded = useReadingPlanStore((s) => s.ensureLoaded);
  useEffect(() => { void ensureLoaded(); }, [ensureLoaded]);

  if (position === 'before') {
    if (!info || !ReadingPlans.blockPlacement(info.reading, verseId, prevVerseId, nextVerseId).start) return null;
    return <Suspense fallback={null}><StartOfReadingBlock info={info} inParagraph={inParagraph} /></Suspense>;
  }
  const { book, chapter } = ReadingPlans.splitVid(verseId);
  const models: EndBlockModel[] = [];
  for (const e of todaySetFor(todays)) {
    if (ReadingPlans.blockPlacement(e.r.reading, verseId, prevVerseId, nextVerseId).end) models.push(endModelOf(e, book, chapter));
  }
  if (info && ReadingPlans.blockPlacement(info.reading, verseId, prevVerseId, nextVerseId).end
    && !models.some((m) => m.enrollmentId === info.enrollmentId && m.day === info.day && m.index === info.index)) {
    models.push(activeEndModel(info, book, chapter));
  }
  if (models.length === 0) return null;
  return (
    <Suspense fallback={null}>
      {models.map((m) => <EndOfReadingBlock key={`${m.enrollmentId}:${m.day}:${m.index}`} model={m} inParagraph={inParagraph} />)}
    </Suspense>
  );
};

export default ReadingPlanVerseBlocks;
