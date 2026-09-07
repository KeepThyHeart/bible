# Module format

Every content module (`bible_*.db`, `commentary_*.db`, ...) is a standalone SQLite
file conforming to the schemas in `sql/schemas/initial/`. Read this before
touching any repository, any `sql/schemas/initial/*.sql`, or anything that
resolves a module by name.

A module file is an **immutable artifact**: it carries a `content_sha256` over
its own content, and the app never writes to a shipped module. Derived data
(search indexes, caches) lives outside the module.

## Files

### Core files

| File | Purpose |
|---|---|
| `src/Data/Core/RowTypes.ts` | Raw SQLite row interfaces, one per table. |
| `src/Data/Repositories/BaseModuleRepository.ts` | `mapModuleIdentity` (row -> identity block), `buildIdentityAssignments` (the `SET` fragment for a `module_info` update), and the `BaseModuleRepository` base class. |
| `src/Data/Models/BaseModuleInfo.ts` | Shared `module_info` model: the identity/provenance block, `getIdentity()`, `isPublicDomain()`. |
| `src/Data/Core/ModuleVersion.ts` | `compareModuleVersions` / `isUpgrade` - orders publisher-authored version strings, returning `incomparable` rather than guessing. |

### Schemas (0.1.0)

| File | Purpose |
|---|---|
| `sql/schemas/initial/BibleTranslation.sql` | `bible_verse`, `interlinear_word`, `verse_link`, `bible_verse_fts`, `module_feature`. |
| `sql/schemas/initial/Commentary.sql` | `commentary_entry`, `verse_link`, `commentary_entry_fts`. |
| `sql/schemas/initial/Dictionary.sql` | `dictionary_entry`, `word_occurrence`, `verse_link`, `dictionary_entry_fts`. |
| `sql/schemas/initial/Book.sql` | `book_section`, `verse_link`, `book_section_fts`. |
| `sql/schemas/initial/Devotional.sql` | `devotional_entry`, `verse_link`, `devotional_entry_fts`. |
| `sql/schemas/initial/CrossReference.sql` | `cross_reference_group` + `verse_link`. |
| `sql/schemas/initial/TopicalIndex.sql` | `topic` + `verse_link` + `topic_fts`. |
| `sql/schemas/initial/TagGraph.sql` | People / places / objects / themes, `tag_association`, `entity_facet`, `verse_link`, `entity_verse_link`. |
| `sql/schemas/initial/MainDatabase.sql` | `main.db`: `bible_book`, `chapter_info`, `module_metadata`, `module_repository`, `module_download_queue`, `module_update`, search tables, `setting`, `schema_migration`. |
| `sql/schemas/initial/UserDatabase.sql` | `user_*.db` - see [User data](user-data.md). |

### Shared fragments

`module_info`, `verse_link`, `schema_version`, `schema_migration`, `setting` and
`module_feature` are each defined **once**, under `sql/schemas/shared/`, and
pulled into the schemas that carry them:

```sql
-- @include ../shared/module_info.sql
```

The prose describing a shared table lives with the fragment, not repeated above
every include; a schema file keeps only what is specific to *it* (which owner
rows populate its `verse_link`, what `module_type` value it uses).

That makes a schema file no longer executable as-is. Expand it first:

```typescript
import { loadSchemaSql } from '@bible/core';

db.exec(loadSchemaSql('sql/schemas/initial/BibleTranslation.sql'));
```

`loadSchemaSql` (`src/Data/Schema/loadSchemaSql.ts`) resolves includes relative
to the including file, recursively, and throws `SchemaLoadError` on a missing
file or a cycle. `src/__tests__/SharedSchemaFragments.test.ts` checks that no
schema declares a shared table inline and that every schema still assembles and
runs. See `sql/schemas/shared/README.md` for the full table and for what is
deliberately *not* shared.

### Discovery, registration, and the module registry

| File | Purpose |
|---|---|
| `src/Services/ModuleLoader.ts` | Generic lazy repository factory with connection caching, optional TTL, and negative caching of failed loads. Platform injects path resolution, the `ISql` factory, and a logger. |
| `src/Services/ModuleRegistrationPolicy.ts` | Which discovered files become registered modules. `moduleFileSlug`, `crossReferenceSlugs`, `isCrossReferenceSourceCommentary(Path)`. |
| `src/Data/Repositories/ModuleMetadataRepository.ts` | CRUD over `main.db` `module_metadata` - the registry of installed modules. `getByUuid` (preferred) and `getByAbbreviation`. |
| `src/Data/Repositories/ModuleCatalogRepository.ts` | CRUD over `module_repository` - remote catalogs, their cached `catalog_json`, and signature trust state. |
| `src/Data/Repositories/ModuleUpdateRepository.ts` | CRUD over `module_update` - available updates per installed module. |
| `src/Data/Repositories/DownloadQueueRepository.ts` | CRUD over `module_download_queue` - in-flight downloads with progress and retry counters. |
| `src/Data/Core/CatalogTypes.ts` | Wire shapes of a repository catalog: `RepositoryInfo`, `CatalogModule`, sample text. |
| `src/Data/Core/FeaturePackTypes.ts` | Downloadable *capabilities* (today only `semantic_search`): flat artifact lists with per-file SHA-256. Fail-closed `parseFeaturePack`. |
| `src/Data/Core/StarterPackTypes.ts` | Language-scoped bundles that *reference* `module_ids` in the same catalog; installing one installs each module through the ordinary per-module path. |

