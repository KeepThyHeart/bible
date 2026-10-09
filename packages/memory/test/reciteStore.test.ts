import { describe, it, expect } from 'vitest';
import { createMemoryTestDb } from './helpers/sqlite';
import { ensureDefaultCollection, MemoryStore, RECITE_DETAIL_KEEP, type ReciteDetailInput } from '../src/core/store';
import { schedule, makeRng } from '../src/core/scheduler';
import type { Passage } from '../src/core/types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 0, 15, 9, 0, 0);
const all = { kind: 'all' } as const;

async function fresh() {
  const harness = createMemoryTestDb().sql;
  const collectionId = await ensureDefaultCollection(harness, 'My plan', NOW);
  return { harness, collectionId, store: new MemoryStore(harness) };
}

function input(collectionId: number, start: number, count: number, ref: string): Omit<Passage, 'id' | 'answerMode' | 'reciteOn'> {
  return {
    collectionId,
    moduleId: 'kjv',
    startVerseId: start,
    endVerseId: start + count - 1,
    reference: ref,
    verseCount: count,
    addedAt: NOW,
  };
}

const detail = (n = 0): ReciteDetailInput => ({
  verdicts: 'ccvnmh',
  credits: [1, 1, 0.9, 0.5, 0, 0.2],
  verseScores: [0.7 + n / 1000],
  extras: 1,
  strictness: 'normal',
  engineId: 'eng',
  modelId: 'mod',
});

async function attempt(store: MemoryStore, cardId: number, at: number) {
  return store.recordAttempt({ cardId, at, score: 0.9, correctFirst: 1, totalSteps: 1, durationMs: 100 });
}

async function schedRecite(store: MemoryStore, passageId: number, at: number) {
  const card = (await store.getCard(passageId, 'recite'))!;
  await store.applySchedule(
    card.id,
    schedule({ intervalStep: card.intervalStep, streak: card.streak, score: 0.9, now: at, rng: makeRng(1) }),
    0.9,
  );
  return (await store.getCard(passageId, 'recite'))!;
}

describe('recite detail', () => {
  it('stores a row, and only verdicts, credits and counts', async () => {
    const { harness, store, collectionId } = await fresh();
    const { passage } = await store.addPassage(input(collectionId, 43003016, 1, 'John 3:16'));
    const card = (await store.getCard(passage.id, 'recite'))!;
    const aid = await attempt(store, card.id, NOW);
    await store.recordReciteDetail(aid, card.id, NOW, detail());
    const rows = await harness.query<Record<string, unknown>>(`SELECT * FROM memory_recite_detail`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ attempt_id: aid, card_id: card.id, verdicts: 'ccvnmh', extras: 1, strictness: 'normal', engine_id: 'eng', model_id: 'mod' });
    expect(JSON.parse(rows[0]!.credits as string)).toEqual([1, 1, 0.9, 0.5, 0, 0.2]);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      ['at', 'attempt_id', 'card_id', 'credits', 'engine_id', 'extras', 'model_id', 'strictness', 'verdicts', 'verse_scores'],
    );
  });

  it('prunes to the last 20 per card, keeping the newest, without touching other cards', async () => {
    const { harness, store, collectionId } = await fresh();
    const { passage } = await store.addPassage(input(collectionId, 43003016, 1, 'John 3:16'));
    const { passage: other } = await store.addPassage(input(collectionId, 45008028, 1, 'Romans 8:28'));
    const card = (await store.getCard(passage.id, 'recite'))!;
    const oc = (await store.getCard(other.id, 'recite'))!;
    const ids: number[] = [];
    for (let i = 0; i < 25; i++) {
      const aid = await attempt(store, card.id, NOW + i * 1000);
      ids.push(aid);
      await store.recordReciteDetail(aid, card.id, NOW + i * 1000, detail(i));
    }
    const oaid = await attempt(store, oc.id, NOW);
    await store.recordReciteDetail(oaid, oc.id, NOW, detail());

    expect(RECITE_DETAIL_KEEP).toBe(20);
    const kept = await harness.query<{ attempt_id: number }>(
      `SELECT attempt_id FROM memory_recite_detail WHERE card_id = ? ORDER BY at`, [card.id]);
    expect(kept.map((r) => r.attempt_id)).toEqual(ids.slice(5));
    expect(await harness.query(`SELECT 1 FROM memory_recite_detail WHERE card_id = ?`, [oc.id])).toHaveLength(1);
    // Attempts are never pruned.
    expect(await harness.query(`SELECT 1 FROM memory_attempt WHERE card_id = ?`, [card.id])).toHaveLength(25);
  });

  it('deleteReciteHistory clears detail but keeps attempts and due_at', async () => {
    const { harness, store, collectionId } = await fresh();
    const { passage } = await store.addPassage(input(collectionId, 43003016, 1, 'John 3:16'));
    const card = await schedRecite(store, passage.id, NOW);
    const aid = await attempt(store, card.id, NOW);
    await store.recordReciteDetail(aid, card.id, NOW, detail());
    await store.deleteReciteHistory();
    expect(await harness.query(`SELECT 1 FROM memory_recite_detail`)).toHaveLength(0);
    expect(await harness.query(`SELECT 1 FROM memory_attempt`)).toHaveLength(1);
    expect((await store.getCard(passage.id, 'recite'))!.dueAt).toBe(card.dueAt);
    expect(card.dueAt).not.toBeNull();
  });

  it('resetPassageProgress clears that passage detail only', async () => {
    const { harness, store, collectionId } = await fresh();
    const { passage: a } = await store.addPassage(input(collectionId, 43003016, 1, 'John 3:16'));
    const { passage: b } = await store.addPassage(input(collectionId, 45008028, 1, 'Romans 8:28'));
    for (const p of [a, b]) {
      const c = (await store.getCard(p.id, 'recite'))!;
      await store.recordReciteDetail(await attempt(store, c.id, NOW), c.id, NOW, detail());
    }
    await store.resetPassageProgress(a.id, NOW + 1);
    const rows = await harness.query<{ card_id: number }>(`SELECT card_id FROM memory_recite_detail`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.card_id).toBe((await store.getCard(b.id, 'recite'))!.id);
  });

  it('cascades when the attempt goes away with its passage', async () => {
    const { harness, store, collectionId } = await fresh();
    const { passage } = await store.addPassage(input(collectionId, 43003016, 1, 'John 3:16'));
    const c = (await store.getCard(passage.id, 'recite'))!;
    await store.recordReciteDetail(await attempt(store, c.id, NOW), c.id, NOW, detail());
    await harness.run(`DELETE FROM memory_passage WHERE id = ?`, [passage.id]);
    expect(await harness.query(`SELECT 1 FROM memory_recite_detail`)).toHaveLength(0);
  });
});

