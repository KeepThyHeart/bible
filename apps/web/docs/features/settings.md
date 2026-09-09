# Settings & Appearance

**Last verified:** 6e80a84 (2026-09-04)

Theme selection, font customization, display options, and offline management, all persisted to localStorage.

## Files

### Components

| File | Description |
|---|---|
| `src/components/Dialogs/SettingsPanel.tsx` | Modal settings panel with left-tab navigation (Text Size, Theme, Modules, Gestures, Offline, About) |

### Theme System

| File | Description |
|---|---|
| `src/themes/*/theme.json` | Per-theme metadata: id, name, group, order, isDark, swatch colors, CSS variable values |
| `src/themes/*/_vars.scss` | Per-theme CSS custom property blocks (`[data-theme="<id>"] { ... }`). **Generated** — see below |
| `admin/brand/theme-palettes.json` | Canonical palette for all 15 themes, shared with the desktop app -- which is why it sits with the brand assets rather than under `apps/web/` |
| `scripts/generate-theme-vars.js` (repo root) | Regenerates `_vars.scss` from the palette; run via `npm run generate:theme-vars`. `npm run check:theme-vars` (`--check`) verifies they are current |
| `src/themes/themeRegistry.ts` | Build-time theme discovery via Vite glob import; exports `THEME_LIST`, `THEME_IDS`, `isValidTheme()`, `getThemeById()` |

### State

| File | Description |
|---|---|
| `src/stores/settingsStore.ts` | All settings with localStorage persistence; theme applied immediately via `data-theme` attribute; sets `data-dark-theme` for dark themes |
| `src/stores/offlineStore.ts` | Offline mode state: enabled flag, downloaded modules list, download progress, online/offline detection |

### Providers

| File | Description |
|---|---|
| `src/providers/OfflineStorageManager.ts` | Manages OPFS storage: module downloads with progress, remove, read, storage quota reporting |

## Settings

### Appearance
- **Theme**: Auto (system), Light, Dark, Sepia, plus 12 decorative themes (discovered at build time from `src/themes/` folders). Displayed as a swatch grid with color previews.

**Theme colours are shared with the desktop app.** The same fifteen themes are also defined in the desktop app's `apps/desktop/src/ui/styles/themes.css`. Twelve are identical in both; light, dark and sepia had drifted into genuinely different colours. `admin/brand/theme-palettes.json` is the one place those colours are written down: a plain string is shared by both apps, while `{ "web": ..., "desktop": ... }` records a colour the two intentionally render differently.

To change a theme colour, edit the palette and run `npm run generate:theme-vars` (never edit `_vars.scss` by hand — it is overwritten). `npm run check:theme-vars` fails if they are stale, and `themePalette.test.ts` in the desktop package fails if the desktop stylesheet drifts from the palette. To add a theme, add it to the palette and create the matching `theme.json`.
- **UI Font Size**: 12-20px slider

### Text Size
- **General +/- control**: Adjusts Bible, Study, and UI font sizes in tandem (±2px per click)
- **Reset Text Sizes**: `settingsStore.resetTextSettings()` — restores just `fontSize`, `studyFontSize`, `uiFontSize`, `lineHeight`, `studyLineHeight`. Distinct from "Reset All" on the Theme tab, which also throws away the theme and font scheme
- **Words of Christ in Red**: toggle checkbox
- **Interlinear Layout**: `stacked` — "Stacked (word columns)", **the default** — or `inline` — "Inline (in parentheses)", prose with each word's original-language form in a parenthetical. Stored as `settingsStore.interlinearLayout` and validated on load (anything else falls back to the default). The same choice is also offered inline, next to each interlinear, by `InterlinearLayoutToggle`. See [Interlinear & Strong's → Layouts](interlinear-strongs.md)
- **Advanced** (collapsible): Individual sliders for Bible Text (12-48px), Study Text (12-36px), UI Text (10-24px), Bible Line Height (1.2-2.5), Study Line Height (1.2-2.5). Each has a − and a + on either side of the slider, stepping 1px (sizes) or 0.1 (line heights). The five rows are generated from one `advancedTextControls` array in `SettingsPanel.tsx`

**Why the +/- buttons never move.** The row is `label line` + `[−][slider][+]`.
The value sits in the label line in a fixed-width, tabular-figures cell
(`.settings-panel__stepper-value`), never between the buttons; the buttons are
fixed 26px boxes anchored to the ends of a full-width flex row and the slider
takes the remainder. So nothing about the button positions depends on whether
the value reads `9px`, `10px` or `100px`.

**Why the dialog does not reflow mid-edit.** Almost every rule in
`_settings.scss` is `calc(Npx * var(--ui-font-scale))`, so dragging the UI Text
slider used to resize the panel under the pointer. `SettingsPanel` now pins
`--ui-font-scale` on the `.settings-panel` element itself to whatever it read
from `<html>` when the panel opened, re-reading on each open — so a reader who
works at 20px UI text still gets a 20px panel, but it holds still while they
edit.

