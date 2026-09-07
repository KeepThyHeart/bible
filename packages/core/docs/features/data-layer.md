# Data Layer

The database access foundation for every app in the monorepo: a driver-agnostic SQL interface, the repository pattern built on it, and the shared type/error/query helpers those repositories use. Start here before touching anything under `src/Data/`.

## Files

| File | Purpose |
|---|---|
| `src/Data/index.ts` | Barrel for the whole data layer. Its header documents the "core ships no provider" rule. |
| `src/Data/Core/ISql.ts` | The SQL abstraction every repository depends on: `queryOne`, `queryAll`, `execute`, `transaction`, `close`, `isOpen`, `getDatabasePath`. |
| `src/Data/Core/IRepository.ts` | Generic `IRepository<T>` shape and `RepositoryQueryOptions`. |
| `src/Data/Core/RowTypes.ts` | Raw row shapes as SQLite returns them, before mapping to models. |
| `src/Data/Core/Errors.ts` | `DataLayerError` and its subclasses (`ValidationError`, `NotFoundError`, `ConflictError`, `DatabaseError`), plus `isReadOnlyDatabaseError`. |
| `src/Data/Core/SafeQuery.ts` | `safeOrderByColumn`, `safeSortDirection`, `buildSafeOrderBy`, `buildPagination` - allow-list helpers for the parts of a query that cannot be parameterised. |
| `src/Data/Core/JsonHelpers.ts` | Safe parse/stringify for `metadata JSON` columns. |
| `src/Data/Core/Colors.ts` | Highlight colour names and hex conversion. |
| `src/Data/Core/Types.ts` | Verse identity, the `Book` enum, and the open-enum validators - see [Verse identity](verse-identity.md). |
| `src/Data/Models/` | Model classes grouped by database type (`Main/`, `User/`, `Bible/`, `Commentary/`, `Dictionary/`, `Book/`, `Devotional/`, `CrossReference/`, `TopicalIndex/`, `TagGraph/`, `Common/`). |
| `src/Data/Models/BaseModuleInfo.ts` | Shared `module_info` base for every module type's info model. |
| `src/Data/Repositories/` | One repository per database type - see [Repositories](repositories.md). |

### Test helpers

| File | Purpose |
|---|---|
| `src/__tests__/helpers/TestSqliteProvider.ts` | An `ISql` implementation over `better-sqlite3` for tests. |
| `src/__tests__/helpers/KJVTestHelper.ts` | Builds a small Bible module database. |
| `src/__tests__/helpers/MainTestHelper.ts` | Builds a `main.db` fixture. |
| `src/__tests__/helpers/UserTestHelper.ts` | Builds a `user_*.db` fixture. |
| `src/__tests__/helpers/MockRepositories.ts` | Repository doubles for service/controller tests. |

## How it works

```
UI / IPC handler / HTTP route
  -> Controller or Service        (business logic, depends on interfaces)
    -> I<Name>Repository          (interface)
      -> <Name>Repository         (implementation, constructor-injected ISql)
        -> ISql                   (queryOne / queryAll / execute / transaction)
          -> platform SqliteProvider (better-sqlite3)
            -> the .db file
```

**Core ships no database driver.** `@bible/core` exports the `ISql` *interface* and nothing that implements it; each consumer supplies its own provider:

- An Electron consumer supplies one backed by better-sqlite3 compiled for Electron's ABI.
- A server consumer supplies one backed by plain better-sqlite3 (or any driver it likes).
- Tests use `src/__tests__/helpers/TestSqliteProvider.ts`, which runs against `:memory:`.

That is why `packages/core/package.json` lists `better-sqlite3` under `devDependencies` only - it exists for the test suite, not for consumers.

### The rules that repositories follow

1. **One repository per database type, handling everything in that database.** Not `BibleVerseRepository` + `BibleModuleInfoRepository`, but one `BibleRepository` covering verses and module info both.
2. **Every repository has an interface.** `IBibleRepository` sits beside `BibleRepository`, and `src/Data/index.ts` exports the interface before the implementation. Controllers and services depend on the interface.
3. **`ISql` arrives by constructor injection.** `new BibleRepository(sqlProvider)` - no repository reaches for a driver itself.
4. **Rows are mapped to models, not returned raw.** `RowTypes.ts` describes what SQLite hands back; the repository converts it (booleans from 0/1, JSON columns parsed, `?? null` on the way back in).

## Gotchas

- **Never interpolate user input into SQL.** Bind parameters for values; for the parts that cannot be bound - column names in `ORDER BY`, sort direction, limit/offset - use `SafeQuery.ts`, which validates against an allow-list. This is a hard project rule, and the web package has had a SQL-injection finding before.
- **SQLite has no boolean type.** Rows come back as `0`/`1`; convert explicitly (`row.is_indexed === 1`). A raw `0` is truthy-negative in SQL but falsy in JS, so an unconverted value usually *looks* right until it doesn't.
- **`metadata` columns may be absent or null.** Always `row.metadata ? JSON.parse(row.metadata) : undefined`, and `JSON.stringify` only when the value exists. `JsonHelpers.ts` wraps both directions.
- **A missing column reads as `undefined` from `SELECT *`.** Tolerant row mapping relies on this rather than probing the schema - see [Module format](module-format.md) before "fixing" one.
- **`packages/core/tsconfig.json` is the build config and excludes tests on purpose.** Type-check with `npm run typecheck` (which uses `tsconfig.typecheck.json`); adding tests to the build config ships them in `dist/`.
- **Changing `src/` requires `npm run build:core` before the desktop app will see it.** `npm run build:desktop` does not rebuild core, and a stale `dist/` surfaces as `"X is not a constructor"` at runtime.

## Related

- [Repositories](repositories.md) - the full map of repository -> database -> tables.
- [Module format](module-format.md) - the module `.db` format and its schemas.
- [Migrations](migrations.md) - schema evolution and the `schema_migration` ledger.
- [User data](user-data.md) - the per-user database specifically.
- [Browser subset](browser-subset.md) - the platform-free entry point that excludes all of this.
