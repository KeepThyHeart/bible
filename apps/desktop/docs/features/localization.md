# Localization (i18n)

**Last verified:** 2026-09-08

All user-visible strings are resolved through `II18nService` against flat, dotted-key JSON catalogs in `apps/desktop/locales/`. ICU MessageFormat is used for placeholders and plurals, loaded lazily.

**Translator-facing documentation lives in [`../../locales/README.md`](../../locales/README.md); terminology decisions live in [`../../locales/GLOSSARY.md`](../../locales/GLOSSARY.md).** Read those before editing any catalog.

## Shipped locales

Every folder under `apps/desktop/locales/`, with the `locale.status` / `locale.direction` from its own `meta.json`:

| Locale | Status | Dir | Notes |
|---|---|---|---|
| `en` | complete | ltr | Source of truth |
| `ar` | **draft** | **rtl** | Arabic - the locale the RTL work was done against |
| `es` | **draft** | ltr | Spanish |
| `hi` | **draft** | ltr | Hindi - quotes **no** Scripture at all (see its `locale.notes`) |
| `pt-BR` | **draft** | ltr | Portuguese (Brazil) |
| `ru` | **draft** | ltr | Russian |
| `zh-Hans` | **draft** | ltr | Chinese (Simplified) |
| `xx-pseudo` | draft (generated) | ltr | Dev-only pseudo-locale for spotting unlocalized strings |

Every non-`en` folder except `xx-pseudo` is machine-drafted and carries a `locale.notes` recording which public-domain Scripture edition its samples quote. New folders are added independently of this document; the direction plumbing picks up whatever is present, so the table may lag the directory. See **Right-to-left (RTL)** below.

