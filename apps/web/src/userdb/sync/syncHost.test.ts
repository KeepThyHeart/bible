// @vitest-environment node
/**
 * Integration tests for the web sync host (design §6): the real sync server in-process, two "browsers" (own cookie
 * jar, IndexedDB and Origin), each with real user-DB workers (createUserDbHandler + createSyncHost over sqlite-wasm).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The server package's dist may be older than its source: run the source. Its only runtime core imports are the
// `Crypto` and `Sync` namespaces, which the browser barrel (aliased to core source) provides.
vi.mock('@bible/sync-server', async () => await import('../../../../../packages/sync-server/src/index'));
vi.mock('@bible/core', async () => {
  const b = await import('@bible/core/browser');
  return { Crypto: b.Crypto, Sync: b.Sync };
});

import { Crypto, Sync } from '@bible/core/browser';
import { IndexedDbSecretStore } from '../IndexedDbSecretStore';
import { deviceNameFromUserAgent } from './syncHost';
import {
  CONSENT, PASSWORD, WRONG_PASSWORD, WireFailure, createBrowser, findSecrets, freshEmail, idbNames, loadSqlite,
  mailToken, rawSecretRecords, seedLegacyUserData, serverRecordCount, signUpVerified, startWorker, startWorld, until,
  type Sqlite3, type World,
} from './__testing__/syncWorld';

let sqlite3: Sqlite3;
beforeAll(async () => { sqlite3 = await loadSqlite(); }, 60_000);

let world: World | null = null;
afterEach(async () => {
  await world?.close();
  world = null;
});
async function setup(): Promise<World> {
  world = await startWorld(sqlite3);
  return world;
}

const T = 60_000;

async function failure(p: Promise<unknown>): Promise<WireFailure> {
  const r = await p.then(() => null, (e: unknown) => e);
  if (!(r instanceof WireFailure)) throw new Error(`expected a wire failure, got ${String(r)}`);
  return r;
}

function addNote(sql: Sync.ISql, content: string): number {
  return sql.execute('INSERT INTO user_note (title, content) VALUES (?, ?)', ['t', content]).lastInsertRowId!;
}
function noteContents(sql: Sync.ISql): string[] {
  return sql.queryAll<{ content: string }>('SELECT content FROM user_note ORDER BY content').map((r) => r.content);
}

describe('web sync host (integration)', () => {
  it('signUp answers only { recoveryCode }; a second browser signs in and both see each other\'s notes', async () => {
    const w = await setup();
    const a = startWorker(sqlite3, createBrowser(w, 'A'));
    const b = startWorker(sqlite3, createBrowser(w, 'B'));
    const email = freshEmail();

    const res = await signUpVerified(w, a, email);
    expect(Object.keys(res as object)).toEqual(['recoveryCode']);
    expect((res as { recoveryCode: string }).recoveryCode).toMatch(/^[0-9A-Z-]{32,}$/);

    addNote(await a.sql(), 'from A');
    await a.sync('syncNow');

    await b.configure();
    expect(await b.account('signIn', email, PASSWORD)).toBeNull();
    await b.sync('syncNow');
    expect(noteContents(await b.sql())).toEqual(['from A']);
    expect(b.events.some((e) => e.event === 'changed' && e.tables.includes('user_note'))).toBe(true);

    addNote(await b.sql(), 'from B');
    await b.sync('syncNow');
    await a.sync('syncNow');
    expect(noteContents(await a.sql())).toEqual(['from A', 'from B']);
  }, T);
});
