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
  'verse_link',
  'schema_version',
  'schema_migration',
  'setting',
  'module_feature'
] as const;

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
});
