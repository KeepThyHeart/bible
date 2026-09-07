# SQL Migrations

One ordered sequence of `NNN_name.sql` files brings an existing `main.db` or
`user_*.db` forward to the current schema; a fresh database is created from
`sql/schemas/initial/` instead and *baselined*. Module databases are **not**
migrated - see [Module format](module-format.md). Read this before adding a
column to `main.db` or the user database.

## Files

### Runner

| File | Purpose |
|---|---|
| `src/Data/Migration/MigrationTypes.ts` | `MigrationTarget`, `MigrationGuard`, `MigrationStatement`, `MigrationScript`, `AppliedMigration`, `MigrationOutcome`, `MigrationRunResult`. |
| `src/Data/Migration/MigrationParser.ts` | `parseMigration(source, label)`. Splits SQL into statements while tracking string literals, quoted identifiers, comments and `BEGIN`/`CASE`...`END` nesting; collects the `@database` / `@description` header and the `@skip-if` guards. |
| `src/Data/Migration/MigrationRunner.ts` | `MigrationRunner`, `MIGRATION_TABLE` (`'schema_migration'`), `fingerprint`. `run` / `baseline` / `getApplied` / `getPending`. |
| `src/Data/Migration/loadMigrations.ts` | `loadMigrationsFromDirectory(dir)` (Node/Electron only - uses `fs`) and `findMigrationsDirectory()`. |
| `src/Data/Migration/repairUserSchema.ts` | `repairUserSchema` / `repairUserTextMarkup` - inline, shape-detected repairs for user databases the runner cannot reach. |
| `src/Data/Migration/index.ts` | Barrel; re-exported from `src/index.ts`. |
| `src/Data/Migration/repairUserSchema.test.ts` | The only test in this subsystem. Covers the legacy colour CHECK, the nullable `verse_id_end`, idempotency and rollback. |

### The sequence

Files live in `sql/migrations/` and are named `NNN_snake_case_name.sql`. `NNN` is
zero-padded, strictly increasing, **never reused and never renumbered** - it is
the migration's identity in the ledger. One sequence covers both `main.db` and
`user_*.db`, so the numbers in either one are sparse.

**This release ships no migrations.** The initial schemas in
`sql/schemas/initial/` are current, so a newly created database is already up to
date and `loadMigrationsFromDirectory` returns an empty list. The first
post-release schema change lands as `001_*.sql`.

## How it works

### File format

```sql
-- Migration 001: short title
-- @database: user            <- required; the runner refuses a file without it
-- @description: One or two lines.

-- @skip-if: column-exists module_metadata.repository_id
ALTER TABLE module_metadata ADD COLUMN repository_id INTEGER;
```

Guard kinds: `table-exists`, `table-missing`, `column-exists`,
`column-missing`. Guards on one statement are ANDed, and a holding guard
*suppresses* the statement. They exist because SQLite has no
`ADD COLUMN IF NOT EXISTS` and no way to drop a `CHECK`, and because a database
may arrive already partly advanced.

### Running

```
loadMigrationsFromDirectory(dir)
  -> for each NNN_name.sql: parseMigration() eagerly   (a malformed file fails at load, not mid-run)
  -> MigrationScript[]

new MigrationRunner(sql, 'user').run(scripts)
  -> ensureLedger()          CREATE TABLE IF NOT EXISTS schema_migration
  -> order()                 sort by version; duplicate version numbers throw
  -> per script:
      target mismatch                -> 'skipped-other-database'
      already in ledger              -> 'already-applied' (+ checksum compared)
      else apply():
          PRAGMA foreign_keys = OFF       (no-op inside a transaction, so it is toggled around one)
          transaction {
            for each statement: guards hold? skip : execute
            PRAGMA foreign_key_check      (inside the transaction - a violation rolls back)
            record(script)                (INSERT OR REPLACE into schema_migration)
          }
          PRAGMA foreign_keys = ON        (only if it was on)
```

`baseline(scripts)` records every targeting migration as applied and runs none -
for a database just created from `sql/schemas/initial/`, which already has
the current structure. Migrations added *after* the baseline still run on the next
`run()`.

