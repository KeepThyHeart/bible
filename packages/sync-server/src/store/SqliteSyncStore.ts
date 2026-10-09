/**
 * SyncStore over ISql (contracts §11, W1-F). Every query on account data is scoped by `account_id`; the only
 * unscoped lookups are the entry points that find an account in the first place (email, session token hash,
 * email token hash, account id) and the expiry sweep.
 */
import type { ISql, SqlParameter, Sync } from '@bible/core';
import type {
  AccountRow, DeviceRow, EmailTokenRow, NewAccount, SessionRow, SyncStore,
} from './SyncStore';
import { MIGRATIONS, SCHEMA_VERSION } from './schema';

interface AccountDb {
  id: string; email: string; email_verified: number; kdf_json: string; auth_hash: Uint8Array;
  recovery_auth_hash: Uint8Array; wrapped_ak_password: string; wrapped_ak_recovery: string; wrapped_idk: string;
  current_epoch: number; next_seq: number; bytes_used: number; quota_bytes: number | null; created_at: number;
  delete_after: number | null;
}
interface SessionDb {
  token_hash: Uint8Array; account_id: string; device_id: string; kind: string; created_at: number;
  last_seen_at: number; expires_at: number; user_agent: string | null;
}
interface RecordDb { id: string; seq: number; deleted: number; blob: Uint8Array | null; size: number }

/** camelCase field -> column, for `accounts.update`. Columns are fixed names, never user input. */
const ACCOUNT_COLUMNS: Record<keyof AccountRow, string> = {
  id: 'id', email: 'email', emailVerified: 'email_verified', kdf: 'kdf_json', authHash: 'auth_hash',
  recoveryAuthHash: 'recovery_auth_hash', wrappedAkPassword: 'wrapped_ak_password',
  wrappedAkRecovery: 'wrapped_ak_recovery', wrappedIdk: 'wrapped_idk', currentEpoch: 'current_epoch',
  nextSeq: 'next_seq', bytesUsed: 'bytes_used', quotaBytes: 'quota_bytes', createdAt: 'created_at',
  deleteAfter: 'delete_after',
};

