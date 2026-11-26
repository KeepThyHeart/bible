/**
 * My verses progress helpers (task 0219 round 2, design section 6): activity blocks per verse, the
 * "need" sort key and the overall progress bar numbers.
 *
 * Pure and DOM-free; `now` always arrives as an argument.
 */

import type { PassageView, Rung, RungView } from './types';
import { RUNG_ORDER } from './types';
import { inRungOrder, isActivitySatisfied, isOptionalRung, TEXT_RECALL_CHAIN, WELL_LEARNED_LEVEL } from './ladder';
import { localDayStart } from './status';
import { verseStatus } from './today';

export type ActivityBlockState = 'notStarted' | 'practicing' | 'complete' | 'notApplicable';

export interface ActivityBlock {
  rung: Rung;
  state: ActivityBlockState;
  tiers: number;
  tiersPassed: number;
  level: number;
  bestScore: number | null;
  /** The harder activity that satisfies this one by carry-down (own level below 4), else null. */
  coveredBy: Rung | null;
  /** True when a click may start the activity. */
  startable: boolean;
  naReason: 'singleVerse' | 'speech' | null;
}

/** The fixed ladder, in `RUNG_ORDER` order. */
export const BLOCK_RUNGS: readonly Rung[] = inRungOrder(RUNG_ORDER.map((rung) => ({ rung }))).map((r) => r.rung);

const REFERENCE_RUNGS: readonly Rung[] = ['refmatch', 'refprovide'];

function coveringRung(rungs: readonly RungView[], rung: Rung): Rung | null {
  const position = TEXT_RECALL_CHAIN.indexOf(rung);
  if (position === -1) return null;
  const hit = rungs.find(
    (r) =>
      (r.applicable || isOptionalRung(r.rung)) &&
      r.level >= WELL_LEARNED_LEVEL &&
      TEXT_RECALL_CHAIN.indexOf(r.rung) > position,
  );
  return hit ? hit.rung : null;
}

/**
 * One block per ladder rung that is worth showing. Walks `BLOCK_RUNGS`, not `pv.rungs`: a single-verse
 * passage has no `ordering` card, which shows as not applicable. Reference rungs are omitted while gated
 * and recite only appears when `reciteShown`.
 */
export function activityBlocks(pv: PassageView, opts: { reciteShown: boolean }): ActivityBlock[] {
  const blocks: ActivityBlock[] = [];
  for (const rung of BLOCK_RUNGS) {
    const card = pv.rungs.find((r) => r.rung === rung);
    if (REFERENCE_RUNGS.includes(rung) && !(card && card.applicable)) continue;
    if (rung === 'recite' && !opts.reciteShown) continue;

    if (!card || !card.applicable) {
      blocks.push({
        rung,
        state: 'notApplicable',
        tiers: card?.tiers ?? 0,
        tiersPassed: 0,
        level: 0,
        bestScore: null,
        coveredBy: null,
        startable: false,
        naReason: rung === 'recite' ? 'speech' : 'singleVerse',
      });
      continue;
    }

    const satisfied = isActivitySatisfied(pv.rungs, rung);
    const state: ActivityBlockState = satisfied ? 'complete' : card.attempts > 0 ? 'practicing' : 'notStarted';
    blocks.push({
      rung,
      state,
      tiers: card.tiers,
      tiersPassed: card.tiersPassed,
      level: card.level,
      bestScore: card.bestScore,
      coveredBy: satisfied && card.level < WELL_LEARNED_LEVEL ? coveringRung(pv.rungs, rung) : null,
      startable: true,
      naReason: null,
    });
  }
  return blocks;
}

function satisfiedFraction(pv: PassageView): number {
  const core = pv.rungs.filter((r) => r.applicable && !isOptionalRung(r.rung));
  if (core.length === 0) return 0;
  return core.filter((r) => isActivitySatisfied(pv.rungs, r.rung)).length / core.length;
}

/**
 * Ascending sort key `[group, primary, secondary]`:
 * 0 due now (not new, not done today) by earliest due; 1 learning (or due but done today) by completion
 * fraction then next review; 2 new, by position; 3 known, by next review. `Infinity` stands for "last".
 */
export function needRank(
  pv: PassageView,
  now: number,
  dayStart: number = localDayStart(now),
): [number, number, number] {
  const info = verseStatus(pv, now, dayStart);
  const next = info.nextReviewAt ?? Infinity;
  if (info.status === 'new') return [2, pv.passage.position ?? Infinity, 0];
  if (info.dueNow && !info.doneToday) return [0, next, 0];
  if (info.status === 'learning' || info.dueNow) return [1, satisfiedFraction(pv), next];
  return [3, next, 0];
}

function cmp(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Verses in "most in need first" order. Ties: position (null last), addedAt, id. */
export function sortByNeed(ps: readonly PassageView[], now: number): PassageView[] {
  const dayStart = localDayStart(now);
  const keyed = ps.map((pv) => ({ pv, key: needRank(pv, now, dayStart) }));
  keyed.sort(
    (a, b) =>
      cmp(a.key[0], b.key[0]) ||
      cmp(a.key[1], b.key[1]) ||
      cmp(a.key[2], b.key[2]) ||
      cmp(a.pv.passage.position ?? Infinity, b.pv.passage.position ?? Infinity) ||
      cmp(a.pv.passage.addedAt, b.pv.passage.addedAt) ||
      cmp(a.pv.passage.id, b.pv.passage.id),
  );
  return keyed.map((k) => k.pv);
}

/** Progress over the shown passages: units are applicable non-optional rungs, done the satisfied ones. */
export function overallProgress(ps: readonly PassageView[]): {
  done: number;
  units: number;
  percent: number;
  versesLearned: number;
  verses: number;
} {
  let done = 0;
  let units = 0;
  let versesLearned = 0;
  for (const pv of ps) {
    for (const r of pv.rungs) {
      if (!r.applicable || isOptionalRung(r.rung)) continue;
      units += 1;
      if (isActivitySatisfied(pv.rungs, r.rung)) done += 1;
    }
    if (pv.wellLearned) versesLearned += 1;
  }
  return {
    done,
    units,
    percent: units === 0 ? 0 : Math.floor((100 * done) / units),
    versesLearned,
    verses: ps.length,
  };
}
