# Desktop Package Documentation

**Last verified:** 2026-09-09

This folder contains feature-oriented documentation for the `@bible/desktop` package. Each feature doc lists the relevant files and provides brief explanations to help you quickly get oriented when working on a particular feature.

**Maintenance Note:** If you find anything in these docs that is outdated, incomplete, or missing (new files, renamed files, removed files, new features), please update the relevant doc to keep them accurate. When adding a new feature or significantly changing an existing one, update or create the corresponding feature doc.

## Architecture Overview

- **Framework:** Electron (main process) + React (renderer)
- **Database:** better-sqlite3 (compiled for Electron's Node.js via electron-rebuild)
- **State Management:** Zustand stores
- **Styling:** Tailwind CSS + custom CSS
- **IPC:** Electron IPC between main and renderer processes
- **Layout:** dockview for dockable/resizable pane system (see `src/ui/components/DockviewLayout.tsx`)

## Feature Docs

| Feature Doc | Description |
|---|---|
| [Bible Pane](features/bible-pane.md) | Core Bible reading with multi-tab, parallel view, display modes, and verse interaction |
| [Interlinear & Study Mode](features/interlinear-study.md) | Study mode with interlinear display, cross-references, footnotes, and verse links |
| [Commentary](features/commentary.md) | Commentary pane with tree view, reference linking, and multi-commentary support |
| [Search](features/search.md) | Keyword, advanced, and semantic search, and find-in-page |
| [Dictionary](features/dictionary.md) | Dictionary/lexicon pane for Strong's and other reference lookups |
| [Notes & Writing](features/notes-writing.md) | File-backed user notes (browser + rich text editor) and the Prayer pane |
| [Highlights](features/highlights.md) | Verse highlighting with color selector and floating annotation toolbar |
| [Bookmarks & Collections](features/bookmarks-collections.md) | Verse bookmarks: one flat named-and-ordered list, saved from the Bible pane and managed in a dialog |
| [Books](features/books.md) | Book and dictionary reading panes with tree navigation |
| [Copy & Export](features/copy-export.md) | Verse copying with multiple formats and custom template editor |
| [Sessions](features/sessions.md) | Study session persistence and auto-save/restore |
| [Settings & Preferences](features/settings-preferences.md) | User preferences, text settings, themes, keyboard shortcuts |
| [Module Management](features/module-management.md) | Module browser, download, repository settings, study/starter packs, and the install policy for already-installed modules |
| [Backup & Restore](features/backup-restore.md) | User data backup and restore with encryption support |
| [Diagnostics & Issue Reporting](features/diagnostics-reporting.md) | Opt-in crash reports and manual issue reports with local queue and background uploader |
| [Electron Shell](features/electron-shell.md) | Main process, IPC registration, menus, window management, database providers, build-time `BIBLE_*` configuration, and the product mark |
| [Sidebar & Layout](features/sidebar-layout.md) | dockview pane layout: groups, tab strip, layout presets, collapsing and resizing |
| [Pop-Out / Detach Pane](features/pop-out.md) | Pop out any pane to a standalone window with state preservation |
| [Study & Topics](features/study-topics.md) | Study Pane (verse-centric hub) and Topics Pane (topical index browsing) |
| [Onboarding](features/onboarding.md) | First-run language question, welcome bar, the header's Help panel, re-runnable guided tour, and the pane empty-state coaching |
| [Localization (i18n)](features/localization.md) | String catalogs, ICU formatting, locale metadata and draft status, the language picker, and right-to-left (RTL) support |
| [Source-side i18n rules](features/i18n-source-fixes.md) | How to write English source strings and call sites that translate cleanly, and the known limitations |
| [Status Bar](features/status-bar.md) | The bottom strip, filled entirely by extension-contributed items; absent entirely when there are none |
| [Extensions](features/extensions.md) | Sandboxed extension host, the `api.*` RPC surface, trust tiers and signing, and the catalog/blocklist marketplace |

## Translating

If you are here to add or correct a translation rather than to change code, start with **[`locales/README.md`](../locales/README.md)** (how to add a locale, the flat dotted-key convention, ICU rules, validators) and **[`locales/GLOSSARY.md`](../locales/GLOSSARY.md)** (agreed Bible-study terminology and register per language). Note that every non-English locale currently shipped is **machine-drafted and awaiting native-speaker review**.

## Testing

- **Unit tests:** `src/ui/services/*.test.ts`, `src/ui/utils/*.test.ts`
- **Component tests:** `src/ui/components/*.test.tsx`, `src/ui/components/study/*.test.tsx` (vitest + @testing-library/react)
- **Main-process unit tests:** `electron/services/__tests__/*.test.ts`, `electron/ipc/__tests__/*.test.ts`, `electron/extensions/__tests__/*.test.ts`, plus co-located files such as `electron/config/paneConfig.test.ts`
- **E2E tests:** Playwright in `e2e/tests/` (ai-disclaimer, bible-pane, bookmarks, chrome-bands, command-registry, commentary, copy, default-layout, diagnostics, dictionary, extension-host-asar, highlight-diagnosis, highlights, interlinear, module-manager, narrow-window, notes, pop-out, reference-links, search, semantic-search, study-pane, tab-strip-actions, topics-pane)
- **E2E guide:** See [`e2e/README.md`](../e2e/README.md) for setup, common issues, and conventions
