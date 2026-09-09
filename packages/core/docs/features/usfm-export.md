# USFM Export

`src/Export/` re-assembles whole USFM documents (one per book) from already-fetched
`bible_verse` rows, and decodes them again. It is the published interoperability
surface for Bible modules - read this when exporting a module,
or when adding a span type that has to survive a round trip.

## Files

| File | Purpose |
|---|---|
| `src/Export/toUSFM.ts` | `toUSFM` / `toUSFMBook`, `renderVerseTextAsUsfm`, `UsfmExportError`, and the `SPAN_TYPE_TO_USFM_MARKER` / `USFM_MARKER_TO_SPAN_TYPE` tables. |
| `src/Export/parseUSFM.ts` | `parseUSFM`, `parseInlineUsfm`, `UsfmParseError` - a reference decoder for the subset `toUSFM` emits. |
| `src/Export/UsfmBookCodes.ts` | Book number <-> USFM identifier: `USFM_BOOKS`, `getUsfmBookByNumber`, `getUsfmBookByCode`, `usfmFileName`. |
| `src/Export/VerseFormatting.ts` | Re-exports the canonical formatting types from `Data/Text`, plus the one exporter-only extension: `HeadingKind`, `VerseBlockWithHeadingKind`, `readHeadingKind`. |
| `src/Export/index.ts` | Barrel over the four. |
| `src/Export/toUSFM.test.ts` | Tests for both directions, including round trips through `parseUSFM`. There is no separate `parseUSFM.test.ts`. |

Everything here is a **pure function over already-fetched rows** - no database
handles, no filesystem - so it runs unchanged in the Electron main process, a
renderer, a CLI, or a server, and is unit-testable without a database.

## The `Usfm` namespace

From `src/index.ts`:

```ts
export * as Usfm from './Export';
export { toUSFM, toUSFMBook, UsfmExportError } from './Export/toUSFM';
export { parseUSFM, UsfmParseError } from './Export/parseUSFM';
```

The namespace exists because `src/Export/VerseFormatting.ts` deliberately mirrors
the type names in `src/Data/Text/VerseFormatting.ts` (`VerseSpan`, `VerseBlock`,
`VerseFormatting`, `PoetryLevel`, `splitVerseWords`, `SPAN_TYPE_USFM`, ...) so that
an integrator can import everything the exporter needs from one place. The root
barrel already does `export * from './Data'`, which re-exports those same names -
a star export of `./Export` would collide with it.

So the qualified form is the general one:

```ts
import { Usfm } from '@bible/core';
Usfm.toUSFM(rows);
Usfm.getUsfmBookByCode('JHN');
```

The four entry-point names are unique, so they are also re-exported unqualified
as a convenience: `import { toUSFM, parseUSFM } from '@bible/core'`.

`src/Export/VerseFormatting.ts` owns **no duplicate definitions** - it re-exports
and adds `HeadingKind` only.

## How it works

Export:

```
bible_verse rows
  -> { verseId, text, formatting: parseVerseFormatting(row.formatting) }   (caller maps)
  -> toUSFM(verses, options)
      -> bucket by book, canonical order
      -> toUSFMBook(verses)
          \id / \ide UTF-8 / [\rem] / \h / \mt1
          per verse:  \c on chapter change
                      emitBlockMarkers()  -> \s | \d, \b, \q1-\q3, \p
                      renderVerseTextAsUsfm() -> spans as character markers
                                              (\qs Selah\qs* among them)
  -> UsfmDocument[] { bookNumber, bookCode, bookName, fileName, usfm }
```

Import (round-trip verification, and a worked example for integrators):

```
usfm text -> parseUSFM()
  -> per \v: parseInlineUsfm() -> { text, spans }
  -> buildFormatting(pending block, spans)
  -> ParsedUsfmDocument { bookNumber, bookCode, bookName?, verses[] }
```

### Spans -> character markers

`SPAN_TYPE_TO_USFM_MARKER` is *derived* from `SPAN_TYPE_USFM` in `Data/Text` at
module load (stripping the leading backslash) rather than restated, so the two
cannot drift. `USFM_MARKER_TO_SPAN_TYPE` is its inverse. Add a span type in
`src/Data/Text/VerseFormatting.ts` and both directions pick it up for free.

`renderVerseTextAsUsfm` walks the verse word by word maintaining the set of
markers that should be open. Spans of different types routinely nest
(`words_of_christ` containing `supplied`) and may also *partially* overlap, which
no nesting-based markup can express - so where an overlap requires it, markers
are closed and re-opened. The output is always well-nested, valid USFM.

