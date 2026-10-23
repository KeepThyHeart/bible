/**
 * The `readerVerseBlocks` slot item (task 0196): called for every verse the reader draws, so it stays
 * cheap (one store selector and a pure check) and loads the block UI only for the verses that need it.
 */
import React, { lazy, Suspense } from 'react';
import { ReadingPlans } from '@bible/core/browser';
import type { ReaderVerseBlockProps } from '../../host/slots';
import { useActiveReadingStore } from '../useActiveReadingStore';

const StartOfReadingBlock = lazy(() => import('./ReadingBlocks').then((m) => ({ default: m.StartOfReadingBlock })));
const EndOfReadingBlock = lazy(() => import('./ReadingBlocks').then((m) => ({ default: m.EndOfReadingBlock })));

const ReadingPlanVerseBlocks: React.FC<ReaderVerseBlockProps> = ({ verseId, prevVerseId, nextVerseId, position, inParagraph }) => {
  const info = useActiveReadingStore((s) => s.info);
  if (!info) return null;
  const at = ReadingPlans.blockPlacement(info.reading, verseId, prevVerseId, nextVerseId);
  if (position === 'before' ? !at.start : !at.end) return null;
  const Block = position === 'before' ? StartOfReadingBlock : EndOfReadingBlock;
  return <Suspense fallback={null}><Block info={info} inParagraph={inParagraph} /></Suspense>;
};

export default ReadingPlanVerseBlocks;
