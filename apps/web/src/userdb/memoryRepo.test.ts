// @vitest-environment node
/**
 * The worker `memory` repo over the in-process handler and a real (in-memory) sqlite-wasm database. The Bible port is
 * a fake main thread that answers `hostCall` events through `hostReply`, as a leader tab's client does.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { ReadingPlans, type Sync } from '@bible/core/browser';
import { MEMORY_API_METHODS } from '@bible/memory/api';
import type { MemoryPush } from '@bible/memory/api';
import { createUserDbHandler } from './handler';
import { createMemoryRepo } from './memoryRepo';
import { finishOpen } from './openUserDb';
import type { UserDbEvent } from './protocol';

let sqlite3: Awaited<ReturnType<typeof sqlite3InitModule>>;
beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
}, 60_000);

const JOHN = 43;

/** A tiny Bible: John 3:16 and friends have text `v<id>`; references parse as "John c:v[-v]". */
const fakeBible = {
  calls: [] as string[],
  navigated: [] as number[],
  async handle(method: string, args: unknown[]): Promise<unknown> {
    this.calls.push(method);
    switch (method) {
      case 'listModules':
        return [{ id: 'KJV', abbreviation: 'KJV', name: 'King James Version' }];
      case 'listBooks':
        return Array.from({ length: 66 }, (_, i) => ({
          bookNumber: i + 1,
          shortName: `B${i + 1}`,
          name: i + 1 === JOHN ? 'John' : `Book ${i + 1}`,
          testament: i < 39 ? 'old' : 'new',
          chapterCount: ReadingPlans.chapterCount(i + 1),
        }));
      case 'listChapters': {
        const book = args[0] as number;
        return Array.from({ length: ReadingPlans.chapterCount(book) }, (_, i) => {
          const count = ReadingPlans.versesInChapter(book, i + 1);
          return { bookNumber: book, chapter: i + 1, verseCount: count, firstVerseId: ReadingPlans.vid(book, i + 1, 1), lastVerseId: ReadingPlans.vid(book, i + 1, count) };
        });
      }
      case 'getRange': {
        const [start, end] = args as [number, number];
        const out: Array<{ verseId: number; text: string }> = [];
        for (let id: number | null = start; id !== null && id <= end; id = ReadingPlans.nextVerse(id)) out.push({ verseId: id, text: `Verse text ${id}` });
        return out;
      }
      case 'parseReference': {
        const m = /^john\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/i.exec(String(args[0]).trim());
        if (!m) return null;
        const chapter = Number(m[1]);
        const dto: Record<string, unknown> = { bookNumber: JOHN, chapter, input: args[0] };
        if (m[2]) {
          dto.startVerse = Number(m[2]);
          dto.startVerseId = ReadingPlans.vid(JOHN, chapter, Number(m[2]));
          const end = m[3] ? Number(m[3]) : undefined;
          if (end) {
            dto.endVerse = end;
            dto.endVerseId = ReadingPlans.vid(JOHN, chapter, end);
          }
        }
        return dto;
      }
      case 'navigateToVerse':
        this.navigated.push(args[0] as number);
        return null;
      default:
        throw new Error(`unexpected host call ${method}`);
    }
  },
};

function setup() {
  const events: UserDbEvent[] = [];
  fakeBible.calls.length = 0;
  fakeBible.navigated.length = 0;
  // eslint-disable-next-line prefer-const
  let handler: ReturnType<typeof createUserDbHandler>;
  handler = createUserDbHandler({
    open: async () => finishOpen(new sqlite3.oo1.DB(':memory:'), ':memory:'),
    emit: (e) => {
      events.push(e);
      if (e.event !== 'hostCall') return;
      void fakeBible.handle(e.method, e.args).then(
        (value) => handler.handle({ op: 'hostReply', callId: e.callId, ok: true, value: value ?? null }),
        (err) => handler.handle({ op: 'hostReply', callId: e.callId, ok: false, error: { name: 'Error', message: String(err.message) } }),
      );
    },
  });
  const call = <T>(method: string, ...args: unknown[]) => handler.handle({ op: 'call', repo: 'memory', method, args }) as Promise<T>;
  return { handler, events, call };
}

