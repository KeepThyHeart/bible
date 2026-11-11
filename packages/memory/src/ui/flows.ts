/**
 * What each practice flow serves next (task 0219).
 *
 * Pure and DOM-free: `now` and `rng` always arrive as arguments, so a fixed
 * clock and a fixed seed make every draw reproducible in a test.
 *
 *   - `today`    the Today queue (core/today), minus verses skipped this run.
 *   - `anyway`   "practice anyway" order once today is done, minus visited.
 *   - `mixed`    the old Variety rule: 30% of draws from what is due, 70% from
 *                everything applicable, minus visited verses.
 *   - `activity` a random applicable target for one activity, minus visited.
 *   - `verse`    that one verse's suggested activity.
 *
 * Applicability is `RungView.applicable`, never array membership: the plan
 * always sends one `RungView` per rung and recomputes `applicable` on read.
 */

import type { PassageView, PlanView, Rung } from '../core/types';
import { isOptionalRung } from '../core/ladder';
import { anywayOrder, suggestedRung, todayQueue } from '../core/today';
import { weightedPick } from '../core/exercises/rng';
import type { Flow } from './state';
import type { PracticeTarget as BasePracticeTarget } from './format';
import { RUNG_LABEL, isDue } from './format';
import { tr } from './i18n';

/**
 * `format.ts#PracticeTarget` plus whether the target is due right now and the
 * rung's current level.
 */
export interface PracticeTarget extends BasePracticeTarget {
  due: boolean;
  level: number;
}

/** Chance a mixed draw is restricted to the due pool. */
const DUE_WEIGHT = 0.3;

function sameTarget(a: PracticeTarget, b: PracticeTarget): boolean {
  return a.passageId === b.passageId && a.rung === b.rung;
}

/** Uniform index in `[0, length)`; boundary handling lives in `weightedPick`. */
function uniformIndex(length: number, rng: () => number): number {
  const idx = weightedPick(new Array(length).fill(1), rng);
  return idx < 0 ? 0 : idx;
}

/**
 * Every applicable (passage, activity) pair the plan currently offers.
 * Optional rungs (recite) are never included.
 */
