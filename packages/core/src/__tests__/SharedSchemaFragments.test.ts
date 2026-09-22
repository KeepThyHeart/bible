import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { loadSchemaSql, SchemaLoadError } from '../Data/Schema';

/**
 * Tables defined in more than one schema have exactly one definition, under
 * `sql/schemas/shared/`, pulled in with `-- @include`. There are no copies to
 * drift, so this file checks the two things that can still go wrong: a schema
 * that repeats a shared table instead of including it, and an assembled schema
 * that does not actually run.
 *
 * See `sql/schemas/shared/README.md`.
 */

const SCHEMA_ROOT = join(__dirname, '..', '..', 'sql', 'schemas');
const INITIAL_DIR = join(SCHEMA_ROOT, 'initial');

const SCHEMA_FILES = readdirSync(INITIAL_DIR)
  .filter(name => name.endsWith('.sql'))
  .sort();

/** Tables that must never be declared inline in `initial/`. */
const SHARED_TABLES = [
  'module_info',
  'compression_dictionary',
  'verse_link',
  'schema_version',
  'schema_migration',
  'setting',
  'module_feature'
] as const;

/** The eight module-type schemas (excludes `MainDatabase.sql` and `UserDatabase.sql`). */
const MODULE_SCHEMA_FILES = SCHEMA_FILES.filter(
  name => name !== 'MainDatabase.sql' && name !== 'UserDatabase.sql'
);

/**
 * DDL for one table, normalized to compare shape across schemas: SQLite's
 * `sql` column reproduces the source text verbatim (including whitespace),
 * which differs across files (`BibleTranslation.sql` vs `TagGraph.sql` wrap
 * their include comments differently), so compare collapsed whitespace
 * instead of the raw string.
 */
function normalizedTableSql(db: Database.Database, table: string): string | undefined {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table) as { sql: string } | undefined;
  return row?.sql.replace(/\s+/gu, ' ').trim();
}

function readSchema(name: string): string {
  return readFileSync(join(INITIAL_DIR, name), 'utf8');
}

describe('shared schema fragments', () => {
  it('has schemas to check', () => {
    expect(SCHEMA_FILES.length).toBe(10);
  });

  it.each(SHARED_TABLES)('no schema declares %s inline', table => {
    const offenders = SCHEMA_FILES.filter(name => readSchema(name).includes(`CREATE TABLE ${table} (`));
    expect(offenders).toEqual([]);
  });

  it.each(SCHEMA_FILES)('%s assembles with every include resolved', name => {
    const sql = loadSchemaSql(join(INITIAL_DIR, name));
    expect(sql).not.toContain('@include');
    expect(sql.length).toBeGreaterThan(readSchema(name).length);
  });

  it.each(SCHEMA_FILES)('%s creates a database once assembled', name => {
    const db = new Database(':memory:');
    try {
      expect(() => db.exec(loadSchemaSql(join(INITIAL_DIR, name)))).not.toThrow();
    } finally {
      db.close();
    }
  });

  /**
   * The point of sharing: one edit reaches every schema. If `module_info` were
   * still copied per file, this would pass for one schema and fail for seven.
   */
  it('gives every module schema the same module_info columns', () => {
    const moduleSchemas = SCHEMA_FILES.filter(
      name => name !== 'MainDatabase.sql' && name !== 'UserDatabase.sql'
    );
    const shapes = moduleSchemas.map(name => {
      const db = new Database(':memory:');
      try {
        db.exec(loadSchemaSql(join(INITIAL_DIR, name)));
        return {
          name,
          columns: db
            .prepare('SELECT name FROM pragma_table_info(?)')
            .pluck()
            .all('module_info') as string[]
        };
      } finally {
        db.close();
      }
    });

    const shared = shapes[0]!.columns;
    for (const shape of shapes) {
      // Dictionary and Devotional append their own columns by ALTER; every
      // schema must still start with the identical shared block.
      expect(shape.columns.slice(0, shared.length)).toEqual(shared);
    }
    expect(shared).toContain('right_to_left');
    expect(shared).not.toContain('dictionary_type');
  });

  it('reports an unreadable include rather than emitting broken SQL', () => {
    expect(() => loadSchemaSql(join(INITIAL_DIR, 'NoSuchSchema.sql'))).toThrow(SchemaLoadError);
  });

  /**
   * F2 (schema v0.2): every module file's keyword index moved out of the
   * module -- into an app-side sidecar, not covered by this subtask -- so no
   * module schema should declare an fts5 virtual table any more. Checked only
   * over the eight module schemas: `UserDatabase.sql`'s `user_note_fts` is
   * deliberately out of scope for F2 and keeps its fts5 table. (MainDatabase.sql
   * had its own `bible_search_index` fts5 table too at the time, likewise out
   * of scope for F2; task 0026 subtask M12 later deleted it as dead code, so
   * MainDatabase.sql -- excluded above for a different reason, see
   * `MODULE_SCHEMA_FILES` -- no longer declares any fts5 table at all.)
   */
  it.each(MODULE_SCHEMA_FILES)('%s declares no fts5 virtual table', name => {
    expect(readSchema(name)).not.toMatch(/using\s+fts5/iu);
  });

  /**
   * `compression_dictionary` and `module_feature` are each one definition,
   * shared by all eight module schemas. Byte-for-byte DDL equality (modulo
   * whitespace) across all eight is the point of sharing rather than copying.
   */
  it.each(['compression_dictionary', 'module_feature'] as const)(
    'gives every module schema an identical %s table',
    table => {
      const shapes = MODULE_SCHEMA_FILES.map(name => {
        const db = new Database(':memory:');
        try {
          db.exec(loadSchemaSql(join(INITIAL_DIR, name)));
          return { name, sql: normalizedTableSql(db, table) };
        } finally {
          db.close();
        }
      });

      for (const shape of shapes) {
        expect(shape.sql, `${shape.name} is missing table ${table}`).toBeDefined();
      }
      const reference = shapes[0]!.sql;
      for (const shape of shapes) {
        expect(shape.sql).toEqual(reference);
      }
    }
  );

  it('gives module_info a compression column defaulting to none', () => {
    const db = new Database(':memory:');
    try {
      db.exec(loadSchemaSql(join(INITIAL_DIR, 'BibleTranslation.sql')));
      const column = db
        .prepare('SELECT * FROM pragma_table_info(?) WHERE name = ?')
        .get('module_info', 'compression') as { dflt_value: string; notnull: number } | undefined;
      expect(column).toBeDefined();
      expect(column!.notnull).toBe(1);
      expect(column!.dflt_value).toBe("'none'");
    } finally {
      db.close();
    }
  });

  it('defaults module_info.format_version to 0.2', () => {
    const db = new Database(':memory:');
    try {
      db.exec(loadSchemaSql(join(INITIAL_DIR, 'BibleTranslation.sql')));
      const column = db
        .prepare('SELECT * FROM pragma_table_info(?) WHERE name = ?')
        .get('module_info', 'format_version') as { dflt_value: string } | undefined;
      expect(column?.dflt_value).toBe("'0.2'");
    } finally {
      db.close();
    }
  });
});
