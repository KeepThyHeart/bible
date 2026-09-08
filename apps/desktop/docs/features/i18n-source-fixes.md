# Source-side i18n rules

**Last verified:** 2026-09-08

Some i18n defects live in **English source strings and their call sites**, not in any translation. A call site that assumes English grammar, English word order, or English text outright cannot be rescued by translation quality: the source has to change. This is the set of rules the desktop source follows, the reasoning behind each, and the known places where it does not yet hold.

For the catalog layout, the service API and the RTL conventions, see [`localization.md`](localization.md). Translator-facing guidance is in [`../../locales/README.md`](../../locales/README.md) and [`../../locales/GLOSSARY.md`](../../locales/GLOSSARY.md).

---

## One ICU message per sentence

The pattern to avoid is a sentence assembled at render time from two or three translated pieces with markup between them:

```tsx
<kbd>Enter</kbd> {t('searchBar.toSearch')}
```

English works because the key name comes first and the verb phrase follows. That ordering is not universal:

* **Hindi** is verb-final, and the postposition has to attach to the key name. The verb cannot appear where English puts it.
* **Arabic** is RTL, so an LTR `<kbd>` spliced into an RTL run needs bidi isolation or the line visually scrambles.
* **Russian** requires case agreement the fragment boundary hides.

Spanish survives all of these, which is exactly why a Spanish-only pilot does not catch them. The rule is **one ICU string per message, with the variable part as a placeholder** - `"{key} to search"` - so the translator controls the whole word order.

Hindi shows the payoff directly:

| Key | en | hi |
|---|---|---|
| `searchBar.hintSearch` | `{key} to search` | `खोजने के लिए {key} दबाएँ` |

The placeholder moves. Under a fragment scheme it cannot.

The search-bar hints are the worked example: `searchBar.hintSearch`, `hintClear`, `hintCommands`, `hintNavigateToReference` and `commandModeHints` are each one whole message, rendered by `TopSearchBar.tsx` and `TopSearchBarDropdown.tsx`. `searchBar.enterKey` / `escKey` / `tabKey` exist only as the keycap *labels* - key names stay English because that is what is printed on the keyboard. `liveSearchSuggestions.hints` does the same job for `LiveSearchSuggestions.tsx`, and `documentationDialog.footerPressToClose` for the documentation footer. All of these live in `locales/en/ui.json`, not in `searchBar.json`, which holds only the placeholder and mode strings.

### Separators belong to the translator

A hardcoded `", "` or `" - "` between fragments is the same defect one level down. `searchBar.commandModeHints` carries its own separators, so `zh-Hans` can use `，` and `ar` can use `،`. `ui.moduleSelector.resultsHint` likewise: `es` and `pt-BR` use `·`, `ru` uses `—`, `zh-Hans` uses `，`.

## How a placeholder renders as markup

`II18nService.t()` returns a `string`, and the app has no rich-text i18n layer. The only other markup-in-string mechanism is `sanitizeHtml` + `dangerouslySetInnerHTML` in the documentation block renderer, which cannot carry a styled React element such as the `<kbd>` keycap.

Rather than a second i18n mechanism, [`src/ui/utils/tElements.tsx`](../../src/ui/utils/tElements.tsx) keeps the ICU string whole and splits the **formatted** result at the placeholder:

```tsx
{tElements(t, 'searchBar.hintSearch', {
  key: <kbd dir="ltr" className="...">{t('searchBar.enterKey')}</kbd>,
})}
```

Each element placeholder is formatted as a NUL-delimited sentinel and the output is split on it. Substituting *through* ICU rather than string-replacing the raw message matters: ICU escaping (`''`), plural/select branches and any co-occurring text placeholders keep working exactly as `locales/README.md` documents. NUL cannot survive JSON parsing into a catalog value, so the sentinel is unambiguous.

Every keycap carries `dir="ltr"`. That is load-bearing, not cosmetic: HTML's default `[dir] { unicode-bidi: isolate }` is what stops a Latin key name from re-ordering the Arabic run around it.

## The catalog owns the plural

Never form a plural in source - not by appending `s`, not with a ternary, and not through a helper that takes an English fallback. Every count goes through `t(key, { count })` against an ICU plural message.

`ui.moduleSelector.resultsHint` is the reference case:

```
{count, plural, one {# result} other {# results}} - Use {navKeys} arrows to navigate, {enterKey} to select
```