export function listTargets(plan: PlanView, now: number): PracticeTarget[] {
  const out: PracticeTarget[] = [];
  for (const pv of plan.passages) {
    for (const rv of pv.rungs) {
      if (!rv.applicable || isOptionalRung(rv.rung)) continue;
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
 * The next target the shuffle should serve: 30% of draws from the due pool
 * (when anything is due), otherwise uniformly from every applicable target.
 * `exclude` is left out of the pool unless it is the only thing on offer.
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
  if (candidates.length === 0) candidates = exclude ? all.filter((t) => !sameTarget(t, exclude)) : all;
  if (candidates.length === 0) return exclude ?? null;
  return candidates[uniformIndex(candidates.length, rng)]!;
}

/** Passage ids no pick may return. */
export type ExcludeSet = ReadonlySet<number>;

function withoutExcluded(plan: PlanView, exclude?: ExcludeSet): PlanView {
  if (!exclude || exclude.size === 0) return plan;
  return { ...plan, passages: plan.passages.filter((pv) => !exclude.has(pv.passage.id)) };
}

/**
 * A random applicable target for one activity, excluding given passages.
 * Exclusion is strict: an otherwise-empty pool means `null`.
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

/** Recite is optional, so `listTargets` never offers it; this lists applicable recite targets. */
function reciteTargets(plan: PlanView, now: number, exclude?: ExcludeSet): PracticeTarget[] {
  const out: PracticeTarget[] = [];
  for (const pv of withoutExcluded(plan, exclude).passages) {
    const rv = pv.rungs.find((r) => r.rung === 'recite');
    if (!rv || !rv.applicable) continue;
    out.push({
      passageId: pv.passage.id,
      rung: 'recite',
      reference: pv.passage.reference,
      dueAt: rv.dueAt,
      due: isDue(rv, now),
      level: rv.level,
    });
  }
  return out;
}

function findPassage(plan: PlanView, id: number): PassageView | undefined {
  return plan.passages.find((pv) => pv.passage.id === id);
}

/** Extra context for the `today` flow. */
export interface FlowOpts {
  /** Verses started today across ALL lists (the new-verse cap is global). */
  startedToday?: number;
}

function queueOpts(skipped: readonly number[], opts: FlowOpts) {
  return {
    skipped: new Set(skipped),
    ...(opts.startedToday !== undefined ? { startedToday: opts.startedToday } : {}),
  };
}

/**
 * What a flow should start next, or `null` when there is nothing to offer.
 * Never returns an inapplicable rung.
 */
export function nextFlowTarget(
  plan: PlanView,
  flow: Flow,
  now: number,
  rng: () => number = Math.random,
  opts: FlowOpts = {},
): { passageId: number; rung: Rung } | null {
  switch (flow.kind) {
    case 'today': {
      const q = todayQueue(plan.passages, now, queueOpts(flow.skipped, opts));
      const first = q.items[0];
      return first ? { passageId: first.passageId, rung: first.rung } : null;
    }
    case 'anyway': {
      const first = anywayOrder(plan.passages, now, new Set(flow.visited))[0];
      return first ? { passageId: first.passageId, rung: first.rung } : null;
    }
    case 'mixed': {
      const t = pickShuffledTarget(withoutExcluded(plan, new Set(flow.visited)), now, rng);
      return t ? { passageId: t.passageId, rung: t.rung } : null;
    }
    case 'activity': {
      const visited = new Set(flow.visited);
      if (isOptionalRung(flow.rung)) {
        const pool = reciteTargets(plan, now, visited);
        const t = pool.length ? pool[uniformIndex(pool.length, rng)]! : null;
        return t ? { passageId: t.passageId, rung: t.rung } : null;
      }
      const t = pickActivityTarget(plan, flow.rung, now, rng, visited);
      return t ? { passageId: t.passageId, rung: t.rung } : null;
    }
    case 'verse': {
      const pv = findPassage(plan, flow.passageId);
      if (!pv) return null;
      const rung = suggestedRung(pv.rungs, now);
      return rung ? { passageId: flow.passageId, rung } : null;
    }
  }
}

/**
 * Items left in a flow: counted for `today` and `anyway`, `null` (unknown, not
 * counted) for the open-ended flows.
 */
export function flowRemaining(plan: PlanView, flow: Flow, now: number, opts: FlowOpts = {}): number | null {
  switch (flow.kind) {
    case 'today':
      return todayQueue(plan.passages, now, queueOpts(flow.skipped, opts)).items.length;
    case 'anyway':
      return anywayOrder(plan.passages, now, new Set(flow.visited)).length;
    default:
      return null;
  }
}

/** One entry of the "Practice something else" picker. */
export interface PickerFlow {
  key: string;
  label: string;
  flow: Flow;
}

const PICKER_RUNGS: readonly Rung[] = ['ordering', 'refmatch', 'blanks', 'firstletters', 'refprovide'];

/**
 * The "Practice something else" entries: Mixed first, then each activity with
 * at least one applicable target. Match the reference and Name the reference
 * vanish while locked (no verse has them applicable). Recite aloud and
 * hands-free appear only when `opts.reciteReady`; both start the recite
 * activity flow, and the host tells them apart by `key`.
 */
export function pickerFlows(plan: PlanView, now: number, opts: { reciteReady?: boolean } = {}): PickerFlow[] {
  const out: PickerFlow[] = [];
  if (listTargets(plan, now).length > 0) {
    out.push({
      key: 'mixed',
      label: tr('memory.ui.flows.mixed', 'Mixed'),
      flow: { kind: 'mixed', visited: [] },
    });
  }
  const available = new Set(listTargets(plan, now).map((t) => t.rung));
  for (const rung of PICKER_RUNGS) {
    if (!available.has(rung)) continue;
    out.push({ key: rung, label: RUNG_LABEL[rung], flow: { kind: 'activity', rung, visited: [] } });
  }
  if (opts.reciteReady) {
    out.push({
      key: 'recite',
      label: tr('memory.ui.flows.recite', 'Recite aloud'),
      flow: { kind: 'activity', rung: 'recite', visited: [] },
    });
    out.push({
      key: 'handsfree',
      label: tr('memory.ui.flows.handsfree', 'Recite hands-free'),
      flow: { kind: 'activity', rung: 'recite', visited: [] },
    });
  }
  return out;
}