### Study text size and the Study pane

`studyFontSize` is published as two custom properties on `<html>` by
`settingsStore.applyStudyFontSize()`, mirroring `applyUiFontSize()`:

| Property | Meaning |
|---|---|
| `--study-font-size` | The px size. `.main-layout__right-pane` sets its `font-size` from it, so everything inheriting (commentary prose, quoted verse text) follows |
| `--study-font-scale` | `studyFontSize / 15` (the default), so every existing px literal renders unchanged until the reader moves the setting. Study-pane **content** rules multiply by it |

An inline `font-size` on the right-pane container cannot do this on its own.
Nearly every element in the Study pane sets an absolute
`calc(Npx * var(--ui-font-scale))`, which overrides an inherited size everywhere
except commentary prose — so "Study Text" would appear to move Commentary and
nothing else, while "UI Text" moved everything. The variables are the single
mechanism.

**Content vs chrome.** Rules that render module data — topic names and
descriptions, verse reference lists and verse text, dictionary entry headwords
and definitions, interlinear word cards, footnotes, commentary and topic cards,
search result rows, and the inline group labels over them — use
`--study-font-scale`. Rules for the pane's fixed furniture — the right-pane tab
strip, study/section/pin headers, the dictionary tab and nav bars, toolbars,
search inputs and their dropdowns, the alphabet bar, sort/filter controls, the
mobile study tab bar, breadcrumb and verse header — stay on `--ui-font-scale`.
Affected files: `_study-pane.scss`, `_mobile-study.scss`, `_search.scss`,
`_right-pane.scss`. `_commentary.scss` needed no change: its prose already
inherits and everything sized in it is chrome.

### Font Scheme (Theme tab)
- **Font family**: twelve schemes in `FONT_SCHEMES` (`src/stores/settingsStore.ts`), split into `recommended` — Classic (Georgia), Lora, Merriweather, Crimson Pro, Libre Baskerville — and `other` — Times, Modern (Sans-Serif), EB Garamond, Playfair Display, Cormorant Garamond, Spectral, Book Antiqua. Each scheme names a heading font and a content font separately. The eight webfonts are self-hosted: `scripts/fetch-fonts.mjs` downloads them into `public/fonts/` (gitignored) and generates the `fonts.css` that `index.html` links at `/fonts/fonts.css`; the rest are system faces
- A deployment can restrict the list: `settingsStore.getVisibleFontSchemes()` filters by `visibleFonts` from `/api/config`, and `getVisibleThemeIds()` does the same for themes
- Study pane font family follows the selected font scheme

### Gestures
- **Swipe to change chapters**: toggle, plus px thresholds for the chapter swipe (Bible pane) and the verse swipe (Commentary pane)
- The tab's strings were hardcoded English fallbacks in `SettingsPanel.tsx`; they now live under `settings.gestures.*` / `settings.tabs.gestures` in `src/locales/en/ui.json` so they can be translated

### Offline

**The Offline tab is hidden unless the server enables it.** `TAB_ITEMS` is
filtered on `settingsStore.serverOfflineDownloads`, which `main.tsx` sets from
`/api/config`'s `offlineDownloads` — itself `features.offlineDownloads === true`
in `site-config.json`, and **false by default** (`server/SiteConfig.ts`).

- **Enable offline mode**: toggle checkbox
- **Online/offline status**: green/red dot indicator with storage usage
- **Bible Translations**: download cards with progress bars for each available module
- **Semantic Search Index**: download card for the browser-optimized embeddings DB

## Help & feedback

| File | Description |
|---|---|
| `src/components/Dialogs/HelpDialog.tsx` | Help dialog. Fetches `/api/config` on open and, when the deployment sets `docsUrl`, shows a prominent link to the documentation website at the top of the body (`target="_blank" rel="noopener noreferrer"`). With no `docsUrl` it renders nothing rather than a dead link. Also carries the "Send feedback" entry point |
| `src/components/Dialogs/FeedbackDialog.tsx` | Feedback form — message (required), optional category (bug / idea / other), optional contact. Posts to `POST /api/feedback`; submit is disabled in flight and the typed message survives a failed send so it can be retried |

`docsUrl` is a top-level key in `site-config.json` (see
`config/site-config.schema.json`), whitelisted into the client payload by
`SiteConfig.getClientConfig()` exactly like `repoUrl`.

The feedback entry point is in the Help dialog on every device, plus a header
icon on **desktop only** (`Header`'s `onFeedbackClick`, passed by `DesktopApp`
and not by `MobileApp`) — the mobile action row is already four buttons wide on
a narrow phone.

## Key Behaviors

- Left sidebar tab navigation (Text Size, Theme, Modules, Gestures, Offline, About) — `SettingsTab` in `SettingsPanel.tsx`; Offline is conditional (above)
- Tab auto-selected based on `scrollToSection` prop
- ESC or click outside closes the panel
- Offline tab fetches storage info and semantic index availability on open
- Module downloads show thin progress bar under the card
- Downloaded modules show green checkmark with remove option
