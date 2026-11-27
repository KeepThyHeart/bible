/**
 * Shared plan factories for UI tests (design-r2 section 11, C0): a `PlanView` and `PassageView`
 * built from a few arguments, so new tests do not each copy the same fixture code.
 */

import type { ListSummary, Passage, PassageView, PlanView, Rung, RungView } from '../../src/core/types';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
/** A fixed "now" (local noon) for tests that need one. */
export const NOW = new Date(2026, 5, 10, 12, 0, 0).getTime();

export function makeRung(rung: Rung, over: Partial<RungView> = {}): RungView {
  return {
    rung,
    level: 0,
    dueAt: null,
    streak: 0,
    lastScore: null,
    applicable: true,
    resume: null,
    tiers: 2,
    tiersPassed: 0,
    bestScore: null,
    attempts: 0,
    nextTier: 0,
    ...over,
  } as RungView;
}

export interface PassageViewOptions {
  id?: number;
  collectionId?: number;
  reference?: string;
  verseCount?: number;
  addedAt?: number;
  position?: number | null;
  moduleId?: string;
  reciteOn?: boolean;
  rungs?: RungView[];
  dueCount?: number;
  bestLevel?: number;
  wellLearned?: boolean;
  passage?: Partial<Passage>;
}

/** A passage view; by default a fresh verse (three untouched rungs). */
export function makePassageView(o: PassageViewOptions = {}): PassageView {
  const id = o.id ?? 1;
  const verseCount = o.verseCount ?? 1;
  return {
    passage: {
      id,
      collectionId: o.collectionId ?? 1,
      moduleId: o.moduleId ?? 'kjv',
      startVerseId: id * 100,
      endVerseId: id * 100 + verseCount - 1,
      reference: o.reference ?? `Verse ${id}`,
      verseCount,
      addedAt: o.addedAt ?? id,
      answerMode: null,
      reciteOn: o.reciteOn ?? false,
      ...(o.position !== undefined ? { position: o.position } : {}),
      ...o.passage,
    },
    rungs: o.rungs ?? [makeRung('ordering'), makeRung('blanks'), makeRung('firstletters')],
    dueCount: o.dueCount ?? 0,
    bestLevel: o.bestLevel ?? 0,
    wellLearned: o.wellLearned ?? false,
  };
}

export interface PlanOptions extends Partial<Omit<PlanView, 'passages' | 'lists'>> {
  passages?: PassageView[];
  lists?: ListSummary[];
}

/**
 * A plan. Lists default to one "Default" list that counts the given passages; counts of explicit lists
 * are used as given. Optional R2 fields (`focus`, `epoch`, `version`, `streakDays`, `lastAddListId`) are
 * only present when passed.
 */
export function makePlan(o: PlanOptions = {}): PlanView {
  const passages = o.passages ?? [];
  const verses = passages.reduce((n, p) => n + p.passage.verseCount, 0);
  const lists = o.lists ?? [{ id: 1, name: 'Default', passageCount: passages.length, verseCount: verses }];
  const { passages: _p, lists: _l, ...rest } = o;
  return {
    cardsWaiting: 0,
    collectionId: lists[0]?.id ?? 1,
    collectionName: 'All lists',
    lists,
    scope: 'all',
    scopeVerseCount: verses,
    referenceActivitiesUnlocked: verses >= 5,
    passages,
    totalDue: passages.reduce((n, p) => n + p.dueCount, 0),
    defaultAnswerMode: 'firstLetter',
    sortOrder: 'need',
    speech: { state: 'unavailable', missingPermissions: [], engineLabel: '', onDevice: true, handsFree: false },
    reciteDueCount: 0,
    ...rest,
  };
}
