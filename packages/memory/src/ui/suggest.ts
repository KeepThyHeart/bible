/**
 * Pure "what should the shuffled deck serve next" logic.
 *
 * Same discipline as `format.ts`: nothing here touches the DOM, and nothing
 * here reads the clock or the RNG itself - `now` and `rng` always arrive as
 * arguments, so a fixed seed and a fixed clock make every draw reproducible
 * in a test.
 *
 * This module answers several different questions that look similar but are
 * not the same button:
 *
 *   - `listTargets`         - every (passage, activity) pair currently on
 *                              offer, so a caller can build its own pool.
 *   - `pickShuffledTarget`  - "give me something to practise now", weighted
 *                              30% toward what's due, 70% toward anything
 *                              applicable - the "shuffle" behind a session
 *                              that keeps serving fresh cards.
 *   - `pickTargetForActivity` - "start *this* activity specifically", for a
 *                              dropdown that names the rung up front.
 *   - `pickActivityTarget`  - a random target for one activity, excluding
 *                              given passages (tile press, Next skip).
 *   - `pickFlowTarget`      - the same for any `Flow` rule (variety or one
 *                              activity); `null` means nothing qualifies.
 *   - `flowUnavailable`     - whether a tile is 'locked', 'empty' or usable.
 *   - `isReferenceRung`     - the two rungs gated on reference unlocking.
 */

import type { PlanView, Rung } from '../core/types';
import { isOptionalRung } from '../core/ladder';
import type { Flow } from './state';
import type { PracticeTarget as BasePracticeTarget } from './format';
import { isDue } from './format';
import { weightedPick } from '../core/exercises/rng';

/**
 * `format.ts#PracticeTarget` plus the two fields the shuffle needs and the
 * panel doesn't already have to hand: whether the target is due right now
 * (so a caller doesn't have to re-derive it from `dueAt` and `now`), and the
 * rung's current level (so a "you're about to redo something you've already
 * mastered" affordance doesn't need a second lookup into `plan.passages`).
 */
export interface PracticeTarget extends BasePracticeTarget {
  due: boolean;
  level: number;
}

/** Chance a draw is restricted to the due pool, per the resolved decision. */
const DUE_WEIGHT = 0.3;

function sameTarget(a: PracticeTarget, b: PracticeTarget): boolean {
  return a.passageId === b.passageId && a.rung === b.rung;
}

/**
 * Uniformly picks one index in `[0, length)` from `rng`.
 *
 * Built on `weightedPick` (equal weights) rather than
 * `Math.floor(rng() * length)` by hand so the boundary handling - `rng() ===
 * 0` must land on index 0, `rng()` just under 1 must still land in range
 * rather than falling through to `-1` on float drift - lives in one place
 * shared with `shuffled`/`weightedPick`'s own callers instead of being
 * reimplemented here.
 */
function uniformIndex(length: number, rng: () => number): number {
  const idx = weightedPick(new Array(length).fill(1), rng);
  // `length` is always >= 1 at every call site below, so `weightedPick` can
  // only return -1 here on a pathological `rng`; clamp rather than trust.
  return idx < 0 ? 0 : idx;
}

/**
 * Every applicable (passage, activity) pair the plan currently offers.
 *
 * "Applicable" is `RungView.applicable`, not "present in the array" - the
 * protocol always sends one `RungView` per rung per passage (see
 * `ladder.ts#materialRungs`), with `applicable` recomputed on every read for
 * the rungs that don't currently qualify (too few verses in scope, etc).
 * Trusting array membership instead would silently offer inapplicable
 * activities the moment that stopped being true.
 */
export function listTargets(plan: PlanView, now: number): PracticeTarget[] {
  const out: PracticeTarget[] = [];
  for (const pv of plan.passages) {
    for (const rv of pv.rungs) {
      if (!rv.applicable || isOptionalRung(rv.rung)) continue; // optional rungs (recite) are never suggested
      out.push({
        passageId: pv.passage.id,
        rung: rv.rung,
        reference: pv.passage.reference,
        dueAt: rv.dueAt,
        due: isDue(rv, now),
        level: rv.level,
      });
    }
  }
  return out;
}

/**
 * The next target the shuffle should serve.
 *
 * 30% of draws are restricted to targets that are due; the other 70% (and
 * *every* draw when nothing is due at all - an empty due pool does not mean
 * "30% chance of nothing", it means every draw behaves like the 70% branch)
 * are drawn uniformly from every applicable target.
 *
 * `exclude` (typically the target just finished) is left out of the pool so
 * the shuffle doesn't hand back the same card twice in a row, unless leaving
 * it out empties the pool entirely - first the chosen pool, then the whole
 * applicable set - in which case `exclude` is the only thing there is to
 * offer and is returned rather than turning "nothing else to practise" into
 * "nothing to practise".
 */
