# Browser Subset

`@bible/core/browser` is the platform-free slice of the core package: pure
TypeScript with no filesystem, no database driver, and no Node globals, safe in a
browser bundle, a web worker, an Electron renderer and a Node script alike. Read
this before adding an export to it, or when a web-client bundle suddenly fails on
a Node builtin.

## Files

| File | Purpose |
|---|---|
| `src/browser.ts` | The barrel itself. Its header comment is the motivation; the export list below is the whole contract. |
| `src/__tests__/browserBarrel.test.ts` | Walks the real import graph from `browser.ts` and fails the build on any platform import. |
| `packages/core/package.json` | The `exports` map that makes `@bible/core/browser` resolvable. |

## Why it exists

The main entry point (`src/index.ts`) re-exports the whole Data layer, which
reaches `better-sqlite3` and Node's `fs`/`path`. That is correct for the Electron
main process and for the web *server*, but it cannot be bundled for a browser.

The barrel exists so a browser client does not have to keep its own hand-maintained
copies of pure core logic. A copy of `CopyService` or `ReferenceCollapser` living in
a client is free to drift from the original, which for something like the copy-template
engine means two clients can format the same copied verses differently. Anything pure
belongs in the barrel instead, imported once.

## What is re-exported

Nine groups, all of it from `src/browser.ts`:

| Group | Exports | From |
|---|---|---|
| Verse identity | `VerseIdHelper`, `Book`; types `VerseId`, `BookNumber` | `src/Data/Core/Types.ts` |
| Book names | `BOOK_COUNT`, `ENGLISH_BOOK_NAMES`, `ENGLISH_DISPLAY_NAMES`, `ENGLISH_SINGLE_CHAPTER_BOOKS`, `LONG_NAMES`, `MEDIUM_NAMES`, `SHORT_NAMES`, `getBookName`, `getBookNumber`, `isSingleChapterBook`; type `BookNameFormat` | `src/Data/Core/BookNames.ts` |
| Reference parsing / formatting | `ReferenceParser`; types `ParsedReference`, `IReferenceParser`, `ReferenceParserConfig` - plus `collapseReferences`, `collapseReferencesStructured`; types `CollapseOptions`, `CollapsedSegment` | `src/Services/ReferenceParser.ts`, `src/Services/ReferenceCollapser.ts` |
| Bible structure | `BIBLE_SECTIONS`, `getBibleSection`; types `BibleSectionKey`, `BibleSectionInfo` | `src/Services/BibleSections.ts` |
| Copy templates | `renderTemplate`, `BUILTIN_TEMPLATES`, `exportTemplates`, `importTemplates`; type `SavedTemplate` | `src/Services/CopyService.ts` |
| Passage formatting | The whole format engine - `getPassageFormatCatalog` and the rest of the numbered catalog, `renderPassageMarkup` + `passageMarkupToHtml`/`...ToText`/`...ToSourceText`/`...ToMarkdown`, `renderPassageCopy`, `renderCopyTemplate`, the verse-text extraction (`getVerseTextForFormat`, `buildPassageReference`) and the option defaults and normalizers | `src/Services/PassageFormat/` |
| Dictionary rendering | `dictionaryDefinitionToHtml`, `definitionHasHtmlMarkup`, `newlinesToLineBreaks`, `readNewlineHandling`, `resolveNewlineHandling`, `NEWLINE_HANDLING_KEY`; type `NewlineHandling` | `src/Services/DictionaryDefinitionFormatter.ts` |
| Strong's numbers | `StrongsNumberHelper`; types `StrongsLanguage`, `ParsedStrongsNumber` | `src/Data/Core/StrongsNumberHelper.ts` |
| Plugin hooks | `HookRegistry`; types `FilterHandler`, `ActionHandler` | `src/Plugin/HookRegistry.ts` |

Note what is **not** here: no repositories, no `ISql`, no `SqliteProvider`, no
`VerseFormatter` (which the web offline path duplicates by hand instead - see
[Text rendering](text-rendering.md)), no controllers.

