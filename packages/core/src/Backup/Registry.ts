/**
 * The user-table registry: one authoritative description of every table in the
 * user database that a backup has to know about.
 *
 * It answers, per table: which columns it has, what its keys are, which columns
 * point at other tables (including the logical pointers SQLite has no
 * constraint for), how two rows are recognised as "the same" when a backup is
 * merged into a database in use, which class of data it is, and how rows from an
 * older schema version are upgraded. Backup, restore and merge are all driven by
 * it, and drift tests compare it with the DDL that the desktop app and core
 * actually create, so a table cannot be added without being classified.
 *
 * Pure data and functions over `ISql`: no platform imports.
 */
import type { ISql } from '../Data/Core/ISql';

/** Version of the user-table shapes described here. Bump when a column or table changes; add an upgrader. */
export const USER_SCHEMA_VERSION = 1;

/**
 * - `content`: what the user wrote or collected; losing it is data loss. Always backed up.
 * - `extension`: extensions' key-value data (databases are handled separately, opt-in).
 * - `workspace`: layouts, keybindings, preferences; useful on a new machine, unwanted when merging.
 * - `history`: bulky and private; off unless asked for.
 * - `excluded`: install state, derived indexes, sync bookkeeping, secrets; never backed up.
 */
export type TableClass = 'content' | 'extension' | 'workspace' | 'history' | 'excluded';

/** A row as read from or written to a section: column name to JSON-safe value. */
export type Row = Record<string, unknown>;

export type OnMissing = 'null' | 'drop';

export type FkSpec =
  | {
      column: string;
      table: string;
      /** True when the DDL declares the constraint (as opposed to a logical pointer). */
      sql: boolean;
      /** What to do with a row whose parent is not in the restored data. */
      onMissing: OnMissing;
    }
  | {
      /** A pointer whose target table depends on another column (`verse_link.source_id` by `source_type`). */
      column: string;
      typeColumn: string;
      targets: Record<string, string>;
      /** Rows whose type is not in `targets`: keep them unchanged, or drop them. */
      otherTypes: 'passThrough' | 'drop';
      onMissing: OnMissing;
    };

export type IdentitySpec =
  /** Two rows are the same when all non-key columns (except `exclude`) are equal, after foreign keys are remapped. Multiset semantics. */
  | { kind: 'content'; exclude: string[] }
  /** Two rows are the same when `columns` are equal; `conflict` decides what happens to the values. */
  | { kind: 'unique'; columns: string[]; conflict: 'keepLocal' | 'newerWins' | 'max'; stamp?: string; maxColumns?: string[] };

export interface TableSpec {
  name: string;
  /** Primary key column(s). */
  pk: string[];
  /** True when the (single) primary key is an autoincrement id that merge reassigns. */
  autoId: boolean;
  cls: TableClass;
  /** Every column any implementation of this table has. */
  columns: string[];
  /** Columns that some implementations lack (their default applies on restore). */
  optionalColumns?: string[];
  /** Which implementations create the table. */
  origin: 'both' | 'core' | 'desktop';
  fks: FkSpec[];
  identity: IdentitySpec;
  /** When merging, leave rows for which this returns true out (rolling autosaves, stock presets, internal settings). */
  skipInMerge?: (row: Row) => boolean;
  /** When merging, never touch this table (a singleton the local install owns). */
  mergeKeepsLocal?: boolean;
  /** A 0/1 "is the default" column: merge never lets a restored row become a second default. */
  defaultFlag?: string;
  /** External-content FTS table to rebuild after rows change. */
  fts?: string;
  /** Row upgraders keyed by the schema version the row came from: `upgraders[v]` turns a v row into a v+1 row. */
  upgraders?: Record<number, (row: Row) => Row>;
}

const contentAll = (exclude: string[] = []): IdentitySpec => ({ kind: 'content', exclude });

