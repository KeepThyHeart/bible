/**
 * Core performance bench (design-r2 section 1c, subtask P0). Skipped unless `MEMORY_PERF` is set:
 *
 *   MEMORY_PERF=1 MEMORY_PERF_OUT=/path/out.json pnpm exec vitest run test/perf/planBuild.perf.test.ts
 *
 * Seeds N = 50 / 300 / 1000 passages in 4 lists, 5 cards each and about 10 attempts per card over 60 days,
 * then times (median and p95 over 10 runs) `getPlan`, `getPlan(all)`, `getAnalytics`, `getPassageView`,
 * `getSettings` and `readMemoryStatus`, with a counting `MemorySql` wrapper. The fake speech host's
 * `status()` waits 0 or 800 ms; "cold" runs reset the probe cache before every run, "warm" runs do not.
 * A markdown table goes to stdout; JSON goes to `MEMORY_PERF_OUT` when set.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { FakeSpeechApi } from '@bible/core/speech';
import type { SpeechStatusDto } from '@bible/core/speech';
import { writeFileSync } from 'node:fs';

import type { MemorySql } from '../../src/core/ports';
import { resetProbeCache } from '../../src/core/recite/speechAvailability';
import { readMemoryStatus } from '../../src/core/status';
import { createMemoryTestDb } from '../helpers/sqlite';
import type { MemoryTestDb } from '../helpers/sqlite';
import { disposeAll, startTestService } from '../helpers/service';

const ENABLED = Boolean(process.env.MEMORY_PERF);
const OUT = process.env.MEMORY_PERF_OUT;
const RUNS = 10;
const SIZES = [50, 300, 1000];
const WAITS = [0, 800];
const LISTS = 4;
const RUNGS = ['ordering', 'blanks', 'firstletters', 'refmatch', 'recite'];
const DAY = 86_400_000;

interface Counts {
  statements: number;
}

/** A `MemorySql` that counts every statement (transactions count their inner statements too). */
function counting(inner: MemorySql, counts: Counts): MemorySql {
  const wrap = (sql: MemorySql): MemorySql => ({
    exec: (s) => {
      counts.statements += 1;
      return sql.exec(s);
    },
    query: (s, p) => {
      counts.statements += 1;
      return sql.query(s, p);
    },
    queryOne: (s, p) => {
      counts.statements += 1;
      return sql.queryOne(s, p);
    },
    run: (s, p) => {
      counts.statements += 1;
      return sql.run(s, p);
    },
    transaction: (work) => sql.transaction((tx) => work(wrap(tx))),
  });
  return wrap(inner);
}