The passage-format group is the largest thing in the barrel and the reason its
file-count bound was raised from 25 to 40. It came out of the desktop renderer,
where the copy dialog had grown a numbered format list, per-format options and a
live preview that the web client could not use - so the web client had written a
weaker restatement of the same output logic inline. The one thing that had to be
rewritten to make the move possible was the HTML handling: `getCleanVerseText`
and `getVerseTextWithRed` stripped markup with `document.createElement('div')`
and `innerHTML`, which no Node script can do. `src/Services/PassageFormat/htmlText.ts`
replaces that with string transforms, and its test pins them case by case to what
the parser produced. Persistence did **not** move: the storage keys differ per
app, so each app reads and writes its own and hands the result to a format as a
`CopyFormatSettings` argument.

## The rule for adding to it

**Only add a module if it, transitively, imports nothing platform-specific.**
That means no Node builtins, no database driver, no Electron - and in practice no
bare specifiers at all.

Adding an export is a one-line edit to `src/browser.ts`. If the new module drags
in something impure, the test below fails at build time rather than the bundler
failing at the web client, far from the edit that caused it.

If a module you want is *almost* pure, the fix is to split the pure part out
- extract the pure half into its own module and
re-export that - not to widen the barrel.

## How the rule is enforced

`src/__tests__/browserBarrel.test.ts` does not lint imports textually - it walks
the graph. From `browser.ts` it collects every `import` / `export ... from` /
`import()` / `require()` specifier, resolves relative ones against `.ts`,
`/index.ts`, `.tsx`, and queues them, recording bare specifiers as it goes. Four
assertions then run over the result:

1. the barrel exists;
2. no reachable module imports anything on the `FORBIDDEN` list - `fs`,
   `fs/promises`, `path`, `os`, `crypto`, `child_process` (with and without the
   `node:` prefix), `better-sqlite3`, `better-sqlite3-multiple-ciphers`,
   `electron`, `electron-log`;
3. **no reachable module imports any bare specifier at all** - stricter than the
   list, so a new dependency has to be considered deliberately rather than
   slipping in;
4. the graph stays bounded: more than 1 file, fewer than 25. If the barrel
   suddenly reaches most of core, someone exported something that dragged the
   Data layer in behind it.

## Resolution

`packages/core/package.json` declares:

```json
"exports": {
  ".":            { "types": "./dist/index.d.ts",   "default": "./dist/index.js" },
  "./browser":    { "types": "./dist/browser.d.ts", "default": "./dist/browser.js" },
  "./package.json": "./package.json",
  "./*":          { "types": "./dist/*.d.ts",       "default": "./dist/*.js" }
}
```

That `exports` entry is what makes the subpath legal for consumers that use the built
package. A bundler-based client in the same workspace may instead alias the specifier
straight at core's TypeScript source (`packages/core/src/browser.ts`) and compile it
like any other source file, which sidesteps CJS interop entirely; if it does, the
alias has to be set in both its TypeScript config and its bundler config, and the two
must agree.

## Gotchas

- **Browser code must import from `@bible/core/browser`, never `@bible/core`.**
  The root barrel reaches `better-sqlite3` and Node builtins. A browser consumer
  should map only the `/browser` subpath, so that the plain specifier fails to
  resolve rather than failing at bundle time - that guard is worth setting up
  deliberately.
- **Building core does not run the guard; the test suite does.** `npm run test -w @bible/core`
  is where a violation surfaces. A `tsc` build of core will happily compile a
  `browser.ts` that re-exports something impure.
- **The barrel is TypeScript source to the web build and `dist/browser.js` to
  everyone else.** A stale `dist` will not affect the web client but will affect
  anything importing the built package.
- **The under-25-file bound is a tripwire, not a limit.** If you add a legitimate
  export that pushes the graph past it, raise the number *and* look at what came
  in behind your module - that is the question the assertion is asking.
- **`ReferenceParser` is reachable from here, `VerseNavigationService` is not.**
  The latter takes an `IBibleBookRepository`, which is exactly the kind of
  dependency the barrel exists to keep out. Reference parsing in the browser has
  no repository.

## See also

- [Verse identity](verse-identity.md) - most of the barrel's surface.
- [Text rendering](text-rendering.md) - `CopyService` and
  `DictionaryDefinitionFormatter`, the two rendering pieces that are pure enough
  to be shared.
- [Data layer](data-layer.md) - everything the barrel deliberately excludes.
