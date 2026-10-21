import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import type { ISql } from '@bible/core';

/** Directory holding the profile generated from 0.1.0-beta.1 (see its README). */
export const BETA1_FIXTURE_DIR = fileURLToPath(new URL('../../../../test-fixtures/beta1/', import.meta.url));

export function beta1Path(name: string): string {
  return BETA1_FIXTURE_DIR + name;
}

export function readBeta1Session(): Record<string, unknown> {
  return JSON.parse(readFileSync(beta1Path('beta1-session.json'), 'utf8')) as Record<string, unknown>;
}

/** Statements of beta1-user.sql (the DDL and rows exactly as beta.1 wrote them). */
export function beta1Statements(): string[] {
  return readFileSync(beta1Path('beta1-user.sql'), 'utf8')
    .split('\n-- @@stmt@@\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'));
}

/** Recreate the beta.1 user database in `sql`, including its `user_version`. */
export function loadBeta1UserDb(sql: ISql): void {
  for (const stmt of beta1Statements()) sql.execute(stmt);
  sql.execute('PRAGMA user_version = 1');
}

/** Every row of every non-virtual user table, for before/after comparison. */
export function snapshotTables(sql: ISql, tables: readonly string[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = sql.queryAll(`SELECT * FROM "${t}" ORDER BY rowid`);
  return out;
}

/** The tables beta.1 populated (all hold seeded rows in the fixture). */
export const BETA1_SEEDED_TABLES = [
  'user_commentary', 'user_note', 'note_verse_link', 'user_text_markup', 'collection', 'pinned_item',
  'session', 'content_verse_link', 'user_keybindings', 'command_history', 'extensions', 'extension_storage',
] as const;
