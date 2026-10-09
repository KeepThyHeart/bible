/** ChangeTracker.touch (task 0150 W3-A): manual change marks for sources without triggers (adapters). */
import { describe, it, expect, beforeEach } from 'vitest';
import { TestSqliteProvider } from '../../helpers/TestSqliteProvider';
import { createUserSchema } from '../../../Data/UserSchema';
import { createChangeTracker, coreTrackedTables, type ChangeTracker } from '../../../Sync/tracking/ChangeTracker';

const RID = (n: number): string => n.toString(16).padStart(32, '0');

interface Rec { dirty: number; deleted: number; rev: number; server_seq: number | null; record_id: string | null; changed_ms: number }

let db: TestSqliteProvider;
let tracker: ChangeTracker;
const record = (kind: string, key: string): Rec | undefined =>
  db.queryOne<Rec>('SELECT * FROM sync_record WHERE table_name = ? AND local_key = ?', [kind, key]);

beforeEach(() => {
  db = new TestSqliteProvider(':memory:');
  createUserSchema(db);
  tracker = createChangeTracker(db);
  tracker.install(coreTrackedTables());
});

describe('ChangeTracker.touch', () => {
  it('creates a live dirty record for a new key', () => {
    tracker.touch('bn.file', 'a.bn');
    expect(record('bn.file', 'a.bn')).toMatchObject({ dirty: 1, deleted: 0, rev: 1, server_seq: null, record_id: null });
    expect(tracker.dirty(10).map((d) => d.localKey)).toContain('a.bn');
  });

  it('re-marks a synced key dirty and bumps rev (so an in-flight ack keeps it dirty)', () => {
    tracker.touch('bn.file', 'a.bn');
    const row = tracker.dirty(10).find((d) => d.localKey === 'a.bn')!;
    tracker.touch('bn.file', 'a.bn'); // edited while the push was in flight
    tracker.markSynced('bn.file', 'a.bn', { recordId: RID(1), serverSeq: 4, hlc: 'h', baseJson: '{}', deleted: false, expectRev: row.rev });
    expect(record('bn.file', 'a.bn')).toMatchObject({ dirty: 1, rev: 2, server_seq: 4, record_id: RID(1) });

    tracker.markSynced('bn.file', 'a.bn', { recordId: RID(1), serverSeq: 5, hlc: 'h', baseJson: '{}', deleted: false });
    expect(record('bn.file', 'a.bn')).toMatchObject({ dirty: 0 });
    tracker.touch('bn.file', 'a.bn');
    expect(record('bn.file', 'a.bn')).toMatchObject({ dirty: 1, deleted: 0, rev: 3, server_seq: 5, record_id: RID(1) });
  });

  it('deleted: forgets a key the server never had', () => {
    tracker.touch('bn.file', 'a.bn');
    tracker.touch('bn.file', 'a.bn', { deleted: true });
    expect(record('bn.file', 'a.bn')).toBeUndefined();
    expect(tracker.pendingCount()).toBe(db.queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM sync_record WHERE dirty = 1')!.n);
  });

  it('deleted: leaves a dirty tombstone for a key on the server, and a later touch revives it', () => {
    tracker.touch('bn.file', 'a.bn');
    tracker.markSynced('bn.file', 'a.bn', { recordId: RID(1), serverSeq: 2, hlc: 'h', baseJson: '{}', deleted: false });
    tracker.touch('bn.file', 'a.bn', { deleted: true });
    expect(record('bn.file', 'a.bn')).toMatchObject({ dirty: 1, deleted: 1, rev: 2, server_seq: 2, record_id: RID(1) });
    tracker.touch('bn.file', 'a.bn');
    expect(record('bn.file', 'a.bn')).toMatchObject({ dirty: 1, deleted: 0, rev: 3 });
  });

  it('deleted on an unknown key is a no-op', () => {
    tracker.touch('bn.file', 'nope.bn', { deleted: true });
    expect(record('bn.file', 'nope.bn')).toBeUndefined();
  });
});
