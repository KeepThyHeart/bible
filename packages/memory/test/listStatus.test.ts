import { describe, expect, it } from 'vitest';
import { listStatus } from '../src/core/listStatus';
import { DAY, HOUR, NOW, makePassageView, makeRung } from './helpers/planFactory';

const practised = { attempts: 3, lastPractisedAt: NOW - 3 * DAY, firstPractisedAt: NOW - 30 * DAY };
const learnedVerse = (id: number, dueAt: number) =>
  makePassageView({ id, wellLearned: true, rungs: [makeRung('blanks', { ...practised, level: 5, dueAt })] });
const learningVerse = (id: number, dueAt: number) =>
  makePassageView({ id, rungs: [makeRung('ordering', { ...practised, level: 4, dueAt }), makeRung('blanks', { ...practised, level: 2, dueAt })] });

describe('listStatus', () => {
  it('empty list', () => {
    expect(listStatus([], NOW)).toEqual({ state: 'empty', percent: 0, verses: 0, versesLearned: 0, dueCount: 0, nextReviewAt: null });
  });

  it('still learning: percent of activities, verses learned, due count; new verses do not count as due', () => {
    const s = listStatus([learningVerse(1, NOW - HOUR), learnedVerse(2, NOW + DAY), makePassageView({ id: 3 })], NOW);
    expect(s.state).toBe('learning');
    expect(s.versesLearned).toBe(1);
    expect(s.verses).toBe(3);
    expect(s.dueCount).toBe(1);
    expect(s.nextReviewAt).toBeNull();
    expect(s.percent).toBeGreaterThan(0);
    expect(s.percent).toBeLessThan(100);
  });

  it('learned with nothing due: 100% and the earliest next review', () => {
    const s = listStatus([learnedVerse(1, NOW + 9 * DAY), learnedVerse(2, NOW + 5 * DAY)], NOW);
    expect(s).toMatchObject({ state: 'learned', percent: 100, dueCount: 0, nextReviewAt: NOW + 5 * DAY });
  });

  it('learned with reviews due stays learned and counts them', () => {
    const s = listStatus([learnedVerse(1, NOW - HOUR), learnedVerse(2, NOW - DAY), learnedVerse(3, NOW + DAY)], NOW);
    expect(s).toMatchObject({ state: 'learned', percent: 100, dueCount: 2, nextReviewAt: null });
  });
});
