/**
 * Durable storage for presentation sessions.
 *
 * State is on disk rather than in a `Map` for one reason: a deploy or a crash
 * during a service must not blank the wall. The viewer reconnects, the server
 * reads the row back, and nobody in the room learns that anything happened.
 *
 * Everything about a session lives on a single row. There is no separate state
 * table and no items table, because there is exactly one state per session and
 * the running order is a short array that is always read and written whole.
 * Splitting either out would buy a join and a class of position-renumbering
 * bugs in exchange for nothing.
 */

import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { SqliteProvider } from '../providers/SqliteProvider.js';
import type { PresentPlanEntry, StoredPresentState } from './protocol.js';
import { initialState } from './reducer.js';
import {
  generateControlToken,
  generateJoinCode,
  generateSessionId,
  hashControlToken,
} from './tokens.js';

/**
 * How long a session survives without activity.
 *
 * Generous on purpose. A weekly service argues for opening last Sunday's
 * session and finding its running order still there, rather than rebuilding it
 * every week. The window slides on every intent, so an active session never
 * expires under someone.
 */
export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Ceiling on live sessions per install, so a small self-hosted box has a bound. */
export const DEFAULT_MAX_SESSIONS = 200;

const SCHEMA_VERSION = 1;

/**
 * `CREATE TABLE IF NOT EXISTS` plus a version marker, rather than core's
 * `MigrationRunner`.
 *
 * Session data is disposable by nature: it expires on its own and holds no
 * irreplaceable user work, so the worst case for a destructive schema change is
 * that everyone recreates their session. That does not yet justify the
 * ceremony. If running orders become something people build up over months and
 * would be upset to lose, they will have earned migrations.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS present_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS present_session (
  session_id         TEXT PRIMARY KEY,
  join_code          TEXT NOT NULL UNIQUE,
  control_token_hash TEXT NOT NULL,
  name               TEXT,
  created_at         TEXT NOT NULL,
  last_active_at     TEXT NOT NULL,
  expires_at         TEXT NOT NULL,
  ended_at           TEXT,
  version            INTEGER NOT NULL DEFAULT 0,
  state_json         TEXT NOT NULL,
  plan_json          TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_present_session_expires
  ON present_session(expires_at);
`;

interface RawSessionRow {
  session_id: string;
  join_code: string;
  control_token_hash: string;
  name: string | null;
  created_at: string;
  last_active_at: string;
  expires_at: string;
  ended_at: string | null;
  version: number;
  state_json: string;
  plan_json: string;
}

export interface PresentSessionRow {
  sessionId: string;
  joinCode: string;
  controlTokenHash: string;
  name: string | null;
  createdAt: string;
  lastActiveAt: string;
  expiresAt: string;
  endedAt: string | null;
  version: number;
  state: StoredPresentState;
  plan: PresentPlanEntry[];
}

export interface CreatedSession {
  sessionId: string;
  joinCode: string;
  /** Plaintext, returned once and never recoverable afterwards. */
  controlToken: string;
  expiresAt: string;
}

export class PresentStore {
  private readonly sql: SqliteProvider;
  private readonly ttlMs: number;
  private readonly maxSessions: number;

  constructor(
    databasePath: string,
    options: { ttlMs?: number; maxSessions?: number } = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS;
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;

    mkdirSync(dirname(databasePath), { recursive: true });
    this.sql = new SqliteProvider(databasePath);
    this.sql.exec(SCHEMA_SQL);
    this.sql.execute(
      'INSERT OR REPLACE INTO present_meta (key, value) VALUES (?, ?)',
      ['schema_version', String(SCHEMA_VERSION)],
    );
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * A row is hydrated rather than returned raw so that a corrupt or
   * older-shaped `state_json` degrades to a usable default instead of throwing
   * on every request for that session forever.
   */
  private hydrate(raw: RawSessionRow | undefined): PresentSessionRow | null {
    if (!raw) return null;

    let state: StoredPresentState;
    try {
      state = JSON.parse(raw.state_json) as StoredPresentState;
    } catch {
      state = initialState(raw.session_id, raw.join_code);
    }
    // The column is authoritative for the version; the copy inside the JSON is
    // there for the client's benefit and must never be the one we trust.
    state.version = raw.version;

    let plan: PresentPlanEntry[];
    try {
      const parsed = JSON.parse(raw.plan_json) as unknown;
      plan = Array.isArray(parsed) ? parsed as PresentPlanEntry[] : [];
    } catch {
      plan = [];
    }

    return {
      sessionId: raw.session_id,
      joinCode: raw.join_code,
      controlTokenHash: raw.control_token_hash,
      name: raw.name,
      createdAt: raw.created_at,
      lastActiveAt: raw.last_active_at,
      expiresAt: raw.expires_at,
      endedAt: raw.ended_at,
      version: raw.version,
      state,
      plan,
    };
  }

  getBySessionId(sessionId: string): PresentSessionRow | null {
    return this.hydrate(this.sql.queryOne<RawSessionRow>(
      'SELECT * FROM present_session WHERE session_id = ?',
      [sessionId],
    ));
  }

  /** `joinCode` must already be in canonical form (see `normalizeJoinCode`). */
  getByJoinCode(joinCode: string): PresentSessionRow | null {
    return this.hydrate(this.sql.queryOne<RawSessionRow>(
      'SELECT * FROM present_session WHERE join_code = ?',
      [joinCode],
    ));
  }

  /** Live sessions: neither explicitly ended nor past their expiry. */
  countActive(now: Date = new Date()): number {
    const row = this.sql.queryOne<{ n: number }>(
      'SELECT COUNT(*) AS n FROM present_session WHERE ended_at IS NULL AND expires_at > ?',
      [now.toISOString()],
    );
    return row?.n ?? 0;
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /**
   * Create a session, returning the control token in the clear exactly once.
   *
   * The join code retry loop exists because the code is short enough for a
   * birthday collision to be a real (if rare) event rather than a theoretical
   * one, and a `UNIQUE` violation surfacing as a 500 to someone setting up
   * before a service is a poor way to find that out.
   */
  createSession(options: { name?: string; now?: Date } = {}): CreatedSession | null {
    const now = options.now ?? new Date();
    if (this.countActive(now) >= this.maxSessions) return null;

    const controlToken = generateControlToken();
    const controlTokenHash = hashControlToken(controlToken);
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.ttlMs).toISOString();

    for (let attempt = 0; attempt < 5; attempt++) {
      const sessionId = generateSessionId();
      const joinCode = generateJoinCode();
      const state = initialState(sessionId, joinCode);

      try {
        this.sql.execute(
          `INSERT INTO present_session
             (session_id, join_code, control_token_hash, name,
              created_at, last_active_at, expires_at, version, state_json, plan_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, '[]')`,
          [
            sessionId,
            joinCode,
            controlTokenHash,
            options.name ?? null,
            createdAt,
            createdAt,
            expiresAt,
            JSON.stringify(state),
          ],
        );
        return { sessionId, joinCode, controlToken, expiresAt };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('UNIQUE')) throw error;
      }
    }

    return null;
  }

