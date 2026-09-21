# Translation Contributor Guide

This project uses [i18next](https://www.i18next.com/) for internationalization. Translations live in `apps/web/src/locales/` with one subfolder per locale (e.g., `en/`, `es/`, `fr/`).

## JSON Schemas

Each namespace has a JSON Schema in `locales/schemas/` (e.g., `ui.schema.json`). These schemas are **auto-generated** from the English baseline files.

**Editor support:** Each locale file includes a `"$schema"` property that gives VS Code and JetBrains autocomplete, inline validation, and missing-key warnings out of the box.

**Regenerating schemas:** After adding or changing keys in the English files, regenerate the schemas:
```bash
npm run generate:locale-schemas
```

**CI verification:** To check that schemas are up to date (without overwriting):
```bash
node scripts/generate-locale-schemas.js --check
```

## Adding a New Language

There is no per-language code to write or register - only files. The picker,
the direction/RTL handling, and the lazy-loading all read the same folder
listing, the same way desktop's language picker reads its `locales/`
folder.

1. **Copy the English folder:**
   ```bash
   cp -r apps/web/src/locales/en apps/web/src/locales/<locale>
   ```
   Use a standard BCP 47 language code (e.g., `es`, `fr`, `pt-BR`, `zh-Hans`) -
   match `@bible/core`'s `LOCALE_REGISTRY` tag for that language exactly
   (`packages/core/src/Data/Locales/LocaleRegistry.ts`), so the picker's
   direction, script and digit-system facts resolve correctly.

2. **Translate the strings** in `ui.json`, `books.json`, `booksShort.json`,
   `modules.json` and `help.json`. Keep all keys identical to the English
   originals (see "Key Naming Conventions" below).

3. **Fill in `meta.json`** with this locale's own identity, in place of the
   copied English one:
   ```json
   {
     "locale.name": "Spanish",
     "locale.nativeName": "Español",
     "locale.status": "draft",
     "locale.direction": "ltr"
   }
   ```
   - `locale.name` / `locale.nativeName`: the English name and the endonym,
     for the picker.
   - `locale.direction`: `"ltr"` or `"rtl"` (Arabic, Urdu).
   - `locale.status`: start at `"draft"` - see "Locale Status" below. This
     file is the *only* registration step: there is no separate list to add
     the locale to anywhere in code. As soon as the folder and its
     `meta.json` exist, the picker offers it (once its status allows - see
     below) and its catalogs are fetched the first time someone selects it.

4. **Test your translations** (see Testing section below).

## Locale Status

Every locale's `meta.json` `locale.status` controls whether - and how - the
language picker offers it. This is the same three-tier system as the desktop
app (`apps/desktop/locales/README.md`):

- **`draft`** - withheld from the picker entirely (unless it is already the
  active locale). Use this for a machine-drafted or incomplete translation
  that has not been reviewed enough to offer at all.
- **`beta`** - offered, with a "Beta" badge next to its name. Machine-drafted
  but complete and stable enough to try.
- **`complete`** - offered, no badge. Reviewed by a native speaker.

Promote a locale by editing its own `meta.json` - nothing else changes.

## File Structure

Each locale folder contains:

| File              | Purpose                                     | Approx. Keys |
|-------------------|----------------------------------------------|-------------|
| `meta.json`       | Locale identity: name, endonym, status, direction (NOT a translated namespace - see above) | 4 |
| `ui.json`         | All UI labels, buttons, messages, tooltips  | ~570         |
| `books.json`      | Names of the 66 Bible books                 | 66           |
| `booksShort.json` | Abbreviated names of the 66 Bible books     | 66           |
| `modules.json`    | Module type labels and descriptions         | ~90          |
| `help.json`       | Help dialog content                         | ~40          |

Partial translations are fine. Any missing key automatically falls back to English.

## Key Naming Conventions

Keys use dot-separated, component-scoped names:

```json
{
  "header": {
    "placeholder": "Go to passage or search...",
    "settings": "Settings"
  },
  "bible": {
    "noModules": "No Bible modules installed",
    "copyVerse": "Copy verse"
  }
}
```

Rules:
- **Do not rename or remove keys.** The key names are referenced in source code.
- **Do not add new keys** without a corresponding code change.
- Keep the nesting structure identical to the English file.

## Interpolation

This project uses **ICU MessageFormat** (via `i18next-icu`) rather than
i18next's own `{{variable}}` syntax, so both apps' catalogs - and their
translators' rules - are the same. Dynamic values use single-brace syntax:

```json
"versesFound": "{count} verses found",
"chapterTitle": "{book} {chapter}"
```

Keep the `{variable}` placeholders in your translation. You may reorder them
to fit natural word order.

Two keys under `ui.passageInsert` (`verseHeading`, `commentPlaceholderText`)
also use single braces (`{verse}`, `{reference}`) but are a deliberate
exception: they are substituted by `@bible/core`'s passage-formatting code,
not by i18next, and are always looked up with no interpolation values -
i18next-icu's own missing-value fallback returns them unchanged, so they
reach that code with the placeholder intact. Leave them exactly as they are
except for translating the surrounding words.

## Pluralization

Plural forms are a single key holding an ICU `plural` clause, not separate
`_one` / `_other` keys:

```json
"result": "{count, plural, one {# result} other {# results}}"
```

The `#` inside a branch is shorthand for the formatted count. Add whichever
categories your language's plural rules need - `zero`, `one`, `two`, `few`,
`many`, `other` (`other` is required; the rest are optional and language-
specific.  Arabic needs all six, Russian needs `one`/`few`/`many`/`other`,
many languages need only `other`). See
[CLDR Language Plural Rules](https://www.unicode.org/cldr/cldr-aux/charts/33/supplemental/language_plural_rules.html)
for your language's categories, and the
[ICU MessageFormat guide](https://formatjs.github.io/docs/core-concepts/icu-syntax/#plural-format)
for the syntax itself. The call site (`t('key', { count })`) does not change -
i18next resolves the right branch from the single key.

## HTML in Translations

Some strings contain inline HTML tags for formatting:

```json
"ideasHelpDesc": "Ideas Search finds passages by <strong>meaning</strong>, not just exact words."
```

Preserve the HTML tags and translate only the text content.

## What NOT to Translate

- **Bible text** -- Bible content comes from module databases, not locale files.
- **Module abbreviations** (e.g., `KJV`, `ESV`) -- these are identifiers.
- **Strong's numbers** (e.g., `G25`, `H1234`) -- universal reference codes.
- **Key names** in the JSON files -- only translate the values.

## Testing

1. **Run the app locally:**
   ```bash
   npm run dev -w @bible/web
   ```
   Switch to your language in the browser (or set `localStorage.setItem('i18nextLng', '<locale>')` in the console) and verify strings display correctly.

2. **Run the translations check script** to find missing or extra keys:
   ```bash
   node scripts/check-translations.js          # Check all locales
   node scripts/check-translations.js es        # Check a specific locale
   ```
   This compares your locale against English and reports missing keys, extra keys, and coverage percentage for each namespace.

3. **Check for RTL issues** if translating to Arabic, Hebrew, Farsi, or Urdu. The app sets `dir="rtl"` automatically for these languages.