export const USER_TABLES: readonly TableSpec[] = [
  {
    name: 'user_commentary', pk: ['user_commentary_id'], autoId: true, cls: 'content', origin: 'both',
    columns: ['user_commentary_id', 'name', 'description', 'created_date', 'modified_date', 'is_default', 'color', 'metadata'],
    fks: [], identity: contentAll(['is_default']), defaultFlag: 'is_default',
  },
  {
    name: 'user_note', pk: ['note_id'], autoId: true, cls: 'content', origin: 'both',
    columns: ['note_id', 'user_commentary_id', 'parent_note_id', 'verse_id_start', 'verse_id_end', 'title', 'content',
      'content_format', 'note_type', 'document_type', 'visibility', 'created_date', 'modified_date', 'tags',
      'series_name', 'entry_date', 'sort_order', 'metadata'],
    optionalColumns: ['sort_order'],
    fks: [
      { column: 'user_commentary_id', table: 'user_commentary', sql: true, onMissing: 'null' },
      { column: 'parent_note_id', table: 'user_note', sql: true, onMissing: 'null' },
    ],
    identity: contentAll(), fts: 'user_note_fts',
  },
  {
    name: 'collection', pk: ['collection_id'], autoId: true, cls: 'content', origin: 'both',
    columns: ['collection_id', 'parent_collection_id', 'name', 'description', 'color', 'icon', 'created_date', 'modified_date', 'sort_order', 'metadata'],
    fks: [{ column: 'parent_collection_id', table: 'collection', sql: true, onMissing: 'null' }],
    identity: contentAll(),
  },
  {
    name: 'pinned_item', pk: ['pin_id'], autoId: true, cls: 'content', origin: 'both',
    columns: ['pin_id', 'collection_id', 'item_type', 'verse_id_start', 'verse_id_end', 'reference_id', 'reference_text',
      'module_id', 'title', 'notes', 'created_date', 'sort_order', 'metadata'],
    fks: [
      { column: 'collection_id', table: 'collection', sql: true, onMissing: 'drop' },
      { column: 'reference_id', typeColumn: 'item_type', targets: { note: 'user_note' }, otherTypes: 'passThrough', onMissing: 'drop' },
    ],
    identity: contentAll(),
  },
  {
    name: 'note_verse_link', pk: ['link_id'], autoId: true, cls: 'content', origin: 'desktop',
    columns: ['link_id', 'note_id', 'verse_id_start', 'verse_id_end', 'link_type', 'word_start', 'word_end', 'metadata'],
    fks: [{ column: 'note_id', table: 'user_note', sql: true, onMissing: 'drop' }],
    identity: contentAll(),
  },
  {
    name: 'content_verse_link', pk: ['link_id'], autoId: true, cls: 'content', origin: 'desktop',
    columns: ['link_id', 'content_type', 'content_id', 'verse_id_start', 'verse_id_end', 'link_type', 'position', 'metadata'],
    // The desktop writes the note id for every content type (note, journal, prayer, document).
    fks: [{ column: 'content_id', table: 'user_note', sql: false, onMissing: 'drop' }],
    identity: contentAll(),
  },
  {
    name: 'user_text_markup', pk: ['markup_id'], autoId: true, cls: 'content', origin: 'both',
    columns: ['markup_id', 'module_id', 'verse_id_start', 'verse_id_end', 'text_start', 'text_end', 'color', 'note_id', 'created_date', 'metadata'],
    fks: [{ column: 'note_id', table: 'user_note', sql: true, onMissing: 'null' }],
    identity: contentAll(),
  },
  {
    name: 'user_cross_reference', pk: ['user_xref_id'], autoId: true, cls: 'content', origin: 'core',
    columns: ['user_xref_id', 'from_verse_id_start', 'from_verse_id_end', 'to_verse_id_start', 'to_verse_id_end', 'notes', 'created_date', 'metadata'],
    fks: [], identity: contentAll(),
  },
  {
    name: 'reading_plan', pk: ['plan_id'], autoId: true, cls: 'content', origin: 'core',
    columns: ['plan_id', 'name', 'description', 'plan_type', 'duration_days', 'is_builtin', 'created_date', 'metadata'],
    fks: [], identity: { kind: 'unique', columns: ['name', 'plan_type', 'is_builtin'], conflict: 'keepLocal' },
  },
  {
    name: 'reading_plan_day', pk: ['day_id'], autoId: true, cls: 'content', origin: 'core',
    columns: ['day_id', 'plan_id', 'day_number', 'metadata'],
    fks: [{ column: 'plan_id', table: 'reading_plan', sql: true, onMissing: 'drop' }],
    identity: { kind: 'unique', columns: ['plan_id', 'day_number'], conflict: 'keepLocal' },
  },
  {
    name: 'reading_plan_passage', pk: ['passage_id'], autoId: true, cls: 'content', origin: 'core',
    columns: ['passage_id', 'day_id', 'session_name', 'verse_id_start', 'verse_id_end', 'sort_order', 'metadata'],
    fks: [{ column: 'day_id', table: 'reading_plan_day', sql: true, onMissing: 'drop' }],
    identity: contentAll(),
  },
  {
    name: 'user_reading_progress', pk: ['progress_id'], autoId: true, cls: 'content', origin: 'core',
    columns: ['progress_id', 'plan_id', 'start_date', 'current_day', 'completed_days', 'notes', 'status',
      'estimated_completion_date', 'streak_days', 'metadata'],
    fks: [{ column: 'plan_id', table: 'reading_plan', sql: true, onMissing: 'drop' }],
    identity: { kind: 'unique', columns: ['plan_id', 'start_date'], conflict: 'keepLocal' },
  },
  {
    name: 'prayer_item', pk: ['prayer_id'], autoId: true, cls: 'content', origin: 'core',
    columns: ['prayer_id', 'title', 'description', 'category', 'priority', 'status', 'created_date', 'answered_date',
      'reminder_date', 'reminder_recurrence', 'tags', 'linked_verses', 'metadata'],
    fks: [], identity: contentAll(),
  },
  {
    name: 'prayer_update', pk: ['update_id'], autoId: true, cls: 'content', origin: 'core',
    columns: ['update_id', 'prayer_id', 'update_text', 'update_date', 'metadata'],
    fks: [{ column: 'prayer_id', table: 'prayer_item', sql: true, onMissing: 'drop' }],
    identity: contentAll(),
  },
  {
    name: 'journal_entry', pk: ['entry_id'], autoId: true, cls: 'content', origin: 'core',
    columns: ['entry_id', 'title', 'content', 'content_format', 'entry_date', 'created_date', 'modified_date', 'tags', 'mood', 'is_encrypted', 'metadata'],
    fks: [], identity: contentAll(),
  },
  {
    name: 'user_data_item', pk: ['item_id'], autoId: true, cls: 'content', origin: 'core',
    columns: ['item_id', 'owner_uuid', 'collection', 'item_key', 'value', 'value_type', 'sort_order', 'created_date', 'modified_date', 'metadata'],
    fks: [], identity: { kind: 'unique', columns: ['owner_uuid', 'collection', 'item_key'], conflict: 'newerWins', stamp: 'modified_date' },
  },
  {
    name: 'verse_link', pk: ['link_id'], autoId: true, cls: 'content', origin: 'core',
    columns: ['link_id', 'source_type', 'source_id', 'verse_id_start', 'verse_id_end', 'link_type', 'sort_order', 'context', 'metadata'],
    fks: [{
      column: 'source_id', typeColumn: 'source_type',
      targets: { note: 'user_note', document: 'user_note', journal: 'journal_entry', prayer: 'prayer_item', user_data_item: 'user_data_item' },
      otherTypes: 'drop', onMissing: 'drop',
    }],
    identity: contentAll(),
  },
  {
    name: 'extension_storage', pk: ['extension_id', 'key'], autoId: false, cls: 'extension', origin: 'desktop',
    columns: ['extension_id', 'key', 'value', 'updated_at'],
    fks: [], identity: { kind: 'unique', columns: ['extension_id', 'key'], conflict: 'newerWins', stamp: 'updated_at' },
  },
  {
    name: 'session', pk: ['session_id'], autoId: true, cls: 'workspace', origin: 'both',
    columns: ['session_id', 'name', 'description', 'created_date', 'modified_date', 'last_opened', 'is_autosave', 'is_default', 'session_data', 'metadata'],
    fks: [], identity: contentAll(['is_default']), defaultFlag: 'is_default',
    skipInMerge: (row) => row.is_autosave === 1,
  },
  {
    name: 'user_keybindings', pk: ['command_id', 'key'], autoId: false, cls: 'workspace', origin: 'desktop',
    columns: ['command_id', 'key', 'mac', 'when_clause'],
    fks: [], identity: { kind: 'unique', columns: ['command_id', 'key'], conflict: 'keepLocal' },
  },
  {
    name: 'setting', pk: ['setting_id'], autoId: true, cls: 'workspace', origin: 'core',
    columns: ['setting_id', 'category', 'key', 'value', 'value_type', 'description', 'metadata'],
    fks: [], identity: { kind: 'unique', columns: ['category', 'key'], conflict: 'keepLocal' },
    skipInMerge: (row) => row.category === 'system',
  },
  {
    name: 'layout_preset', pk: ['layout_id'], autoId: true, cls: 'workspace', origin: 'core',
    columns: ['layout_id', 'name', 'description', 'is_stock', 'layout_data', 'created_date', 'metadata'],
    fks: [], identity: contentAll(), skipInMerge: (row) => row.is_stock === 1,
  },
  {
    name: 'module_display_option', pk: ['option_id'], autoId: true, cls: 'workspace', origin: 'core',
    // module_id is a local install id, not portable across machines (see the restore report warning).
    columns: ['option_id', 'module_id', 'option_key', 'option_value', 'metadata'],
    fks: [], identity: { kind: 'unique', columns: ['module_id', 'option_key'], conflict: 'keepLocal' },
  },
  {
    name: 'user_profile', pk: ['profile_id'], autoId: false, cls: 'workspace', origin: 'core',
    columns: ['profile_id', 'username', 'display_name', 'email', 'created_date', 'last_login', 'preferences', 'metadata'],
    fks: [], identity: { kind: 'unique', columns: ['profile_id'], conflict: 'keepLocal' }, mergeKeepsLocal: true,
  },
  {
    name: 'user_search_history', pk: ['search_id'], autoId: true, cls: 'history', origin: 'core',
    columns: ['search_id', 'query', 'search_type', 'scope', 'module_id', 'result_count', 'search_date', 'metadata'],
    fks: [], identity: contentAll(),
  },
  {
    name: 'navigation_history', pk: ['nav_id'], autoId: true, cls: 'history', origin: 'core',
    columns: ['nav_id', 'session_id', 'tab_id', 'module_id', 'module_type', 'verse_id_start', 'verse_id_end', 'navigation_date', 'metadata'],
    fks: [{ column: 'session_id', table: 'session', sql: true, onMissing: 'drop' }],
    identity: contentAll(),
  },
  {
    name: 'command_history', pk: ['command_id'], autoId: false, cls: 'history', origin: 'desktop',
    columns: ['command_id', 'last_used', 'use_count'],
    fks: [], identity: { kind: 'unique', columns: ['command_id'], conflict: 'max', maxColumns: ['last_used', 'use_count'] },
  },
];

