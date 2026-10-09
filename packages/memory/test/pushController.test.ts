/**
 * The push-card worker service (task 0072), against a real SQLite database and
 * a fake `api.reminders`.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { createMemoryTestDb } from './helpers/sqlite';
import { createFakeReminders } from './fakeReminders';
import type { FakeRemindersOptions } from './fakeReminders';
import { ensureDefaultCollection, MemoryStore } from '../src/core/store';
import { makeRng } from '../src/core/scheduler';
import { TIERS } from '../src/core/ladder';
import { DEFAULT_PUSH_SETTINGS } from '../src/core/pushCards';
import { PushController, detectReminders } from '../src/core/pushController';
import { fixedOffsetCalendar } from '../src/core/reminderPlan';
import type { PushCardRow, PushCardSettings } from '../src/core/pushTypes';
import type { Rung, VerseText, WorkerPush } from '../src/core/types';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 0, 15, 9, 0, 0);

function verses(): VerseText[] {
  return [
    { verseId: 1, label: '1:1', words: ['In', 'the', 'beginning', 'God'], lines: null, psalmTitle: null, paragraphStart: false },
  ];
}

interface SetupOpts {
  fake?: FakeRemindersOptions | null; // null = no reminders api on the host
  enabled?: boolean;
  passages?: number;
  settings?: Partial<PushCardSettings>;
}

const controllers: PushController[] = [];
afterEach(() => {
  for (const c of controllers.splice(0)) c.dispose();
});

async function setup(o: SetupOpts = {}) {
  const harness = createMemoryTestDb().sql;
  const collectionId = await ensureDefaultCollection(harness, 'My plan', T0);
  const store = new MemoryStore(harness);
  const fake = o.fake === null ? null : createFakeReminders(o.fake ?? {});
  const clock = { t: T0 };
  const posts: WorkerPush[] = [];
  const openPanel = vi.fn(async () => undefined);
  const refreshStatus = vi.fn(async () => undefined);

  const ids: number[] = [];
  for (let i = 0; i < (o.passages ?? 3); i += 1) {
    const { passage } = await store.addPassage({
      collectionId,
      moduleId: 'kjv',
      startVerseId: 100 + i * 10,
      endVerseId: 101 + i * 10,
      reference: `Ref ${i + 1}:1-2`,
      verseCount: 2,
      addedAt: T0,
    });
    await store.syncLadders(collectionId);
    const cards = await store.listCards(passage.id);
    await store.recordAttempt({
      cardId: cards[0]!.id, at: T0 - 2 * DAY + i, score: 0.5, correctFirst: 1, totalSteps: 2, durationMs: 100, tier: 0,
    });
    ids.push(passage.id);
  }

  const settings: PushCardSettings = {
    ...DEFAULT_PUSH_SETTINGS,
    enabled: o.enabled ?? true,
    ...o.settings,
  };
  await store.setPushSettingsRaw(JSON.stringify(settings));

  const controller = new PushController({
    store,
    api: fake ? { reminders: fake.api } : {},
    now: () => clock.t,
    calendar: fixedOffsetCalendar(0),
    rng: makeRng(7),
    fetchVerses: async () => verses(),
    post: (p) => posts.push(p),
    refreshStatus,
    openPanel,
    debounceMs: 0,
    tickMs: 3_600_000,
    capabilitiesTimeoutMs: 30,
  });
  controllers.push(controller);
  return { harness, collectionId, store, fake, clock, posts, openPanel, refreshStatus, controller, ids };
}

function waitingRow(key: string, passageId: number, fireAt: number): PushCardRow {
  return { key, passageId, fireAt, origin: 'plan', state: 'waiting', updatedAt: fireAt };
}

describe('detectReminders', () => {
  it('returns null for a host without reminders', async () => {
    expect(await detectReminders({})).toBeNull();
    expect(await detectReminders({ reminders: {} })).toBeNull();
    expect(await detectReminders(null)).toBeNull();
  });

  it('returns the api and capabilities when well formed', async () => {
    const fake = createFakeReminders({ permission: 'prompt' });
    const d = await detectReminders({ reminders: fake.api });
    expect(d?.caps.permission).toBe('prompt');
  });

  it('returns null when capabilities throws or hangs', async () => {
    expect(await detectReminders({ reminders: createFakeReminders({ throwOnCapabilities: true }).api })).toBeNull();
    expect(await detectReminders({ reminders: createFakeReminders({ hang: true }).api }, 20)).toBeNull();
  });
});

describe('degraded mode', () => {
  it('without a host api: no replaceAll; the tick turns due rows into waiting cards', async () => {
    const s = await setup({ fake: null });
    await s.controller.start();
    const scheduled = await s.store.listPushCards(['scheduled']);
    expect(scheduled.length).toBeGreaterThan(0);
    expect((await s.controller.getSettingsView()).status.hostApi).toBe(false);

    s.clock.t = scheduled[0]!.fireAt + 10 * 60 * 1000;
    await s.controller.tick();
    expect(await s.controller.waitingCount()).toBe(1);
    expect(s.posts).toContainEqual({ type: 'cardsWaitingChanged', count: 1 });
  });

  it('drops rows older than 12 hours instead of making them wait', async () => {
    const s = await setup({ fake: null });
    await s.controller.start();
    const first = (await s.store.listPushCards(['scheduled']))[0]!;
    s.clock.t = first.fireAt + 13 * HOUR;
    await s.controller.tick();
    expect((await s.store.listPushCards()).find((r) => r.key === first.key)?.state).toBe('dropped');
  });

  it('capabilities throwing or hanging degrades without replaceAll', async () => {
    for (const fake of [{ throwOnCapabilities: true }, { hang: true }]) {
      const s = await setup({ fake });
      await s.controller.start();
        expect(s.fake!.calls.replaceAll).toHaveLength(0);
      expect((await s.controller.getSettingsView()).status.hostApi).toBe(false);
      expect((await s.store.listPushCards(['scheduled'])).length).toBeGreaterThan(0);
    }
  });

  it.each(['denied', 'prompt', 'unsupported'] as const)('permission %s does not call replaceAll', async (permission) => {
    const s = await setup({ fake: { permission } });
    await s.controller.start();
    expect(s.fake!.calls.replaceAll).toHaveLength(0);
    const view = await s.controller.getSettingsView();
    expect(view.status.hostApi).toBe(true);
    expect(view.status.permission).toBe(permission);
  });
});

describe('host mode', () => {
  it('sends at most 20 items, all within 3 days, never with verse text', async () => {
    const s = await setup({ passages: 6, settings: { plan: { ...DEFAULT_PUSH_SETTINGS.plan, maxPerDay: 12, slots: [
      { id: 'a', kind: 'fixed', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6] },
      { id: 'b', kind: 'fixed', time: '12:00', days: [0, 1, 2, 3, 4, 5, 6] },
      { id: 'c', kind: 'fixed', time: '15:00', days: [0, 1, 2, 3, 4, 5, 6] },
      { id: 'd', kind: 'fixed', time: '18:00', days: [0, 1, 2, 3, 4, 5, 6] },
    ] } } });
    await s.controller.start();
    const items = s.fake!.lastItems!;
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(20);
    for (const i of items) {
      expect(i.fireAt).toBeGreaterThan(T0);
      expect(i.fireAt).toBeLessThanOrEqual(T0 + 3 * DAY);
      expect(i.body).toMatch(/Can you say it\?/);
      expect(i.body).not.toMatch(/beginning/);
      expect(i.key).toMatch(/^card:\d+:\d+$/);
    }
  });

  it('disabled sends an empty list and clears scheduled rows', async () => {
    const s = await setup({ enabled: false });
    await s.controller.start();
    expect(s.fake!.lastItems).toEqual([]);
    expect(await s.store.listPushCards(['scheduled'])).toEqual([]);
  });

  it('a snooze made while cards are disabled survives', async () => {
    const s = await setup({ enabled: false, passages: 1 });
    await s.controller.start();
    const res = await s.controller.snooze({ passageId: s.ids[0]!, key: 'x' });
    await s.controller.recomputeNow();
    const rows = await s.store.listPushCards(['scheduled']);
    expect(rows.map((r) => [r.origin, r.fireAt])).toEqual([['snooze', res.snoozedUntil]]);
  });

  it('window slots keep their times across recomputes on the same day', async () => {
    const s = await setup({
      settings: {
        plan: {
          slots: [{ id: 'w', kind: 'window', start: '10:00', end: '18:00', count: 3, days: [0, 1, 2, 3, 4, 5, 6] }],
          quiet: { start: '21:30', end: '07:00' },
          maxPerDay: 3,
        },
      },
      passages: 6,
    });
    await s.controller.start();
    const first = (await s.store.listPushCards(['scheduled'])).map((r) => r.fireAt).sort();
    s.clock.t += 30 * 60_000;
    await s.controller.recomputeNow();
    const second = (await s.store.listPushCards(['scheduled'])).map((r) => r.fireAt).sort();
    expect(first.length).toBeGreaterThan(0);
    expect(second.filter((t) => t > s.clock.t)).toEqual(first.filter((t) => t > s.clock.t));
  });

  it('a settings change recomputes the plan', async () => {
    const s = await setup();
    await s.controller.start();
    const before = s.fake!.lastItems!.map((i) => i.fireAt);
    await s.controller.setSettings({
      ...DEFAULT_PUSH_SETTINGS,
      enabled: true,
      plan: { ...DEFAULT_PUSH_SETTINGS.plan, slots: [{ id: 'm', kind: 'fixed', time: '10:30', days: [0, 1, 2, 3, 4, 5, 6] }] },
    });
    const after = s.fake!.lastItems!.map((i) => i.fireAt);
    expect(after.length).toBeGreaterThan(0);
    expect(after).not.toEqual(before);
    for (const at of after) expect(new Date(at).getUTCHours()).toBe(10);
    // turning it off empties the host's list
    await s.controller.setSettings({ ...DEFAULT_PUSH_SETTINGS, enabled: false });
    expect(s.fake!.lastItems).toEqual([]);
  });

  it('does not repeat a passage on the same day across recomputes', async () => {
    const s = await setup({ passages: 3 });
    await s.controller.start();
    await s.controller.recomputeNow();
    const rows = await s.store.listPushCards(['scheduled']);
    const keys = new Set(rows.map((r) => r.key));
    expect(keys.size).toBe(rows.length);
    const perDay = new Map<number, number[]>();
    for (const r of rows) {
      const d = Math.floor(r.fireAt / DAY);
      perDay.set(d, [...(perDay.get(d) ?? []), r.passageId]);
    }
    for (const ids of perDay.values()) expect(new Set(ids).size).toBe(ids.length);
  });

  it('serializes overlapping recomputes', async () => {
    const s = await setup({ fake: { replaceAllDelayMs: 15 } });
    await Promise.all([s.controller.recomputeNow(), s.controller.recomputeNow(), s.controller.recomputeNow()]);
    // start() was never called, so no reminders were detected; detect via start.
    await s.controller.start();
    await Promise.all([s.controller.recomputeNow(), s.controller.recomputeNow(), s.controller.recomputeNow()]);
    expect(s.fake!.calls.replaceAll.length).toBeGreaterThanOrEqual(4);
    expect(s.fake!.maxInFlight).toBe(1);
  });

  it('subscribes to onActivated/onMissed and releases them on dispose', async () => {
    const s = await setup();
    await s.controller.start();
    expect(s.fake!.listenerCount).toEqual({ activated: 1, missed: 1 });
    s.controller.dispose();
    expect(s.fake!.listenerCount).toEqual({ activated: 0, missed: 0 });
  });
});

describe('host events', () => {
  it('onMissed moves known keys to waiting and ignores unknown ones', async () => {
    const s = await setup();
    await s.controller.start();
    const row = (await s.store.listPushCards(['scheduled']))[0]!;
    await s.fake!.fireMissed([row.key, 'card:999:1']);
    expect((await s.store.listPushCards(['waiting'])).map((r) => r.key)).toEqual([row.key]);
    expect(s.posts).toContainEqual({ type: 'cardsWaitingChanged', count: 1 });
    await s.fake!.fireMissed(['nope']);
    expect(await s.controller.waitingCount()).toBe(1);
  });

  it('onActivated opens the panel, posts showCard and sets the launch intent', async () => {
    const s = await setup();
    await s.controller.start();
    const row = (await s.store.listPushCards(['scheduled']))[1]!;
    await s.fake!.fireActivated({ key: row.key, data: { v: 1, passageId: row.passageId }, firedAt: row.fireAt });
    expect(s.openPanel).toHaveBeenCalled();
    expect(s.posts).toContainEqual({ type: 'showCard', key: row.key });
    expect((await s.store.listPushCards(['waiting'])).map((r) => r.key)).toEqual([row.key]);
    expect(s.controller.consumeLaunchIntent()).toEqual({ showCard: true, key: row.key });
    expect(s.controller.consumeLaunchIntent()).toEqual({ showCard: false });
  });

  it('an unconsumed launch intent expires after 5 minutes; consuming keeps the stack order', async () => {
    const s = await setup();
    await s.store.insertPushCards([
      waitingRow('a', s.ids[0]!, T0 - 3 * HOUR),
      waitingRow('b', s.ids[1]!, T0 - 2 * HOUR),
    ]);
    await s.controller.handleActivated({ key: 'b', data: { v: 1, passageId: s.ids[1]! }, firedAt: T0 - 2 * HOUR });
    expect(s.controller.consumeLaunchIntent().showCard).toBe(true);
    expect((await s.controller.getStack()).cards.map((c) => c.key)).toEqual(['b', 'a']);
    await s.controller.handleActivated({ key: 'a', data: { v: 1, passageId: s.ids[0]! }, firedAt: T0 - 3 * HOUR });
    s.clock.t += 6 * 60_000;
    expect(s.controller.consumeLaunchIntent()).toEqual({ showCard: false });
  });

  it('onActivated on a done row does not revive it or set an intent', async () => {
    const s = await setup();
    await s.store.insertPushCards([{ ...waitingRow('d', s.ids[0]!, T0 - HOUR), state: 'done' }]);
    await s.controller.handleActivated({ key: 'd', data: { v: 1, passageId: s.ids[0]! }, firedAt: T0 - HOUR });
    expect(s.openPanel).toHaveBeenCalled();
    expect((await s.store.getPushCard('d'))?.state).toBe('done');
    expect(s.controller.consumeLaunchIntent()).toEqual({ showCard: false });
  });

  it('onMissed drops rows older than 12 hours and waits for newer ones', async () => {
    const s = await setup();
    await s.store.insertPushCards([
      { ...waitingRow('old', s.ids[0]!, T0 - 13 * HOUR), state: 'fired' },
      { ...waitingRow('new', s.ids[1]!, T0 - HOUR), state: 'fired' },
    ]);
    await s.controller.handleMissed({ keys: ['old', 'new'] });
    expect((await s.store.getPushCard('old'))?.state).toBe('dropped');
    expect((await s.store.getPushCard('new'))?.state).toBe('waiting');
  });

  it('onActivated for an unknown key creates a waiting row only for a real passage', async () => {
    const s = await setup();
    await s.controller.start();
    await s.fake!.fireActivated({ key: 'card:999:5', data: { v: 1, passageId: 999 }, firedAt: T0 });
    expect(await s.controller.waitingCount()).toBe(0);
    await s.fake!.fireActivated({ key: `card:${s.ids[0]}:5`, data: { v: 1, passageId: s.ids[0]! }, firedAt: T0 });
    expect(await s.controller.waitingCount()).toBe(1);
  });

  it('the launch-intent card comes first in the stack', async () => {
    const s = await setup();
    await s.store.insertPushCards([
      waitingRow('a', s.ids[0]!, T0 - 3 * HOUR),
      waitingRow('b', s.ids[1]!, T0 - 2 * HOUR),
    ]);
    s.clock.t = T0;
    await s.controller.handleActivated({ key: 'b', data: { v: 1, passageId: s.ids[1]! }, firedAt: T0 - 2 * HOUR });
    const stack = await s.controller.getStack();
    expect(stack.cards.map((c) => c.key)).toEqual(['b', 'a']);
    expect(stack.cards[0]!.verses).toHaveLength(1);
  });
});

describe('stack', () => {
  it('substitutes the next best passage when a card went stale', async () => {
    const s = await setup({ passages: 3 });
    // Card for passage 0 fired long ago, but the user practised it since.
    await s.store.insertPushCards([waitingRow('old', s.ids[0]!, T0 - 5 * DAY)]);
    const stack = await s.controller.getStack();
    expect(stack.cards).toHaveLength(1);
    expect(stack.cards[0]!.key).toBe('old');
    expect(stack.cards[0]!.passageId).not.toBe(s.ids[0]);
  });

  it('drops a stale row when no substitute exists', async () => {
    const s = await setup({ passages: 1 });
    await s.store.insertPushCards([waitingRow('old', s.ids[0]!, T0 - 5 * DAY)]);
    const stack = await s.controller.getStack();
    expect(stack.cards).toEqual([]);
    expect((await s.store.listPushCards()).find((r) => r.key === 'old')?.state).toBe('dropped');
  });

  it('a soft-deleted passage is skipped', async () => {
    const s = await setup({ passages: 1 });
    await s.store.insertPushCards([waitingRow('w', s.ids[0]!, T0 - HOUR)]);
    await s.store.removePassage(s.ids[0]!, T0);
    expect((await s.controller.getStack()).cards).toEqual([]);
  });

  it('firstWords prompt adds a cue', async () => {
    const s = await setup({ settings: { prompt: 'firstWords' } });
    await s.store.insertPushCards([waitingRow('w', s.ids[0]!, T0 + 0)]);
    s.clock.t = T0 + DAY;
    await s.store.setPushCardState('w', 'waiting', T0);
    // Fire time is in the future of the last attempt, so the card is fresh.
    const stack = await s.controller.getStack();
    expect(stack.cards[0]!.cue).toBe('In the beginning…');
  });
});

describe('grading', () => {
  it('records the attempt, moves the card, settles the row and refreshes', async () => {
    const s = await setup({ passages: 2 });
    await s.controller.start();
    const row = (await s.store.listPushCards(['scheduled']))[0]!;
    await s.store.setPushCardState(row.key, 'waiting', T0);
    s.posts.length = 0;
    const res = await s.controller.grade({ passageId: row.passageId, grade: 'knew', key: row.key, durationMs: 99 * 60 * 1000 });
    expect((await s.store.listPushCards()).find((r) => r.key === row.key)?.state).toBe('done');
    const recall = await s.store.getRecallCard(row.passageId);
    expect(recall?.intervalStep).toBe(0);
    expect(res.nextDueAt).toBe(recall?.dueAt);
    const attempt = await s.harness.queryOne<{ score: number; correct_first: number; total_steps: number; duration_ms: number; tier: number }>(
      `SELECT * FROM memory_attempt WHERE card_id = ?`, [recall!.id],
    );
    expect(attempt).toMatchObject({ score: 1, correct_first: 1, total_steps: 1, tier: 0, duration_ms: 30 * 60 * 1000 });
    expect(s.refreshStatus).toHaveBeenCalled();
    expect(s.posts).toContainEqual({ type: 'planChanged' });
    expect(res.stack.cards.find((c) => c.passageId === row.passageId)).toBeUndefined();
  });

  it('partly and missed grades use 0.7 and 0.3', async () => {
    const s = await setup({ passages: 1 });
    const id = s.ids[0]!;
    await s.controller.grade({ passageId: id, grade: 'partly' });
    await s.controller.grade({ passageId: id, grade: 'missed' });
    const recall = (await s.store.getRecallCard(id))!;
    const scores = await s.harness.query<{ score: number }>(`SELECT score FROM memory_attempt WHERE card_id = ? ORDER BY id`, [recall.id]);
    expect(scores.map((r) => r.score)).toEqual([0.7, 0.3]);
  });

  async function masterWell(s: Awaited<ReturnType<typeof setup>>, passageId: number) {
    for (const rung of ['ordering', 'blanks', 'firstletters'] as Rung[]) {
      const card = await s.store.getCard(passageId, rung);
      for (let tier = 0; tier < TIERS[rung]; tier += 1) {
        await s.store.recordAttempt({
          cardId: card!.id, at: T0 - DAY + tier, score: 1, correctFirst: 19, totalSteps: 20, durationMs: 1000, tier,
        });
      }
    }
  }

  it('missed on a well-learned passage makes its hardest rung due now', async () => {
    const s = await setup({ passages: 1 });
    const id = s.ids[0]!;
    await masterWell(s, id);
    await s.controller.grade({ passageId: id, grade: 'missed' });
    const hardest = (await s.store.getCard(id, 'firstletters'))!;
    expect(hardest.dueAt).toBe(T0);
    expect((await s.store.getCard(id, 'blanks'))!.dueAt).toBeNull();
  });

  it('partly on a well-learned passage leaves the ladder alone', async () => {
    const s = await setup({ passages: 1 });
    const id = s.ids[0]!;
    await masterWell(s, id);
    await s.controller.grade({ passageId: id, grade: 'partly' });
    expect((await s.store.getCard(id, 'firstletters'))!.dueAt).toBeNull();
  });

  it('missed on a not-yet-learned passage does not touch the ladder', async () => {
    const s = await setup({ passages: 1 });
    await s.controller.grade({ passageId: s.ids[0]!, grade: 'missed' });
    for (const c of await s.store.listCards(s.ids[0]!)) expect(c.dueAt).toBeNull();
  });

  it('rejects an unknown passage', async () => {
    const s = await setup({ passages: 1 });
    await expect(s.controller.grade({ passageId: 9999, grade: 'knew' })).rejects.toThrow();
  });
});

describe('snooze', () => {
  it('moves a card one hour later', async () => {
    const s = await setup({ passages: 1 });
    await s.store.insertPushCards([waitingRow('w', s.ids[0]!, T0 - HOUR)]);
    const res = await s.controller.snooze({ passageId: s.ids[0]!, key: 'w' });
    expect(res.snoozedUntil).toBe(T0 + HOUR);
    const rows = await s.store.listPushCards();
    expect(rows.find((r) => r.key === 'w')?.state).toBe('done');
    const snz = rows.find((r) => r.origin === 'snooze')!;
    expect(snz).toMatchObject({ state: 'scheduled', fireAt: T0 + HOUR });
  });

  it('inside quiet hours it waits for quiet hours to end, and survives a recompute', async () => {
    const s = await setup({ passages: 1 });
    await s.controller.start();
    s.clock.t = Date.UTC(2026, 0, 15, 22, 0, 0);
    const res = await s.controller.snooze({ passageId: s.ids[0]!, key: 'x' });
    expect(res.snoozedUntil).toBe(Date.UTC(2026, 0, 16, 7, 0, 0));
    await s.controller.recomputeNow();
    const snooze = (await s.store.listPushCards(['scheduled'])).filter((r) => r.origin === 'snooze');
    expect(snooze).toHaveLength(1);
    expect(s.fake!.lastItems!.some((i) => i.fireAt === res.snoozedUntil)).toBe(true);
  });
});

describe('settings view', () => {
  it('reports status and passages, and requests permission on demand', async () => {
    const s = await setup({ fake: { permission: 'prompt' } });
    await s.controller.start();
    let view = await s.controller.getSettingsView();
    expect(view.status).toMatchObject({ hostApi: true, permission: 'prompt' });
    expect(view.passages).toHaveLength(3);
    expect(s.fake!.calls.replaceAll).toHaveLength(0);
    view = await s.controller.requestPermission();
    expect(view.status.permission).toBe('granted');
    expect(s.fake!.calls.requestPermission).toBe(1);
    expect(s.fake!.lastItems!.length).toBeGreaterThan(0);
  });

  it('normalizes garbage settings and persists them', async () => {
    const s = await setup({ fake: null });
    const view = await s.controller.setSettings({ enabled: 'yes', plan: 5 });
    expect(view.settings.plan.maxPerDay).toBeGreaterThanOrEqual(1);
    expect(JSON.parse((await s.store.getPushSettingsRaw())!)).toEqual(view.settings);
  });
});
