/**
 * One list's learning state, for Home's list tiles.
 *
 * A list is *learned* once every verse in it is well learned (`PassageView.wellLearned`: every
 * applicable activity satisfied, see `ladder.ts#passageWellLearned`). Levels never fall except by
 * an explicit reset, so a learned list stays learned; what keeps coming back is review: each
 * activity keeps its own spaced schedule (`scheduler.ts`, 1 to 180 days), and a verse is due for
 * review when any of its applicable activities is (`today.ts#verseStatus`).
 *
 * Pure and DOM-free; `now` always arrives as an argument.
 */

import type { PassageView } from './types';
import { overallProgress } from './progress';
import { localDayStart } from './status';
import { verseStatus } from './today';

export type ListLearnState = 'empty' | 'learning' | 'learned';

export interface ListStatus {
  state: ListLearnState;
  /** Percent of applicable activities complete, 0..100 (100 once learned). */
  percent: number;
  verses: number;
  versesLearned: number;
  /** Started verses with a review due now. */
  dueCount: number;
  /** Earliest review still ahead (ms), when nothing is due; null when nothing is scheduled. */
  nextReviewAt: number | null;
}

export function listStatus(passages: readonly PassageView[], now: number): ListStatus {
  const p = overallProgress(passages);
  const dayStart = localDayStart(now);
  let dueCount = 0;
  let next: number | null = null;
  for (const pv of passages) {
    const info = verseStatus(pv, now, dayStart);
    if (info.status === 'new') continue;
    if (info.dueNow) dueCount += 1;
    else if (info.nextReviewAt !== null && (next === null || info.nextReviewAt < next)) next = info.nextReviewAt;
  }
  const verses = passages.length;
  const learned = verses > 0 && p.versesLearned === verses;
  return {
    state: verses === 0 ? 'empty' : learned ? 'learned' : 'learning',
    percent: learned ? 100 : Math.min(p.percent, 99),
    verses,
    versesLearned: p.versesLearned,
    dueCount,
    nextReviewAt: dueCount > 0 ? null : next,
  };
}