/**
 * Tables that exist in the user database but are never backed up. Listed so the
 * drift tests can tell "deliberately excluded" from "forgotten".
 */
export const EXCLUDED_TABLES: readonly string[] = [
  'extensions', // install state and paths of this machine
  'extension_catalog_source', // marketplaces (including the risk-acknowledgement) are a per-machine trust decision
  'extension_blocklist', // refreshed from the network
  'sync_metadata', // device-bound bookkeeping
  'schema_version',
  'schema_migration',
];

/** Shadow tables of the note full-text index, and SQLite's own tables, are derived data. */
export function isDerivedTable(name: string): boolean {
  return name.startsWith('sqlite_') || name === 'user_note_fts' || name.startsWith('user_note_fts_');
}

/** Whether a table name is one this registry knows, backed up or deliberately excluded. */
export function isClassified(name: string): boolean {
  return USER_TABLES.some((t) => t.name === name) || EXCLUDED_TABLES.includes(name) || isDerivedTable(name);
}

const BY_NAME: ReadonlyMap<string, TableSpec> = new Map(USER_TABLES.map((t) => [t.name, t]));

export function tableSpec(name: string): TableSpec | undefined {
  return BY_NAME.get(name);
}

/** Every table a spec's foreign keys point at (self-references excluded). */
export function parentTables(spec: TableSpec): string[] {
  const out = new Set<string>();
  for (const fk of spec.fks) {
    const targets = 'table' in fk ? [fk.table] : Object.values(fk.targets);
    for (const t of targets) if (t !== spec.name) out.add(t);
  }
  return [...out];
}

