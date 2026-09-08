# Onboarding

**Last verified:** 2026-09-08

First-run guidance for two audiences at once: seminary students who want the power features found fast, and laypeople who have never used Bible software and would otherwise bounce off a multi-pane workspace with no explanation.

The design constraint that shapes everything here: **nothing blocks the app and nothing gates functionality.** There is no launch wizard. The layers are ordered from least to most intrusive, and the least intrusive one carries most of the weight.

There is exactly one exception, documented as layer 0 below: the first-run language question. A user who cannot read the UI cannot interact with the app at all, so that one question is asked before anything else.

## Layer 0 - first-run language question (the one modal)

`components/onboarding/LanguageFirstRun.tsx`, rendered by `App.tsx` after the tour so it sits above everything on a genuinely fresh install. It renders `null` once answered, so it costs nothing on every later launch.

**Why this one is modal** when the welcome bar deliberately is not: the welcome bar's argument - "a new user's first interaction should be with the app, not a wizard" - does not transfer to language. It is one click, asked once per install, and everything else is unreadable until it is settled.

**Two steps.**

1. **Language.** The four `SUPPORTED_CONTENT_LANGUAGES` (`en`, `es`, `hi`, `zh-Hans`, from `@bible/core`) are listed first - those are the languages we intend to have study *content* for. Every other loaded locale stays reachable behind a "More languages" disclosure; hiding a working translation to keep the list short would be a regression. Draft catalogs are badged so we never imply a review that did not happen.
2. **Suggested content.** Starter packs for the chosen language, fetched via `module:get-starter-packs`. This step is frequently **empty** - Hindi has no Bible translation confirmed public domain, and an offline install has no catalog at all - so it renders an honest "nothing yet, here is where to look later" rather than an empty list or a spinner that never resolves.

Installing is deliberately **not** a one-click button here. A starter pack is hundreds of megabytes of separately-licensed content and each module's licence is presented by the Module Manager before its download; short-circuiting that for a first-run convenience would put content on disk whose terms the user was never shown.

**Two implementation points worth knowing:**

* The dialog waits for `whenLocaleCatalogsReady()` (`services/localeCatalogsReady.ts`) before appearing. Locale catalogs load asynchronously and `loadCatalog()` fires no event, so a picker rendered at first paint would list only the statically-bundled `en` and never learn about the rest.
* `languageChosen` is read **once at mount**, not subscribed to. Committing the language marks it chosen while the dialog is still on screen, and a live subscription would unmount the dialog mid-flow so the user would never see step 2.

`languageChosen` is stored separately from the locale itself (`bible.ui.locale`, owned by `utils/documentDirection.ts`): "the UI is in English" and "the user was asked and said English" are different facts, and only the second should suppress the question.

Detached pane windows render `detached.tsx`, not `App.tsx`, so they never mount this dialog.

## The three remaining layers

### 1. Empty-state coaching (always on)

When a pane holds nothing, it explains what it is for and offers the single action that fills it. This is the highest-value layer: it teaches at the exact moment of confusion, costs an experienced user nothing, and never has to be dismissed.

`components/onboarding/PaneEmptyState.tsx` is the shared presentation: optional decorative icon (`aria-hidden`), title, one or two explanatory sentences, an optional quieter hint, and zero or more actions.

