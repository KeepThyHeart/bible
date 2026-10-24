/**
 * @vitest-environment jsdom
 *
 * With RECITE_ENABLED off (src/core/features.ts; the web hosts turn it off), recite and
 * hands-free are absent from the exercise picker, passage actions, plan tiles
 * and settings, while the other Memory exercises keep working. The rest of the
 * suite turns the flag on (test/helpers/reciteOn.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeSpeechApi } from '@bible/core/speech';

import { RECITE_ENABLED, reciteEnabled, setReciteEnabledForTests } from '../src/core/features';
import type { PassageView, PlanView, RungView, SessionView, SettingsView, SpeechAvailability } from '../src/core/types';
import type { PanelHost } from '../src/ui/host';
import { reciteDueEntry, reciteTileVisible } from '../src/ui/activities';
import { renderPassageScreen } from '../src/ui/passageView';
import { renderSettings } from '../src/ui/settingsView';
import { MODULE_KJV, call, disposeAll, startTestService } from './helpers/service';

const JOHN_3_16 = 43003016;
const TEXT =
  'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.';

const READY: SpeechAvailability = { state: 'ready', missingPermissions: [], engineLabel: 'Test', onDevice: true, handsFree: true };

beforeEach(() => setReciteEnabledForTests(false));
afterEach(() => {
  disposeAll();
  setReciteEnabledForTests(true); // restore the suite-wide default
});

async function setup() {
  const speech = new FakeSpeechApi({ script: [{ say: TEXT }], granted: { listen: true, speak: true } });
  const t = await startTestService({
    speech,
    bible: {
      listModules: async () => [MODULE_KJV],
      getRange: async () => [{ verseId: JOHN_3_16, text: TEXT, textPlain: TEXT }],
    },
  });
  const collection = await t.db.sql.queryOne<{ id: number }>('SELECT id FROM memory_collection LIMIT 1');
  const res = await t.db.sql.run(
    `INSERT INTO memory_passage (collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at)
     VALUES (?, 'KJV', ?, ?, 'John 3:16', 1, 0)`,
    [collection?.id, JOHN_3_16, JOHN_3_16],
  );
  const passageId = Number(res.lastInsertRowid);
  for (const rung of ['blanks', 'firstletters', 'recite']) {
    await t.db.sql.run(
      `INSERT INTO memory_card (passage_id, rung, state, interval_step, due_at, streak, last_score)
       VALUES (?, ?, 'new', -1, NULL, 0, NULL)`,
      [passageId, rung],
    );
  }
  return { ...t, passageId };
}

describe('recite with the flag off', () => {
  it('ships with the flag on (desktop, 1.0)', () => {
    setReciteEnabledForTests(null);
    expect(RECITE_ENABLED).toBe(true);
    expect(reciteEnabled()).toBe(true);
  });

  it('hides recite from the plan, passage view and settings, and refuses to start', async () => {
    const { svc, passageId } = await setup();

    const plan = await call<PlanView>(svc, { type: 'getPlan' });
    expect(plan.reciteDueCount).toBe(0);
    expect(plan.passages[0]!.rungs.map((r) => r.rung)).not.toContain('recite');
    const view = await call<PassageView>(svc, { type: 'getPassageView', passageId });
    expect(view.rungs.map((r) => r.rung)).not.toContain('recite');

    const settings = await call<SettingsView>(svc, { type: 'getSettings' });
    expect(settings.recite).toBeUndefined();
    expect(settings.speech).toBeUndefined();

    await expect(call(svc, { type: 'startRecite', source: { kind: 'passage', passageId }, mode: 'tap' })).rejects.toBeDefined();
    expect(await call(svc, { type: 'getReciteState' })).toBeNull();
    expect(await svc.practiceDueAloud()).toEqual({ started: false });
  });

  it('keeps the other exercises working', async () => {
    const { svc, passageId } = await setup();
    const plan = await call<PlanView>(svc, { type: 'getPlan' });
    const rungs = plan.passages[0]!.rungs.filter((r) => r.applicable).map((r) => r.rung);
    expect(rungs).toEqual(expect.arrayContaining(['blanks', 'firstletters']));
    const session = await call<SessionView>(svc, { type: 'startSession', passageId, rung: 'blanks' });
    expect(session.rung).toBe('blanks');
  });
});

describe('recite UI is absent with the flag off, even if the host sends recite data', () => {
  const host = {
    now: () => 0,
    request: async () => ({ ok: true, data: {} }),
    go: () => undefined,
    reload: () => undefined,
    announce: () => undefined,
  } as unknown as PanelHost;

  it('plan tile and due entry', () => {
    const plan = { speech: READY, reciteDueCount: 3 } as PlanView;
    expect(reciteTileVisible(plan)).toBe(false);
    expect(reciteDueEntry(plan)).toBeNull();
    setReciteEnabledForTests(true);
    expect(reciteTileVisible(plan)).toBe(true);
  });

  it('settings block', () => {
    const settings = {
      defaultAnswerMode: 'firstLetter',
      speech: READY,
      recite: { strictness: 'normal', promptStyle: 'reference', feedback: 'brief', readBack: false, autoAdvance: false, voiceCommands: false, hintDelayMs: 5000 },
    } as SettingsView;
    const plan = { speech: READY, reciteDueCount: 0, passages: [], lists: [] } as unknown as PlanView;
    const off = renderSettings(host, settings, plan);
    expect(off.querySelector('.sm-block-recite')).toBeNull();
    expect(off.textContent).not.toMatch(/hands-free|recite/i);
    setReciteEnabledForTests(true);
    expect(renderSettings(host, settings, plan).querySelector('.sm-block-recite')).not.toBeNull();
  });

  it('passage actions and activity tabs', () => {
    const rung = (name: RungView['rung'], over: Partial<RungView> = {}): RungView => ({
      rung: name, level: 0, dueAt: null, streak: 0, lastScore: null, applicable: true, resume: null,
      tiers: 3, tiersPassed: 0, bestScore: null, attempts: 0, nextTier: 0, ...over,
    });
    const pv = {
      passage: { id: 1, collectionId: 1, moduleId: 'kjv', startVerseId: JOHN_3_16, endVerseId: JOHN_3_16, reference: 'John 3:16', verseCount: 1, addedAt: 0, answerMode: null, reciteOn: false },
      dueCount: 0, bestLevel: 0, wellLearned: false,
      rungs: [rung('blanks'), rung('firstletters'), rung('recite', { optional: true })],
    } as unknown as PassageView;
    const off = renderPassageScreen(host, pv, 'firstLetter', undefined, READY);
    expect(off.textContent).not.toMatch(/recite/i);
    expect(off.querySelector('#sm-recite-on')).toBeNull();
    expect(off.textContent).toMatch(/blanks|first/i);
    setReciteEnabledForTests(true);
    expect(renderPassageScreen(host, pv, 'firstLetter', 'recite', READY).querySelector('#sm-recite-on')).not.toBeNull();
  });
});