/** Tables in dependency order: parents before children. Registry order breaks ties, so the result is stable. */
export function orderedTables(specs: readonly TableSpec[] = USER_TABLES): TableSpec[] {
  const names = new Set(specs.map((s) => s.name));
  const done = new Set<string>();
  const out: TableSpec[] = [];
  const visiting = new Set<string>();
  const visit = (s: TableSpec): void => {
    if (done.has(s.name)) return;
    if (visiting.has(s.name)) throw new Error(`Foreign-key cycle through ${s.name}`);
    visiting.add(s.name);
    for (const p of parentTables(s)) {
      const ps = BY_NAME.get(p);
      if (ps && names.has(p)) visit(ps);
    }
    visiting.delete(s.name);
    done.add(s.name);
    out.push(s);
  };
  for (const s of specs) visit(s);
  return out;
}

/** Bring a row from schema version `from` up to the current one through the registered upgraders. */
export function upgradeRow(spec: TableSpec, row: Row, from: number, to: number = USER_SCHEMA_VERSION): Row {
  let cur = row;
  for (let v = from; v < to; v++) {
    const up = spec.upgraders?.[v];
    if (up) cur = up(cur);
  }
  return cur;
}

// --- schema version stamp -----------------------------------------------------

/** The schema version stored in the database (`PRAGMA user_version`); 0 when never stamped. */
export function readUserSchemaVersion(db: ISql): number {
  return db.queryOne<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0;
}

/** Record the current schema version. Never lowers a version a newer build stamped. */
export function stampUserSchemaVersion(db: ISql): void {
  if (readUserSchemaVersion(db) < USER_SCHEMA_VERSION) {
    db.execute(`PRAGMA user_version = ${USER_SCHEMA_VERSION}`);
  }
}
