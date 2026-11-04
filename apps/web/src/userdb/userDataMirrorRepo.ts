/**
 * Worker repo `userDataMirror` (S1, design §3): what the main-thread `MemoryUserDb` mirror (`OpfsUserData`) needs.
 * Reads the two user-data tables whole, reserves id blocks, and applies the mirror's changes in one transaction.
 * No side effects at module load.
 */
import type { Sync, UserData } from '@bible/core/browser';

export interface UserDataMirrorRepo {
  readSnapshot(): { items: UserData.UserDataItemRow[]; links: UserData.VerseLinkRow[] };
  /**
   * Reserve `count` ids (`end` exclusive) by bumping `sqlite_sequence`; never overlaps a later insert.
   * `count` 0 reserves nothing and returns `start === end === seq + 1` (probe of the current sequence).
   */
  reserveIds(kind: 'item' | 'link', count: number): { start: number; end: number };
  /** One transaction; upserts (`ON CONFLICT … DO UPDATE`), never `INSERT OR REPLACE`. */
  applyChanges(changes: UserData.UserDataChange[]): { applied: number };
}

const KIND_TABLE = { item: ['user_data_item', 'item_id'], link: ['verse_link', 'link_id'] } as const;

/** Raise the AUTOINCREMENT sequence of `table` to at least `atLeast` (creating its row if missing). */
export function bumpSequence(sql: Sync.ISql, table: string, atLeast: number): void {
  const cur = sql.queryOne<{ seq: number }>('SELECT seq FROM sqlite_sequence WHERE name = ?', [table]);
  if (!cur) sql.execute('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)', [table, atLeast]);
  else if (cur.seq < atLeast) sql.execute('UPDATE sqlite_sequence SET seq = ? WHERE name = ?', [atLeast, table]);
}

export function createUserDataMirrorRepo(sql: Sync.ISql): UserDataMirrorRepo {
  const apply = (c: UserData.UserDataChange): void => {
    switch (c.type) {
      case 'item:put': {
        const r = c.row;
        sql.execute(
          `INSERT INTO user_data_item (item_id, owner_uuid, collection, item_key, value, value_type, sort_order, created_date, modified_date, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(owner_uuid, collection, item_key) DO UPDATE SET
             value = excluded.value, value_type = excluded.value_type, sort_order = excluded.sort_order,
             created_date = excluded.created_date, modified_date = excluded.modified_date, metadata = excluded.metadata`,
          [r.item_id, r.owner_uuid, r.collection, r.item_key, r.value, r.value_type, r.sort_order, r.created_date, r.modified_date, r.metadata],
        );
        break;
      }
      case 'item:delete':
        sql.execute('DELETE FROM user_data_item WHERE owner_uuid = ? AND collection = ? AND item_key = ?', [c.ownerUuid, c.collection, c.itemKey]);
        break;
      case 'link:put': {
        const r = c.row;
        sql.execute(
          `INSERT INTO verse_link (link_id, source_type, source_id, verse_id_start, verse_id_end, link_type, sort_order, context, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(link_id) DO UPDATE SET
             source_type = excluded.source_type, source_id = excluded.source_id, verse_id_start = excluded.verse_id_start,
             verse_id_end = excluded.verse_id_end, link_type = excluded.link_type, sort_order = excluded.sort_order,
             context = excluded.context, metadata = excluded.metadata`,
          [r.link_id, r.source_type, r.source_id, r.verse_id_start, r.verse_id_end, r.link_type, r.sort_order, r.context, r.metadata],
        );
        break;
      }
      case 'link:delete':
        sql.execute('DELETE FROM verse_link WHERE link_id = ?', [c.linkId]);
        break;
    }
  };

  return {
    readSnapshot() {
      return {
        items: sql.queryAll<UserData.UserDataItemRow>('SELECT * FROM user_data_item ORDER BY item_id'),
        links: sql.queryAll<UserData.VerseLinkRow>('SELECT * FROM verse_link ORDER BY link_id'),
      };
    },

    reserveIds(kind, count) {
      const entry = KIND_TABLE[kind];
      if (!entry) throw new Error(`Unknown id kind: ${String(kind)}`);
      if (!Number.isInteger(count) || count < 0) throw new Error('reserveIds: count must be a non-negative integer');
      const [table, column] = entry;
      return sql.transaction(() => {
        const seq = sql.queryOne<{ seq: number }>('SELECT seq FROM sqlite_sequence WHERE name = ?', [table])?.seq ?? 0;
        const top = sql.queryOne<{ m: number | null }>(`SELECT MAX(${column}) AS m FROM ${table}`)?.m ?? 0;
        const start = Math.max(seq, top) + 1;
        if (count > 0) bumpSequence(sql, table, start + count - 1);
        return { start, end: start + count };
      });
    },

    applyChanges(changes) {
      sql.transaction(() => {
        for (const c of changes) apply(c);
      });
      return { applied: changes.length };
    },
  };
}
