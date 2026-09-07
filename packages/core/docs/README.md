# Core Package Documentation

This folder contains feature-oriented documentation for the `@bible/core` package. Each doc lists the files involved in a subsystem and explains how they fit together, so you can get oriented without searching the tree.

**Maintenance note:** if you find anything here that is outdated, incomplete, or missing (new files, renamed files, removed files, new features), update the relevant doc. When you add a feature or significantly change one, update or create its doc. These docs describe `@bible/core` only - what a consuming application does with core belongs in that application's own docs, not here.

## What this package is

`@bible/core` is the shared library behind every Bible application in this repository - an Electron desktop app, a web app, a CLI. It owns the data model, the database access layer, and the business logic that no consumer should duplicate. It is platform-free: it ships no SQLite driver, no Electron dependency, and no browser APIs.

- **Language:** TypeScript, full strict mode (`noImplicitAny`, `strictNullChecks`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`). Non-negotiable.
- **Database:** SQLite, through the `ISql` abstraction. **Core ships no driver** - each consumer supplies its own provider.
- **Architecture:** repository pattern with constructor dependency injection; interfaces exported before implementations.
- **Two entry points:** `@bible/core` (everything, Node-only) and `@bible/core/browser` (the platform-free subset, safe to bundle).

## Feature docs

| Doc | Covers |
|---|---|
| [Data layer](features/data-layer.md) | `ISql`, the repository pattern, models, error types, safe-query helpers, test helpers |
| [Repositories](features/repositories.md) | Every repository mapped to its database file and tables |
| [Verse identity](features/verse-identity.md) | Verse IDs, the `Book` enum, book names, reference parsing and collapsing, Strong's numbers |
| [Module format](features/module-format.md) | The module `.db` format, its schemas, discovery, registration, catalogs |
| [Migrations](features/migrations.md) | The `NNN_name.sql` sequence, `MigrationRunner`, the `schema_migration` ledger, user-schema repair |
| [User data](features/user-data.md) | Notes, markup, collections, sessions, the unified `verse_link` table |
| [Search](features/search.md) | FTS keyword search and the configurable semantic pipeline |
| [Text rendering](features/text-rendering.md) | Normalising stored module text into display text; copy templates |
| [Controllers](features/controllers.md) | The stateful layer between UI and repositories/services |
| [API contracts](features/api-contracts.md) | `src/Api/` - the interfaces a first-party client implements |
| [Study overview](features/study-overview.md) | Cross-module per-chapter aggregation |
| [Extensions & plugins](features/extensions-plugins.md) | The third-party extension contract and the in-process hook system |
| [USFM export](features/usfm-export.md) | `src/Export/` - USFM read and write |
| [Browser subset](features/browser-subset.md) | `@bible/core/browser`, what belongs in it and why |
| [Getting started](getting-started.md) | End-to-end walkthrough: provider -> repositories -> controllers -> search |

## Build and test

```bash
npm run build:core        # tsc + copy SQL assets (from the repo root)
npm run typecheck         # all packages, tests included
npm run test -w @bible/core
```

**A consuming app's build does not necessarily rebuild core.** After changing anything in `packages/core/src/`, run `npm run build:core` (or `npm run build`) before running an app against it, or you will hit runtime errors like `"X is not a constructor"` from a stale `dist/`.

Type-checking uses `packages/core/tsconfig.typecheck.json`, which adds the tests that the emit-only `tsconfig.json` deliberately excludes. Keep `tsconfig.json` emit-only - adding tests to it ships them in `dist/`.

Tests are `vitest`. They live beside their subject (`src/Services/*.test.ts`, `src/Data/Repositories/*.test.ts`) or under `src/__tests__/` for repository and integration suites; shared fixtures are in `src/__tests__/helpers/`.

## Related documentation

Repository-wide design specifications live outside this package, under the repository's own `admin/` and design directories. Application-specific documentation belongs with each application under `apps/`.
