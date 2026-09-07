# Web Package Documentation

**Last verified:** 6e80a84 (2026-09-04)

This folder contains feature-oriented documentation for the `@bible/web` package. Each feature doc lists the relevant files and provides brief explanations to help you quickly get oriented when working on a particular feature.

**Maintenance Note:** If you find anything in these docs that is outdated, incomplete, or missing (new files, renamed files, removed files, new features), please update the relevant doc to keep them accurate. When adding a new feature or significantly changing an existing one, update or create the corresponding feature doc.

## Architecture Overview

- **Framework:** Preact (lightweight React alternative) for the frontend, Express.js for the backend API
- **Database:** better-sqlite3 (via `better-sqlite3-web` alias) with SQLite
- **State Management:** Custom observer-pattern stores (not Zustand/Redux)
- **Styling:** SCSS (`src/styles/`, entry `src/styles/main.scss`)
- **Config:** a `site-config.json` in the package data dir, loaded by `server/SiteConfig.ts` (template: `config/site-config.example.json`); the legacy `server-config.json` / `settings.json` / `search-pipeline.json` trio still loads as a fallback

## Feature Docs

| Feature Doc | Description |
|---|---|
| [Bible Pane](features/bible-pane.md) | Core Bible reading and display with multi-tab support, display modes, and navigation |
| [Interlinear & Strong's](features/interlinear-strongs.md) | Greek/Hebrew interlinear display and Strong's dictionary lookups (child of Bible Pane) |
| [Commentary](features/commentary.md) | Commentary pane with multi-tab support, pin/unpin, and reference auto-linking |
| [Search](features/search.md) | Keyword and semantic search with results panel |
| [Settings & Appearance](features/settings.md) | Theme, font, and display settings with localStorage persistence |
| [Navigation & Layout](features/navigation-layout.md) | Header, URL hash routing, history, resizable panes, keyboard shortcuts |
| [Copy & Export](features/copy-export.md) | Verse copying with multiple format options |
| [Modules](features/modules.md) | Module management and data loading (Bible, Commentary, Dictionary), plus the Dictionary pane and its search |
| [Topics & Tag Graph](features/topics.md) | Topical index browsing (Nave's, Torrey's) and tag graph entities |
| [Server & API](features/server-api.md) | Express backend, database management, API routes |
| [Mobile Study Pane](features/navigation-layout.md#mobile-study-pane) | All-in-one mobile study hub with icon grid, breadcrumb navigation, verse history |
| [State Management](features/state-management.md) | Store architecture, data providers, hooks |
| [Study Pane](features/topics.md#ui-components) | Desktop Study pane host components (cross-refs, topics, synthesis, interlinear sections) are mapped in the Topics doc |
| [PWA & Offline](features/pwa-offline.md) | Service worker (**off by default** — opt in with `ENABLE_PWA=1`), installability, HTTP cache headers, offline module storage via OPFS |

## Testing

- **Unit tests:** Vitest (`src/__tests__/`, `server/__tests__/`)
- **Component tests:** Vitest + `@testing-library/preact` (next to each component, e.g. `Header.test.tsx`)
- **E2E tests:** Playwright (`e2e/tests/`) — `npm run test:e2e -w @bible/web`. See [`e2e/README.md`](../e2e/README.md) for how the suite builds its own data directory and why it never reuses a server you started yourself.
- **Exploratory UI testing:** `exploratory-ui-testing.md` — **not yet imported into this repo**; upstream it is a flow-by-flow plan for driving the app in a real browser (by hand or via Claude for Chrome), covering the judgment calls Playwright cannot make.

Component tests follow the store-mocking pattern established in `src/components/ConnectionBanner.test.tsx` and `src/components/BiblePane/BibleToolbar.test.tsx`. All stores use a mutable container object for state so that `vi.mock` hoisting doesn't cause temporal dead zone issues.

API integration tests require module databases in a sibling desktop package's data directory — `server/__tests__/api.test.ts` resolves `../../../desktop/data`, i.e. `apps/desktop/data/` (KJV, Barnes, Clarke, ExB, Strong's dictionaries). **No desktop package is imported into this repo**, so those tests cannot run here. See the [main README](../README.md#testing) for full prerequisites.