  /**
   * Persist new state, bump the version, and slide the expiry window.
   *
   * The version comes from the row inside a transaction rather than from the
   * caller's copy, so the number a viewer receives is always the database's own
   * count of accepted changes. Returns the committed state, version included.
   */
  commitState(sessionId: string, next: StoredPresentState, now: Date = new Date()): StoredPresentState | null {
    return this.sql.transaction(() => {
      const row = this.sql.queryOne<{ version: number }>(
        'SELECT version FROM present_session WHERE session_id = ?',
        [sessionId],
      );
      if (!row) return null;

      const committed: StoredPresentState = { ...next, version: row.version + 1 };
      const stamp = now.toISOString();
      this.sql.execute(
        `UPDATE present_session
            SET version = ?, state_json = ?, last_active_at = ?, expires_at = ?
          WHERE session_id = ?`,
        [
          committed.version,
          JSON.stringify(committed),
          stamp,
          new Date(now.getTime() + this.ttlMs).toISOString(),
          sessionId,
        ],
      );
      return committed;
    });
  }

  /** Replace the running order wholesale. */
  setPlan(sessionId: string, plan: PresentPlanEntry[], now: Date = new Date()): boolean {
    const result = this.sql.execute(
      `UPDATE present_session
          SET plan_json = ?, last_active_at = ?, expires_at = ?
        WHERE session_id = ?`,
      [
        JSON.stringify(plan),
        now.toISOString(),
        new Date(now.getTime() + this.ttlMs).toISOString(),
        sessionId,
      ],
    );
    return result.changes > 0;
  }

  /**
   * Slide the expiry window without changing anything else.
   *
   * Called when a viewer connects: a session with a projector attached to it is
   * plainly in use, even if nobody has touched the controller for an hour.
   */
  touch(sessionId: string, now: Date = new Date()): void {
    this.sql.execute(
      'UPDATE present_session SET last_active_at = ?, expires_at = ? WHERE session_id = ?',
      [now.toISOString(), new Date(now.getTime() + this.ttlMs).toISOString(), sessionId],
    );
  }

  /**
   * End a session.
   *
   * The row is kept, not deleted, so that a viewer reconnecting into a session
   * that has just finished gets a clean "session ended" screen instead of the
   * same 404 an unknown code produces. The sweep removes it later.
   */
  endSession(sessionId: string, now: Date = new Date()): boolean {
    const result = this.sql.execute(
      'UPDATE present_session SET ended_at = ? WHERE session_id = ? AND ended_at IS NULL',
      [now.toISOString(), sessionId],
    );
    return result.changes > 0;
  }

  // -------------------------------------------------------------------------
  // Housekeeping
  // -------------------------------------------------------------------------

  /**
   * Delete expired sessions, and ended ones after a grace period.
   *
   * The grace period is what lets a projector that is still politely
   * reconnecting be told the session ended, rather than being told the code
   * does not exist -- which reads, on a wall, as a fault.
   */
  sweep(now: Date = new Date(), endedGraceMs = 60 * 60 * 1000): number {
    const stamp = now.toISOString();
    const graceCutoff = new Date(now.getTime() - endedGraceMs).toISOString();
    const result = this.sql.execute(
      `DELETE FROM present_session
        WHERE expires_at <= ?
           OR (ended_at IS NOT NULL AND ended_at <= ?)`,
      [stamp, graceCutoff],
    );
    return result.changes;
  }

  close(): void {
    this.sql.close();
  }

  /** Ids for plan entries. Here rather than in the reducer so that stays pure. */
  static newEntryId(): string {
    return randomUUID();
  }
}