| Empty state | Rendered by | `data-testid` |
|---|---|---|
| No dictionary chosen | `DictionaryPane.tsx` | `dictionary-empty-state` |
| Dictionary open, nothing looked up | `DictionaryPane.tsx` | `dictionary-no-entry-state` |
| Dictionary lookup failed | `DictionaryPane.tsx` | `dictionary-error-state` |
| No commentary available | `CommentaryPane.tsx` | `commentary-empty-state` |
| No tabs open in a Books **or** Dictionary pane (two variants of one state - bookshelf vs. dictionary shelf) | `BookPane.tsx` | `book-dict-empty-state` |
| Single-module dictionary panel: nothing looked up / lookup failed | `src/ui/components/dictionary/DictionarySinglePanel.tsx` | `dictionary-single-no-entry-state`, `dictionary-single-error-state` |
| Notes folder empty | `notes/NotesFolderBrowser.tsx` | `notes-empty-state` |
| Verse Notes folder empty | `notes/NotesFolderBrowser.tsx` | `verse-notes-empty-state` |
| No topical index installed | `TopicsPane/BrowseView.tsx` | `topics-no-modules-state` |
| Topics filtered to nothing | `TopicsPane/BrowseView.tsx` | `topics-empty-state` |
| All panels closed | `DockviewWatermark.tsx` | - |
| New tab | `NewTabPage.tsx` | - |

Two notes on the pane wiring:

* `NotesFolderBrowser` takes an optional `onCreateNote`, passed only when creating is actually permitted - the action itself lives in `UserNotesPane`. Inside the **Verse Notes** folder it is deliberately omitted: that folder is filled by annotating verses from the Bible pane, so a "New note" button there would be wrong.
* `BookPane` renders **one** empty state, shown only when the pane has no tabs at all (`allTabs.length === 0`). It branches on `isDictionaryPane` for its copy and its action ("Get a dictionary"/"Choose a dictionary" vs. the book equivalents) but both branches carry the same `book-dict-empty-state` testid. There is no separate "book open, no section loaded" state.

### 2. Welcome bar (first run only)

`components/onboarding/WelcomeBar.tsx`, rendered by `App.tsx` directly beneath the header. One sentence of orientation, a "Take a tour" button and a dismiss control. It is a `role="region"`, not a dialog - it blocks nothing and steals no focus.

It retires permanently on dismissal **or** on completing the tour, since finishing the tour already answers the question the bar was asking.

### 3. Guided tour (on demand, re-runnable)

`components/onboarding/GuidedTour.tsx` - five steps over the Bible pane, study tools, search, adding a pane, and a close. Reachable from the header's `?` -> **Take a tour** (see "The Help panel" below), from **Help -> Take a Tour** in the native menu bar, and from the command palette, forever, not just on first run.

* **Escapable at every step.** Escape is handled at the document in the capture phase and stopped, so it closes the tour without also closing what is behind it. Skip and Done do the same thing.
* **No orphaned overlay is possible by construction.** The whole tour is one conditionally-mounted React subtree (`{isTourActive && <GuidedTour />}`), so leaving it removes the scrim, the spotlight and the card together. If a future step needs to mark an element, mark it with React state - never with `classList.add`.
* **Anchors** are resolved from the DOM by `tourSteps.ts`. Each step carries an ordered list of selectors and the first one that matches wins. A step whose anchors all miss (pane closed, control hidden at a narrow width) still renders, centred and without a spotlight, rather than silently dropping out.

| Step | Anchors, in order |
|---|---|
| Bible pane | `[data-tour-pane="bible"]`, `[data-testid="bible-pane"]` |
| Study tools | `[data-tour-pane="study"]`, `[data-tour-pane="commentary"]`, `[data-testid="commentary-pane"]` |
| Search | `[data-testid="search-input"]` |
| Add a pane | `[data-tour-anchor="add-pane"]` |
| Finish | none - centred |

`data-tour-pane` is set by `PanelContentRenderer.tsx` on every panel wrapper; `data-tour-anchor="add-pane"` is on the "+" button in `DockviewHeaderActions.tsx`. Both are identification hooks only.

## The Help panel (the header's `?`)

`components/HelpPanel.tsx`, opened by the `?` button in `components/HeaderActions.tsx` (which owns the open/closed state; the panel is anchored under the button). It lists every way into help - the in-app documentation, the tour, the keyboard shortcuts, and the two build-configured external rows.

**Every row dispatches the same `command:*` DOM event** the native menu (`menu/buildMenuSpec.ts`) and the command palette (`commands/appCommands.ts`) dispatch - one code path per action, nothing to keep in sync. That is the rule `HeaderActions` follows for Preferences and the Module Manager too.

