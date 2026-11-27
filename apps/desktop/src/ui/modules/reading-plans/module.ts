/**
 * Reading plans, lazy half (activated at startup, `onStartupFinished`): puts the "today's reading"
 * bar into the Bible pane's `readerBars` slot and the start / end of reading blocks (task 0196) into
 * `readerVerseBlocks`. The bar itself (and the plan store behind it) loads
 * on first render, and shows nothing for a user without plans.
 *
 * The bar is driven by the props BiblePane passes through the slot; there is no other reader
 * listening (no `reader.*` hook is needed).
 */
import { createElement, lazy, Suspense } from 'react';
import type { FeatureModuleContext } from '@bible/core/browser';
import { newTabRows, readerBars, readerChapterEnd, readerVerseBlocks, type ReaderBarProps, type ReaderChapterEndProps } from '../host/slots';
import ReadingPlanVerseBlocks from './ReadingPlans/ReadingPlanVerseBlocks';
import { activatePlanReadingTab } from './planReadingTab';
import { activateReadingPlanBadge } from './readingPlanBadge';
import TodayReadingRow from './ReadingPlans/TodayReadingRow';

const ReadingPlanBar = lazy(() => import('./ReadingPlans/ReadingPlanBar'));
const ReadingPlanChapterEnd = lazy(() => import('./ReadingPlans/ReadingPlanChapterEnd'));

/** The slot entry: lazy-loads the bar and passes the reader's chapter through. */
export function ReadingPlanReaderBar(props: ReaderBarProps) {
  return createElement(Suspense, { fallback: null }, createElement(ReadingPlanBar, props));
}

/** The `readerChapterEnd` slot entry: the "Continue reading" link and, in Study / Parallel, the end block. */
export function ReadingPlanReaderChapterEnd(props: ReaderChapterEndProps) {
  return createElement(Suspense, { fallback: null }, createElement(ReadingPlanChapterEnd, props));
}

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  ctx.subscriptions.push(readerBars.register(ReadingPlanReaderBar));
  ctx.subscriptions.push(readerVerseBlocks.register(ReadingPlanVerseBlocks));
  ctx.subscriptions.push(readerChapterEnd.register(ReadingPlanReaderChapterEnd));
  // Keeps the reusable plan reading tab's title in step with its chapter (also after a restart / layout restore).
  ctx.subscriptions.push(activatePlanReadingTab());
  ctx.subscriptions.push(activateReadingPlanBadge());
  ctx.subscriptions.push(newTabRows.register(TodayReadingRow));
}
