# Shared schema fragments

A table defined in more than one schema has exactly one definition, here. The schemas that carry it pull it in with an include directive rather than repeating it:

```sql
-- @include ../shared/module_info.sql
```

| Fragment | Included by |
|---|---|
| `module_info.sql` | The eight module schemas |
| `compression_dictionary.sql` | The eight module schemas |
| `verse_link.sql` | The eight module schemas and `UserDatabase` |
| `schema_version.sql` | The eight module schemas |
| `schema_version_migratable.sql` | `MainDatabase`, `UserDatabase` |
| `schema_migration.sql` | `MainDatabase`, `UserDatabase` |
| `setting.sql` | `MainDatabase`, `UserDatabase` |
| `module_feature.sql` | The eight module schemas |

`module_feature` is here despite originally having one consumer: nothing about a capability flag is specific to a bible, and every module type now includes it with the same one-line include rather than a second definition.

`compression_dictionary` holds the optional trained dictionary backing `module_info.compression`. A row exists iff frames were encoded against a dictionary; `compression = 'none'` (the default) means the table is empty. Keyed by `codec`, so a module carries at most one dictionary per codec.

## Assembling a schema

A schema file is no longer executable as-is -- the directive is a SQL comment, so the file still reads and diffs as plain SQL, but the text it names is not in it. Expand it first:

```typescript
import { loadSchemaSql } from '@bible/core';

db.exec(loadSchemaSql('sql/schemas/initial/BibleTranslation.sql'));
```

`loadSchemaSql` resolves each include relative to the file containing it, recursively, and fails loudly on a missing file or an include cycle. It is exported from the package precisely so that anything creating a conforming database -- the app, the converters, an external tool -- can do this without reimplementing it.

## What a publisher consumes (task 0027 F9)

`bible-scripts` -- the out-of-repo C++ SWORD-to-module converter -- builds the module files this package's readers open. The design's decision (task 0027 §6.1) is that it produces v0.2 by *consuming* this package's exports, not by copying the format's rules into its own codebase: every earlier drift bug in this series traced back to a rule that had been hand-copied somewhere and quietly fell out of step with the real one. `@bible/core`'s public root (`import { ... } from '@bible/core'`) is the whole contract a publisher needs:

| Export | For |
|---|---|
| `loadSchemaSql` | Assemble a schema file into runnable SQL (see above). |
| `CONTENT_MAP`, `ContentShape` | Which table(s) a module type's prose/indexed content lives in, and which columns are which -- so a publisher writes to the columns this package will actually read, without duplicating the registry. |
| `FORMAT_VERSION`, `READABLE_FORMAT_VERSIONS`, `LEGACY_FORMAT_VERSIONS`, `parseFormatVersion`, `isReadableFormatVersion` | Which `module_info.format_version` value to write, and to classify one already on disk. |
| `IContentCodec`, `NoneCodec`, `DeflateCodec`, `ZstdCodec`, `CodecRegistry`, `createNodeCodecRegistry` | Encode prose cells with the exact frame layout (bare, standard DEFLATE/zstd -- see `IContentCodec`'s doc comment) a reader will decode, rather than a hand-rolled equivalent. |
| `computeContentSha256` | Compute `module_info.content_sha256` over the module's decoded content, the same way the install gate and boot-time scan verify it. |
| `validateModuleFile`, `hasSqliteHeader` | Run the conformance rule table a built file must pass before it is fit to ship, against the same code path the app validates with. |

`src/__tests__/PublisherExportsContract.test.ts` is this table's enforcement: it builds a conforming module using only symbols imported the way an external consumer would import them, and fails to resolve -- not just to pass -- if a future refactor drops one of them from a barrel.

**Known gap: no dictionary trainer.** The design (§3.3) describes `compression_dictionary` rows trained from a corpus of a module's own content. `packages/core` does not export a training function, and this subtask deliberately does not add one: Node's built-in `zlib` zstd support has no `ZDICT_*`-style training API, and adding one would mean a new native dependency, which is exactly what choosing Node's built-in zstd was meant to avoid (see `ZstdCodec.ts`'s doc comment). Until a trainer subtask is scoped, `bible-scripts` must produce `compression_dictionary` rows some other way -- for example, shelling out to the standalone `zstd` CLI's own dictionary trainer -- which is that project's concern, not this package's.

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

`src/__tests__/SharedSchemaFragments.test.ts` asserts that no schema declares a shared table inline, that every schema assembles with all includes resolved, that each one creates a database, that `module_info` has identical columns across all eight module schemas, that `compression_dictionary` and `module_feature` exist with identical DDL in all eight, and that no assembled schema declares an `fts5` virtual table.
