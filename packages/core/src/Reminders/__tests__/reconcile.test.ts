import { describe, expect, it } from 'vitest';
import { reconcileMissed } from '../reconcile';
import { DEFAULT_MISSED_POLICY } from '../types';

const NOW = 1_800_000_000_000;
const TOL = DEFAULT_MISSED_POLICY.lateToleranceMs;
const COLLAPSE = DEFAULT_MISSED_POLICY.collapseWithinMs;
const at = (fireAt: number, name = String(fireAt)) => ({ fireAt, name });

describe('reconcileMissed', () => {
  it('has the documented default policy', () => {
    expect(TOL).toBe(5 * 60_000);
    expect(COLLAPSE).toBe(12 * 3_600_000);
  });

  it('exactly now is on time', () => {
    const r = reconcileMissed([at(NOW)], NOW);
    expect(r.onTime).toHaveLength(1);
    expect(r.summarize.length + r.drop.length + r.future.length).toBe(0);
  });

  it('late == lateTolerance is on time; +1 ms is summarized', () => {
    expect(reconcileMissed([at(NOW - TOL)], NOW).onTime).toHaveLength(1);
    const r = reconcileMissed([at(NOW - TOL - 1)], NOW);
    expect(r.onTime).toHaveLength(0);
    expect(r.summarize).toHaveLength(1);
  });

  it('late == collapseWithin is summarized; +1 ms is dropped', () => {
    expect(reconcileMissed([at(NOW - COLLAPSE)], NOW).summarize).toHaveLength(1);
    const r = reconcileMissed([at(NOW - COLLAPSE - 1)], NOW);
    expect(r.summarize).toHaveLength(0);
    expect(r.drop).toHaveLength(1);
  });

  it('1 ms in the future is future', () => {
    const r = reconcileMissed([at(NOW + 1)], NOW);
    expect(r.future).toHaveLength(1);
    expect(r.onTime).toHaveLength(0);
  });

  it('drops NaN and infinite fireAt', () => {
    const r = reconcileMissed([at(NaN), at(Infinity), at(-Infinity)], NOW);
    expect(r.drop).toHaveLength(3);
    expect(r.onTime.length + r.summarize.length + r.future.length).toBe(0);
  });

  it('preserves input order within each list and returns the original objects', () => {
    const items = [at(NOW - 3_600_000, 'c'), at(NOW + 10, 'f1'), at(NOW - 7_200_000, 'b'), at(NOW - 1, 'a'), at(NOW + 5, 'f2'), at(NOW - 2 * COLLAPSE, 'x')];
    const r = reconcileMissed(items, NOW);
    expect(r.summarize.map((i) => i.name)).toEqual(['c', 'b']);
    expect(r.future.map((i) => i.name)).toEqual(['f1', 'f2']);
    expect(r.onTime.map((i) => i.name)).toEqual(['a']);
    expect(r.drop.map((i) => i.name)).toEqual(['x']);
    expect(r.summarize[0]).toBe(items[0]);
  });

  it('handles an empty list', () => {
    expect(reconcileMissed([], NOW)).toEqual({ onTime: [], summarize: [], drop: [], future: [] });
  });

  it('accepts a custom, partial policy', () => {
    const items = [at(NOW - 1000), at(NOW - 5000), at(NOW - 20_000)];
    const r = reconcileMissed(items, NOW, { lateToleranceMs: 1000, collapseWithinMs: 10_000 });
    expect(r.onTime.map((i) => i.fireAt)).toEqual([NOW - 1000]);
    expect(r.summarize.map((i) => i.fireAt)).toEqual([NOW - 5000]);
    expect(r.drop.map((i) => i.fireAt)).toEqual([NOW - 20_000]);
    // A partial policy keeps the other default.
    const r2 = reconcileMissed([at(NOW - 3 * 60_000)], NOW, { collapseWithinMs: 1000 });
    expect(r2.onTime).toHaveLength(0);
    expect(r2.drop).toHaveLength(1);
  });
});
