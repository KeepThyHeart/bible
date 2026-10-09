/**
 * Storage for push cards (task 0072): the recall card that
 * hides from the ordinary queries, and the memory_push_card table.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryTestDb } from './helpers/sqlite';
import { ensureDefaultCollection, MemoryStore } from '../src/core/store';
import { schedule, makeRng, INTERVALS_DAYS } from '../src/core/scheduler';
import { RECALL_SCORES } from '../src/core/pushTypes';
import type { PushCardRow } from '../src/core/pushTypes';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 15, 9, 0, 0);

async function fresh() {
  const harness = createMemoryTestDb().sql;
  const collectionId = await ensureDefaultCollection(harness, 'My plan', NOW);
  const store = new MemoryStore(harness);
  return { harness, collectionId, store };
}

async function addPassage(store: MemoryStore, collectionId: number, start: number, ref: string) {
  const { passage } = await store.addPassage({
    collectionId,
    moduleId: 'kjv',
    startVerseId: start,
    endVerseId: start + 1,
    reference: ref,
    verseCount: 2,
    addedAt: NOW,
  });
  await store.syncLadders(collectionId);
  return passage;
}

function row(key: string, passageId: number, fireAt: number, over: Partial<PushCardRow> = {}): PushCardRow {
  return { key, passageId, fireAt, origin: 'plan', state: 'scheduled', updatedAt: NOW, ...over };
}

describe('push card schema', () => {
  it('has the memory_push_card table on a fresh database', async () => {
    const { harness } = await fresh();
    const t = await harness.queryOne<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='memory_push_card'`,
    );
    expect(t?.name).toBe('memory_push_card');
  });
});

describe('recall card', () => {
  it('is hidden from listCards, dueCount and nextDueCard', async () => {
    const { store, collectionId } = await fresh();
    const p = await addPassage(store, collectionId, 100, 'John 3:16-17');
    const before = (await store.listCards(p.id)).length;
    const recall = await store.ensureRecallCard(p.id);
    await store.setCardDueAt(recall.id, NOW - 1000);

    expect((await store.listCards(p.id)).length).toBe(before);
    expect((await store.listCards(p.id)).some((c) => c.rung === ('recall' as never))).toBe(false);
    const scope = { kind: 'all' } as const;
    // Every ordinary card is due_at NULL, so only the recall card could be due.
    expect(await store.dueCount(scope, NOW)).toBe(0);
    expect(await store.dueCount({ kind: 'list', id: collectionId }, NOW)).toBe(0);
    expect(await store.nextDueCard(scope, NOW)).toBeUndefined();
    expect((await store.getRecallCard(p.id))?.dueAt).toBe(NOW - 1000);
  });

  it('ensureRecallCard is idempotent', async () => {
    const { store, collectionId } = await fresh();
    const p = await addPassage(store, collectionId, 100, 'John 3:16-17');
    const a = await store.ensureRecallCard(p.id);
    const b = await store.ensureRecallCard(p.id);
    expect(b.id).toBe(a.id);
    expect(a.intervalStep).toBe(-1);
  });

  it('its attempts count for lastAttemptAt and the streak calendar', async () => {
    const { store, collectionId } = await fresh();
    const p = await addPassage(store, collectionId, 100, 'John 3:16-17');
    const recall = await store.ensureRecallCard(p.id);
    await store.recordAttempt({
      cardId: recall.id, at: NOW, score: 1, correctFirst: 1, totalSteps: 1, durationMs: 500, tier: 0,
    });
    const facts = await store.listPushCandidateFacts();
    expect(facts).toEqual([
      { passageId: p.id, reference: 'John 3:16-17', lastAttemptAt: NOW, recallDueAt: null },
    ]);
  });

  it('missed / partly / knew reset, step back and advance interval_step', async () => {
    const { store, collectionId } = await fresh();
    const p = await addPassage(store, collectionId, 100, 'John 3:16-17');
    const recall = await store.ensureRecallCard(p.id);
    const grade = async (score: number, now: number) => {
      const c = (await store.getRecallCard(p.id))!;
      const r = schedule({ intervalStep: c.intervalStep, streak: c.streak, score, now, rng: makeRng(now ^ c.id) });
      await store.applySchedule(c.id, r, score);
      return (await store.getRecallCard(p.id))!;
    };
    expect((await grade(RECALL_SCORES.knew, NOW)).intervalStep).toBe(0);
    expect((await grade(RECALL_SCORES.knew, NOW + DAY)).intervalStep).toBe(1);
    const partly = await grade(RECALL_SCORES.partly, NOW + 2 * DAY);
    expect(partly.intervalStep).toBe(0);
    const missed = await grade(RECALL_SCORES.missed, NOW + 3 * DAY);
    expect(missed.intervalStep).toBe(0);
    expect(missed.streak).toBe(0);
    expect(missed.dueAt).toBeGreaterThan(NOW + 3 * DAY);
    expect(INTERVALS_DAYS[0]).toBe(1);
    void recall;
  });
});

describe('push_card table', () => {
  it('cascades when the passage row is deleted', async () => {
    const { store, collectionId, harness } = await fresh();
    const p = await addPassage(store, collectionId, 100, 'John 3:16-17');
    await store.insertPushCards([row('card:1:1', p.id, NOW + 1000)]);
    expect(await store.listPushCards()).toHaveLength(1);
    await harness.run(`DELETE FROM memory_passage WHERE id = ?`, [p.id]);
    expect(await store.listPushCards()).toHaveLength(0);
  });

  it('insert ignores duplicate keys; list filters by state', async () => {
    const { store, collectionId } = await fresh();
    const p = await addPassage(store, collectionId, 100, 'John 3:16-17');
    await store.insertPushCards([row('a', p.id, NOW + 1), row('a', p.id, NOW + 2), row('b', p.id, NOW + 3, { state: 'waiting' })]);
    expect((await store.listPushCards()).map((r) => r.key)).toEqual(['a', 'b']);
    expect((await store.listPushCards(['waiting'])).map((r) => r.key)).toEqual(['b']);
    expect(await store.listPushCards([])).toEqual([]);
    expect(await store.waitingCount()).toBe(1);
  });

  it('deleteFutureScheduled only removes future scheduled rows of that origin', async () => {
    const { store, collectionId } = await fresh();
    const p = await addPassage(store, collectionId, 100, 'John 3:16-17');
    await store.insertPushCards([
      row('past', p.id, NOW - 10),
      row('fut', p.id, NOW + 10),
      row('snz', p.id, NOW + 10, { origin: 'snooze' }),
      row('wait', p.id, NOW + 10, { state: 'waiting' }),
    ]);
    await store.deleteFutureScheduled(NOW, 'plan');
    expect((await store.listPushCards()).map((r) => r.key).sort()).toEqual(['past', 'snz', 'wait']);
  });

  it('setPushCardState updates state and updated_at', async () => {
    const { store, collectionId } = await fresh();
    const p = await addPassage(store, collectionId, 100, 'John 3:16-17');
    await store.insertPushCards([row('a', p.id, NOW)]);
    expect(await store.setPushCardState('a', 'done', NOW + 5)).toBe(true);
    expect(await store.setPushCardState('nope', 'done', NOW + 5)).toBe(false);
    const [r] = await store.listPushCards();
    expect(r).toMatchObject({ state: 'done', updatedAt: NOW + 5 });
  });

  it('prunes settled rows older than the max age and keeps the rest', async () => {
    const { store, collectionId } = await fresh();
    const p = await addPassage(store, collectionId, 100, 'John 3:16-17');
    await store.insertPushCards([
      row('old-done', p.id, NOW, { state: 'done', updatedAt: NOW - 40 * DAY }),
      row('new-done', p.id, NOW, { state: 'done', updatedAt: NOW - DAY }),
      row('old-wait', p.id, NOW, { state: 'waiting', updatedAt: NOW - 40 * DAY }),
    ]);
    await store.prunePushCards(NOW, 30 * DAY);
    expect((await store.listPushCards()).map((r) => r.key).sort()).toEqual(['new-done', 'old-wait']);
  });

  it('usedPassageIdsByDay groups by the injected day function', async () => {
    const { store, collectionId } = await fresh();
    const p1 = await addPassage(store, collectionId, 100, 'A 1:1-2');
    const p2 = await addPassage(store, collectionId, 200, 'B 1:1-2');
    const dayStart = Math.floor(NOW / DAY) * DAY;
    await store.insertPushCards([
      row('a', p1.id, dayStart + 1000),
      row('b', p2.id, dayStart + DAY + 1000),
      row('c', p1.id, dayStart + DAY + 2000, { state: 'dropped' }),
      row('d', p2.id, dayStart - 1000),
    ]);
    const map = await store.usedPassageIdsByDay(dayStart, (ms) => Math.floor(ms / DAY) * DAY);
    expect([...map.get(dayStart)!]).toEqual([p1.id]);
    expect([...map.get(dayStart + DAY)!]).toEqual([p2.id]);
    expect(map.size).toBe(2);
  });

  it('settings round-trip as raw JSON', async () => {
    const { store } = await fresh();
    expect(await store.getPushSettingsRaw()).toBeUndefined();
    await store.setPushSettingsRaw('{"enabled":true}');
    expect(await store.getPushSettingsRaw()).toBe('{"enabled":true}');
  });
});