function bytes(v: Uint8Array): Uint8Array {
  // better-sqlite3 returns Buffers; hand callers a plain view so equality checks behave the same everywhere.
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

function toAccountParam(key: keyof AccountRow, value: unknown): SqlParameter {
  if (key === 'emailVerified') return value ? 1 : 0;
  if (key === 'kdf') return JSON.stringify(value);
  return value as SqlParameter;
}

function accountFromDb(r: AccountDb): AccountRow {
  return {
    id: r.id, email: r.email, emailVerified: r.email_verified === 1,
    kdf: JSON.parse(r.kdf_json) as Sync.KdfParamsJson,
    authHash: bytes(r.auth_hash), recoveryAuthHash: bytes(r.recovery_auth_hash),
    wrappedAkPassword: r.wrapped_ak_password, wrappedAkRecovery: r.wrapped_ak_recovery, wrappedIdk: r.wrapped_idk,
    currentEpoch: r.current_epoch, nextSeq: r.next_seq, bytesUsed: r.bytes_used, quotaBytes: r.quota_bytes,
    createdAt: r.created_at, deleteAfter: r.delete_after,
  };
}

function sessionFromDb(r: SessionDb): SessionRow {
  return {
    tokenHash: bytes(r.token_hash), accountId: r.account_id, deviceId: r.device_id,
    kind: r.kind === 'recovery' ? 'recovery' : 'normal', createdAt: r.created_at, lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at, userAgent: r.user_agent,
  };
}

function recordToWire(r: RecordDb): Sync.EncryptedRecordWire {
  return {
    id: r.id, seq: r.seq, deleted: r.deleted === 1,
    blob: r.blob === null ? null : Buffer.from(r.blob.buffer, r.blob.byteOffset, r.blob.byteLength).toString('base64url'),
  };
}

export interface PurgeResult { accounts: number; tokens: number; sessions: number }

/** The store plus host-only maintenance (not part of the §11 interface). */
export interface SqliteSyncStore extends SyncStore {
  /** Deletes expired sessions and email tokens, and accounts whose `delete_after` has passed (with all their data). */
  purgeExpired(now: number): PurgeResult;
  /** Runs `fn` in one transaction (nested calls use the driver's savepoints). */
  transaction<T>(fn: () => T): T;
  /** Deletes one session of an account (logout, single-use recovery session). */
  deleteSession(accountId: string, tokenHash: Uint8Array): void;
}

export function createSqliteSyncStore(sql: ISql): SqliteSyncStore {
  const one = <T>(q: string, p: SqlParameter[] = []): T | undefined => sql.queryOne<T>(q, p);
  const all = <T>(q: string, p: SqlParameter[] = []): T[] => sql.queryAll<T>(q, p);
  const run = (q: string, p: SqlParameter[] = []): number => sql.execute(q, p).changes;

  /** Children first, so it works whether or not the host enabled foreign keys. */
  function deleteAccountData(accountId: string): void {
    for (const t of ['record', 'session', 'email_token', 'device', 'keyset']) {
      run(`DELETE FROM ${t} WHERE account_id = ?`, [accountId]);
    }
  }

  const store: SqliteSyncStore = {
    migrate(): void {
      const row = one<{ user_version: number }>('PRAGMA user_version');
      const current = row?.user_version ?? 0;
      if (current > SCHEMA_VERSION) {
        throw new Error(`Sync database schema v${current} is newer than this server (v${SCHEMA_VERSION})`);
      }
      for (let v = current; v < SCHEMA_VERSION; v++) {
        sql.transaction(() => {
          for (const stmt of MIGRATIONS[v]) run(stmt);
          run(`PRAGMA user_version = ${v + 1}`);
        });
      }
    },

    accounts: {
      create(a: NewAccount): void {
        run(`INSERT INTO account (id, email, email_verified, kdf_json, auth_hash, recovery_auth_hash,
            wrapped_ak_password, wrapped_ak_recovery, wrapped_idk, current_epoch, next_seq, bytes_used, quota_bytes,
            created_at, delete_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
        [a.id, a.email, a.emailVerified ? 1 : 0, JSON.stringify(a.kdf), a.authHash, a.recoveryAuthHash,
          a.wrappedAkPassword, a.wrappedAkRecovery, a.wrappedIdk, a.currentEpoch, a.quotaBytes, a.createdAt,
          a.deleteAfter]);
      },
      byEmail(email: string): AccountRow | undefined {
        const r = one<AccountDb>('SELECT * FROM account WHERE email = ?', [email]);
        return r && accountFromDb(r);
      },
      byId(id: string): AccountRow | undefined {
        const r = one<AccountDb>('SELECT * FROM account WHERE id = ?', [id]);
        return r && accountFromDb(r);
      },
      update(id: string, patch: Partial<AccountRow>): void {
        const sets: string[] = [];
        const params: SqlParameter[] = [];
        for (const key of Object.keys(patch) as (keyof AccountRow)[]) {
          if (key === 'id' || patch[key] === undefined) continue;
          const col = ACCOUNT_COLUMNS[key];
          if (!col) continue;
          sets.push(`${col} = ?`);
          params.push(toAccountParam(key, patch[key]));
        }
        if (sets.length === 0) return;
        run(`UPDATE account SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
      },
      delete(id: string): void {
        sql.transaction(() => {
          deleteAccountData(id);
          run('DELETE FROM account WHERE id = ?', [id]);
        });
      },
    },

    sessions: {
      create(s: SessionRow): void {
        run(`INSERT INTO session (token_hash, account_id, device_id, kind, created_at, last_seen_at, expires_at,
            user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.tokenHash, s.accountId, s.deviceId, s.kind, s.createdAt, s.lastSeenAt, s.expiresAt, s.userAgent]);
      },
      byTokenHash(h: Uint8Array): SessionRow | undefined {
        const r = one<SessionDb>('SELECT * FROM session WHERE token_hash = ?', [h]);
        return r && sessionFromDb(r);
      },
      touch(h: Uint8Array, at: number): void {
        run('UPDATE session SET last_seen_at = ? WHERE token_hash = ?', [at, h]);
      },
      deleteForDevice(accountId: string, deviceId: string): void {
        run('DELETE FROM session WHERE account_id = ? AND device_id = ?', [accountId, deviceId]);
      },
      deleteAllExcept(accountId: string, keepHash?: Uint8Array): void {
        if (keepHash) run('DELETE FROM session WHERE account_id = ? AND token_hash <> ?', [accountId, keepHash]);
        else run('DELETE FROM session WHERE account_id = ?', [accountId]);
      },
      deleteRecovery(accountId: string): void {
        run("DELETE FROM session WHERE account_id = ? AND kind = 'recovery'", [accountId]);
      },
    },

    devices: {
      upsert(d: DeviceRow): void {
        run(`INSERT INTO device (account_id, id, name_sealed, created_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (account_id, id) DO UPDATE SET name_sealed = excluded.name_sealed`,
        [d.accountId, d.id, d.nameSealed, d.createdAt]);
      },
      list(accountId: string): DeviceRow[] {
        return all<{ account_id: string; id: string; name_sealed: string; created_at: number }>(
          'SELECT account_id, id, name_sealed, created_at FROM device WHERE account_id = ? ORDER BY created_at, id',
          [accountId],
        ).map((r) => ({ id: r.id, accountId: r.account_id, nameSealed: r.name_sealed, createdAt: r.created_at }));
      },
      delete(accountId: string, id: string): void {
        sql.transaction(() => {
          run('DELETE FROM session WHERE account_id = ? AND device_id = ?', [accountId, id]);
          run('DELETE FROM device WHERE account_id = ? AND id = ?', [accountId, id]);
        });
      },
    },

    keysets: {
      replaceAll(accountId: string, ks: Sync.KeysetWire[]): void {
        sql.transaction(() => {
          run('DELETE FROM keyset WHERE account_id = ?', [accountId]);
          for (const k of ks) {
            run('INSERT INTO keyset (account_id, epoch, wrapped_data_key) VALUES (?, ?, ?)',
              [accountId, k.epoch, k.wrappedDataKey]);
          }
        });
      },
      list(accountId: string): Sync.KeysetWire[] {
        return all<{ epoch: number; wrapped_data_key: string }>(
          'SELECT epoch, wrapped_data_key FROM keyset WHERE account_id = ? ORDER BY epoch', [accountId],
        ).map((r) => ({ epoch: r.epoch, wrappedDataKey: r.wrapped_data_key }));
      },
    },

    records: {
      changes(accountId: string, since: number, limit: number): Sync.EncryptedRecordWire[] {
        return all<RecordDb>(
          'SELECT id, seq, deleted, blob, size FROM record WHERE account_id = ? AND seq > ? ORDER BY seq LIMIT ?',
          [accountId, since, limit],
        ).map(recordToWire);
      },
      push(accountId: string, recs: Sync.PushRecord[], quotaBytes: number) {
        // Writes go straight in, so a repeated id in one batch sees its own earlier write; an over-quota result
        // throws to roll the whole transaction back.
        const overQuota = new Error('quota_exceeded');
        try {
          return sql.transaction((): Sync.PushResponse => {
            const acct = one<{ next_seq: number; bytes_used: number }>(
              'SELECT next_seq, bytes_used FROM account WHERE id = ?', [accountId]);
            if (!acct) throw new Error('push: unknown account');
            let nextSeq = acct.next_seq;
            let bytesUsed = acct.bytes_used;
            const accepted: Sync.PushResponse['accepted'] = [];
            const conflicts: Sync.PushResponse['conflicts'] = [];
            for (const rec of recs) {
              const cur = one<RecordDb>(
                'SELECT id, seq, deleted, blob, size FROM record WHERE account_id = ? AND id = ?', [accountId, rec.id]);
              const ok = cur ? cur.seq === rec.baseSeq : rec.baseSeq === null;
              if (!ok) {
                // No row and a non-null baseSeq: report seq 0 / tombstone-like so the client re-sends as new.
                conflicts.push({ id: rec.id, current: cur ? recordToWire(cur) : { id: rec.id, seq: 0, deleted: true, blob: null } });
                continue;
              }
              const blob = rec.deleted || rec.blob === null ? null : Buffer.from(rec.blob, 'base64url');
              const size = blob ? blob.byteLength : 0;
              bytesUsed += size - (cur?.size ?? 0);
              const seq = nextSeq++;
              if (cur) {
                run('UPDATE record SET seq = ?, deleted = ?, blob = ?, size = ? WHERE account_id = ? AND id = ?',
                  [seq, rec.deleted ? 1 : 0, blob, size, accountId, rec.id]);
              } else {
                run('INSERT INTO record (account_id, id, seq, deleted, blob, size) VALUES (?, ?, ?, ?, ?, ?)',
                  [accountId, rec.id, seq, rec.deleted ? 1 : 0, blob, size]);
              }
              accepted.push({ id: rec.id, seq });
            }
            // Over quota only blocks pushes that grow usage (deletes still go through).
            if (bytesUsed > quotaBytes && bytesUsed > acct.bytes_used) throw overQuota;
            run('UPDATE account SET next_seq = ?, bytes_used = ? WHERE id = ?', [nextSeq, bytesUsed, accountId]);
            return { accepted, conflicts };
          });
        } catch (e) {
          if (e === overQuota) return { error: 'quota_exceeded' as const };
          throw e;
        }
      },
      count(accountId: string): number {
        return one<{ n: number }>('SELECT COUNT(*) AS n FROM record WHERE account_id = ?', [accountId])?.n ?? 0;
      },
      wipe(accountId: string): void {
        sql.transaction(() => {
          run('DELETE FROM record WHERE account_id = ?', [accountId]);
          // next_seq is NOT reset: seqs stay strictly increasing for the account's lifetime.
          run('UPDATE account SET bytes_used = 0 WHERE id = ?', [accountId]);
        });
      },
    },

    emailTokens: {
      create(t: EmailTokenRow): void {
        run('INSERT INTO email_token (token_hash, account_id, purpose, expires_at) VALUES (?, ?, ?, ?)',
          [t.tokenHash, t.accountId, t.purpose, t.expiresAt]);
      },
      consume(hash: Uint8Array, purpose: 'verify' | 'reset', now: number): EmailTokenRow | undefined {
        return sql.transaction(() => {
          const r = one<{ token_hash: Uint8Array; account_id: string; purpose: string; expires_at: number }>(
            'SELECT * FROM email_token WHERE token_hash = ? AND purpose = ?', [hash, purpose]);
          if (!r) return undefined;
          run('DELETE FROM email_token WHERE token_hash = ? AND account_id = ?', [hash, r.account_id]);
          if (r.expires_at <= now) return undefined;
          return { tokenHash: bytes(r.token_hash), accountId: r.account_id, purpose, expiresAt: r.expires_at };
        });
      },
    },

    transaction<T>(fn: () => T): T {
      return sql.transaction(fn);
    },

    deleteSession(accountId: string, tokenHash: Uint8Array): void {
      run('DELETE FROM session WHERE account_id = ? AND token_hash = ?', [accountId, tokenHash]);
    },

    purgeExpired(now: number): PurgeResult {
      return sql.transaction(() => {
        const doomed = all<{ id: string }>(
          'SELECT id FROM account WHERE delete_after IS NOT NULL AND delete_after <= ?', [now]);
        for (const a of doomed) {
          deleteAccountData(a.id);
          run('DELETE FROM account WHERE id = ?', [a.id]);
        }
        const tokens = run('DELETE FROM email_token WHERE expires_at <= ?', [now]);
        const sessions = run('DELETE FROM session WHERE expires_at <= ?', [now]);
        return { accounts: doomed.length, tokens, sessions };
      });
    },
  };
  return store;
}
