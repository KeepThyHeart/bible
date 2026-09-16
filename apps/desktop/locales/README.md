# Translating the desktop app

This folder holds every UI string the Electron app can display. English (`en/`) is the source of truth; every other folder is a translation of it.

> ### Translation quality notice
>
> **Every non-English locale here is machine-drafted and has not been reviewed by a native speaker** - `ar`, `es`, `pt-BR`, `ru`, `hi` and `zh-Hans`. They are all marked `"locale.status": "draft"` and the app surfaces that status wherever a language is chosen. Corrections are very welcome - see [Reviewing a draft](#reviewing-a-draft) below.
>
> Arabic (`ar`) is the first `"direction": "rtl"` locale. It exists so that right-to-left layout work has something real to test against; **the UI's RTL support is still in progress**, so expect mirroring bugs before you assume the translation is wrong.

---

## Globalization roadmap (14-language wave)

This app is being globalized to 14 languages: `en`, `zh-Hans`, `es`, `hi`, `ar`, `fr`, `ru`, `pt-BR`, `id`, `bn`, `ur`, `ja`, `vi`, `tr`. This section is the decision record for that effort - read it before starting work on a new locale or on the shared localization plumbing, so decisions already made are not re-litigated per PR.

**Scope of this pass:** infrastructure and architecture only (the tier system below, the shared locale registry, the localizer interface) - no glossary terminology or catalog content has been drafted for any of the seven new locales (`fr`, `id`, `bn`, `ur`, `ja`, `vi`, `tr`). That drafting is separate follow-up work, once a worker is asked to do it; see [Adding a new locale](#adding-a-new-locale).

* **Tags.** `zh-Hans` only for now (Simplified Chinese; Traditional/`zh-Hant` is a later addition, not this wave). `pt-BR` only for now (Brazilian Portuguese; see the register note in `GLOSSARY.md` on why a neutral `pt` was rejected - `pt-PT` can be added later without touching `pt-BR`).
* **Selectability tiers.** `draft` (hidden) / `beta` (shown, badged) / `complete` (regular, no badge) - see [the three tiers](#the-three-tiers) below. This replaces the old binary "only `en` is selectable" gate; nothing is auto-promoted by this change alone.
* **Shared locale identity.** `@bible/core`'s `LOCALE_REGISTRY` and `resolveLocaleDescriptor()` (`packages/core/src/Data/Locales/LocaleRegistry.ts`) are now the one place direction, script and digit-system facts live for all 14 planned locales, resolved by primary subtag so a region variant (`ar-EG`, `ur-PK`) still resolves correctly. This fixed a real bug along the way: the web app's `syncDocumentLang()` compared the *exact* tag against a hard-coded RTL list, so `ar-EG` silently stayed LTR - it now reads the shared registry instead (`apps/web/src/i18n.ts`).
* **Message format.** Desktop keeps ICU MessageFormat via `intl-messageformat` (unchanged). The web app is planned to migrate from i18next's own `{{x}}`/`_one`/`_other` syntax to ICU too (`i18next-icu`), so both apps share one translator rulebook and one validator - not yet done as of this note.
* **Digits.** Chapter/verse numbers and counts should be configurable per user, not hard-coded per locale. **Implemented**: `@bible/core`'s `Localizer.formatNumber()`/`formatDate()` (`packages/core/src/Data/Locales/Localizer.ts`) take a per-call `digitSystem: 'latin' | 'native'` override on top of each locale's own default (native for `ar`/`bn`, Latin for `hi`/`ur`, matching `Intl`'s real per-locale behavior - see the module doc for how these were checked). Nothing in either app's UI reads or exposes this as a user-facing setting yet, and no `toLocale*`/`toFixed` call site has been migrated to it - both are follow-up work.
* **Book names and reference parsing.** The largest functional gap: modules carry no book names, and `ReferenceParser` has no localized table for any language, so "Juan 3:16" does not parse. **The interface is implemented** (`packages/core/src/Data/Locales/Localizer.ts`'s `referenceParserConfig` field, registered per tag via `registerLocalizer()`/`getLocalizer()`) but **no language's book-name table has been drafted** - that is real content work (66 book names × long/short/aliases, per language) left for a dedicated future pass. Every locale falls back to the English table today via `EnglishLocalizer`, which is exactly the "English always accepted as a parsing fallback" behavior the roadmap calls for - it is just currently the *only* table that exists.
* **Server side (web).** Stays English. API error messages remain error codes the client maps to catalog strings; the HTML shell is not localized server-side. Out of scope for this task.
* **Web plugins.** Should eventually get l10n parity with desktop extensions (manifest `LocalizedString`, `l10n/<bcp47>.json` catalogs) - planned, not yet scheduled.
* **Content search (FTS, semantic embeddings).** Explicitly **out of scope** for this task - CJK/non-English tokenization and multilingual semantic search is a separate effort. It was flagged, though, that the module/search data format should be abstracted behind an interface early, so alternate module or search backends can be swapped in later; that is a search/module-architecture concern, not a translation one, and is left for that separate task.
* **Scripture samples for new locales.** Follow the existing rule (only ever quote a verifiably public-domain edition, sourced and verified against a primary text, never from memory; plain non-Scripture prose, as `hi` already does, when a public-domain edition cannot be confirmed). Choosing and sourcing an edition per locale is deferred to whoever drafts that locale's catalog - not done in this pass.
* **Fonts.** Bundle Noto Nastaliq Urdu for `ur` (Windows does not install it by default, and Nastaliq needs much taller line-height than the OS fallback would give it). CJK (`zh-Hans`, `ja`) stays on system/OS fonts, but needs an exact `:lang()` font stack **per** locale - `zh-Hans` and `ja` share Han code points, and a shared/ambiguous stack renders one of them with the wrong glyph shapes (Han unification). Not yet implemented.
* **RTL grid.** The dockview pane grid not mirroring under RTL is accepted for this beta wave (users can re-dock manually); fixing it needs an upstream change or a fork and is not blocking.

None of the seven new locales (`fr`, `id`, `bn`, `ur`, `ja`, `vi`, `tr`) has a catalog folder, or glossary terminology, yet - both are content-drafting work, deferred to a later pass; see [Adding a new locale](#adding-a-new-locale) for the process once that work is picked up.

---

## Layout

```
locales/
  GLOSSARY.md          Domain terminology, per language. Read this first.
  README.md            This file.
  en/                  Source of truth
    meta.json          Locale metadata (name, status, direction)
    commands.json      Command palette / menu command titles, categories, aliases
    layout.json        Layout preset names and descriptions
    main.json          Strings the main process shows (native dialogs, About)
    menu.json          Application menu labels
    searchBar.json     Unified search bar
    ui.json            Everything else (dialogs, panes, in-app documentation)
  ar/                  Arabic (RTL) - same file names, same keys
  es/                  Spanish - same file names, same keys
  hi/                  Hindi
  pt-BR/               Portuguese (Brazil)
  ru/                  Russian
  zh-Hans/             Chinese (Simplified)
  xx-pseudo/           GENERATED pseudo-locale for finding unlocalized strings.
                       Never edit by hand; run scripts/i18n-pseudo.js.
```

Locale folder names are BCP-47 tags (`es`, `pt-BR`, `zh-Hans`). They must match `^[a-zA-Z0-9_-]+$` - the IPC bridge that reads catalogs rejects anything else as a path-traversal attempt.

The app loads catalogs from two places and merges them, user over built-in:

| Source | Path |
|---|---|
| Built-in (ships with the app) | this folder |
| User-supplied | `<userData>/locales/` - e.g. `%APPDATA%/bible-desktop-app/locales/` on Windows |

That means you can test a translation without rebuilding: drop `es/ui.json` into the user folder and restart.

---

## The key convention: FLAT dotted keys

Every catalog is a **flat** JSON object. The dots are part of the key, not nesting:

```jsonc
// CORRECT
{
  "biblePane.nextChapterTitle": "Capítulo siguiente",
  "biblePane.previousChapterTitle": "Capítulo anterior"
}

// WRONG - do not nest
{
  "biblePane": { "nextChapterTitle": "..." }
}
```

All namespaces are merged into one lookup table at runtime, so **keys must be unique across every file in a locale**.

Special key shapes:

| Shape | Meaning |
|---|---|
| `<command>` | The command's title. Keep it **bare** - no `"View: "` prefix. |
| `<command>.category` | The category shown beside the title. The palette joins them. |
| `<command>.alias.0`, `.alias.1`, ... | Extra search terms for the palette. Must be a gapless sequence starting at 0 - lookup stops at the first gap. Translate these into words a user of your language would actually type; they are not required to be literal translations. |

## Missing keys

A key absent from your locale falls back to English rather than breaking. That is a safety net, not a workflow: `i18n-validate.js` fails the build for any missing key, and a half-English dialog looks worse than a rough translation.

---

## ICU MessageFormat rules

Strings with `{...}` are formatted with [ICU MessageFormat](https://formatjs.github.io/docs/core-concepts/icu-syntax/).

1. **Never translate, rename, reorder-away, or drop a placeholder name.** `{reference}` stays `{reference}` in every language. You may move it within the sentence.

2. **Do not assume the English plural works.** If English wrote a bare `{count}`, and your language needs different wording for one vs. many, use a real plural - do not settle for the English shape:

   ```jsonc
   // en (naive)
   "layout.undo.toast": "Rearranged {count} tabs."

   // es (correct)
   "layout.undo.toast": "{count, plural, one {Se ha reorganizado # pestaña.} other {Se han reorganizado # pestañas.}}"
   ```

   `#` prints the number. Use the plural categories your language actually has (`one`/`other` for Spanish; `one`/`few`/`many`/`other` for Russian; `other` alone for Chinese). Exact-value forms such as `=0 {...}` are allowed.

3. **Apostrophes are ICU's escape character.** A lone `'` before `{` or `#` suppresses formatting. Write `''` for a literal apostrophe in a string that contains placeholders.

4. **Nested placeholders inside plural branches are fine**, e.g. `{count, plural, one {# resultado en {book}} other {# resultados en {book}}}`.

5. **Some placeholders render as markup, not text.** `{key}`, `{navKeys}`, `{enterKey}`, `{tabKey}` become styled `<kbd>` keycaps; `{link}` in the theme preview becomes an underlined link span. They behave like any other placeholder - **move them wherever your language needs them**, which is the whole point: `searchBar.hintSearch` is `"{key} to search"` in English but `"खोजने के लिए {key} दबाएँ"` in Hindi, because Hindi is verb-final. Keycaps carry `dir="ltr"`, so an Arabic sentence around them stays correctly ordered - do not try to compensate with RLM/LRM marks in the catalog.

6. **`{productName}` and `{version}` are supplied by the build**, not by the catalog. Never translate the product name and never replace the placeholder with a literal.

## Things that must survive byte-for-byte

* **Copy-template variables** - `{book}`, `{chapter}`, `{verse_range}`, `{version}`, `{nl}`, `{verses}`, `{num}`, `{text}`. These appear in `templateEditorDialog.*` and are parsed by the copy engine, **not** by ICU. Leave the whole string alone.
* **Inline markup** - `<strong>`, `<kbd>`, and their closing tags. Translate the text between them; keep the tags and their order.
* **Key names** - `Ctrl`, `Alt`, `Shift`, `Enter`, `Esc`, `Cmd`, and combinations like `Ctrl+K`. They stay English because that is what is printed on the keyboard.
* **`&` accelerator mnemonics**, where present - keep one, and put it on a letter that exists in your translated word.
* **The product name.** It is a build-time setting (`BIBLE_PRODUCT_NAME`) and reaches the string as the `{productName}` placeholder. Keep the placeholder; never translate it and never hardcode a product name in its place.
* `Aa` (a typography icon), Strong's prefixes `G`/`H`, module abbreviations (`KJV`), and language tags (`[ESP]`).

---

## Scripture quoted inside UI strings

A few keys embed actual Scripture. Currently:

| Key | Where it appears | Text |
|---|---|---|
| `preferencesDialog.typographyPreviewLine` | Preferences -> Typography size preview | John 3:16, first clause only |
| `preferencesDialog.fontSampleBible` | Preferences -> Fonts -> Bible pane sample | John 3:16, same clause, trailing `...` |
| `ui.preferences.themePreviewLine1` | Preferences -> Themes preview pane | John 3:16, with the link phrase as a `{link}` placeholder |
| `ui.preferences.themePreviewLine2` | Preferences -> Themes preview pane | John 3:17 |
| `ui.preferences.themePreviewLink` | the `{link}` phrase inside `themePreviewLine1` | a phrase lifted from John 3:16 |

`themePreviewLink` must be a phrase that actually occurs in that locale's `themePreviewLine1`, in the same orthography (including diacritics) - it is spliced back into the sentence at render time and any mismatch shows.

`typographyPreviewLine` and `fontSampleBible` are the **same clause of John 3:16** shown in two different previews, and they differ only in that the font sample trails off with an ellipsis. Keep them in the same edition and the same wording; two renderings of one verse a screen apart is exactly the kind of thing a seminary user notices.

**Only ever use a public-domain translation here.** This repository is GPL-3.0-or-later and must be redistributable in full; a copyrighted Bible text baked into a UI string is not. Most modern translations are under active copyright, including several that feel "standard" in their language.

Known-good choices:

| Locale | Translation | Status |
| ------ | ----------- | ------ |
| `en`   | King James Version (1611) | Public domain |
| `es`   | Reina-Valera 1909 | Public domain |
| `ar`   | Smith-Van Dyck (فان دايك), 1865 | Public domain |
| `pt-BR`| João Ferreira de Almeida, old text (1819/1898) | Public domain |
| `ru`   | Синодальный перевод (Synodal), 1876 | Public domain |
| `zh-Hans` | 和合本 (Chinese Union Version), 1919, 神版 | Public domain |
| `hi`   | *none - plain non-Scripture sample* | see `hi/meta.json` |

Each of those locales records the reasoning, and the copyrighted editions that must **not** be substituted, in its own `meta.json` `locale.notes` field. Read that field before touching any of the keys in the table above. The traps are the same shape as the Spanish one every time: the famous, modern-sounding rendering is usually the copyrighted revision, and the public-domain text is the older, slightly archaic one.

Two of them deserve calling out here:

* **`pt-BR`** reads *"Porque assim amou Deus ao mundo..."*. That is the old Almeida. The familiar *"Porque Deus amou o mundo de tal maneira..."* is the 1995 Almeida Revista e Corrigida (copyright SBB) / Almeida Corrigida Fiel 1994 (copyright SBTB). Do not "improve" it into the modern reading.
* **`zh-Hans`** uses the **神版** of the 和合本, not the 上帝版, and every UI string that refers to God therefore uses 神. Printed 神版 Bibles set a space before 神 to keep line lengths matching the 上帝版; that is typesetting, not orthography, and it is deliberately not reproduced in the catalog.

**`hi` quotes no Scripture at all.** No Hindi translation could be positively confirmed public domain - the Bible Society of India asserts copyright on the familiar Hindi O.V. editions - so per the rule above plain sentences were substituted rather than guessing, in **both** the typography preview line and the two theme preview lines. If you can cite a specific pre-1928 Hindi edition, that is a welcome PR.

> **Translators, please read before "fixing" the Spanish sample.** It reads `ha dado á su Hijo unigénito` - with an accented `á`. That is not a typo. It is the 1909 orthography, and it is the one visible difference between RV1909 and the Reina-Valera **1960**, whose text is copyrighted by Sociedades Bíblicas Unidas. Modernising that single character silently converts the string into the copyrighted edition. Leave it as-is.

When adding a locale, verify the licence of whatever translation you quote before using it. If you cannot confirm a translation is public domain, do not guess - use a plain non-Scripture sentence for the sample instead and note it in the locale's `meta.json` `notes` field.

---

## Locale metadata (`meta.json`)

Every locale folder must contain `meta.json`:

```json
{
  "locale.name": "Spanish",
  "locale.nativeName": "Español",
  "locale.status": "beta",
  "locale.direction": "ltr"
}
```

| Key | Values | Meaning |
|---|---|---|
| `locale.name` | free text | Name in English, for maintainers and logs |
| `locale.nativeName` | free text | Endonym, shown in the language picker |
| `locale.status` | `draft` \| `beta` \| `complete` | See the three tiers below. |
| `locale.direction` | `ltr` \| `rtl` | Base writing direction. `ar` and (once added) `ur` are `rtl`; everything else is `ltr`. |
| `locale.notes` | free text, optional | Maintainer notes for this locale: which Scripture edition the sample quotes and why, which editions are copyrighted and must not be substituted, and any terminology decision a reviewer is likely to want to overturn. Not shown in the UI. |

`locale.notes` is not present in `en/meta.json`, so `i18n-validate.js` reports it as an **extra key**. That is expected and non-fatal - extra keys are a warning only. Do not delete the notes to silence it.

It is loaded through the ordinary catalog mechanism, so no build or IPC change is needed to add a language - dropping in a folder is enough.

### The three tiers

Every catalog goes through three tiers on its way to full support:

| Tier | Shown in the built-in picker? | Badge | Meaning |
|---|---|---|---|
| `draft` | **No** - withheld by `selectableLocales()`. | - | Machine-drafted and either incomplete (missing namespaces, low key coverage) or otherwise not yet vetted enough to try. Every new locale starts here. |
| `beta` | Yes | "Beta — community review pending" | Machine-drafted but **complete** - every namespace present, `check-translations.js` passes for it - and stable enough to offer with an honest caveat. Not yet reviewed by a native speaker. |
| `complete` | Yes | none | Reviewed by a native speaker end to end. |

This gate applies to **built-in** catalogs only. A locale a user drops into `<userData>/locales/` is always shown, at whatever status it claims (defaulting to `draft` if it has no `meta.json`) - hiding a translation a user installed themselves would be a regression, badge or no badge.

Promoting a built-in locale is exactly one edit: change `locale.status` in its `meta.json`. `selectableLocales()` (`GeneralSection.tsx`) and both pickers pick it up with no other code change - there is no separate allowlist. `I18nService.getLocaleMetadata()` reads the field from the locale's own catalog (never through the English fallback) and defaults to `draft` when it is absent or unrecognized, so an unknown locale can never silently present itself as reviewed or even beta-stable. `availableLocaleInfos` returns the whole list ready for a picker, sorted English -> `complete` -> `beta` -> `draft`.

**Do not flip a locale to `beta` or `complete` yourself without meeting the bar above.** `beta` is a claim that the catalog is complete (all namespaces, full key coverage); `complete` is a claim that a native speaker signed off. As of this writing all six machine-drafted locales (`ar`, `es`, `hi`, `pt-BR`, `ru`, `zh-Hans`) are still `draft`: each is missing `main.json`/`menu.json` entirely and `ui.json` is only ~64% complete, so none has met the `beta` bar yet.

---

## Adding a new locale

1. Read [`GLOSSARY.md`](GLOSSARY.md) and fill in your language's column and its register/formality note *before* translating. Terminology decided per-string ends up inconsistent.
2. `mkdir locales/<bcp47>` and copy every `.json` from `en/`.
3. Translate the values. Leave the keys untouched.
4. Write `meta.json` with `"locale.status": "draft"` (see [the three tiers](#the-three-tiers) - a new locale always starts here, no exceptions).
5. Validate:
   ```bash
   node apps/desktop/scripts/i18n-validate.js --locale=<bcp47>
   node scripts/check-translations.js <bcp47>
   ```
6. Test it in the running app by selecting the language, and re-read anything that overflows its control - Spanish and Russian run 15-30 % longer than English.

## Tooling

| Command | What it does |
|---|---|
| `node scripts/check-translations.js` | Coverage report for every locale in both the desktop and web catalog roots. Shows each locale's draft status. Exits non-zero on any missing key. |
| `node scripts/check-translations.js es` | Same, for one locale. |
| `node apps/desktop/scripts/i18n-validate.js` | Strict key-set check of `locales/` against `en/`. Reports missing keys (fatal), extra keys, and JSON parse errors. |
| `node apps/desktop/scripts/i18n-validate.js --json` | Machine-readable output. |
| `node apps/desktop/scripts/i18n-pseudo.js` | Regenerates `xx-pseudo/` from `en/`. Run after changing `en/`. |

Neither validator can tell you whether a translation is *good* - only whether it is *complete*. That is what review is for.

## Reviewing a draft

If you speak one of these languages or another one, feel free to correct or contribute to these translation files!  That will help other people who know your language to enjoy the app better.

1. Check the term against [`GLOSSARY.md`](GLOSSARY.md). If the glossary itself is wrong, fix it there first - otherwise the error comes back.
2. Fix the string in the locale's JSON.
3. Run the two validators above.
4. Open a PR describing what was wrong. Terminology reasoning is welcome in the PR body; the audience includes seminary students who will notice.
5. Once a locale has been reviewed end to end, its `meta.json` can be moved to `"locale.status": "complete"` in the same PR. If you filled in every missing namespace/key for a still-unreviewed locale (making `check-translations.js` pass for it) but did not review the wording, move it to `"locale.status": "beta"` instead - that is what makes it appear in the app's pickers, badged, ahead of a full review.