### Tests

| File | Purpose |
|---|---|
| `src/Data/Core/ModuleVersion.test.ts` | Version ordering, including the date/edition-year `incomparable` cases. |
| `src/Services/ModuleLoader.test.ts` | Caching, TTL, negative caching, eviction. |
| `src/__tests__/ModuleRegistrationPolicy.test.ts` | The TSK shadowing rule. |
| `src/__tests__/ModuleMetadataRepository.test.ts`, `src/__tests__/ModuleCatalogRepository.test.ts`, `src/__tests__/ModuleUpdateRepository.test.ts`, `src/__tests__/DownloadQueueRepository.test.ts` | Registry repositories. |
| `src/Data/Core/FeaturePackTypes.test.ts`, `src/Data/Core/StarterPackTypes.test.ts` | Catalog-input validators. |

## How it works

Module identity is read straight off the single `module_info` row:

```
SELECT * FROM module_info WHERE info_id = 1
  -> mapModuleIdentity(row)                       (BaseModuleRepository.ts)
  -> new BibleModuleInfo({ ...identity, ... })
  -> info.getIdentity()  ->  moduleUuid ?? abbreviation
```

Writes go the other way: `buildIdentityAssignments(info)` returns a `SET`
fragment plus bound parameters, appended to the caller's own `UPDATE`. Column
names come from a fixed list, never from caller input, so interpolating them is
safe; every value binds as a parameter.

`module_uuid` - not `abbreviation` - is the cross-database join key. An
abbreviation is a display and lookup convenience and is not stable.

## Gotchas

- **`bible_verse_fts` column order is load-bearing.** It is declared
  `(verse_id UNINDEXED, text)`, so `text` is column 1. FTS5 `highlight()` does
  not raise on a bad column index - it returns an empty string, and the failure
  is silent and total: the reference renders, the verse text is blank. The
  repository falls back to the row's own text rather than serving a blank.

- **`isPublicDomain()` falls back to substring-matching the freeform
  `copyright` string** when `license_spdx` is absent. That is why the shipped
  KJV reports `false` - its `copyright` is `""`. Never parse `copyright`
  yourself; it is display-only.

- **`getIdentity()` falls back to the abbreviation** when a module carries no
  `module_uuid`. Anything that *persists* a cross-database reference should use
  `moduleUuid` and treat an abbreviation-shaped identity as unstable.

- **`compareModuleVersions` calls a bare 4-digit number `incomparable`.** That
  is on purpose (`MAX_BARE_VERSION_COMPONENT = 1000`): `20240115` and `1769` are
  a date and an edition year, and treating them as release numbers would make
  the 1769 KJV an "upgrade" over the 1611. `1.0` and `1.0.0` are `same`, not
  adjacent.

- **`commentary_tsk.db` is deliberately not registered** when `xref_tsk.db` is
  installed. The rule is stated over filenames, not over TSK; both files stay on
  disk, and the commentary remains usable as an import source. Registering both
  made TSK appear three times under one verse.

- **An interlinear alignment is a *list* of word ranges, not one range.** One
  original word does not always map to one contiguous run of translated words
  (Greek `ou me` -> "not ... at all"). The first range lives in
  `word_position_start` / `word_position_end`, which is what the indexes cover;
  any further ranges live in `extra_word_positions` as `"12-14,18"`, read with
  `parseWordPositionList`. It is NULL for almost every word. Do not assume
  `wordPositionStart..wordPositionEnd` is the whole alignment -- use
  `InterlinearWord.getWordSpans()`.

- **`ModuleLoader` caches failures too**, for `failureTtlMs` (default 30s). Call
  `evict(abbr)` after installing or replacing a module file rather than waiting
  out the window.

## Related

- [Data layer](data-layer.md) | [Repositories](repositories.md) |
  [Verse identity](verse-identity.md) | [Search](search.md)
- [Migrations](migrations.md) - how `main.db` and `user_*.db` (not module files)
  move forward.
- [User data](user-data.md) - the user-database half of the unified `verse_link`.
