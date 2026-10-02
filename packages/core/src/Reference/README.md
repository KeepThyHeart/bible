# Reference engine

One data-driven parser and formatter for Bible references in every language (task 0077). Re-exported by
`@bible/core` and `@bible/core/browser`; nothing in this folder imports the rest of core.

```ts
import { loadReferenceLocales, referenceEngineFor } from '@bible/core/browser';

await loadReferenceLocales(['zh-Hans']);          // on demand; en + OSIS ids are always loaded
const engine = referenceEngineFor('zh-Hans');     // UI language, then English, then OSIS ids
engine.parse('约3：16');                           // { ok: true, ranges: [{ book: 43, chapter: 3, verse: 16 }], ... }
engine.scan('参看约翰福音3:16。');                  // matches with offsets into the original text
engine.format({ book: 43, chapter: 3, verse: 16 }); // "约翰福音3:16"
engine.formatParts(...);                          // typed parts, for styling or bidi isolation
```

`ReferenceParser` (Services/) is a compatibility adapter over this engine.

## Loading

Only `locales/en.json` and the OSIS ids are bundled into the core. Every other language is a separate file
loaded by `loadReferenceLocales(tags)` (dynamic `import()`: a separate chunk in web/desktop bundles, a file
read in Node). The apps load the UI language (desktop and web on startup and locale change). Other data
sources (an asset store, a language pack) plug in with `addReferenceLocaleSource()`, or hand over data with
`registerReferenceLocale()`. Parsing stays synchronous; caches rebuild when `referenceLocalesVersion()`
changes.

## Adding a language

1. Add `locales/<tag>.json` (BCP 47 tag: `pt-BR`, `ar`, `zh-Hans`) in the shape of `ReferenceLocaleData`
   (`types.ts`): all 66 books with at least `long`; `medium`, `short`, `aliases` optional. Mark it
   `"status": "draft"` until a native speaker has reviewed it.
2. A regional variant may contain only what differs: `{ "tag": "ar-SA", "extends": "ar", "format": { ... } }`.
3. Separators and digits are inherited from the root (`":"`, `"-"`, `", "`, Latin digits) unless the file
   says otherwise (`syntax` for input, `format` for output; `format.digits: "native"` with a
   `numberingSystem` such as `arab`).
4. Register the loader in `registry.ts` (`BUILTIN`).
5. Add `locales/<tag>.cases.json` with golden cases. `pnpm --filter @bible/core exec vitest run src/Reference`
   validates every file (66 books, no name meaning two books unless listed under `ambiguous`) and runs the
   cases, a format/parse round trip, and prints the cross-locale clash report.
