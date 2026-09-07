# SQL migrations

Place all SQL migrations into this directory.

---

## Layout

```
packages/core/sql/
  schemas/initial/*.sql     <- the current schema. What a NEW database is created from.
  migrations/NNN_name.sql   <- ordered forward steps. What an existing database runs to be brought fully up-to-date.
```

This release ships **no migrations**: the initial schemas are current, so a new
database is already up to date and `loadMigrationsFromDirectory` returns an empty
list. The first post-release schema change lands here as `001_*.sql`.

The two must stay in step: a fresh database built from `schemas/initial/` and an
old database brought forward through every migration must end up structurally
identical. If you change one, change the other in the same commit.

---

## Naming convention

```
NNN_snake_case_name.sql
```

* `NNN` - zero-padded, strictly increasing, **never reused and never renumbered**
  once merged. The number is the migration's identity in the ledger.
* Take the next free number. Never insert between existing numbers.
* One sequence covers **both** `main.db` and `user_*.db`; each file declares which
  one it targets, so the numbers in either database are sparse. That is expected.

## Required header

Every migration starts with a comment header:

```sql
-- Migration NNN: Short title
-- @database: main | user | both
-- @description: One or two lines on what and why.
```

`@database` is required - the runner refuses to load a file without it.

## Statement guards

SQLite has no `ADD COLUMN IF NOT EXISTS` and no way to drop a `CHECK`. Rather
than swallowing errors, a statement can be guarded by a directive on the
immediately preceding comment lines. Multiple guards on one statement are ANDed.

```sql
-- @skip-if: table-exists   <table>
-- @skip-if: table-missing  <table>
-- @skip-if: column-exists  <table>.<column>
-- @skip-if: column-missing <table>.<column>
```

Example:

```sql
-- @skip-if: column-exists module_metadata.repository_id
ALTER TABLE module_metadata ADD COLUMN repository_id INTEGER;
```

Guards are what make a migration **idempotent**, so a database that has already
been brought partway to the target shape still applies cleanly.

## Dropping a CHECK / changing a column

Use the SQLite 12-step rebuild: create `<table>_new`, copy, drop the original,
rename, recreate indexes and triggers. An FTS5 external-content index has to be
recreated the same way.

The runner disables `PRAGMA foreign_keys` for the duration of a migration, runs
everything in one transaction, and executes `PRAGMA foreign_key_check` **before**
committing - a violation rolls the whole migration back.

## Version bookkeeping

`schema_migration` is the **only** authority on what has been applied:

| column | meaning |
|---|---|
| `version` | the `NNN` prefix |
| `name` | the rest of the filename |
| `applied_date` | when |
| `checksum` | content fingerprint of the file, to detect edits to an applied migration (line-ending insensitive) |

Two further markers are written for humans, but neither drives anything:

* `schema_version` - the annotated history table both initial schemas carry.
* `setting._schema` - a loose version string.

Do not write either from an individual migration. A release that changes the
schema sets them once, in its final migration.

## Never edit an applied migration

Once a migration ships, its checksum is recorded in every database that ran it.
Editing it makes the runner report a checksum mismatch. Write a new migration
instead.

## Running them

```ts
import { MigrationRunner, loadMigrationsFromDirectory } from '@bible/core';

const migrations = loadMigrationsFromDirectory('/path/to/sql/migrations');
const runner = new MigrationRunner(sql, 'user');   // or 'main'
const result = runner.run(migrations);
```

For a database just created from `schemas/initial/`, baseline it instead of
replaying history:

```ts
runner.baseline(migrations);   // records every migration as applied, runs none
```

See `packages/core/src/Data/Migration/`.
