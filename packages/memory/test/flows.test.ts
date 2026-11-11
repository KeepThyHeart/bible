/**
 * Tests for `src/ui/flows.ts`: what each practice flow serves next, how many
 * are left, and which activities the picker offers.
 */
// Fixtures are hand-built and loosely typed.
// @ts-nocheck

import { describe, it, expect } from 'vitest';
import { flowRemaining, listTargets, nextFlowTarget, pickActivityTarget, pickShuffledTarget, pickerFlows } from '../src/ui/flows';
import { mulberry32 } from '../src/core/exercises/rng';
import type { Passage, PassageView, PlanView, RungView } from '../src/core/types';

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);
const DAY = 86_400_000;

function rungView(over: Partial<RungView> & Pick<RungView, 'rung'>): RungView {
  return {
    level: 0, dueAt: null, streak: 0, lastScore: null, applicable: true, resume: null,
    tiers: 2, tiersPassed: 0, bestScore: null, attempts: 0, nextTier: 0, ...over,
  };
}

function pvFixture(id: number, rungs: RungView[], over: Partial<Passage> = {}, wellLearned = false): PassageView {
  const passage: Passage = {
    id, collectionId: 1, moduleId: 'kjv', startVerseId: 19023001, endVerseId: 19023001,
    reference: `Ref ${id}`, verseCount: 1, addedAt: NOW - 30 * DAY + id, answerMode: null, ...over,
  };
  return { passage, dueCount: 0, bestLevel: 0, wellLearned, rungs };
}

/** Practised verse: ordering/blanks/firstletters applicable; refmatch/refprovide per `ref`. */
function practised(id: number, o: { dueAt?: number | null; ref?: boolean; lastAt?: number } = {}): PassageView {
  const last = o.lastAt ?? NOW - 5 * DAY;
  const mk = (rung, applicable = true) =>
    rungView({ rung, applicable, attempts: applicable ? 1 : 0, level: 1, dueAt: applicable ? (o.dueAt ?? null) : null, lastPractisedAt: last, firstPractisedAt: last });
  return pvFixture(id, [
    mk('ordering'), mk('refmatch', !!o.ref), mk('blanks'), mk('firstletters'), mk('refprovide', !!o.ref),
    rungView({ rung: 'recite', applicable: true }),
  ]);
}

function plan(passages: PassageView[]): PlanView {
  return {
    collectionId: 1, collectionName: 'Default',
    lists: [{ id: 1, name: 'Default', passageCount: passages.length, verseCount: 0 }],
    scope: 'all', scopeVerseCount: 0, referenceActivitiesUnlocked: true,
    passages, totalDue: 0, defaultAnswerMode: 'firstLetter', sortOrder: 'bible',
  };
}

function seq(...v: number[]) {
  let i = 0;
  return () => v[i++ % v.length]!;
}

describe('listTargets / pick helpers', () => {
  it('skips inapplicable and optional rungs', () => {
    const t = listTargets(plan([practised(1)]), NOW);
    expect(t.map((x) => x.rung).sort()).toEqual(['blanks', 'firstletters', 'ordering']);
  });

  it('pickShuffledTarget goes to the due pool when rng < 0.3', () => {
    const p = plan([practised(1, { dueAt: NOW - 1000 }), practised(2, { dueAt: NOW + DAY })]);
    for (let s = 1; s <= 10; s++) {
      const t = pickShuffledTarget(p, NOW, seq(0.1, 0.5));
      expect(t.passageId).toBe(1);
    }
  });

  it('pickActivityTarget excludes strictly', () => {
    const p = plan([practised(1)]);
    expect(pickActivityTarget(p, 'blanks', NOW, mulberry32(1), new Set([1]))).toBeNull();
  });
});