| Row | Event / action | Present when |
|---|---|---|
| Documentation | `command:app:openDocumentation` - the in-app `DocumentationDialog` | always |
| Take a tour | `command:app:startTour` | always |
| Keyboard shortcuts | `command:app:openKeyboardShortcuts` | always |
| Documentation website | `app:open-external` IPC with the configured URL | `getDocsUrl()` is set |
| Report an issue | `command:app:reportIssue` | `getIssueReportUrl()` resolves |

**Two entries are build-configured, and are simply *absent* when unset** - a row that opens nothing is worse than no row, the same rule the "Report an Issue" command follows:

* `BIBLE_DOCS_URL` -> `docsUrl` on `AppConfig`, read through `config/appConfig.ts#getDocsUrl`. The row is external: it goes to the OS browser via the `app:open-external` IPC rather than through a `command:*` event.
* `BIBLE_ABOUT_TEXT` -> `aboutText`, a maintainer-written blurb shown at the top of the panel. It is passed through **untranslated** on purpose: it arrives as one already-authored string, not as a message with placeholders.

Both rows that leave the app (the docs site and Report an Issue) carry the external-link glyph, which is `aria-hidden`.

Both fields live on `electron/config/appConfig.ts` (with `isDocsSiteConfigured` alongside `isIssueReportingConfigured` / `isModuleCatalogConfigured`), have defines in `electron.vite.config.ts`, and are rows in the Build Configuration table in `apps/desktop/README.md`. See `electron-shell.md` for the config plumbing.

The footer prints the product name and version (`helpPanel.versionLine`), or the product name alone when no version was baked in - the same "no dangling Version" rule the documentation dialog's footer follows.

**Accessibility.** The panel is a `role="menu"` with an `aria-label`; the button carries `aria-haspopup="menu"` and `aria-expanded`. The first item is focused on open, Arrow Up/Down wrap, Home/End jump to the ends, and Escape or a click outside closes it. Selecting a row closes the panel *before* dispatching, so the dialog or overlay the row opens receives focus rather than fighting the menu for it.

All `helpPanel.*` keys are in `locales/en/ui.json`, resolved with plain `t()`.

## Persistence

`stores/useOnboardingStore.ts`, backed by `localStorage` - the same mechanism as `useSearchStore`'s semantic-mode flag and `utils/documentDirection.ts`, and shared across every window of the renderer origin so a detached pane sees the same flags with no IPC round trip.

| Key | Meaning |
|---|---|
| `bible.onboarding.languageChosen` | The first-run language question has been answered. Never asked again. |
| `bible.onboarding.welcomeDismissed` | The welcome bar has been dismissed. Never shown again. |
| `bible.onboarding.tourCompleted` | The tour has been finished or skipped at least once. |

`isTourActive` and `tourStepIndex` are **not** persisted, on purpose: a tour that resumed itself after a restart would be exactly the launch-blocking modal this feature must not be. Reads and writes are wrapped in try/catch, because `localStorage` throws in hardened contexts and onboarding must never be able to break launch.

`createOnboardingStore()` is exported so tests can simulate a restart: mutate one instance, build a second, and assert the second came up with the persisted value.

## Accessibility

* The tour card is `role="dialog" aria-modal="true"` with `aria-labelledby` and `aria-describedby`, and traps focus via `hooks/useFocusTrap` (which restores focus to the previously-focused element on release).
* The welcome bar's dismiss control has an `aria-label`; its glyph is `aria-hidden`.
* Arrow-key navigation in the tour follows the **reading** direction - ArrowLeft advances in RTL.
* `useReducedMotion()` disables the spotlight and card transitions when the OS asks for reduced motion.
* Every decorative icon is `aria-hidden`; none carries meaning on its own.

## RTL and theming

