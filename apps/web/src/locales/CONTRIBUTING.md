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

1. **Copy the English folder:**
   ```bash
   cp -r apps/web/src/locales/en apps/web/src/locales/<locale>
   ```
   Use a standard BCP 47 language code (e.g., `es`, `fr`, `de`, `pt-BR`, `zh-CN`).

2. **Translate the strings** in each JSON file. Keep all keys identical to the English originals.

3. **Register the locale in `i18n.ts`:**
   ```typescript
   import ui_es from './locales/es/ui.json';
   import books_es from './locales/es/books.json';
   import modules_es from './locales/es/modules.json';
   import help_es from './locales/es/help.json';

   // Add to the resources object:
   resources: {
     en: { ui, books, modules, help },
     es: { ui: ui_es, books: books_es, modules: modules_es, help: help_es },
   },
   ```

4. **Add the language to SettingsPanel.tsx** so users can select it from the UI language dropdown.

5. **Test your translations** (see Testing section below).

## File Structure

Each locale folder contains four JSON files:

| File           | Purpose                                  | Approx. Keys |
|----------------|------------------------------------------|---------------|
| `ui.json`      | All UI labels, buttons, messages, tooltips | ~430         |
| `books.json`   | Names of the 66 Bible books              | 66            |
| `modules.json` | Module type labels and descriptions      | ~80           |
| `help.json`    | Help dialog content                      | ~40           |

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

Dynamic values use `{{variable}}` syntax:

```json
"versesFound": "{{count}} verses found",
"chapterTitle": "{{book}} {{chapter}}"
```

Keep the `{{variable}}` placeholders in your translation. You may reorder them to fit natural word order.

## Pluralization

Plural forms use `_one` / `_other` suffixes:

```json
"result_one": "{{count}} result",
"result_other": "{{count}} results"
```

Some languages need additional suffixes (`_zero`, `_two`, `_few`, `_many`). See the [i18next plurals documentation](https://www.i18next.com/translation-function/plurals) for your language's requirements.

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