`ru` uses all four of its plural categories (`1 результат` / `2 результата` / `5 результатов`), `ar` all six including the dual `نتيجتان`, and `zh-Hans` a plain `{count}` because Chinese has one category. `hi` also uses a plain `{count}`: Hindi has two categories but *परिणाम* does not inflect, so a two-branch block with identical branches would be noise. `ui.moduleSelector.openCount` is a real plural in `es`, `pt-BR`, `hi` and `ar`; `ru` uses the invariant `(открыто: {count})`, which is what Russian UIs actually write and which avoids agreeing an adjective with an unstated noun.

`searchResultsPane.resultCount`, `.semanticMatchCount` and `diagnosticsSettings.deleteAllConfirm` are the same shape. A source-side helper that carries an English fallback is worse than no helper: it applies English plural rules in exactly the case it exists to cover, a locale whose catalog has not finished loading.

Note that `naiveFormat` - the pre-ICU-load fallback inside `I18nService.ts` - only substitutes bare `{name}` placeholders. A message that must render correctly on the very first paint cannot rely on ICU features.

## Resolve at render, never at module load

A module body runs once, at import, almost always before the user has chosen a locale. Calling `t()` there freezes whichever locale happened to be active first. So a constant that describes a user-visible string stores a **key**, and the component resolves it: `AVAILABLE_THEMES` (`labelKey` / `descriptionKey`, resolved in `ThemesSection.tsx`), `AVAILABLE_FONT_FAMILIES` and `AVAILABLE_FONTS` (`labelKey`, resolved in `TypographySection.tsx` and `PaneFontSettings.tsx`), and `sectionDefs.tsx`'s `SECTIONS` (`labelKey`, resolved in `PreferencesDialog.tsx`). The full table is in [`localization.md`](localization.md#english-data-in-modules-resolve-at-render-never-at-import).

Typeface **names** are proper nouns and stay Latin, which is why `preferencesDialog.fontDefaultLabel` is `{fontName} (Default)` and takes the name as a parameter rather than being written out per locale. Theme names are in `GLOSSARY.md`; the one that needed a decision is **Sepia**, which most languages borrow (*Sépia*, *Сепия*, *सेपिया*, *سيبيا*) but Chinese renders as 棕褐色.

## Persist the canonical English label, localize on render

Dockview is the sharper version of the same trap: `api.addPanel({ title })` writes the title into the **serialized layout**, so a title resolved at creation time is not merely frozen for the session, it is persisted to disk. Creating a Commentary pane while Arabic is active must not write `التفسير` into the layout file, because `localizePaneLabel` matches generic English and could never translate it again, even after switching back.

So `src/ui/utils/paneNames.ts` supplies `PANE_NAME_KEYS`, `genericEnglishTitle()` and `localizePaneLabel(t, contentType, stored)`. Creation sites (`NewTabPage.tsx`, `LayoutPresetService.ts`, `useLayoutStore.ts`, `bible/revealDictionaryPanel.ts`) pass `genericEnglishTitle()`; render sites (`DockviewTabRenderer.tsx` for both title and subtitle, `DockviewWatermark.tsx`) call `localizePaneLabel`. A content-derived title (`John 3`, `Matthew Henry`) is data and passes through untouched. `paneNames.test.ts` asserts the round trip for every pane type, so what gets written to disk is always something that can later be localized.

Do not apply English casing rules to a stored string either - not `charAt(0).toUpperCase()`, not `toLowerCase()`. German nouns, Turkish dotted/dotless `i`, and every script without case at all.

## Pane names are bare nouns, passed as nested catalog references

An ICU parameter may be a primitive **or** a catalog reference. `I18nService.resolveParams` walks the params object and resolves anything matching `isLocalizedKey` (`{ key, params? }`) to a string before ICU sees it, recursing through `resolve()` -> `t()`; `formatWithIcu` additionally flattens a non-string `format()` result, because `intl-messageformat` returns an *array* rather than a string whenever an argument is not a primitive, and an array reaching `CommandRegistry.query`'s `.toLowerCase()` takes the renderer into the ErrorBoundary. Anything else non-primitive is coerced with `String()`, so do not pass arbitrary objects.

`src/ui/commands/layoutCommands.ts` uses it for `layout.applyPreset.title`, and `FontsSection.tsx` for `preferencesDialog.paneFontLabel`:

| Locale | `preferencesDialog.paneFontLabel` |
|---|---|
| en | `{paneName} Pane` |
| ru | `Панель «{paneName}»` |
| ar | `جزء «{paneName}»` |
| zh-Hans | `{paneName}窗格` |