/** Adds the lists, passages, cards and attempts directly through the synchronous host handle (fast). */
function seed(db: MemoryTestDb, n: number, now: number): number[] {
  const host = db.host;
  const collections = host.queryAll<{ id: number }>('SELECT id FROM memory_collection ORDER BY id').map((c) => c.id);
  for (let i = collections.length; i < LISTS; i++) {
    const r = host.execute('INSERT INTO memory_collection (name, created_at) VALUES (?, ?)', [`List ${i + 1}`, now]);
    collections.push(Number(r.lastInsertRowId));
  }
  const ids: number[] = [];
  host.transaction(() => {
    for (let i = 0; i < n; i++) {
      const verse = 43_003_000 + i;
      const p = host.execute(
        `INSERT INTO memory_passage (collection_id, module_id, start_verse_id, end_verse_id, reference, verse_count, added_at)
         VALUES (?, 'KJV', ?, ?, ?, 1, ?)`,
        [collections[i % LISTS], verse, verse, `Bench ${i + 1}`, now - (n - i) * 3_600_000],
      );
      const passageId = Number(p.lastInsertRowId);
      ids.push(passageId);
      RUNGS.forEach((rung, r) => {
        const learned = (i + r) % 3 !== 0;
        const dueAt = learned ? now + (((i * 7 + r) % 21) - 10) * DAY : null;
        const c = host.execute(
          `INSERT INTO memory_card (passage_id, rung, state, interval_step, due_at, streak, last_score)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [passageId, rung, learned ? 'learning' : 'new', learned ? (i + r) % 6 : -1, dueAt, learned ? 2 : 0, learned ? 0.9 : null],
        );
        if (!learned) return;
        for (let a = 0; a < 10; a++) {
          host.execute(
            `INSERT INTO memory_attempt (card_id, at, score, correct_first, total_steps, replay, tier) VALUES (?, ?, ?, ?, ?, 0, 0)`,
            [Number(c.lastInsertRowId), now - Math.floor(((a * 6 + (i % 6)) / 60) * 60 * DAY) - ((i * 13) % 5000), 0.6 + ((a + i) % 5) / 12, 3, 4],
          );
        }
      });
    }
  });
  return ids;
}

/** A speech host whose `status()` takes `waitMs` (the renderer round trip plus the engine import). */
function slowSpeech(waitMs: number): FakeSpeechApi {
  const speech = new FakeSpeechApi();
  const status = speech.status.bind(speech);
  speech.status = async (): Promise<SpeechStatusDto> => {
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    return status();
  };
  return speech;
}

function stats(samples: number[]): { median: number; p95: number } {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!;
  return { median: at(0.5), p95: at(0.95) };
}

interface Row {
  passages: number;
  speechWaitMs: number;
  probe: 'cold' | 'warm';
  op: string;
  medianMs: number;
  p95Ms: number;
  statements: number;
}

const rows: Row[] = [];

function table(all: Row[]): string {
  const lines = ['| passages | speech wait | probe | operation | median ms | p95 ms | statements |', '|---:|---:|---|---|---:|---:|---:|'];
  for (const r of all) {
    lines.push(`| ${r.passages} | ${r.speechWaitMs} | ${r.probe} | ${r.op} | ${r.medianMs.toFixed(1)} | ${r.p95Ms.toFixed(1)} | ${r.statements} |`);
  }
  return lines.join('\n');
}

describe.skipIf(!ENABLED)('memory core perf (MEMORY_PERF=1)', () => {
  afterEach(() => {
    disposeAll();
    resetProbeCache();
  });

  afterAll(() => {
    if (rows.length === 0) return;
    // eslint-disable-next-line no-console
    console.log(`\n${table(rows)}\n`);
    if (OUT) writeFileSync(OUT, JSON.stringify({ runs: RUNS, rows }, null, 2));
  });

  for (const n of SIZES) {
    for (const wait of WAITS) {
      it(`N=${n}, speech status waits ${wait} ms`, { timeout: 600_000 }, async () => {
        const db = createMemoryTestDb();
        const counts: Counts = { statements: 0 };
        const now = Date.now();
        const t = await startTestService({ db, sql: counting(db.sql, counts), speech: slowSpeech(wait) });
        const ids = seed(db, n, now);
        const svc = t.svc;
        const mid = ids[Math.floor(ids.length / 2)]!;

        const ops: Array<[string, (() => Promise<unknown>), boolean]> = [
          ['getPlan', () => svc.getPlan(), true],
          ['getPlan(all)', () => svc.getPlan({ scope: { kind: 'all' } }), true],
          ['getAnalytics', () => svc.getAnalytics(), false],
          ['getPassageView', () => svc.getPassageView({ passageId: mid }), true],
          ['getSettings', () => svc.getSettings(), true],
          ['readMemoryStatus', async () => readMemoryStatus(db.host, Date.now()), false],
        ];

        // Sanity: the seed is what we think it is.
        const plan = await svc.getPlan({ scope: { kind: 'all' } });
        expect(plan.passages).toHaveLength(n);

        for (const probe of ['cold', 'warm'] as const) {
          if (probe === 'warm' && wait === 0) continue; // identical to cold when the host answers at once
          for (const [op, fn, touchesSpeech] of ops) {
            if (probe === 'warm' && !touchesSpeech) continue;
            const samples: number[] = [];
            let statements = 0;
            if (probe === 'warm') await fn(); // fill the probe cache
            for (let i = 0; i < RUNS; i++) {
              if (probe === 'cold') resetProbeCache();
              const before = counts.statements;
              const t0 = performance.now();
              await fn();
              samples.push(performance.now() - t0);
              statements = counts.statements - before;
            }
            const { median, p95 } = stats(samples);
            rows.push({ passages: n, speechWaitMs: wait, probe, op, medianMs: median, p95Ms: p95, statements });
          }
        }
      });
    }
  }
});