describe('recite due rules', () => {
  it('excludes untried + off, includes untried + on, includes tried and due', async () => {
    const { store, collectionId } = await fresh();
    const { passage: a } = await store.addPassage(input(collectionId, 43003016, 1, 'John 3:16'));
    const { passage: b } = await store.addPassage(input(collectionId, 45008028, 1, 'Romans 8:28'));
    const { passage: c } = await store.addPassage(input(collectionId, 19023001, 1, 'Psalm 23:1'));

    expect(await store.reciteDueCount(all, NOW)).toBe(0);
    expect(await store.nextDueRecite(all, NOW, [])).toBeUndefined();

    await store.setPassageReciteOn(b.id, true);
    expect((await store.getPassage(b.id))!.reciteOn).toBe(true);
    expect(await store.reciteDueCount(all, NOW)).toBe(1);
    expect((await store.nextDueRecite(all, NOW, []))?.passage.id).toBe(b.id);

    const cCard = await schedRecite(store, c.id, NOW);
    expect(cCard.dueAt).not.toBeNull();
    const later = cCard.dueAt! + 1;
    expect(await store.reciteDueCount(all, later)).toBe(2);
    // Tried-and-due sorts before untried-on.
    expect((await store.nextDueRecite(all, later, []))?.passage.id).toBe(c.id);
    expect((await store.nextDueRecite(all, later, [c.id]))?.passage.id).toBe(b.id);
    expect(await store.nextDueRecite(all, later, [c.id, b.id])).toBeUndefined();
    // Not yet due.
    expect(await store.reciteDueCount(all, NOW)).toBe(1);

    await store.setPassageReciteOn(b.id, false);
    expect(await store.reciteDueCount(all, NOW)).toBe(0);
    void a;
  });

  it('never leaks recite into dueCount or nextDueCard', async () => {
    const { store, collectionId } = await fresh();
    const { passage } = await store.addPassage(input(collectionId, 43003016, 1, 'John 3:16'));
    await store.setPassageReciteOn(passage.id, true);
    const card = await schedRecite(store, passage.id, NOW);
    const later = card.dueAt! + DAY;
    expect(await store.reciteDueCount(all, later)).toBe(1);
    expect(await store.dueCount(all, later)).toBe(0);
    expect(await store.dueCount({ kind: 'list', id: collectionId }, later)).toBe(0);
    expect(await store.nextDueCard(all, later)).toBeUndefined();
    expect(await store.nextDueCard({ kind: 'list', id: collectionId }, later)).toBeUndefined();
  });

  it('respects list scope', async () => {
    const { store, collectionId } = await fresh();
    const other = (await store.createCollection('Other', NOW)).id;
    const { passage: a } = await store.addPassage(input(collectionId, 43003016, 1, 'John 3:16'));
    const { passage: b } = await store.addPassage(input(other, 45008028, 1, 'Romans 8:28'));
    await store.setPassageReciteOn(a.id, true);
    await store.setPassageReciteOn(b.id, true);
    expect(await store.reciteDueCount({ kind: 'list', id: other }, NOW)).toBe(1);
    expect((await store.nextDueRecite({ kind: 'list', id: other }, NOW, []))?.passage.id).toBe(b.id);
    expect(await store.reciteDueCount(all, NOW)).toBe(2);
  });

  it('soft delete hides a passage from recite due queries', async () => {
    const { store, collectionId } = await fresh();
    const { passage } = await store.addPassage(input(collectionId, 43003016, 1, 'John 3:16'));
    await store.setPassageReciteOn(passage.id, true);
    expect(await store.reciteDueCount(all, NOW)).toBe(1);
    await store.removePassage(passage.id, NOW);
    expect(await store.reciteDueCount(all, NOW)).toBe(0);
    expect(await store.nextDueRecite(all, NOW, [])).toBeUndefined();
  });
});
