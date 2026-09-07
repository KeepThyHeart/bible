# Shared schema fragments

A table defined in more than one schema has exactly one definition, here. The schemas that carry it pull it in with an include directive rather than repeating it:

```sql
-- @include ../shared/module_info.sql
```

| Fragment | Included by |
|---|---|
| `module_info.sql` | The eight module schemas |
| `verse_link.sql` | The eight module schemas and `UserDatabase` |
| `schema_version.sql` | The eight module schemas |
| `schema_version_migratable.sql` | `MainDatabase`, `UserDatabase` |
| `schema_migration.sql` | `MainDatabase`, `UserDatabase` |
| `setting.sql` | `MainDatabase`, `UserDatabase` |
| `module_feature.sql` | `BibleTranslation` only, so far |

`module_feature` is here despite having one consumer: nothing about a capability flag is specific to a bible, and when another module type wants one it should add a one-line include, not a second definition.

## Assembling a schema

A schema file is no longer executable as-is -- the directive is a SQL comment, so the file still reads and diffs as plain SQL, but the text it names is not in it. Expand it first:

```typescript
import { loadSchemaSql } from '@bible/core';

db.exec(loadSchemaSql('sql/schemas/initial/BibleTranslation.sql'));
```

`loadSchemaSql` resolves each include relative to the file containing it, recursively, and fails loudly on a missing file or an include cycle. It is exported from the package precisely so that anything creating a conforming database -- the app, the converters, an external tool -- can do this without reimplementing it.

## Type-specific columns

`module_info` is one definition shared by all eight module types. Two of them need columns nobody else does, and they add them with `ALTER TABLE` immediately after the include rather than forking the shared block:

| Schema | Added |
|---|---|
| `Dictionary.sql` | `dictionary_type`, `language_from`, `language_to` |
| `Devotional.sql` | `devotional_type`, `total_days` |

`ALTER TABLE ... ADD COLUMN` keeps a real typed column with its `CHECK`, which pushing the fields into `metadata` JSON would have cost. Note that SQLite requires a non-NULL default when adding a `NOT NULL` column; `module_info` is empty at creation, so those defaults exist only to satisfy that rule. Anything narrower than these belongs in `metadata` rather than in a new column.

`module_type` and `format` carry no per-type `DEFAULT` and no `CHECK` -- the price of a single definition, and consistent with the enum policy, which already calls `module_type` an open set validated in TypeScript. Each schema names its own values in the comment above the include.

## Not shared

- `schema_version` comes in two shapes. Module files never migrate in place -- they are replaced wholesale -- so they use `schema_version.sql`. `main.db` and `user_*.db` do migrate, and use `schema_version_migratable.sql`, which adds `migration_script_up` / `migration_script_down`.
- `module_metadata` lives only in `MainDatabase.sql`. It is the registry of installed modules, not something a module carries about itself.

## Enforcement

`src/__tests__/SharedSchemaFragments.test.ts` asserts that no schema declares a shared table inline, that every schema assembles with all includes resolved, that each one creates a database, and that `module_info` has identical columns across all eight module schemas.