describe('nextFlowTarget', () => {
  const due = (id, at) => practised(id, { dueAt: at });

  it('today: first of the queue, honouring skipped', () => {
    const p = plan([due(1, NOW - 2 * DAY), due(2, NOW - DAY)]);
    expect(nextFlowTarget(p, { kind: 'today', skipped: [] }, NOW)?.passageId).toBe(1);
    expect(nextFlowTarget(p, { kind: 'today', skipped: [1] }, NOW)?.passageId).toBe(2);
    expect(nextFlowTarget(p, { kind: 'today', skipped: [1, 2] }, NOW)).toBeNull();
  });

  it('today: nothing when no verse is due', () => {
    const p = plan([practised(1, { dueAt: NOW + DAY })]);
    expect(nextFlowTarget(p, { kind: 'today', skipped: [] }, NOW)).toBeNull();
  });

  it('anyway: due first, visited excluded', () => {
    const p = plan([practised(1, { dueAt: NOW + 3 * DAY }), practised(2, { dueAt: NOW - DAY })]);
    expect(nextFlowTarget(p, { kind: 'anyway', visited: [] }, NOW)?.passageId).toBe(2);
    expect(nextFlowTarget(p, { kind: 'anyway', visited: [2] }, NOW)?.passageId).toBe(1);
    expect(nextFlowTarget(p, { kind: 'anyway', visited: [1, 2] }, NOW)).toBeNull();
  });

  it('mixed: excludes visited, picks only applicable rungs, null when exhausted', () => {
    const p = plan([practised(1), practised(2)]);
    for (let s = 1; s <= 30; s++) {
      const t = nextFlowTarget(p, { kind: 'mixed', visited: [1] }, NOW, mulberry32(s));
      expect(t.passageId).toBe(2);
      expect(['ordering', 'blanks', 'firstletters']).toContain(t.rung);
    }
    expect(nextFlowTarget(p, { kind: 'mixed', visited: [1, 2] }, NOW, mulberry32(1))).toBeNull();
  });

  it('mixed: due-weighted draw prefers due when rng < 0.3', () => {
    const p = plan([practised(1, { dueAt: NOW - 1000 }), practised(2, { dueAt: NOW + DAY })]);
    expect(nextFlowTarget(p, { kind: 'mixed', visited: [] }, NOW, seq(0.1, 0.9))?.passageId).toBe(1);
  });

  it('activity: only that rung, only applicable, excluding visited', () => {
    const p = plan([practised(1), practised(2, { ref: true })]);
    for (let s = 1; s <= 20; s++) {
      expect(nextFlowTarget(p, { kind: 'activity', rung: 'refmatch', visited: [] }, NOW, mulberry32(s))).toEqual({ passageId: 2, rung: 'refmatch' });
    }
    expect(nextFlowTarget(p, { kind: 'activity', rung: 'refmatch', visited: [2] }, NOW)).toBeNull();
    expect(nextFlowTarget(plan([practised(1)]), { kind: 'activity', rung: 'refprovide', visited: [] }, NOW)).toBeNull();
  });

  it('verse: that passage suggested rung; null for unknown passage', () => {
    const pv = practised(1, { dueAt: NOW - 1000 });
    pv.rungs.find((r) => r.rung === 'blanks').dueAt = NOW - 5000;
    const p = plan([pv]);
    expect(nextFlowTarget(p, { kind: 'verse', passageId: 1 }, NOW)).toEqual({ passageId: 1, rung: 'blanks' });
    expect(nextFlowTarget(p, { kind: 'verse', passageId: 99 }, NOW)).toBeNull();
  });
});

describe('flowRemaining', () => {
  it('counts today and anyway; null for the open-ended flows', () => {
    const p = plan([practised(1, { dueAt: NOW - DAY }), practised(2, { dueAt: NOW - 2 * DAY }), practised(3, { dueAt: NOW + DAY })]);
    expect(flowRemaining(p, { kind: 'today', skipped: [] }, NOW)).toBe(2);
    expect(flowRemaining(p, { kind: 'today', skipped: [1] }, NOW)).toBe(1);
    expect(flowRemaining(p, { kind: 'anyway', visited: [] }, NOW)).toBe(3);
    expect(flowRemaining(p, { kind: 'anyway', visited: [1, 3] }, NOW)).toBe(1);
    expect(flowRemaining(p, { kind: 'mixed', visited: [] }, NOW)).toBeNull();
    expect(flowRemaining(p, { kind: 'activity', rung: 'blanks', visited: [] }, NOW)).toBeNull();
    expect(flowRemaining(p, { kind: 'verse', passageId: 1 }, NOW)).toBeNull();
  });
});

describe('pickerFlows', () => {
  const keys = (p, o?) => pickerFlows(p, NOW, o).map((f) => f.key);

  it('Mixed first, then applicable activities in ladder order', () => {
    expect(keys(plan([practised(1)]))).toEqual(['mixed', 'ordering', 'blanks', 'firstletters']);
  });

  it('hides refmatch/refprovide below 25 verses and shows them at 25', () => {
    const locked = plan([practised(1, { ref: false })]);
    expect(keys(locked)).not.toContain('refmatch');
    expect(keys(locked)).not.toContain('refprovide');
    const open = plan([practised(1, { ref: true })]);
    expect(keys(open)).toEqual(['mixed', 'ordering', 'refmatch', 'blanks', 'firstletters', 'refprovide']);
  });

  it('empty plan offers nothing', () => {
    expect(keys(plan([]))).toEqual([]);
  });

  it('recite entries only when reciteReady', () => {
    const p = plan([practised(1)]);
    expect(keys(p)).not.toContain('recite');
    expect(keys(p, { reciteReady: true })).toEqual(['mixed', 'ordering', 'blanks', 'firstletters', 'recite', 'handsfree']);
  });

  it('each entry carries a fresh flow', () => {
    const f = pickerFlows(plan([practised(1)]), NOW).find((x) => x.key === 'blanks');
    expect(f.flow).toEqual({ kind: 'activity', rung: 'blanks', visited: [] });
  });
});

describe('today flow with startedToday', () => {
  it('passes the all-lists count to the new-verse cap', () => {
    const p = plan([pvFixture(1, [rungView({ rung: 'ordering' })])]);
    expect(nextFlowTarget(p, { kind: 'today', skipped: [] }, NOW)?.passageId).toBe(1);
    expect(nextFlowTarget(p, { kind: 'today', skipped: [] }, NOW, Math.random, { startedToday: 3 })).toBeNull();
    expect(flowRemaining(p, { kind: 'today', skipped: [] }, NOW, { startedToday: 3 })).toBe(0);
    expect(flowRemaining(p, { kind: 'today', skipped: [] }, NOW)).toBe(1);
  });
});