Ordering is deterministic: earliest start, then longest, then marker name.

### Selah is a span, not a block flag

`musical_direction` covers the words of a Selah / Higgaion notation, which are
already part of `text` like any others - the span adds no words, it only says
which words they are. `\qs` is a *character* marker in USFM, so this needs no
special handling in either direction: it renders through
`SPAN_TYPE_TO_USFM_MARKER` and reads back through `USFM_MARKER_TO_SPAN_TYPE`
exactly like `\nd` or `\wj`. `SELAH_MARKER` remains exported from `toUSFM.ts`
for callers that want the marker name.

It was previously `block.selah`, a boolean. That forced the exporter to *guess*
which words to wrap - it looked for a trailing `Selah` token and warned when it
found none - and it could not express a notation sitting mid-verse, as
"Higgaion. Selah" does in Ps 9:16.

### Heading kind

USFM needs `\s` (editorial section heading, "The Beatitudes") and `\d` (canonical
psalm superscription, "A Psalm of David") kept apart - they render and validate
differently - but the canonical `VerseBlock.heading` is a single field.
Producers that know the difference record `heading_kind` alongside it;
`readHeadingKind(block)` reads it without widening the type and returns
`'section'` when absent or unrecognized. A module converted from legacy HTML generally
will not have it, since `<b>` was used ambiguously for both.

## Gotchas

- **Nothing in this repo calls it.** `toUSFM` / `parseUSFM` are referenced only by
  `src/index.ts`, the public developer site, and a comment in
  `BibleTranslation.sql`. There is no export UI, no CLI command, and no IPC
  handler. It is a published API for external integrators, so treat its shape as
  a contract even though nothing local breaks.
- **`parseUSFM` is not a general USFM importer.** It understands the span and
  block vocabulary plus the scaffolding the exporter emits, and ignores everything
  else. Footnotes, cross-reference notes, milestones and `\va`/`\vp` alternate
  numbering belong to the module converter, not here.
- **Paratext reserves file number 40 for deuterocanonical material**, so
  `fileNumber` diverges from `bookNumber` across the whole New Testament: Matthew
  is book 40 but file 41, Revelation book 66 but file 67. `usfmFileName` uses
  `fileNumber` (`44-JHN.usfm` for John, which is book **43**). Never compute the
  filename prefix from the book number.
- **`toUSFMBook` throws `UsfmExportError`** when the rows span more than one book,
  when the book number is outside the 66-book canon, or when `verses` is empty.
  `toUSFM` never throws for the first case - it buckets by book first.
- **Non-fatal problems are silent unless you pass `onWarning`.** Dropped spans
  (unknown type, non-integer offsets, offsets outside the verse's word count) and
  stripped backslashes both go there.
- **A backslash in `text` is removed, not escaped.** USFM has no escape sequence
  for one, so a conforming module must not store one; `sanitizeText` strips
  defensively and warns rather than emitting a broken document.
- **Poetry levels clamp at 3.** `q4` and deeper collapse to `\q3`, and on the way
  back `toPoetryLevel` clamps to 1-3.
- **`\b` is only emitted between poetic stanzas** - when a poetry block also has
  `paragraph_start`, is not the first verse of the chapter, and carries no
  heading. Prose paragraph starts get `\p`.
- **The first verse of a chapter always gets a paragraph marker**, because USFM
  text may not follow `\c` or `\s` directly. `parseUSFM` therefore treats the
  first verse after `\c` as an implicit `paragraph_start`, which is what makes the
  round trip stable.
- **`parseUSFM` handles a single-book document.** `toUSFM` returns one document
  per book; feed them back one at a time.
- **The `x-ref` attribute is the only span attribute carried.** It is emitted
  before the closing marker and read back by `parseRefAttribute`, and is only
  meaningful on `quotation` spans. It holds the quoted passage as an inclusive
  range: a bare id (`|x-ref="23007014"`) for a single verse, `start-end`
  (`|x-ref="24031031-24031034"`) for the multi-verse case, which is the common
  one - Heb 8:8-12 quotes Jer 31:31-34. A bare id decodes to `ref_start` ===
  `ref_end`.

## See also

- [Text rendering](text-rendering.md) - the `formatting` payload this reads, and
  `parseVerseFormatting`, which callers use to build `UsfmVerseInput.formatting`.
- [Module format](module-format.md) -
  the normative format definition and the exporter's structural rules.
- [Verse identity](verse-identity.md) - `verseId` is re-derived locally here
  (`parseVerseId` in both `toUSFM.ts` and `parseUSFM.ts`) rather than imported.
