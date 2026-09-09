import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PresentStore } from '../present/PresentStore';
import { hashControlToken, verifyControlToken } from '../present/tokens';
import type { PresentPassageItem } from '../../src/present/protocol';

const JOHN_3: PresentPassageItem = { kind: 'passage', module: 'KJV', book: 43, chapter: 3 };

let dir: string;
let store: PresentStore;

function open(options: { ttlMs?: number; maxSessions?: number } = {}): PresentStore {
  return new PresentStore(join(dir, 'present.db'), options);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'present-store-'));
  store = open();
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('creating sessions', () => {
  it('returns a usable set of identifiers', () => {
    const created = store.createSession();
    expect(created).not.toBeNull();
    expect(created!.joinCode).toHaveLength(8);
    expect(created!.sessionId).toHaveLength(16);
    expect(Date.parse(created!.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('stores only a hash of the control token', () => {
    const created = store.createSession()!;
    const row = store.getBySessionId(created.sessionId)!;
    expect(row.controlTokenHash).not.toBe(created.controlToken);
    expect(row.controlTokenHash).toBe(hashControlToken(created.controlToken));
    expect(verifyControlToken(created.controlToken, row.controlTokenHash)).toBe(true);
  });

  it('is reachable by either identifier', () => {
    const created = store.createSession({ name: 'Sunday evening' })!;
    expect(store.getBySessionId(created.sessionId)?.joinCode).toBe(created.joinCode);
    expect(store.getByJoinCode(created.joinCode)?.sessionId).toBe(created.sessionId);
    expect(store.getBySessionId(created.sessionId)?.name).toBe('Sunday evening');
  });

  it('starts with nothing on the wall and an empty running order', () => {
    const created = store.createSession()!;
    const row = store.getBySessionId(created.sessionId)!;
    expect(row.version).toBe(0);
    expect(row.state.live).toBeNull();
    expect(row.plan).toEqual([]);
    expect(row.endedAt).toBeNull();
  });

  it('refuses once the install is at its ceiling', () => {
    const capped = open({ maxSessions: 2 });
    expect(capped.createSession()).not.toBeNull();
    expect(capped.createSession()).not.toBeNull();
    expect(capped.createSession()).toBeNull();
    capped.close();
  });

  it('returns nothing for identifiers that were never issued', () => {
    expect(store.getBySessionId('NOSUCHSESSION000')).toBeNull();
    expect(store.getByJoinCode('NOSUCH00')).toBeNull();
  });
});

describe('committing state', () => {
  it('bumps the version from the row, not from the caller', () => {
    const created = store.createSession()!;
    const row = store.getBySessionId(created.sessionId)!;

    // A controller working from a stale copy claims version 99; the database's
    // own count is what the viewers must see.
    const committed = store.commitState(created.sessionId, { ...row.state, version: 99, live: JOHN_3 });
    expect(committed?.version).toBe(1);
    expect(store.getBySessionId(created.sessionId)?.version).toBe(1);
  });

  it('round-trips the item on the wall', () => {
    const created = store.createSession()!;
    const row = store.getBySessionId(created.sessionId)!;
    store.commitState(created.sessionId, {
      ...row.state,
      live: JOHN_3,
      position: { index: 16, highlight: { verseIdStart: 43003016, textStart: 2, textEnd: 7 } },
    });

    const after = store.getBySessionId(created.sessionId)!;
    expect(after.state.live).toEqual(JOHN_3);
    expect(after.state.position.index).toBe(16);
    expect(after.state.position.highlight).toEqual({ verseIdStart: 43003016, textStart: 2, textEnd: 7 });
  });

  it('survives a restart with the wall intact', () => {
    // The reason state is on disk at all: a deploy or a crash mid-service must
    // not blank the screen.
    const created = store.createSession()!;
    const row = store.getBySessionId(created.sessionId)!;
    store.commitState(created.sessionId, { ...row.state, live: JOHN_3, position: { index: 16, highlight: null } });
    store.close();

    store = open();
    const after = store.getBySessionId(created.sessionId)!;
    expect(after.state.live).toEqual(JOHN_3);
    expect(after.state.position.index).toBe(16);
    expect(after.version).toBe(1);
  });

  it('slides the expiry window forward', () => {
    const shortLived = open({ ttlMs: 60_000 });
    const created = shortLived.createSession({ now: new Date(1_000_000) })!;
    expect(created.expiresAt).toBe(new Date(1_060_000).toISOString());

    const row = shortLived.getBySessionId(created.sessionId)!;
    shortLived.commitState(created.sessionId, { ...row.state, live: JOHN_3 }, new Date(1_030_000));
    expect(shortLived.getBySessionId(created.sessionId)?.expiresAt)
      .toBe(new Date(1_090_000).toISOString());
    shortLived.close();
  });

  it('reports failure for a session that is gone', () => {
    const created = store.createSession()!;
    const row = store.getBySessionId(created.sessionId)!;
    store.sweep(new Date(Date.now() + 400 * 24 * 3600 * 1000));
    expect(store.commitState(created.sessionId, row.state)).toBeNull();
  });

  it('does not trust a version smuggled inside the stored JSON', () => {
    const created = store.createSession()!;
    const row = store.getBySessionId(created.sessionId)!;
    store.commitState(created.sessionId, { ...row.state, version: 500 });
    expect(store.getBySessionId(created.sessionId)?.state.version).toBe(1);
  });
});

describe('the running order', () => {
  it('replaces the plan wholesale', () => {
    const created = store.createSession()!;
    expect(store.setPlan(created.sessionId, [{ id: 'a', item: JOHN_3, note: 'read slowly' }])).toBe(true);
    expect(store.getBySessionId(created.sessionId)?.plan)
      .toEqual([{ id: 'a', item: JOHN_3, note: 'read slowly' }]);

    // Reordering is just sending the new order.
    store.setPlan(created.sessionId, [
      { id: 'b', item: { ...JOHN_3, chapter: 1 } },
      { id: 'a', item: JOHN_3 },
    ]);
    expect(store.getBySessionId(created.sessionId)?.plan.map(e => e.id)).toEqual(['b', 'a']);
  });

  it('reports failure for an unknown session', () => {
    expect(store.setPlan('NOSUCHSESSION000', [])).toBe(false);
  });

  it('is independent of the wall state', () => {
    const created = store.createSession()!;
    const row = store.getBySessionId(created.sessionId)!;
    store.setPlan(created.sessionId, [{ id: 'a', item: JOHN_3 }]);
    store.commitState(created.sessionId, { ...row.state, live: JOHN_3 });
    expect(store.getBySessionId(created.sessionId)?.plan).toHaveLength(1);
  });
});

describe('ending and expiry', () => {
  it('marks a session ended without deleting it', () => {
    // A projector still reconnecting should be told the session ended, not
    // handed the same 404 an unknown code produces.
    const created = store.createSession()!;
    expect(store.endSession(created.sessionId)).toBe(true);
    expect(store.getBySessionId(created.sessionId)?.endedAt).not.toBeNull();
    expect(store.endSession(created.sessionId)).toBe(false);
  });

  it('stops counting an ended session against the ceiling', () => {
    const capped = open({ maxSessions: 1 });
    const first = capped.createSession()!;
    expect(capped.createSession()).toBeNull();
    capped.endSession(first.sessionId);
    expect(capped.createSession()).not.toBeNull();
    capped.close();
  });

  it('sweeps sessions past their expiry', () => {
    const shortLived = open({ ttlMs: 1_000 });
    const created = shortLived.createSession({ now: new Date(1_000_000) })!;
    expect(shortLived.sweep(new Date(1_000_500))).toBe(0);
    expect(shortLived.sweep(new Date(1_002_000))).toBe(1);
    expect(shortLived.getBySessionId(created.sessionId)).toBeNull();
    shortLived.close();
  });

  it('keeps an ended session through its grace period', () => {
    const created = store.createSession()!;
    store.endSession(created.sessionId, new Date(1_000_000));
    expect(store.sweep(new Date(1_000_000 + 30 * 60_000), 60 * 60_000)).toBe(0);
    expect(store.getBySessionId(created.sessionId)).not.toBeNull();
    expect(store.sweep(new Date(1_000_000 + 90 * 60_000), 60 * 60_000)).toBe(1);
    expect(store.getBySessionId(created.sessionId)).toBeNull();
  });

  it('counts only live sessions as active', () => {
    const a = store.createSession()!;
    store.createSession();
    expect(store.countActive()).toBe(2);
    store.endSession(a.sessionId);
    expect(store.countActive()).toBe(1);
  });
});

describe('corrupt rows', () => {
  it('degrades to a usable default rather than throwing forever', () => {
    const created = store.createSession()!;

    // Reach past the public API to plant a row of the kind an older release, an
    // interrupted write or a botched hand-edit would leave behind.
    const internals = store as unknown as {
      sql: { execute(sql: string, params: unknown[]): unknown };
    };
    internals.sql.execute(
      'UPDATE present_session SET state_json = ?, plan_json = ? WHERE session_id = ?',
      ['{not json', 'also not json', created.sessionId],
    );

    const row = store.getBySessionId(created.sessionId)!;
    expect(row.state.live).toBeNull();
    expect(row.state.session.joinCode).toBe(created.joinCode);
    expect(row.plan).toEqual([]);
  });
});