export function pickShuffledTarget(
  plan: PlanView,
  now: number,
  rng: () => number,
  exclude?: PracticeTarget,
): PracticeTarget | null {
  const all = listTargets(plan, now);
  if (all.length === 0) return null;

  const due = all.filter((t) => t.due);
  const useDuePool = due.length > 0 && rng() < DUE_WEIGHT;
  const pool = useDuePool ? due : all;

  let candidates = exclude ? pool.filter((t) => !sameTarget(t, exclude)) : pool;
  if (candidates.length === 0) {
    // The chosen pool was just `exclude` alone - fall back to the full
    // applicable set (minus `exclude`) before giving up on variety.
    candidates = exclude ? all.filter((t) => !sameTarget(t, exclude)) : all;
  }
  if (candidates.length === 0) {
    // `exclude` was the only applicable target in the whole plan.
    return exclude ?? null;
  }

  return candidates[uniformIndex(candidates.length, rng)]!;
}

/**
 * What a "start this activity" dropdown option should begin for one specific
 * rung: the soonest-due applicable target on that rung, or - nothing due -
 * the applicable target with the lowest passage id, for the same reason
 * `format.ts#pickDueTarget` breaks its own final tie on passage id: a
 * deterministic answer is one a user can form a habit around.
 */
export function pickTargetForActivity(plan: PlanView, rung: Rung, now: number): PracticeTarget | null {
  const targets = listTargets(plan, now).filter((t) => t.rung === rung);
  if (targets.length === 0) return null;

  const due = targets.filter((t) => t.due);
  const pool = due.length > 0 ? due : targets;

  pool.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.passageId - b.passageId);
  return pool[0]!;
}

/** Passage ids no pick may return - e.g. the passage a Next press just left. */
export type ExcludeSet = ReadonlySet<number>;

/** `plan` with every passage in `exclude` removed (the same object when there is nothing to remove). */
function withoutExcluded(plan: PlanView, exclude?: ExcludeSet): PlanView {
  if (!exclude || exclude.size === 0) return plan;
  return { ...plan, passages: plan.passages.filter((pv) => !exclude.has(pv.passage.id)) };
}

/**
 * A random applicable target for one specific activity, for an activity tile
 * press or the Next skip within an activity flow.
 *
 * Draws uniformly from every applicable target on `rung` whose passage is not
 * in `exclude`; `null` when that pool is empty. (The planView picker this was
 * moved from fell back to the excluded target itself when it was the only
 * one; the Next button wants "nothing else" instead, so exclusion is strict.)
 */
export function pickActivityTarget(
  plan: PlanView,
  rung: Rung,
  now: number,
  rng: () => number,
  exclude?: ExcludeSet,
): PracticeTarget | null {
  const pool = listTargets(withoutExcluded(plan, exclude), now).filter((t) => t.rung === rung);
  if (pool.length === 0) return null;
  return pool[uniformIndex(pool.length, rng)]!;
}

/**
 * What a flow should start next, or `null` when there is nothing to offer.
 *
 * - `variety`: main's weighted shuffle (`pickShuffledTarget`: 30% due-only,
 *   70% anything applicable) over the passages not in `exclude`.
 * - `activity`: `pickActivityTarget` on the flow's rung.
 * - `passage`: always `null` - that flow names one passage and has no rule to
 *   re-run (the Next button is not shown for it).
 *
 * `exclude` is strict for both rules: a Next press never re-offers the
 * passage just left, and an otherwise-empty pool means "nothing else".
 * `rng` is an argument for the usual reason - callers pass `Math.random`,
 * tests pass a fixed sequence.
 */
export function pickFlowTarget(
  plan: PlanView,
  flow: Flow,
  now: number,
  rng: () => number,
  exclude?: ExcludeSet,
): PracticeTarget | null {
  switch (flow.kind) {
    case 'variety':
      return pickShuffledTarget(withoutExcluded(plan, exclude), now, rng);
    case 'activity':
      return pickActivityTarget(plan, flow.rung, now, rng, exclude);
    case 'passage':
      return null;
  }
}

/** Why an activity tile cannot be pressed. */
export type ActivityUnavailable = 'locked' | 'empty';

/**
 * Whether a flow can be started right now: `null` when it can, `'locked'`
 * when it is a reference activity (`refmatch`/`refprovide`, or the
 * `activity` flow for one) and `plan.referenceActivitiesUnlocked` is false,
 * `'empty'` when the gate is open but no applicable target exists.
 * The `passage` flow is always `null` (it is never a tile). Show the locked
 * tile's hint with the existing reference-hint text.
 */
export function flowUnavailable(plan: PlanView, flow: Flow, now: number): ActivityUnavailable | null {
  if (flow.kind === 'passage') return null;
  if (flow.kind === 'activity' && isReferenceRung(flow.rung) && !plan.referenceActivitiesUnlocked) {
    return 'locked';
  }
  // The rng only chooses among candidates; any rng answers "is there one".
  return pickFlowTarget(plan, flow, now, () => 0) === null ? 'empty' : null;
}

/** The two rungs gated behind `PlanView.referenceActivitiesUnlocked`. */
export function isReferenceRung(rung: Rung): boolean {
  return rung === 'refmatch' || rung === 'refprovide';
}
