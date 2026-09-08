# Settings & Preferences

**Last verified:** 2026-09-08

User preferences for text display and themes, plus the read-only keyboard-shortcut and documentation dialogs that sit alongside them.

The Preferences dialog exposes six sections: **General** (UI language, global font scale, UI control size, advanced pane manager), **Typography** (fine-grained Bible/Study/UI text-size + line-height sliders and font-family picker), **Fonts** (per-pane font family/size/line-height overrides), **Themes**, **Extensions**, **Diagnostics**.

## Files

### Components

| File | Description |
|---|---|
| `src/ui/components/PreferencesDialog.tsx` | Main preferences dialog composition shell |
| `src/ui/components/PreferencesDialog/sectionDefs.tsx` | Section list (`SECTIONS`) + icons + `SectionId` union (`general`, `typography`, `fonts`, `themes`, `extensions`, `diagnostics`). Each entry holds a `labelKey`, **not** a label - see [Localization](#localization) |
| `src/ui/components/PreferencesDialog/GeneralSection.tsx` | UI language (collapsible, collapsed by default), global font scale (70-150%, 5% steps), UI control size (11-20px), and the Advanced Pane Manager opt-in checkbox (drag-and-drop pane rearranging; off by default - see [Advanced Pane Manager gate](sidebar-layout.md) in the layout doc). Also owns `SELECTABLE_BUILT_IN_LOCALES` / `selectableLocales()`, the single gate on which shipped locales either picker offers - see [Localization](localization.md#language-picker) |
| `src/ui/components/PreferencesDialog/TypographySection.tsx` | Fine-grained Bible/Study/UI text-size + line-height sliders (12-48 / 12-36 / 10-24 px; 1.2-2.5 line height) and font-family picker (System Default, Georgia, Times New Roman, Palatino, Garamond, Lora, Merriweather, EB Garamond) |
| `src/ui/components/PreferencesDialog/FontsSection.tsx` | Per-pane font settings list. `PANE_CONFIGS` holds a pane type and a sample-text **key** per pane (`bible`, `commentary`, `book`, `dictionary`); the panel label is `preferencesDialog.paneFontLabel` with the pane's bare noun from `utils/paneNames.ts` |
| `src/ui/components/PreferencesDialog/PaneFontSettings.tsx` | Collapsible per-pane font settings panel. Its typeface list is `useTextSettingsStore`'s `AVAILABLE_FONTS` (Georgia, Merriweather, Garamond, Times New Roman, Crimson Text, Libre Baskerville) - a different, bundled-font list from the Typography section's `AVAILABLE_FONT_FAMILIES` |
| `src/ui/components/PreferencesDialog/ThemesSection.tsx` | Theme selector: one card per `AVAILABLE_THEMES` entry with a swatch built from its `preview` colors, plus a live preview block |
| `src/ui/components/PreferencesDialog/useDialogShell.ts` | Dialog focus/escape shell hook |
| `src/ui/utils/paneNames.ts` | `PANE_NAME_KEYS` - the catalog key for each pane's name, shared with the dockview tab strip; also `genericEnglishTitle()` and `localizePaneLabel()` |
| `src/ui/components/ExtensionsSection.tsx` | The Extensions section of the dialog - see [Extensions](extensions.md) |
| `src/ui/components/diagnostics/DiagnosticsSettings.tsx` | The Diagnostics section - see [Diagnostics & Issue Reporting](diagnostics-reporting.md) |
| `src/ui/components/KeyboardShortcutsDialog.tsx` | Read-only shortcut reference. Opened from `src/ui/App.tsx` (`showKeyboardShortcuts`). **Nothing here is configurable**, and the list is the hardcoded `SHORTCUT_CATEGORIES` constant in the same file rather than a projection of `services/KeybindingService.ts`, so it can drift from the real bindings. It does localize: every row holds a `titleKey`/`descriptionKey` resolved with `t()`, and the key strings are rendered per platform (`Mod` becomes the Command symbol on macOS, `Ctrl` elsewhere) |
| `src/ui/components/DocumentationDialog.tsx` | In-app documentation/help dialog (content in `src/ui/components/DocumentationDialog/`) |

### State

| File | Description |
|---|---|
| `src/ui/stores/usePreferencesStore.ts` | Zustand store for theme, global font scale, UI control size, fine-grained typography (`TypographyPrefs`: bibleFontSize, studyFontSize, uiFontSize, bibleLineHeight, studyLineHeight, uiLineHeight, bibleFontFamily, studyFontFamily, uiFontFamily), and `advancedPaneManagerEnabled` (drag-and-drop pane rearranging opt-in, default `false` - see `services/AdvancedPaneManagerGate.ts`). Exports `AVAILABLE_FONT_FAMILIES`, `DEFAULT_TYPOGRAPHY`, `getFontFamilyStack()`, `AVAILABLE_THEMES` (generated from `styles/themeTokens.ts`), `ThemeId`/`isValidThemeId` (re-exported from `styles/themeTokens.ts`). Applies values as CSS variables (`--bible-font-size`, `--bible-line-height`, `--bible-font-family`, `--study-*`, `--ui-*`, `--ui-font-scale`, `--global-font-scale`, `--ui-control-font-size`) on the document root, and pushes the Bible/Study values into `useTextSettingsStore` (see "Typography vs. per-pane Fonts precedence" below). |
| `src/ui/stores/useTextSettingsStore.ts` | Zustand store for per-pane text settings (font family, size, line height per pane type). Tracks a `customized: Record<PaneType, boolean>` flag per pane; a non-customized pane's font settings are kept live in sync with the Typography section via `syncFromTypography()`, called from `usePreferencesStore.ts`. `getFontFamilyCSS()` resolves either a named `AVAILABLE_FONTS` option or an already-resolved CSS font stack (what a synced, non-customized pane carries). |

### Styles

| File | Description |
|---|---|
| `src/ui/styles/globals.css` | Global styles; `.pane-content-{bible,commentary,book,dictionary}` consume the typography CSS variables with per-pane override precedence, each multiplied by `--global-font-scale` via `calc()`. `body` consumes `--ui-font-family`/`--ui-font-size`/`--ui-line-height` as the UI chrome baseline. `.pane-header-title`/`.pane-header-subtitle`/`.pane-tab`/`.pane-tab-compact` size themselves from `--ui-control-font-size` - see [UI Control Font Size](#ui-control-font-size) for why a Tailwind `text-*` utility must never appear on those. |
| `src/ui/styles/dockview-overrides.css` | dockview chrome. `.dockview-tab-content` - the tab strip the user actually sees - sizes itself from `--ui-control-font-size` x `--global-font-scale`. |
| `src/ui/components/DockviewTabRenderer.tsx` | Renders each tab. Its sizes are **inline**, so they outrank any stylesheet; `controlScaled(px)` puts every one of them (title, icon, subtitle, close button, dropdown row) on `--ui-control-font-size` x `--global-font-scale`. |
| `src/ui/styles/themes.css` | Theme definitions (15 themes: light, dark, sepia, plus 12 decorative themes shared with `apps/web/src/themes/`) and default typography CSS variable values. Also styles `input[type=range]` (track + thumb, themed via `--theme-range-track`/`--theme-range-thumb`) and multiplies `--ui-control-font-size` by `--global-font-scale` for pane headers/tabs. |
| `src/ui/styles/themeTokens.ts` | Single authoritative list of the 15 selectable themes (`THEME_TOKENS`: id, sort order, dark/light polarity, `labelKey`/`descriptionKey`, 4-color preview swatch), plus `THEME_IDS`, the `ThemeId` union and `isValidThemeId()`, consumed by `usePreferencesStore.ts`'s `AVAILABLE_THEMES`. It does **not** hold the full CSS palette - that stays in `themes.css`. |
| `src/ui/styles/fonts.css` | `@font-face` declarations for the self-hosted families bundled under `src/ui/styles/fonts/`: Noto Serif, Merriweather, Crimson Text, Libre Baskerville (Latin, Latin-ext and, for Noto Serif, Greek subsets) and Ezra SIL. The files are bundled so the renderer needs no network at all - its CSP `style-src 'self'` blocks a Google Fonts `@import`. Regenerate with `node scripts/fetch-fonts.mjs`; licences are in `src/ui/styles/fonts/FONT-LICENSES.md`. Lora and EB Garamond are offered by `AVAILABLE_FONT_FAMILIES` but are not bundled, so they resolve only if installed locally and otherwise fall back through their stack to Georgia / serif. |
| `admin/brand/theme-palettes.json` (repo root) | The canonical palette for all 15 themes, shared with the web client. A string value is a colour both apps use; a `{ "web": ..., "desktop": ... }` object records one they deliberately render differently. `node scripts/generate-theme-vars.js` generates the web client's `_vars.scss` files from it; the desktop stylesheet is hand-written and checked against it instead (see `themePalette.test.ts` below). |

### Tests

| File | Description |
|---|---|
| `src/ui/stores/usePreferencesStore.test.ts` | Asserts theme/font-scale/typography changes land on `document.documentElement` live, and that `AVAILABLE_THEMES` is fully generated from `themeTokens.ts` |
| `src/ui/stores/usePreferencesStore.sessionPersistence.test.ts` | Session save/restore contract: full round trip through `getSessionData()`/`loadFromSession()`, the registered `'preferences'` serializer, and per-field fallback to defaults on missing/out-of-range/wrong-type saved data |
| `src/ui/stores/useTextSettingsStore.test.ts` | Asserts the `customized` tracking: a non-customized pane follows `syncFromTypography()`, an explicit Fonts-section edit detaches it, `resetSettings()` re-attaches it |
| `src/ui/stores/useTextSettingsStore.lineHeightDefaults.test.ts` | The store's own bootstrap defaults, before any `syncFromTypography()` call: `commentary`/`book`/`dictionary` start on the study tier's 1.6 line height, not the Bible tier's. Deliberately resets no state, so it exercises the real construction path the other two suites bypass |
| `src/ui/stores/useTextSettingsStore.sessionPersistence.test.ts` | Session save/restore contract for per-pane settings **and** the `customized` flags: full round trip, a partial `customizedData` object, an absent one, and per-field fallback on corrupt pane data |
| `src/ui/stores/paneFontLiveSync.test.tsx` | Component-level check that a pane consuming `useTextSettingsStore` (mirroring the real `BibleVerseList.tsx` / `*SinglePanel.tsx` inline-style pattern) re-renders live when the Typography section changes, and that an explicitly customized pane keeps its override |
| `src/ui/services/AppInitService.preferences.test.ts` | End-to-end `initializeApp()` test (every other store it touches mocked out) proving the actual startup path - not just the store methods in isolation - restores theme/typography/per-pane font settings, and that a session carrying no `customized` data leaves the Typography sliders live |
| `src/ui/styles/themeTokens.test.ts` | Structural agreement between `themeTokens.ts` and `themes.css`: every theme has a `[data-theme]` block defining every required CSS variable (including the range-slider tokens) |
| `src/ui/styles/themePalette.test.ts` | Holds `themes.css` to `admin/brand/theme-palettes.json`: for each of the 15 themes, the ten shared core colours (`bg-*`, `text-*`, `border-color`, `accent-color`, `accent-hover`, `christ-words`) must match the palette's desktop value. A failure means a shared colour moved on one side only |
| `src/ui/components/PreferencesDialog/GeneralSection.test.tsx` | The language picker: `selectableLocales()`'s allowlist behaviour (shipped drafts hidden, user-supplied and active locales kept), the disclosure starting collapsed while still naming the active language, and the draft badge surviving for a user-supplied draft |
| `src/ui/components/KeyboardShortcutsDialog.test.tsx` | Rendering, category headings, and close behaviour of the read-only shortcut list |
| `src/ui/styles/fontScaleConsumption.test.ts` | Text-level check that `--global-font-scale` is multiplied via `calc()` into `body`, every `.pane-content-*` rule, and `--ui-control-font-size`; **and** that the declarations which *win* the cascade for pane-header/tab text read `--ui-control-font-size` rather than a Tailwind `text-*` utility (see [UI Control Font Size](#ui-control-font-size)) |

## Session Persistence

Theme, global font scale, UI control size, and `TypographyPrefs` (via `usePreferencesStore`) and per-pane font settings plus the `customized` flags (via `useTextSettingsStore`) all survive an app restart through the same session mechanism documented in [sessions.md](./sessions.md).

**Save path.** Both stores register a session serializer (`registerSessionSerializer()` in `stores/helpers/sessionRegistry.ts`) rather than being imported directly by `useSessionStore`:

- `usePreferencesStore` registers `'preferences'` -> `getSessionData()` (`{ theme, globalFontScale, uiControlFontSize, typography }`).
- `useTextSettingsStore` registers `'textSettings'` -> the per-pane `TextSettings` map, and a separate `'textSettingsCustomized'` -> the `customized: Record<PaneType, boolean>` map.

`useSessionStore.getSessionData()` collects both into `SessionData.ui.preferences` / `ui.textSettings` / `ui.textSettingsCustomized` (see `packages/core/src/Data/Models/User/Session.ts`).

**Restore path.** `services/AppInitService.ts`'s `initializeApp()` calls `usePreferencesStore.getState().loadFromSession(sessionData.ui.preferences)` and `useTextSettingsStore.getState().loadFromSession(sessionData.ui.textSettings, sessionData.ui.textSettingsCustomized)` synchronously, as the very first thing it does once session data is available (no IPC round trip needed beyond the one already fetching the session) - before the async commentary/dictionary/bookmark loads - so the user's real theme/typography lands as early in startup as possible. When a session has no `ui.preferences` at all (a fresh profile), `usePreferencesStore.getState().applyAll()` is called instead, re-asserting the current (default) in-memory state onto the DOM rather than relying on it having already happened at module load.

Both `loadFromSession()` methods route through the exact same DOM-application functions a live edit uses (`applyThemeToDOM`/`applyTypographyToDOM`/etc., and `applyTypographyToDOM`'s call into `useTextSettingsStore.syncFromTypography()`) so restore and live-edit can never drift apart - see "Typography vs. per-pane Fonts precedence" below.

**Corrupt/missing data.** Every field is validated independently and falls back to its own default when missing, the wrong type, or out of range (e.g. an unrecognized theme id, a `NaN` font size, a font-family id no longer in `AVAILABLE_FONT_FAMILIES`) - a single bad field can never crash startup or leave a half-applied theme, and can never wipe out sibling fields that *were* valid in the same saved object.

**A pane the saved flags do not name is not customized.** `useTextSettingsStore.loadFromSession()` defaults every pane absent from the (possibly absent or partial) `customizedData` argument to `customized: false` - i.e. "follow the Typography section live" - never to `true`. Defaulting to `true` would silently detach a user's panes from Typography syncing on every restart, whether or not they had ever opened the Fonts section. `AppInitService.preferences.test.ts` and `useTextSettingsStore.sessionPersistence.test.ts` both pin this.

## Typography vs. per-pane Fonts precedence

Two sections both affect a pane's text: **Typography** sets *global* Bible/Study/UI values, and **Fonts** sets a *per-pane* override. Both write to the same CSS variables consumed by `globals.css`'s `.pane-content-*` rules (`var(--pane-font-size-bible, var(--bible-font-size, 20px))`), and an inline-set pane override always wins over the fallback - there is no way for that fallback chain to prefer the global value once a pane override is defined in the DOM.

`useTextSettingsStore`'s `customized: Record<PaneType, boolean>` flag is what decides which of the two a pane is listening to:

- A pane starts **not customized**. `usePreferencesStore.ts`'s `applyTypographyToDOM` (called from every typography-changing action, and once at module load) pushes the current Bible/Study values into `useTextSettingsStore.syncFromTypography()`, which updates every non-customized pane's `fontSize`/`fontFamily`/`lineHeight` live.
- Editing a pane's font family, size, or line height in the **Fonts** section (`PaneFontSettings.tsx` -> `updateSettings()`) marks that pane customized, detaching it from further Typography syncs. Toggling the Bible pane's "red letter" checkbox does **not** customize it - that setting is unrelated to which font tier the pane follows.
- **Reset to Defaults** in the Fonts section (`resetSettings()`) un-customizes the pane and reverts it to the last Typography values pushed in, so it resumes following live.
- `getFontFamilyCSS()` falls through to its input verbatim when it isn't a recognized `AVAILABLE_FONTS` name, since a non-customized pane's `fontFamily` is an already-resolved CSS stack from the Typography picker, not a name.

`--global-font-scale` (General section) is multiplied in by the consumers rather than by the store: `globals.css`'s `.pane-content-*` rules and `body`, and `themes.css`'s pane-header/tab rule, each wrap their font-size in `calc(... * var(--global-font-scale, 1))`. The Typography section's own "UI text" controls (`--ui-font-size`/`--ui-font-family`/`--ui-line-height`) are consumed by `body` in `globals.css` as the UI chrome's baseline typography; individual elements like pane tabs and headers override that via the coarser `--ui-control-font-size` from the General section.

## UI Control Font Size

The General section's "UI Control Font Size" slider (11-20px, default 14) writes `--ui-control-font-size` onto `document.documentElement`. Three things consume it, and all three have to keep consuming it for the setting to move anything on screen:

1. **The cascade.** `globals.css` `@import`s `themes.css` *above* `@tailwind components`. themes.css's `.pane-header, .pane-header-title, ... { font-size: calc(var(--ui-control-font-size) * var(--global-font-scale, 1)) }` is therefore emitted first, so any `font-size` re-declared at identical specificity in globals.css's own `@layer components` rules wins. The size is therefore declared in the rule that wins: globals.css's `.pane-header-title` / `.pane-header-subtitle` / `.pane-tab` / `.pane-tab-compact` each carry an explicit `font-size: calc(var(--ui-control-font-size, 14px) * <ratio> * var(--global-font-scale, 1))` and no `text-*` size utility. The ratios set the hierarchy: title `1.0`, subtitle `0.857`, the same shape as `uiScaled()` in `StudyPane.tsx` and `--ui-font-scale`. **Do not put a `text-*` size utility on those four selectors.**
2. **The real tab strip is dockview's.** Live tabs are rendered by `DockviewTabRenderer.tsx` as `.dockview-tab-content` and styled in `dockview-overrides.css`, whose rule reads the variable. The stylesheet alone is not enough: `DockviewTabRenderer.tsx` sizes its whole tab **inline** (title, icon, subtitle, close button, dropdown row) and an inline declaration outranks any selector, so every one of those goes through `controlScaled(px)` in that component - the same ratio trick as `uiScaled()` in `StudyPane.tsx` - and the hierarchy survives at any slider position. With the component and the stylesheet agreeing, the CSS rule needs no `!important`. **Do not put a literal `fontSize: '<n>px'` back into that component.**
3. **`.pane-tab` / `.pane-tab-compact` have no markup.** No component renders those classes; the live tab strip is dockview's. The rules are kept consistent with the ones above only so `fontScaleConsumption.test.ts` has a complete set to check. If they are ever removed, remove them from that test in the same change.

`fontScaleConsumption.test.ts` guards all of this. It is a text-level check (jsdom under vitest runs neither PostCSS nor the real cascade), so it asserts the *winning* declaration specifically: the globals.css rule must reference `--ui-control-font-size`, its `@apply` list must contain no font-size utility, `dockview-overrides.css` must contain no literal `font-size: <number>`, and `DockviewTabRenderer.tsx` must contain no literal `fontSize: '<n>px'`.

## Language section

The Language block is a disclosure, **collapsed by default**, matching `PaneFontSettings.tsx` (the dialog's only other collapsible). It is the first control in the first tab, and a stray click on a row would otherwise switch the whole interface - potentially into a language the user cannot read well enough to switch back from. The collapsed header still shows the active language's endonym, so the disclosure hides the *choice*, never the state.

Which languages are offered is decided by `SELECTABLE_BUILT_IN_LOCALES` in `GeneralSection.tsx` - see [Localization](localization.md#language-picker).

## Range slider styling

Every `<input type="range">` in this dialog carries Tailwind's `appearance-none` utility, which strips **all** native rendering, track included - so `accent-color` has no effect on these controls and cannot be used to theme them. `themes.css` styles `input[type=range]` directly via `::-webkit-slider-runnable-track`/`::-webkit-slider-thumb` and `::-moz-range-track`/`::-moz-range-thumb`, referencing the per-theme `--theme-range-track`/`--theme-range-thumb` variables, which works consistently across engines and themes. The Bible-pane "red letter" checkbox keeps its `accentColor` inline style: checkboxes are not reset with `appearance-none` and still benefit from it.

## Themes

15 themes are selectable: **light**, **dark**, **sepia**, **arctic**, **autumn**, **forest**, **lagoon**, **meadow**, **midnight**, **ocean**, **parchment**, **rose**, **slate**, **sunrise**, **sunset**. Each is selectable in the Themes section with a live preview, and carries a `labelKey`/`descriptionKey` (`ui.preferences.theme<Name>Label`/`...Description` in `locales/en/ui.json`) - never inline English.

**Where a theme is defined, and why it is split across files.** `styles/themeTokens.ts` is the one list of selectable themes (id, order, `isDark`, catalog keys, and a 4-color preview swatch) - `usePreferencesStore.ts`'s `AVAILABLE_THEMES` and its `ThemeId` type are generated from it rather than hand-duplicated. The runtime CSS palette a theme needs (~143 variables: surfaces, status colors, morphology colors, pane headers, tabs, links, range slider, ...) lives in `themes.css` as plain `[data-theme]` blocks, because that is what the rest of the app's stylesheets consume (`rgb(var(--theme-bg-primary-rgb))`) and there is no build step in this package that generates CSS from TypeScript.

The same 15 themes also exist in the web client, at a much smaller 21-token surface. `admin/brand/theme-palettes.json` at the repo root is the single place the shared colours are written down:

- The web client's `apps/web/src/themes/<id>/_vars.scss` files are **generated** from it by `node scripts/generate-theme-vars.js` (`--check` verifies rather than writes).
- `themes.css` is hand-written - its token set is far larger and mostly derived - and is **checked** against the palette by `styles/themePalette.test.ts`. The ten core colours (`bg-primary/secondary/tertiary`, `text-primary/secondary/muted`, `border-color`, `accent-color`, `accent-hover`, `christ-words`) must match the palette's desktop value for every theme.
- Where the two apps intentionally render a colour differently, the palette records it as `{ "web": ..., "desktop": ... }` rather than letting the two stylesheets disagree silently. Replacing such an object with a single string unifies that colour across both apps.

Desktop's much larger token surface is **derived** from that core palette by one consistent set of formulas, applied identically to the 12 decorative themes (documented in each theme's block comment in `themes.css`). Status colors (danger/success/warning/info) and morphology colors specifically are reused **wholesale** from the light/dark blocks rather than hand-tuned per theme - accessibility-auditing a bespoke status/morphology palette for 12 additional themes is out of scope. Pane headers, tabs, links, Strong's numbers, footnote/cross-reference markers, and the range slider derive from the theme's own bg/text/border/accent/info tokens via `rgb(var(--theme-*-rgb))`, so there is nothing hand-picked to keep in sync for those categories.

Adding a 16th theme means: a `[data-theme]` block in `themes.css`, an entry in `THEME_TOKENS`, a `labelKey`/`descriptionKey` pair in `locales/en/ui.json`, and an entry in `admin/brand/theme-palettes.json`.

## Localization

Nothing in this dialog is an English literal. Two rules keep it that way.

**Store constants hold keys, never text.** `AVAILABLE_THEMES` has `labelKey`/`descriptionKey`; `AVAILABLE_FONT_FAMILIES` and `AVAILABLE_FONTS` have an optional `labelKey`; `SECTIONS` has `labelKey`. Each is resolved with `t()` inside the component that renders it, because these modules are evaluated once at import - before the user's locale is restored - so resolving there would freeze whichever locale happened to be active first.

**Typeface names are proper nouns.** `Georgia`, `Merriweather`, `EB Garamond` stay Latin in every locale. Only the prose wrapped around them is a key, which is why `preferencesDialog.fontDefaultLabel` is `{fontName} (Default)` and takes the face name as a parameter, and why only the `system` entry of `AVAILABLE_FONT_FAMILIES` carries a `labelKey`.

| Key | What it labels |
|---|---|
| `preferencesDialog.title`, `.done`, `.sectionsNavLabel` | dialog heading, footer button, tablist accessible name |
| `preferencesDialog.sectionGeneral` ... `.sectionDiagnostics` | the six sidebar sections |
| `preferencesDialog.fontsIntro` | Fonts intro; takes `{percent}` |
| `preferencesDialog.paneFontLabel` | `{paneName} Pane` - the frame around a pane's bare noun |
| `preferencesDialog.fontSampleBible` / `Commentary` / `Book` / `Dictionary` | the four font samples |
| `preferencesDialog.fontSystemDefault`, `.fontDefaultLabel` | the two non-typeface font labels |
| `preferencesDialog.uiControlPreview` | the UI-control size preview line |
| `paneName.*` | pane names, shared with the dockview tab strip |
| `ui.preferences.theme<Name>Label` / `.theme<Name>Description` | one pair per theme (`ui.preferences.themeLightLabel` ... `themeSunsetDescription`) - see [Themes](#themes) |

The Bible font sample and the typography preview line both quote **John 3:16**, and every locale must use a **public-domain** translation there - each locale's `meta.json` `locale.notes` records which edition and which copyrighted editions must not be substituted, and `hi` deliberately quotes no Scripture at all. See [`locales/README.md`](../../locales/README.md) before editing either.