**Shipped does not mean selectable.** Every catalog here is loaded and usable, but the pickers currently offer only `en` out of the built-in set, because the rest are machine-drafted. See [Which locales are offered](#which-locales-are-offered).

## Files

| File | Purpose |
|---|---|
| `src/ui/services/II18nService.ts` | Service interface. Also defines `LocaleStatus`, `LocaleDirection`, and `LocaleMetadata`. |
| `src/ui/services/I18nService.ts` | Implementation: catalog merge, en fallback, lazy ICU formatting + formatter cache, locale metadata resolution. |
| `src/ui/services/I18nService.test.ts` | Unit tests, including locale-metadata behavior. |
| `src/ui/services/LocaleCatalogLoader.ts` | Renderer-side loader; pulls built-in and user catalogs over the IPC bridge at startup. |
| `src/ui/services/localeCatalogsReady.ts` | `whenLocaleCatalogsReady()` / `catalogsReady` - the one-shot signal that the loader has finished. `loadCatalog()` fires no event of its own, so a component that must see every locale (the first-run picker) gates on this rather than reading `availableLocaleInfos` while only the statically-bundled `en` has landed. |
| `src/ui/types/LocalizedString.ts` | The `LocalizedString` union and `isLocalizedKey()` that `I18nService.resolve()` consumes. |
| `src/ui/contexts/useI18n.ts` | React hook returning `{ i18n, locale, t }`; re-renders on locale change. |
| `src/ui/contexts/useDirection.ts` | `useDirection()` / `useIsRtl()` - reactive writing direction of the active locale. |
| `src/ui/utils/documentDirection.ts` | Binds `<html dir>`/`<html lang>`; persists and restores the chosen locale. |
| `src/ui/utils/textDirection.ts` | Content (module-language) direction, independent of the UI locale. |
| `src/ui/testing/enCatalog.ts` | Test-only. Loads the real `en/` catalogs so a component test can assert the wording a user reads rather than a key. |
| `src/ui/utils/paneNames.ts` | `PANE_NAME_KEYS` + `localizePaneLabel()` - the catalog key for each pane's name, and the rule that turns a dockview panel's *persisted* English title into a localized one at render time. |
| `src/ui/components/PreferencesDialog/GeneralSection.tsx` | The Preferences language picker. Also owns `BUILT_IN_LOCALES`, `SELECTABLE_BUILT_IN_LOCALES` and `selectableLocales()` - the single gate on which shipped locales either picker offers. |
| `src/ui/components/onboarding/LanguageFirstRun.tsx` | The first-run language question. Filters through the same `selectableLocales()`, and skips the question entirely when it leaves one language. |
| `electron/ipc/i18nHandlers.ts` | Main-process handlers that enumerate and read catalog files from the app bundle and from `<userData>/locales/`: `i18n:listBuiltinCatalogs`, `i18n:readBuiltinCatalog`, `i18n:listUserCatalogs`, `i18n:readUserCatalog`, and `i18n:setLocale` from the renderer. |
| `electron/preload.ts` | Exposes those five channels to the renderer, which is what `LocaleCatalogLoader` calls. |
| `electron/services/MainI18n.ts` | Synchronous `t()` for the **main process** - native dialogs, detached window titles, the About box. Loads the same catalogs at startup; no ICU. |
| `locales/en/main.json` | Strings the main process renders. |
| `locales/en/menu.json` | The application menu bar. Its own namespace because menu wording differs from the command-palette wording for the same command. |
| `locales/<bcp47>/*.json` | The catalogs themselves. |
| `locales/<bcp47>/meta.json` | Per-locale metadata (see below). |
| `scripts/i18n-validate.js` | Exits non-zero on any key present in `en/` but missing elsewhere; extra keys are a warning only. |
| `scripts/i18n-pseudo.js` | Regenerates `locales/xx-pseudo/` from `locales/en/`. Skips `meta.json`. |
| `scripts/i18n-extract.js` | Heuristic linter over `src/ui/` and `electron/`, exiting non-zero on likely user-facing English: JSX text nodes, a whitelist of JSX attributes (`title`, `placeholder`, `aria-label`, `alt`, `label`, `tooltip`), and `alert` / `confirm` / `toast` / `dialog.showMessageBox` arguments. |
| `../../../../scripts/check-translations.js` | Repo-level coverage report across the desktop and web catalog roots; prints each locale's draft status. |

Test coverage beyond `I18nService.test.ts`: `src/ui/services/localeCatalogsReady.test.ts`, `src/ui/utils/documentDirection.test.ts`, `src/ui/utils/textDirection.test.ts`, `src/ui/utils/paneNames.test.ts`, `electron/services/MainI18n.test.ts`.

## Locale metadata and draft status

Each locale folder carries a `meta.json` with flat `locale.*` keys:

```json
{
  "locale.name": "Spanish",
  "locale.nativeName": "Español",
  "locale.status": "draft",
  "locale.direction": "ltr"
}
```

It is deliberately a normal catalog namespace, so the existing catalog IPC bridge loads it with no main-process changes and a user can add a language by dropping a folder into `<userData>/locales/`.

Renderer API:

* `i18n.getLocaleMetadata(code)` - resolved from that locale's **own** catalog, never through the English fallback (otherwise every locale would report itself as English and `complete`). Unknown/absent status defaults to `draft`, direction to `ltr`.
* `i18n.availableLocaleInfos` - every loaded locale with metadata, sorted English -> `complete` -> `draft` -> native name, ready to render in a picker.
* `i18n.currentDirection` - `ltr`/`rtl` for the active locale. Bound to `<html dir>` by `utils/documentDirection.ts` (see below).

## English data in modules: resolve at render, never at import

A module body runs **once**, when it is first imported, and that is almost always before the user has chosen a locale. Anything resolved there is frozen in whichever locale happened to be active first, and no locale change will ever update it. So a constant that describes a user-visible string stores a **key**, and the component resolves it:

| Holder | Field | Resolved by |
|---|---|---|
| `stores/usePreferencesStore.ts` `AVAILABLE_THEMES` | `labelKey` / `descriptionKey` | `ThemesSection.tsx` |
| `stores/usePreferencesStore.ts` `AVAILABLE_FONT_FAMILIES` | `labelKey` (only for `System Default`) | `TypographySection.tsx` |
| `stores/useTextSettingsStore.ts` `AVAILABLE_FONTS` | `labelKey` (only for `Georgia (Default)`) | `PaneFontSettings.tsx` |
| `components/PreferencesDialog/sectionDefs.tsx` `SECTIONS` | `labelKey` | `PreferencesDialog.tsx` |
| `utils/paneNames.ts` `PANE_NAME_KEYS` | the key itself | `FontsSection.tsx`, and `localizePaneLabel()` in `DockviewTabRenderer.tsx` / `DockviewWatermark.tsx` |

Typeface **names** (`Georgia`, `Merriweather`, `EB Garamond`) are proper nouns and stay Latin in every locale - only the prose around them is a key, which is why `preferencesDialog.fontDefaultLabel` takes `{fontName}` instead of spelling the face name out per locale.

Dockview is the sharper version of the same trap: `api.addPanel({ title })` writes the title into the **serialized layout**, so an English title survives a restart. `localizePaneLabel()` therefore translates at render time, and it keys off the stored generic English label (`Study`, `Commentary`, ...) so that layouts already on disk localize too. A title derived from content - a passage, a module name - is data and passes through untouched.

## No English literals in source

Every user-visible string is a key, and the English lives in `locales/en/`. A component that renders a literal is a bug; `node scripts/find-untranslated-strings.js`, run from the repo root, inventories them (five rules: `jsx-text`, `jsx-attr`, `obj-prop`, `prose`, `tf-fallback`) and `scripts/i18n-extract.js` fails the build on the JSX and dialog cases.

The reason is reviewability rather than translation: the wording has to be readable - and editable - in one place, without reading the code. An inline English fallback beside a key is a second copy that the catalog silently shadows at runtime, so it can disagree with what ships and nobody notices.

### The main process has its own `t()`

`electron/services/MainI18n.ts`, because `I18nService` is renderer-only and main builds native dialogs, window titles and the About box. It is synchronous, loads the catalogs once at startup, and does `{name}` substitution but no ICU. The active locale is pushed to it from the renderer over `i18n:setLocale`, since that is where the user chooses it and where it is persisted.

### Tests assert catalog text, not keys

`src/ui/testing/enCatalog.ts` exposes `enString(key)` and `enT(key, params)` backed by the real English catalogs. A component test asserts `enString('foo.bar')` rather than a literal, so it stays anchored to the key while checking the words a user actually reads - which also means rewording a catalog entry fails the test that names it. That is intended: the wording is a deliberate choice.

## Language picker

There are two pickers - `PreferencesDialog/GeneralSection.tsx` (the app's only call to `setLocale()` outside onboarding) and `onboarding/LanguageFirstRun.tsx` - and both list `i18n.availableLocaleInfos` passed through `selectableLocales()`. `LanguageFirstRun` waits on `whenLocaleCatalogsReady()` first, so it never decides how many languages there are while only the bundled `en` has loaded.

### Which locales are offered

`selectableLocales()` lives in `GeneralSection.tsx` and is the **only** gate. It keeps:

* every **user-supplied** locale - anything whose code is not in `BUILT_IN_LOCALES`, i.e. a folder dropped into `<userData>/locales/`;
* the **built-in** locales named in `SELECTABLE_BUILT_IN_LOCALES`, currently `['en']`;
* the **active** locale, always, so a user already running a withdrawn language still sees what they are on rather than an unchecked radio group.

Every shipped catalog other than `en` is machine-drafted and has never had a native-speaker review, so offering them invites a user to switch the whole interface into a translation we cannot stand behind - and possibly into one they cannot read well enough to switch back from. **To ship another language, add its code to `SELECTABLE_BUILT_IN_LOCALES` and change nothing else.**

The filtering is deliberately at the two call sites and **not** inside `I18nService`: `availableLocaleInfos` is also the mechanism by which a user adds their own language, and that must keep working untouched. `LocaleMetadata` carries no provenance field, so `BUILT_IN_LOCALES` names the shipped codes instead; a code missing from that list is treated as user-supplied and shown, which is the safe direction to fail.

Consequences for the two pickers:

* **Preferences** - the section is a disclosure, **collapsed by default** (see [Settings & Preferences](settings-preferences.md#language-section)). Its footnote switches between the draft warning (`preferencesDialog.languageDraftNote`) and `preferencesDialog.languageMoreComingNote` depending on whether any draft is actually listed.
* **First run** - with a single language on offer there is no question to ask, so step 1 is skipped rather than rendered as a one-item radio group: the locale is committed, the answer recorded, and the dialog opens on the suggested-content step. Widening the allowlist brings the question back with no further change.

### The draft badge

Each row shows the endonym (`nativeName`) plus the English name and BCP-47 code, and **every locale whose `status` is not `complete` carries a visible `preferencesDialog.localeDraftBadge` badge** ("Draft — community review pending", `data-testid="locale-draft-badge-<code>"`). That badge is not optional: it is the app's only honest signal that a translation is machine-drafted and unreviewed. Do not hide it behind a tooltip or a settings flag. It applies to user-supplied catalogs too - one with no `meta.json` defaults to `draft`.

Switching applies immediately - direction included. The one thing that does not follow live is an already-detached pane window; it picks up the new locale when reopened, and the picker's help text says so.

The chosen locale is persisted to `localStorage` under `bible.ui.locale` (`LOCALE_STORAGE_KEY` in `utils/documentDirection.ts`). `localStorage` is shared across every window of the renderer origin, so detached windows read the same value with no main-process round trip.

## Right-to-left (RTL)

| File | Role |
|---|---|
| `src/ui/utils/documentDirection.ts` | Binds `<html dir>`/`<html lang>` to the active locale; owns locale persistence. Called from **both** `main.tsx` and `detached.tsx` - a detached pane is its own renderer context and would otherwise stay English/LTR. |
| `src/ui/utils/textDirection.ts` | `directionForLanguage()` / `isRtlLanguage()` - direction of a **module's** content language, which is independent of the UI locale. |
| `src/ui/utils/overlayPosition.ts` | `anchorAtPointerX()` / `isDocumentRtl()` - flips context menus anchored to a raw `clientX` so they open away from the pointer in the reading direction. |
| `src/ui/contexts/useDirection.ts` | `useDirection()` / `useIsRtl()` for the rare component that must branch in JS. |
| `src/ui/styles/globals.css` (RTL section) | `.rtl-mirror`, `.bidi-isolate`, `[data-content-dir]`. |
| `src/ui/styles/dockview-overrides.css` (RTL section) | dockview tab-strip mirroring, and why the panel grid does not mirror. |

Conventions:

* **Use logical Tailwind utilities** for anything direction-sensitive: `ps-`/`pe-`, `ms-`/`me-`, `start-`/`end-`, `text-start`/`text-end`, `border-s`/`border-e`, `rounded-s`/`rounded-e`. Same for inline styles: `paddingInlineStart`, `marginInlineEnd`, `borderInlineStart`, `textAlign: 'start'`. Physical `pl-`/`ml-`/`left-`/`text-left` should not appear in `src/ui/**`.
* **Exceptions that stay physical**, and why: `left-1/2` paired with `-translate-x-1/2` (a centering idiom - `start-1/2` would throw it off-centre in RTL); TipTap's `textAlign: 'left' | 'right'` in `notes/editor/EditorToolbar.tsx` (that is the *user's* paragraph alignment inside a note, i.e. content, not chrome); and the monospace stack-trace block in `ErrorBoundary.tsx`.
* **`.rtl-mirror`** goes on leaf glyphs whose meaning is relative - next/previous, expand/collapse, back, breadcrumb separators. Never on absolute glyphs (play, check, plus, magnifier, logo) and never on a flex container. It uses the independent `scale` property, not `transform: scaleX(-1)`, so it composes with Tailwind's `rotate-90` instead of replacing it.
* **Content direction is not UI direction.** Scripture follows the *module's* language: `BibleVerseList` resolves `availableBibles[].language_code` through `directionForLanguage()` and sets `dir`/`lang`/`data-content-dir` on the text container. An Arabic UI reading the KJV keeps the KJV left-to-right, and vice versa.
* **Isolate embedded Latin/numeric runs** in scripture - verse numbers (`<bdi>`), Strong's tags, references, keyboard accelerators. `.verse-number`, `.strongs-number`, `.footnote-marker`, `.cross-ref-marker`, `.scripture-link` and `.verse-ref-detected` already carry `unicode-bidi: isolate` in `globals.css`; use `.bidi-isolate` for new sites.

### Strings that name a physical direction

Some catalog strings say "left"/"right" as literal words. Whether that is a bug depends entirely on whether the thing they describe mirrors, so the rule is:

**Pane GEOMETRY does not mirror. Pane CHROME does.**

* The dockview grid keeps its physical order (see the gap below), and `splitRight`/`splitDown` call dockview's physical `addGroup({ direction: 'right' | 'below' })`. So "Bible on the left, study tools on the right", the 2x2 quad description, "the right pane", and every `Split Right` label stay **factually correct in RTL** and must NOT be neutralised. If dockview mirroring ever lands, this whole family flips at once - treat it as one unit.
* Toolbars, tab strips and pane-internal controls DO mirror, so anything describing a control's position within a pane ("the dropdown at the top-left of the Bible pane") becomes wrong in RTL and must be reworded to name the control, not its side.
* The Bible pane's chapter arrows live inside the **content**-direction container, so they mirror when the *module* is RTL even if the UI is English. Any string describing them must say "previous/next", never "left/right".
* Never neutralise: "Right-click ..." (a mouse button), `Alt+Left`/`Alt+Right` (key names), and `editorToolbar.alignLeftTitle`/`alignRightTitle` (TipTap paragraph alignment, which is deliberately physical - see the exceptions above).

### Known RTL gaps

* **dockview panel order does not mirror.** dockview-core 5.2 positions every panel with a JS-computed physical `left`, and the CSS trick that would mirror it breaks dockview's own drag/drop quadrant maths. Tab strips, tab internals and the close/overflow affordances *do* mirror. Fixing the grid needs an upstream change or a fork.
* **Parallel Bible view** applies one content direction per pane, taken from the primary tab's module. Two modules of differing direction shown side-by-side will share the first one's direction.
* **Commentary / dictionary / book panes** do not yet set `data-content-dir` from their module's language; they inherit the UI direction. `BibleVerseList.tsx` is the only component that sets it.
* Context menus that already clamp themselves to the viewport (`VerseContextMenu`, `highlights/HighlightMenu`) still open rightward from the pointer in RTL: they position on a physical `left` and never call `anchorAtPointerX()`. They stay on-screen; only the unfold direction is unidiomatic.