The pane names themselves (`paneName.*`, ten of them: `bible`, `commentary`, `book`, `dictionary`, `notes`, `prayer`, `search`, `study`, `topics`, `newTab`) are **bare nouns** rather than whole phrases - "Bible", not "Bible pane" - so that the word for *pane* stays inside the surrounding message, where a language that inflects can inflect it. Every locale needing case agreement frames the name appositively, so the citation form is always what the placeholder should receive. See the **Pane names** table in `GLOSSARY.md`, including the trap that the Book pane means a *study book*, not a book of the Bible (`书籍` not `书卷`, `كتاب` not `سفر`).

## Scripture and product name inside UI strings

Sample text that quotes Scripture goes in the catalog, never in source, and **every locale quotes a public-domain edition**, per the rule in `locales/README.md`. Each locale's `meta.json` `locale.notes` records which edition its samples use and which copyrighted editions must not be substituted; `hi` deliberately quotes no Scripture at all, and its samples are plain prose. `locales/README.md` carries a table of every key that embeds Scripture (`ui.preferences.themePreviewLine1` / `Line2`, `preferencesDialog.typographyPreviewLine`, `preferencesDialog.fontSampleBible`), so a new one cannot be added without going past the licence rule.

The product name is a placeholder, not a literal: `documentationDialog.footerVersion` is `{productName} · Version {version}`, and `gettingStarted.welcome`, `search.intro`, `copyExport.intro` and `tips.intro` all take `{productName}`. No IPC is needed for it - `electron/preload.ts` exposes `window.electron.appConfig`, and `src/ui/config/appConfig.ts` reads it with a build-time-define fallback (`__BIBLE_APP_VERSION__`, from `BIBLE_APP_VERSION`) for windows whose preload has not landed. When `appVersion` is empty the footer prints the product name alone rather than a dangling "Version".

## Known limitations

* **`BiblePaneOverlays.tsx` hardcodes the module-selector title.** `title={versionSelectorTabId ? "Switch Bible Version" : "Select Bible Translation"}` - two English literals with no catalog keys. It is the last `<ModuleSelector>` call site not fully localized; `CommentaryPane.tsx`, `DictionaryPane.tsx` and `BookPane/BookModuleSelectorModal.tsx` all pass `t()` results, and this file's own `emptyMessage` already does.

* **Strings that name a physical direction.** Several keys say "left"/"right" in prose: `layout.studyMode.description` ("Bible on the left, study tools on the right"), `documentationDialog.gettingStarted.layoutItem1` / `layoutItem2`, `documentationDialog.biblePane.navItem2`, and the six split labels `bookPane.splitRight` / `splitDown`, `commentaryPane.splitRight` / `splitDown`, `ui.dockviewTab.splitRight` / `splitDown`. These are **correct today**, because the dockview grid does not mirror in RTL - see [`localization.md`](localization.md#strings-that-name-a-physical-direction) for the rule that decides which such strings are bugs. If pane geometry ever mirrors, this whole family must be reworded to logical terms in one change.

* **`rightPane.expandTitle` / `collapseTitle` are dead keys.** They exist in all eight locale directories and nothing in `src/`, `electron/` or `e2e/` references `rightPane.` at all. They should be deleted from every catalog.

* **The font-size bounds are duplicated.** `PaneFontSettings.tsx` writes `14` and `30` inline in four places - the slider's `min`/`max` and the two end labels - so the input and its labels can drift apart.

* **Decimal separator in `ui.preferences.lineHeightValue`.** The value is pre-formatted with `Number.toFixed(2)`, so `1.75` keeps a full stop in locales that write `1,75`. Passing the number and using an ICU number skeleton would fix it, but `naiveFormat` would print the skeleton verbatim on first paint. Worth doing together with teaching `naiveFormat` to strip argument types.

## Finding violations

* `scripts/i18n-extract.js` fails on likely user-facing English in JSX text, a whitelist of JSX attributes, and `alert` / `confirm` / `toast` / `dialog.showMessageBox` arguments.
* `node scripts/find-untranslated-strings.js` from the repo root is a broader inventory (rules `jsx-text`, `jsx-attr`, `obj-prop`, `prose`, `tf-fallback`); it always exits 0, so read the report rather than trusting the exit code.
* `scripts/i18n-validate.js` fails on any key present in `en/` but missing from another locale.