describe('memory repo (worker)', () => {
  it('exposes every MemoryApi method', async () => {
    const sql = { execute: () => ({ changes: 0 }) } as unknown as Sync.ISql;
    const repo = createMemoryRepo(sql, { emit: () => undefined, hostCall: async () => null }) as unknown as Record<string, unknown>;
    for (const m of MEMORY_API_METHODS) expect(typeof repo[m], m).toBe('function');
  });

  it('adds a passage, reads the plan and runs a session step, asking the main thread for Bible data', async () => {
    const { call, events } = setup();
    const added = await call<{ passage: { id: number } }>('addPassage', { reference: 'John 3:16-17' });
    expect(added.passage.id).toBeGreaterThan(0);
    expect(fakeBible.calls).toContain('parseReference');

    const plan = await call<{ lists: unknown[]; passages?: unknown[] }>('getPlan');
    expect(JSON.stringify(plan)).toContain('John 3:16');

    const session = await call<{ sessionId: string }>('startSession', { passageId: added.passage.id });
    expect(typeof session.sessionId).toBe('string');
    expect(fakeBible.calls).toContain('getRange');
    await call('endSession', { sessionId: session.sessionId });

    // The service pushes (status etc.) reach the UI as memoryPush events.
    const pushes = events.filter((e): e is Extract<UserDbEvent, { event: 'memoryPush' }> => e.event === 'memoryPush');
    expect(pushes.length).toBeGreaterThan(0);
    expect(pushes.some((p) => (p.push as MemoryPush).type === 'status')).toBe(true);
    // Writes raise `changed` for the memory tables.
    expect(events.some((e) => e.event === 'changed' && e.tables.includes('memory_passage'))).toBe(true);
  }, 60_000);

  it('addVerses (the Memorize action) is idempotent and navigateTo reaches the host', async () => {
    const { call } = setup();
    const first = await call<{ outcome: string; passageId: number }>('addVerses', { verseIds: [43003016, 43003017], module: 'KJV' });
    expect(first.outcome).toBe('added');
    const again = await call<{ outcome: string; passageId: number }>('addVerses', { verseIds: [43003016, 43003017], module: 'KJV' });
    expect(again.outcome).toBe('exists');
    expect(again.passageId).toBe(first.passageId);
    await call('navigateTo', { verseId: 43003016 });
    expect(fakeBible.navigated).toEqual([43003016]);
  }, 60_000);

  it('wipe disposes the service; the next call starts a fresh one on an empty database', async () => {
    const { handler, call } = setup();
    await call('addVerses', { verseIds: [43003016] });
    expect(JSON.stringify(await call('getPlan'))).toContain('John 3:16');
    await handler.handle({ op: 'wipe' });
    expect(JSON.stringify(await call('getPlan'))).not.toContain('John 3:16');
  }, 60_000);

  it('a failed start is retried on the next call', async () => {
    const opened = finishOpen(new sqlite3.oo1.DB(':memory:'), ':memory:');
    let failures = 1;
    const flaky = new Proxy(opened.sql, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (prop === 'execute' && typeof v === 'function') {
          return (...a: unknown[]) => {
            if (failures > 0 && String(a[0]).includes('memory_collection')) {
              failures--;
              throw new Error('disk busy');
            }
            return (v as (...x: unknown[]) => unknown).apply(target, a);
          };
        }
        return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(target) : v;
      },
    }) as Sync.ISql;
    const repo = createMemoryRepo(flaky, {
      emit: () => undefined,
      hostCall: (_api, method, args) => fakeBible.handle(method, args),
    });
    await expect(repo.getPlan()).rejects.toThrow();
    expect(failures).toBe(0);
    await expect(repo.getPlan()).resolves.toBeTruthy();
  }, 60_000);
});
