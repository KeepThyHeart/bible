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
import { RECITE_TILE, reciteDueEntry, reciteTileVisible } from '../src/ui/activities';
import { RUNG_BLURB, RUNG_LABEL, carriesDownFrom, suggestedRungFor } from '../src/ui/format';
import { listTargets } from '../src/ui/suggest';
import { renderPassageScreen } from '../src/ui/passageView';
import { renderPlan } from '../src/ui/planView';
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
  it('reciteStarted remembers the passage screen and reciteEnded returns to it', () => {
    let s = navReduce(INITIAL_NAV, { type: 'goPassage', passageId: 4, rung: 'recite' });
    s = navReduce(s, { type: 'reciteStarted', reciteId: 'a', mode: 'tap' });
    expect(s.view).toEqual({ name: 'recite', reciteId: 'a', mode: 'tap' });
    s = navReduce(s, { type: 'reciteEnded' });
    expect(s.view).toEqual({ name: 'passage', passageId: 4, rung: 'recite' });
  });

  it('a resume from the plan returns to the plan; a second run keeps the return target', () => {
    let s = navReduce(INITIAL_NAV, { type: 'reciteStarted', reciteId: 'a', mode: 'handsfree' });
    s = navReduce(s, { type: 'reciteStarted', reciteId: 'b', mode: 'handsfree' });
    expect(navReduce(s, { type: 'reciteEnded' }).view).toEqual({ name: 'plan' });
    expect(sameView({ name: 'recite', reciteId: 'a', mode: 'tap' }, { name: 'recite', reciteId: 'b', mode: 'tap' })).toBe(false);
  });
});

describe('carry-down and suggestion', () => {
  it('recite mastered carries into the text rungs but not the reference rungs', () => {
    const rungs = [
      rung({ rung: 'ordering' }), rung({ rung: 'refmatch' }), rung({ rung: 'blanks' }),
      rung({ rung: 'firstletters' }), rung({ rung: 'refprovide' }), rung({ rung: 'recite', level: 5, optional: true }),
    ];
    expect(carriesDownFrom(rungs, 'ordering')).toBe(true);
    expect(carriesDownFrom(rungs, 'blanks')).toBe(true);
    expect(carriesDownFrom(rungs, 'firstletters')).toBe(true);
    expect(carriesDownFrom(rungs, 'refmatch')).toBe(false);
    expect(carriesDownFrom(rungs, 'refprovide')).toBe(false);
  });

  it('refprovide no longer carries down (same chain as ladder.ts)', () => {
    const rungs = [rung({ rung: 'ordering' }), rung({ rung: 'refprovide', level: 5 })];
    expect(carriesDownFrom(rungs, 'ordering')).toBe(false);
  });

  it('recite is never suggested or drawn for a flow, even when due', () => {
    const rungs = [rung({ rung: 'ordering', level: 5 }), rung({ rung: 'recite', dueAt: NOW - 1, optional: true })];
    expect(suggestedRungFor(rungs, NOW)).toBe('ordering');
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

  it('the plan grid renders the recite tile only when ready, and starts hands-free for due', async () => {
    const p = plan({ reciteDueCount: 2 }, [pv([rung({ rung: 'ordering' })])]);
    const h = host();
    const root = renderPlan(h, p);
    expect(root.textContent).toContain(RECITE_TILE.title);
    const due = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes("Recite what's due aloud"))!;
    due.click();
    await flush();
    expect(h.requests[0]).toEqual({ type: 'startRecite', source: { kind: 'due' }, mode: 'handsfree' });
    expect(h.go).toHaveBeenCalledWith({ type: 'reciteStarted', reciteId: 'r1', mode: 'handsfree' });

    const off = renderPlan(host(), plan({ speech: speech({ state: 'permission-missing' }) }, [pv([rung({ rung: 'ordering' })])]));
    expect(off.textContent).not.toContain(RECITE_TILE.title);
    expect(off.textContent).not.toContain("Recite what's due aloud");
  });
});

describe('passage screen recite row', () => {
  const rungs = [rung({ rung: 'ordering', level: 1 }), rung({ rung: 'recite', optional: true })];

  it('marks recite optional in its tab', () => {
    const root = renderPassageScreen(host(), pv(rungs), 'firstLetter', 'recite', speech());
    const tab = [...root.querySelectorAll('[role="tab"], button')].find((b) => b.textContent?.includes('Recite aloud'))!;
    expect(tab.textContent).toContain('(optional)');
  });

  it('Recite starts tap mode when ready', async () => {
    const h = host();
    const root = renderPassageScreen(h, pv(rungs), 'firstLetter', 'recite', speech());
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Recite')!;
    expect(btn.disabled).toBe(false);
    btn.click();
    await flush();
    expect(h.requests[0]).toEqual({ type: 'startRecite', source: { kind: 'passage', passageId: 10 }, mode: 'tap' });
  });

  it('Recite is disabled with the reason when speech is not ready', () => {
    const root = renderPassageScreen(
      host(), pv(rungs), 'firstLetter', 'recite',
      speech({ state: 'permission-missing', missingPermissions: ['speech:listen'] }),
    );
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Recite')!;
    expect(btn.disabled).toBe(true);
    expect(root.textContent).toContain('microphone access');
  });

  it('the include toggle sends setPassageRecite and reloads', async () => {
    const h = host();
    const root = renderPassageScreen(h, pv(rungs), 'firstLetter', 'recite', speech());
    const box = root.querySelector<HTMLInputElement>('#sm-recite-on')!;
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await flush();
    expect(h.requests[0]).toEqual({ type: 'setPassageRecite', passageId: 10, on: true });
    expect(h.reload).toHaveBeenCalled();
  });

  it('the suggested "Practice Passage" never names recite', () => {
    const root = renderPassageScreen(host(), pv([rung({ rung: 'recite', dueAt: NOW - 1, optional: true })]), 'firstLetter', null, speech());
    expect(root.textContent).not.toContain('Practice Passage');
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