Logical properties only (`ps`/`pe`/`ms`/`me`/`text-start`), and semantic theme tokens only (`bg-surface-elevated`, `text-text-secondary`, `border-border`, `bg-accent` + `text-text-on-accent`) so light, dark and sepia all work.

The tour is the one place that computes physical offsets in JS, because it anchors to `getBoundingClientRect()` coordinates. The card's leading edge is placed with `utils/overlayPosition.ts#anchorAtPointerX`, which resolves to `left` in LTR and `right` in RTL. The spotlight rect itself stays physical - it is tracing a real element's box.

## Files

| File | Purpose |
|---|---|
| `src/ui/stores/useOnboardingStore.ts` | Persisted flags + ephemeral tour position |
| `src/ui/components/onboarding/PaneEmptyState.tsx` | Shared empty-state presentation |
| `src/ui/components/onboarding/WelcomeBar.tsx` | First-run orientation strip |
| `src/ui/components/onboarding/GuidedTour.tsx` | Spotlight overlay + step card |
| `src/ui/components/onboarding/tourSteps.ts` | Step copy stems and anchor selectors |
| `src/ui/components/onboarding/useReducedMotion.ts` | Reactive `prefers-reduced-motion` |
| `src/ui/components/onboarding/index.ts` | Barrel export |
| `src/ui/components/onboarding/LanguageFirstRun.tsx` | Layer 0 - the first-run language + starter-pack dialog |
| `src/ui/services/localeCatalogsReady.ts` | `whenLocaleCatalogsReady()`, awaited before the language dialog paints |
| `src/ui/components/HelpPanel.tsx` | The `?` menu: documentation, tour, shortcuts, plus the configured docs site and issue-report rows |
| `src/ui/components/HeaderActions.tsx` | Header buttons for Module Manager, Preferences and `?`; owns the Help panel's open state |
| `src/ui/config/appConfig.ts` | `getDocsUrl()` / `getAboutText()` / `getIssueReportUrl()` / `getProductName()` for the panel |
| `src/ui/App.tsx` | Mounts the bar, the tour and the language dialog; listens for `command:app:startTour`, `command:app:openDocumentation`, `command:app:openKeyboardShortcuts` and `command:app:reportIssue` |
| `src/ui/commands/appCommands.ts` | Registers `app.startTour` (and the documentation / shortcuts / issue commands the panel reuses) |
| `src/ui/menu/buildMenuSpec.ts` | Adds **Help -> Take a Tour** |
| `src/ui/components/PanelContentRenderer.tsx` | Sets `data-tour-pane` |
| `src/ui/components/DockviewHeaderActions.tsx` | Sets `data-tour-anchor="add-pane"` |
| `src/ui/hooks/useFocusTrap.ts` | Focus trap used by the tour card |
| `src/ui/utils/overlayPosition.ts` | `anchorAtPointerX` - the tour card's direction-aware leading edge |
| `electron/config/appConfig.ts` | `docsUrl` / `aboutText` and the `isDocsSiteConfigured` flag in the main process |

Tests: `src/ui/stores/__tests__/useOnboardingStore.test.ts` (persistence across a simulated reload), `src/ui/components/onboarding/GuidedTour.test.tsx` (escape from every step, no orphaned overlay), `src/ui/components/onboarding/WelcomeBar.test.tsx`, and `src/ui/components/HelpPanel.test.tsx` (the always-available rows, that "Take a tour" fires the same command the menu bar does, that the docs-site and issue rows are omitted when unconfigured and that a configured docs site opens through `app:open-external`, the build blurb, and Escape).

## Translation status

Every user-visible string here is a catalog key resolved with `t()`; the `onboarding.*`, `newTabPage.*` and `helpPanel.*` entries all live in `locales/en/ui.json`. Source carries no English literals - see `localization.md`, "No English literals in source".

Each string is one complete ICU message with placeholders for variable parts - never a sentence assembled from several `t()` calls with markup between them. See `i18n-source-fixes.md` for why that pattern breaks Hindi and Arabic.
