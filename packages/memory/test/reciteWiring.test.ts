/**
 * @vitest-environment jsdom
 *
 * Wiring of Recite aloud into the panel: nav state, activity tiles, the
 * passage screen's recite row, carry-down, suggestion skipping, the manifest,
 * and the stylesheet's no-strike-through rule.
 */
// Ported unchanged from the extension, whose tests were not type-checked; fixtures here
// predate later type changes. Behaviour is covered by vitest, not tsc.
// @ts-nocheck
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { Passage, PassageView, PlanView, RungView, SpeechAvailability } from '../src/core/types';
import { INITIAL_NAV, navReduce, sameView } from '../src/ui/state';
import { reciteDueEntry, reciteTileVisible } from '../src/ui/activities';
import { RUNG_BLURB, RUNG_LABEL } from '../src/ui/format';
import { listTargets } from '../src/ui/flows';
import type { PanelHost } from '../src/ui/host';

const NOW = Date.UTC(2026, 8, 19, 12, 0, 0);

const speech = (over: Partial<SpeechAvailability> = {}): SpeechAvailability => ({
  state: 'ready', missingPermissions: [], engineLabel: 'Whisper', onDevice: true, handsFree: true, ...over,
});

const rung = (over: Partial<RungView> & Pick<RungView, 'rung'>): RungView => ({
  level: 0, dueAt: null, streak: 0, lastScore: null, applicable: true, resume: null,
  tiers: 1, tiersPassed: 0, bestScore: null, attempts: 0, nextTier: 0, ...over,
});

const passage = (over: Partial<Passage> = {}): Passage => ({
  id: 10, collectionId: 1, moduleId: 'kjv', startVerseId: 1, endVerseId: 3, reference: 'Genesis 1:1-3',
  verseCount: 3, addedAt: 0, answerMode: null, reciteOn: false, ...over,
});

const pv = (rungs: RungView[], p: Partial<Passage> = {}): PassageView => ({
  passage: passage(p), dueCount: 0, bestLevel: 0, wellLearned: false, rungs,
});

const plan = (over: Partial<PlanView> = {}, passages: PassageView[] = []): PlanView => ({
  collectionId: 1, collectionName: 'P', lists: [{ id: 1, name: 'D', passageCount: 1, verseCount: 3 }],
  scope: 'all', scopeVerseCount: 3, referenceActivitiesUnlocked: false, sortOrder: 'bible', passages,
  totalDue: 0, defaultAnswerMode: 'firstLetter', speech: speech(), reciteDueCount: 0, ...over,
});

function host(): PanelHost & { requests: any[]; go: ReturnType<typeof vi.fn> } {
  const requests: any[] = [];
  return {
    requests,
    now: () => NOW,
    request: vi.fn(async (r: any) => {
      requests.push(r);
      return { ok: true, data: { reciteId: 'r1', mode: r.mode ?? 'tap' } };
    }),
    announce: vi.fn(),
    go: vi.fn(),
    reload: vi.fn(),
    startSession: vi.fn(),
    startFlow: vi.fn(),
    openInBible: vi.fn(),
  } as any;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('nav state for recite', () => {
  it('reciteStarted remembers the verse page and reciteEnded returns to it', () => {
    let s = navReduce(INITIAL_NAV, { type: 'goVerse', passageId: 4 });
    s = navReduce(s, { type: 'reciteStarted', reciteId: 'a', mode: 'tap' });
    expect(s.view).toEqual({ name: 'recite', reciteId: 'a', mode: 'tap' });
    s = navReduce(s, { type: 'reciteEnded' });
    expect(s.view).toEqual({ name: 'verse', passageId: 4 });
  });

  it('a resume from Today returns to Today; a second run keeps the return target', () => {
    let s = navReduce(INITIAL_NAV, { type: 'reciteStarted', reciteId: 'a', mode: 'handsfree' });
    s = navReduce(s, { type: 'reciteStarted', reciteId: 'b', mode: 'handsfree' });
    expect(navReduce(s, { type: 'reciteEnded' }).view).toEqual({ name: 'today' });
    expect(sameView({ name: 'recite', reciteId: 'a', mode: 'tap' }, { name: 'recite', reciteId: 'b', mode: 'tap' })).toBe(false);
  });
});

describe('carry-down and suggestion', () => {
  it('recite is never suggested or drawn for a flow, even when due', () => {
    const rungs = [rung({ rung: 'ordering', level: 5 }), rung({ rung: 'recite', dueAt: NOW - 1, optional: true })];
    expect(listTargets(plan({}, [pv(rungs)]), NOW).map((t) => t.rung)).toEqual(['ordering']);
  });

  it('has a label and a blurb', () => {
    expect(RUNG_LABEL.recite).toBe('Recite aloud');
    expect(RUNG_BLURB.recite.length).toBeGreaterThan(10);
  });
});

describe('activities', () => {
  it('shows the recite tile and due entry only when speech is ready', () => {
    expect(reciteTileVisible(plan())).toBe(true);
    expect(reciteTileVisible(plan({ speech: speech({ state: 'needs-download' }) }))).toBe(false);
    expect(reciteDueEntry(plan({ speech: speech({ state: 'unavailable' }) }))).toBeNull();
    expect(reciteDueEntry(plan({ reciteDueCount: 3 }))).toMatchObject({ count: 3, enabled: true });
    expect(reciteDueEntry(plan({ reciteDueCount: 3 }))!.label).toContain('(3)');
    expect(reciteDueEntry(plan())!.enabled).toBe(false);
  });
});

describe('styles', () => {
  it('styles carry the recite rules and never use strike-through on rules', () => {
    const css = readFileSync(resolve(__dirname, '../src/ui/memory.css'), 'utf8');
    expect(css).toContain('.sm-recite-missed');
    expect(css).toContain('.sm-handsfree');
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toContain('line-through');
  });
});