### The ledger

`schema_migration` is the **only** authority on what has been applied:

| column | meaning |
|---|---|
| `version` | the `NNN` prefix |
| `name` | the rest of the filename |
| `applied_date` | when |
| `checksum` | `fingerprint(source)` |

`fingerprint` is FNV-1a, 64-bit as two 32-bit halves, over the source with CRLF
normalised to LF. Not SHA-256, deliberately: it detects accidental drift, it is
not a security boundary, and a pure-TS implementation keeps `@bible/core` free of
a `node:crypto` import. A mismatch is reported in
`MigrationRunResult.checksumMismatches` and is never fatal on its own - it means
someone edited a shipped migration.

`schema_version` and `setting._schema` are human-readable markers. Neither
drives anything; do not write them from an individual migration - a release that
changes the schema sets them once, in its final migration.

## `repairUserSchema`

**What it is for:** bringing a user database created by an *older build* up to
the current shape, in-process, without the migration runner.

`initializeUserSchema` uses `CREATE TABLE IF NOT EXISTS`, which is a no-op on a
database that already has the table - so an upgraded profile keeps the old
build's constraints forever. That is not hypothetical: highlighting and
underlining were dead on every profile older than the hex-colour change, because
the table still carried
`CHECK (color IN ('yellow','green','blue','red','purple','orange'))` while
`UserTextMarkupRepository.create` always emits hex. Every INSERT failed, the
failure was swallowed on the way back to the renderer, and the toolbar dismissed
itself as if the gesture had worked. E2E never saw it because each worker deletes
the whole userData directory.

Migration 007 plus `MigrationRunner` would fix it, but the desktop app cannot
run them: `@bible/core` is *bundled* into the desktop main-process bundle, so
`findMigrationsDirectory()`'s `__dirname` resolves to `out/main` and the `.sql`
files are not on disk beside it. The two fixes the user DB actually needs are
therefore expressed inline in TypeScript.

`repairUserTextMarkup` detects two drifts from `sqlite_master.sql` and fixes both
in one rebuild:

1. the six-name colour CHECK, and
2. a nullable `verse_id_end` (pre-R-1) - a NULL end made a single-verse markup
   match every range starting after it, mis-selecting in `getForVerseRange` and
   silently deleting out-of-range rows in `deleteForVerseRange`.

Design rules it follows: **shape-detected** (`sqlite_master.sql`, not the ledger,
so it is right even when the ledger is missing or lying), **never lossy** (the
original colour name is written to `metadata.colorName` first), and **atomic**
(one transaction, foreign keys off, `PRAGMA foreign_key_check` before commit).

**When it runs:** a consumer should call it last in its user-schema
initialisation, once the tables are known to exist. Safe on every open; it
returns immediately when the table is already current or absent.

## Gotchas

- **`schemas/initial/` and `migrations/` must stay in step.** A fresh database
  and an old database brought forward must end up structurally identical. Change
  one, change the other in the same commit.

- **Never edit an applied migration.** Its checksum is recorded in every database
  that ran it; an edit shows up as a mismatch forever. Write a new migration.

- **`loadMigrationsFromDirectory` imports `node:fs`.** Never reach it from
  renderer or browser code; it is not in the browser barrel (`src/browser.ts`).

- **`findMigrationsDirectory` returns `undefined` rather than throwing**, so a
  caller can fall back instead of crashing at startup. Both of its candidate
  paths assume `sql/**` has been copied alongside `dist/`, so a consumer's build
  must do that copy or the lookup fails in a packaged app.

- **The runner toggles `PRAGMA foreign_keys` around the transaction, not inside
  it** - the pragma is a no-op inside a transaction. It restores the previous
  value, so a caller that had foreign keys off is not silently switched on.

## Related

- [Module format](module-format.md) - module `.db` files are immutable
  artifacts and are replaced, not migrated.
- [User data](user-data.md) | [Data layer](data-layer.md) |
  [Repositories](repositories.md)
- `sql/migrations/README.md` - the authoring guide.
