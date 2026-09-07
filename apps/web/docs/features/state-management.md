# State Management

**Last verified:** 6e80a84 (2026-09-04)

Custom observer-pattern stores and data provider abstractions.

## Store Architecture

All stores extend a `Store` base class with subscriber notification on state changes. Each store manages one domain.

### Files

| File | Description |
|---|---|
| `src/stores/Store.ts` | Base store class with observer pattern (subscribe/notify) |
| `src/stores/bibleStore.ts` | Tabs, display mode, history, navigation, tab reordering, session persistence |
| `src/stores/commentaryStore.ts` | Active commentary tabs, entries, pin state, sync state, tab reordering, right-pane mode. Also owns the **speculative-prefetch budget** (`affordablePrefetchModules`, `isCheapEnoughToWarm`, `PREFETCH_WORD_BUDGET`) that keeps a chapter navigation from pulling megabytes of unopened commentary — see [Server & API → Commentary payload budget](server-api.md) |
| `src/stores/searchStore.ts` | Query, results, search type, loading, visibility, Strong's mode and its paging (`loadMoreStrongs`, `loadAllStrongs`) |
| `src/stores/dictionaryStore.ts` | Dictionary tabs (permanent + temporary), per-tab search/browse/entry state, `openStrongs()` |
| `src/stores/moduleStore.ts` | Available modules, books, lookups |
| `src/stores/settingsStore.ts` | Theme, font settings, line height, interlinear layout, gesture thresholds, localStorage persistence |
| `src/stores/studyStore.ts` | Study pane: cross-references, topics, tag-graph entities and verse text for the study verse |
| `src/stores/offlineStore.ts` | Offline mode flag, downloaded modules, download progress, online/offline detection — see [PWA & Offline](pwa-offline.md) |
| `src/stores/connectionStore.ts` | Transient connection-error message behind `src/components/ConnectionBanner.tsx`; auto-dismisses after 15s |
| `src/events/eventBus.ts` | Small pub/sub used for cross-store signalling that would otherwise need a store-to-store import (tested by `src/__tests__/eventBus.test.ts`) |

### Hooks

| File | Description |
|---|---|
| `src/hooks/useStore.ts` | Subscribes a Preact component to store changes; forces re-render on state update |
| `src/hooks/useAppShared.ts` | The state and handlers `DesktopApp` and `MobileApp` both need — global keys (Ctrl+C, `/`), Strong's popup/tooltip state, verse hit-testing |
| `src/hooks/useContextMenu.ts` | Right-click menu state and action dispatch |
| `src/hooks/useVersePopup.tsx` | Verse-reference hover tooltip (desktop) / tap preview (mobile); cache keyed `module:verseId` |
| `src/hooks/useVerseText.ts` | Fetch-and-cache for a single verse's text |
| `src/hooks/useVerseNavigation.ts` | Shared "navigate to this reference" handler used by link click sites |
| `src/hooks/useEscapeKey.ts` | Escape-to-close for dialogs |
| `src/hooks/useViewportPosition.ts` | Keeps popups/tooltips inside the viewport |

## Data Providers

Abstraction layer between UI and server API. All providers use fetch-based HTTP calls.

| File | Description |
|---|---|
| `src/providers/interfaces.ts` | Provider interfaces (`IBibleDataProvider`, `ICommentaryDataProvider`, `ISearchProvider`, `IInterlinearDataProvider`, `IModuleProvider`, `IStrongsProvider`, `ICrossRefDataProvider`, `ITopicalDataProvider`, `ITagGraphDataProvider`), plus the `IDataProviders` bag `App` passes down |
| `src/providers/ServerDataProvider.ts` | Fetch-based implementations of all provider interfaces |
| `src/providers/StudyOverviewProvider.ts` | Chapter-level pre-generated study cache (`/api/study/overview`), served per-verse locally. Exports `IStudyOverviewProvider`, re-exported from `interfaces.ts` |
| `src/providers/OfflineStorageManager.ts` | OPFS module storage: download with progress, remove, read, quota |
| `src/offline/OfflineBibleProvider.ts` | `IBibleDataProvider` that answers from a downloaded OPFS module when present and falls through to the server otherwise — see [PWA & Offline](pwa-offline.md) |

## Types

| File | Description |
|---|---|
| `src/types.ts` | All TypeScript interfaces for API responses (`ChapterData`, `VerseData`, `CommentaryData`, `InterlinearData`, `SearchResultData`, `ModuleInfo`, `StrongsEntryData`, etc.) |
| `src/constants.ts` | Max chapters per book, plus re-exports of the book names and parse aliases from `@bible/core/browser` |

**Book names and aliases live in `@bible/core`** (`packages/core/src/Data/Core/BookNames.ts`) — the single source of truth for the repo. The client reaches them through `@bible/core/browser`, a barrel restricted to platform-free modules so it can be bundled (the main `@bible/core` entry point pulls in the Data layer and `better-sqlite3`). `browserBarrel.test.ts` in the core package fails the build if anything platform-specific becomes reachable from it. Import runtime values from `@bible/core/browser` in client code; the server may use `@bible/core` directly.

## Key Patterns

- Stores are singletons imported directly (not context-based)
- Components subscribe via `useStore(store, selector)` hook
- Data providers injected as props from `App` component
- localStorage used for session and settings persistence
