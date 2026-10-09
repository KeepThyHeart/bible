import { describe, it, expect } from 'vitest';
import {
  applicableRungs,
  materialRungs,
  isActivitySatisfied,
  passageWellLearned,
  isOptionalRung,
  OPTIONAL_RUNGS,
  TEXT_RECALL_CHAIN,
  TIERS,
  TIER_LABEL,
  MIN_VERSES_FOR_REFERENCE_ACTIVITIES,
  type ActivityLevel,
} from '../src/core/ladder';
import type { Rung } from '../src/core/types';

const lv = (rung: Rung, level: number, applicable = true): ActivityLevel => ({ rung, level, applicable });

describe('recite rung: constants', () => {
  it('has one tier labelled From memory and is optional', () => {
    expect(TIERS.recite).toBe(1);
    expect(TIER_LABEL.recite).toEqual(['From memory']);
    expect(OPTIONAL_RUNGS).toEqual(['recite']);
    expect(isOptionalRung('recite')).toBe(true);
    expect(isOptionalRung('blanks')).toBe(false);
  });

  it('ends the text recall chain', () => {
    expect(TEXT_RECALL_CHAIN).toEqual(['ordering', 'blanks', 'firstletters', 'recite']);
  });
});

describe('recite rung: which rungs exist and apply', () => {
  it('gives every passage a recite card, last', () => {
    expect(materialRungs(1).at(-1)).toBe('recite');
    expect(materialRungs(3).at(-1)).toBe('recite');
  });

  it('applicableRungs is unchanged by default and appends recite with speech', () => {
    expect(applicableRungs(3, 1)).toEqual(['ordering', 'blanks', 'firstletters']);
    expect(applicableRungs(3, 1, 0, {})).toEqual(['ordering', 'blanks', 'firstletters']);
    expect(applicableRungs(3, 1, 0, { speech: false })).not.toContain('recite');
    expect(applicableRungs(3, 1, 0, { speech: true })).toEqual(['ordering', 'blanks', 'firstletters', 'recite']);
    const big = MIN_VERSES_FOR_REFERENCE_ACTIVITIES;
    expect(applicableRungs(1, 2, big, { speech: true })).toEqual([
      'refmatch',
      'blanks',
      'firstletters',
      'refprovide',
      'recite',
    ]);
  });
});

describe('recite rung: carry-down', () => {
  it('a recite level >= 4 satisfies ordering, blanks and firstletters', () => {
    const rungs = [lv('ordering', 0), lv('blanks', 0), lv('firstletters', 0), lv('recite', 4)];
    for (const r of ['ordering', 'blanks', 'firstletters'] as Rung[]) {
      expect(isActivitySatisfied(rungs, r)).toBe(true);
    }
  });

  it('recite below 4 carries nothing', () => {
    const rungs = [lv('ordering', 0), lv('blanks', 0), lv('firstletters', 0), lv('recite', 3)];
    expect(isActivitySatisfied(rungs, 'blanks')).toBe(false);
  });

  it('never satisfies the reference activities', () => {
    const rungs = [lv('refmatch', 0), lv('refprovide', 0), lv('blanks', 0), lv('recite', 5)];
    expect(isActivitySatisfied(rungs, 'refmatch')).toBe(false);
    expect(isActivitySatisfied(rungs, 'refprovide')).toBe(false);
  });

  it('a real recitation still carries down when recite is no longer applicable', () => {
    const rungs = [lv('blanks', 0), lv('firstletters', 0), lv('recite', 5, false)];
    expect(isActivitySatisfied(rungs, 'blanks')).toBe(true);
    expect(passageWellLearned(rungs)).toBe(true);
  });

  it('a non-recite harder rung still must be applicable to carry', () => {
    const rungs = [lv('blanks', 0), lv('firstletters', 5, false)];
    expect(isActivitySatisfied(rungs, 'blanks')).toBe(false);
  });
});

describe('recite rung: well learned', () => {
  it('recite 5 alone is well learned when no reference rungs apply', () => {
    const rungs = [lv('ordering', 0), lv('blanks', 0), lv('firstletters', 0), lv('recite', 5)];
    expect(passageWellLearned(rungs)).toBe(true);
  });

  it('recite 5 does not cover applicable reference rungs', () => {
    const rungs = [lv('refmatch', 0), lv('blanks', 0), lv('firstletters', 0), lv('refprovide', 0), lv('recite', 5)];
    expect(passageWellLearned(rungs)).toBe(false);
  });

  it('an untouched recite never blocks', () => {
    const rungs = [lv('blanks', 4), lv('firstletters', 4), lv('recite', 0)];
    expect(passageWellLearned(rungs)).toBe(true);
  });

  it('recite alone applicable is not well learned (empty required set)', () => {
    expect(passageWellLearned([lv('recite', 5)])).toBe(false);
  });
});
