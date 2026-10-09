/**
 * Reading plans, lazy half (activated at startup, `onStartupFinished`): puts the "today's reading"
 * bar into the Bible pane's `readerBars` slot. The bar itself (and the plan store behind it) loads
 * on first render, and shows nothing for a user without plans.
 *
 * The bar is driven by the props BiblePane passes through the slot; there is no other reader
 * listening (no `reader.*` hook is needed).
 */
import { createElement, lazy, Suspense } from 'react';
import type { FeatureModuleContext } from '@bible/core/browser';
import { readerBars, type ReaderBarProps } from '../host/slots';

const ReadingPlanBar = lazy(() => import('./ReadingPlans/ReadingPlanBar'));

/** The slot entry: lazy-loads the bar and passes the reader's chapter through. */
export function ReadingPlanReaderBar(props: ReaderBarProps) {
  return createElement(Suspense, { fallback: null }, createElement(ReadingPlanBar, props));
}

export async function activate(ctx: FeatureModuleContext): Promise<void> {
  ctx.subscriptions.push(readerBars.register(ReadingPlanReaderBar));
}
