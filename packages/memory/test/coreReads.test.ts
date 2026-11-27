/**
 * Round 2 core read path (design-r2 1a and 2b): batched queries, reads that never wait on the speech engine,
 * plan epoch/version, all-scope mutation replies, `addPassageRange` and `previewVerses`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeSpeechApi } from '@bible/core/speech';

import type { MemorySql } from '../src/core/ports';
import { resetProbeCache } from '../src/core/recite/speechAvailability';
import type { PassageView, PlanView, SettingsView } from '../src/core/types';
import { createMemoryTestDb } from './helpers/sqlite';
import { MODULE_KJV, call, disposeAll, startTestService } from './helpers/service';

beforeEach(resetProbeCache);
afterEach(disposeAll);

function counting(inner: MemorySql, counts: { n: number }): MemorySql {
  const wrap = (sql: MemorySql): MemorySql => ({
    exec: (s) => (counts.n++, sql.exec(s)),
    query: (s, p) => (counts.n++, sql.query(s, p)),
    queryOne: (s, p) => (counts.n++, sql.queryOne(s, p)),
    run: (s, p) => (counts.n++, sql.run(s, p)),
    transaction: (work) => sql.transaction((tx) => work(wrap(tx))),
  });
  return wrap(inner);
}

const RUNGS = ['ordering', 'blanks', 'firstletters', 'refmatch', 'recite'];

async function seed(db: MemorySql, n: number): Promise<number[]> {
  const list = await db.queryOne<{ id: number }>('SELECT id FROM memory_collection LIMIT 1');
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const verse = 43_003_000 + i + 1;
    const p = await db.run(
      `INSERT INTO memory_passage (collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at)
       VALUES (?, 'KJV', ?, ?, ?, 1, 0)`,
      [list!.id, verse, verse, `John 3:${i + 1}`],
    );
    const passageId = Number(p.lastInsertRowid);
    ids.push(passageId);
    for (const rung of RUNGS) {
      const c = await db.run(
        `INSERT INTO memory_card (passage_id, rung, state, interval_step, due_at, streak, last_score)
         VALUES (?, ?, 'learning', 1, 1000, 1, 0.9)`,
        [passageId, rung],
      );
      const cardId = Number(c.lastInsertRowid);
      await db.run(
        `INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps, replay, tier) VALUES (?, ?, 0.9, 3, 4, 0, 0)`,
        [cardId, 5000 + i],
      );
      await db.run(
        `INSERT INTO memory_resume_state (card_id, cursor, correct_first, graded_units, tier, updated_at) VALUES (?, 1, 1, 1, 0, 0)`,
        [cardId],
      );
    }
  }
  return ids;
}

function neverSpeech(): { speech: FakeSpeechApi; calls: () => number } {
  const speech = new FakeSpeechApi();
  let n = 0;
  speech.status = () => {
    n++;
    return new Promise(() => undefined);
  };
  return { speech, calls: () => n };
}

function within<T>(p: Promise<T>, ms = 3000): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out')), ms))]);
}

describe('batched reads', () => {
  async function statementsFor(n: number) {
    const counts = { n: 0 };
    const db = createMemoryTestDb();
    const t = await startTestService({ db, sql: counting(db.sql, counts) });
    const ids = await seed(db.sql, n);
    counts.n = 0;
    const plan = await call<PlanView>(t.svc, { type: 'getPlan' });
    const planStatements = counts.n;
    expect(plan.passages).toHaveLength(n);
    counts.n = 0;
    await call<PassageView>(t.svc, { type: 'getPassageView', passageId: ids[0]! });
    const viewStatements = counts.n;
    counts.n = 0;
    await call(t.svc, { type: 'getAnalytics' });
    return { planStatements, viewStatements, analyticsStatements: counts.n };
  }

  it('costs the same number of queries for 4 passages and for 40', async () => {
    const small = await statementsFor(4);
    const big = await statementsFor(40);
    expect(big.planStatements).toBe(small.planStatements);
    expect(big.viewStatements).toBe(small.viewStatements);
    expect(big.analyticsStatements).toBe(small.analyticsStatements);
    expect(big.planStatements).toBeLessThan(25);
  });

  it('keeps resume points and levels on the batched path', async () => {
    const t = await startTestService();
    await seed(t.sql, 3);
    await t.sql.run('UPDATE memory_passage SET verse_count = 4, end_verse_id = start_verse_id + 3');
    const plan = await call<PlanView>(t.svc, { type: 'getPlan' });
    const blanks = plan.passages[0]!.rungs.find((r) => r.rung === 'blanks')!;
    expect(blanks.resume).toEqual({ stepsDone: 1, totalSteps: expect.any(Number) });
    expect(blanks.attempts).toBe(1);
  });

  it('reports the streak on the plan', async () => {
    const now = new Date(2026, 5, 10, 12).getTime();
    const t = await startTestService({ now: () => now });
    expect((await call<PlanView>(t.svc, { type: 'getPlan' })).streakDays).toBe(0);
    await seed(t.sql, 1);
    await t.sql.run('UPDATE memory_attempt SET at = ?', [now - 1000]);
    expect((await call<PlanView>(t.svc, { type: 'getPlan' })).streakDays).toBe(1);
  });
});

describe('reads never wait on speech', () => {
  it('flags the pre-probe placeholder as unknown; a probed value never is', async () => {
    const t = await startTestService({ speech: new FakeSpeechApi() });
    expect((await call<PlanView>(t.svc, { type: 'getPlan' })).speech.unknown).toBe(true);
    await call(t.svc, { type: 'refreshSpeech' });
    const after = (await call<PlanView>(t.svc, { type: 'getPlan' })).speech;
    expect(after.state).toBe('ready');
    expect(after.unknown).toBeUndefined();
  });

  it('refreshSpeech with force re-probes despite the cache; without it does not', async () => {
    const speech = new FakeSpeechApi();
    const inner = speech.status.bind(speech);
    let n = 0;
    speech.status = async () => {
      n++;
      return inner();
    };
    const t = await startTestService({ speech });
    await call(t.svc, { type: 'refreshSpeech' });
    await call(t.svc, { type: 'refreshSpeech' });
    expect(n).toBe(1);
    await call(t.svc, { type: 'refreshSpeech', force: true });
    expect(n).toBe(2);
  });

  it('answers getPlan, getPassageView and getSettings with a speech host that never replies', async () => {
    const { speech, calls } = neverSpeech();
    const t = await startTestService({ speech });
    const ids = await seed(t.sql, 2);
    const plan = await within(call<PlanView>(t.svc, { type: 'getPlan' }));
    expect(plan.speech.state).toBe('unavailable');
    await within(call<PassageView>(t.svc, { type: 'getPassageView', passageId: ids[0]! }));
    const settings = await within(call<SettingsView>(t.svc, { type: 'getSettings' }));
    expect(settings.speech?.state).toBe('unavailable');
    expect(calls()).toBe(0);
  });

  it('refreshSpeech probes once for concurrent calls and emits one quiet planChanged', async () => {
    const speech = new FakeSpeechApi();
    const inner = speech.status.bind(speech);
    let n = 0;
    speech.status = async () => {
      n++;
      await new Promise((r) => setTimeout(r, 20));
      return inner();
    };
    const t = await startTestService({ speech });
    const before = t.pushes.length;
    await Promise.all([call(t.svc, { type: 'refreshSpeech' }), call(t.svc, { type: 'refreshSpeech' })]);
    expect(n).toBe(1);
    const changes = t.pushes.slice(before).filter((p) => p.type === 'planChanged');
    expect(changes).toHaveLength(1);
    expect((await call<PlanView>(t.svc, { type: 'getPlan' })).speech.state).toBe('ready');

    // Cached for minutes: a second refresh neither probes nor pushes.
    const mark = t.pushes.length;
    await call(t.svc, { type: 'refreshSpeech' });
    expect(n).toBe(1);
    expect(t.pushes.slice(mark).filter((p) => p.type === 'planChanged')).toHaveLength(0);
  });
});

describe('plan pushes and versions', () => {
  it('removePassage emits planChanged', async () => {
    const t = await startTestService();
    const [id] = await seed(t.sql, 1);
    const before = t.pushes.length;
    await call(t.svc, { type: 'removePassage', passageId: id! });
    expect(t.pushes.slice(before).some((p) => p.type === 'planChanged')).toBe(true);
  });

  it('stamps plans and pushes with an epoch and an increasing version', async () => {
    const t = await startTestService();
    const first = await call<PlanView>(t.svc, { type: 'getPlan' });
    expect(first.epoch).toBeTruthy();
    await call(t.svc, { type: 'setPassageSortOrder', order: 'bible' });
    const push = t.pushes.filter((p) => p.type === 'planChanged').at(-1) as { epoch?: string; version?: number };
    expect(push.epoch).toBe(first.epoch);
    expect(push.version).toBeGreaterThan(first.version!);
    const second = await call<PlanView>(t.svc, { type: 'getPlan' });
    expect(second.epoch).toBe(first.epoch);
    expect(second.version).toBeGreaterThanOrEqual(push.version!);
    // Another service instance has its own epoch.
    const other = await startTestService();
    expect((await call<PlanView>(other.svc, { type: 'getPlan' })).epoch).not.toBe(first.epoch);
  });
});

describe('mutation replies use scope all', () => {
  it('builds every reply over all lists and names the focus', async () => {
    const t = await startTestService();
    const [a, b] = await seed(t.sql, 2);
    const created = await call<PlanView>(t.svc, { type: 'createList', name: 'Second' });
    const second = created.lists.find((l) => l.name === 'Second')!;
    expect(created.scope).toBe('all');

    const moved = await call<PlanView>(t.svc, { type: 'movePassage', passageId: b!, collectionId: second.id });
    expect(moved.scope).toBe('all');
    expect(moved.passages).toHaveLength(2);

    const focused = await call<PlanView>(t.svc, { type: 'setScope', scope: { kind: 'list', id: second.id } });
    expect(focused.scope).toBe('all');
    expect(focused.focus).toBe(second.id);
    expect(focused.passages).toHaveLength(2);
    // A plain read still follows the focus; getPlan with an explicit scope also reports it.
    expect((await call<PlanView>(t.svc, { type: 'getPlan' })).passages).toHaveLength(1);
    const all = await call<PlanView>(t.svc, { type: 'getPlan', scope: { kind: 'all' } });
    expect(all.passages).toHaveLength(2);
    expect(all.focus).toBe(second.id);

    const renamed = await call<PlanView>(t.svc, { type: 'renameList', id: second.id, name: 'Renamed' });
    expect(renamed.scope).toBe('all');
    expect(renamed.passages).toHaveLength(2);
    const reset = await call<PlanView>(t.svc, { type: 'resetPassageProgress', passageId: a! });
    expect(reset.scope).toBe('all');
    expect(reset.passages).toHaveLength(2);
    const deleted = await call<PlanView>(t.svc, { type: 'deleteList', id: second.id, movePassagesTo: moved.collectionId });
    expect(deleted.scope).toBe('all');
    expect(deleted.focus).toBe('all');
    expect(deleted.passages).toHaveLength(2);
  });
});

describe('addPassageRange and previewVerses', () => {
  const chapters: Record<number, number[]> = { 1: [31, 25, 24] };
  const bible = {
    listModules: async () => [MODULE_KJV],
    listChapters: async (book: number) =>
      (chapters[book] ?? []).map((n, i) => ({
        bookNumber: book,
        chapter: i + 1,
        verseCount: n,
        firstVerseId: book * 1_000_000 + (i + 1) * 1000 + 1,
        lastVerseId: book * 1_000_000 + (i + 1) * 1000 + n,
      })),
    getRange: async (start: number, end: number) => {
      const out = [];
      for (let id = start; id <= end; id++) {
        const ch = Math.floor(id / 1000) % 1000;
        const v = id % 1000;
        if (v < 1 || v > (chapters[1]![ch - 1] ?? 0)) continue;
        out.push({ verseId: id, text: `v${id}`, textPlain: `v${id}` });
      }
      return out;
    },
  };
  const GEN = 1_000_000;

  it('adds a range, counts verses across a chapter boundary, and reports a repeat as existing', async () => {
    const t = await startTestService({ bible });
    const first = await call<{ passage: { verseCount: number; reference: string }; existed?: boolean }>(t.svc, {
      type: 'addPassageRange',
      startVerseId: GEN + 1030,
      endVerseId: GEN + 2003,
    });
    expect(first.passage.verseCount).toBe(5);
    expect(first.passage.reference).toMatch(/1:30-2:3$/);
    expect(first.existed).toBeUndefined();
    const again = await call<{ existed?: boolean }>(t.svc, {
      type: 'addPassageRange',
      startVerseId: GEN + 1030,
      endVerseId: GEN + 2003,
    });
    expect(again.existed).toBe(true);
    expect((await call<PlanView>(t.svc, { type: 'getPlan' })).passages).toHaveLength(1);
  });

  it('refuses a verse that does not exist, a backwards range and more than 25 verses', async () => {
    const t = await startTestService({ bible });
    await expect(
      call(t.svc, { type: 'addPassageRange', startVerseId: GEN + 1099, endVerseId: GEN + 1099 }),
    ).rejects.toThrow(/only has 31 verses/);
    await expect(
      call(t.svc, { type: 'addPassageRange', startVerseId: GEN + 1010, endVerseId: GEN + 1005 }),
    ).rejects.toThrow(/before it starts/);
    await expect(
      call(t.svc, { type: 'addPassageRange', startVerseId: GEN + 1001, endVerseId: GEN + 1031 }),
    ).rejects.toThrow(/31 verses/);
    await expect(
      call(t.svc, { type: 'addPassageRange', startVerseId: GEN + 1001, endVerseId: GEN + 1002, newListName: '  ' }),
    ).rejects.toThrow();
    expect((await call<PlanView>(t.svc, { type: 'getPlan' })).passages).toHaveLength(0);
  });

  it('adds into a new list by name, reusing an existing name', async () => {
    const t = await startTestService({ bible });
    const r1 = await call<{ passage: { collectionId: number } }>(t.svc, {
      type: 'addPassageRange', startVerseId: GEN + 1001, endVerseId: GEN + 1002, newListName: ' Mine ',
    });
    const r2 = await call<{ passage: { collectionId: number } }>(t.svc, {
      type: 'addPassageRange', startVerseId: GEN + 1003, endVerseId: GEN + 1004, newListName: 'mine',
    });
    expect(r2.passage.collectionId).toBe(r1.passage.collectionId);
  });

  it('previews a validated range with its reference and text', async () => {
    const t = await startTestService({ bible });
    const p = await call<{ reference: string; verses: { text: string }[] }>(t.svc, {
      type: 'previewVerses', startVerseId: GEN + 1030, endVerseId: GEN + 2003,
    });
    expect(p.reference).toMatch(/1:30-2:3$/);
    expect(p.verses).toHaveLength(5);
    await expect(
      call(t.svc, { type: 'previewVerses', startVerseId: GEN + 1001, endVerseId: GEN + 1031 }),
    ).rejects.toThrow(/31 verses/);
    await expect(
      call(t.svc, { type: 'previewVerses', startVerseId: GEN + 1099, endVerseId: GEN + 1099 }),
    ).rejects.toThrow(/only has 31 verses/);
  });
});
