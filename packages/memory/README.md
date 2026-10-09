# @bible/memory

Scripture memory as a built-in feature module (task 0114). Source-consumed, no build step.

| Export | What |
|---|---|
| `@bible/memory/core` | `MemoryService`, the store, scheduler, recite and push-card logic, ports, `createSqlPort`, legacy import |
| `@bible/memory/api` | `MemoryApi` (what the UI calls), `MEMORY_API_METHODS`, push and notice types |
| `@bible/memory/ui` | `mountMemoryUi(container, { api, subscribe, t?, locale? })` |
| `@bible/memory/manifest` | the feature-module manifest and app/verse-action descriptors |
| `@bible/memory/messages` | `tr`/`tc` support: `formatMessage`, `Translate` |
| `@bible/memory/status`, `/maintenance`, `/legacy`, `/schema` | light helpers used by the desktop main process |

Strings are `tr(key, 'English', params)` (UI) and `tc(...)` (core); the catalogs live in the desktop app
(`apps/desktop/locales/<lng>/memory.json`). Tests: `pnpm --filter @bible/memory test`. See
[the feature doc](../core/docs/features/memory.md).

License: GPL-3.0-or-later.
