# Text Rendering

Turning what a module stores - clean text plus a structured `formatting`
payload - into the HTML the reader displays, and into
the plain text the clipboard gets. Read this before changing anything that
produces `text_html`, strips markup, or renders a definition or commentary entry.

## Files

### Storage format and normalization

| File | Purpose |
|---|---|
| `src/Data/Text/VerseFormatting.ts` | The `bible_verse.formatting` payload: `VerseSpanType` vocabulary, `VerseSpan`, `VerseBlock`, `SourceVerseRef`, `splitVerseWords`, `parseVerseFormatting` / `stringifyVerseFormatting`, `SPAN_TYPE_USFM`, `BLOCK_USFM`. |
| `src/Data/Text/normalizeVerseText.ts` | Pure converter: presentational HTML in, clean UTF-8 + spans out. Also exports `mergeSpans`. |
| `src/Data/Text/normalizeVerseText.test.ts` | Tests against fixtures extracted from real shipped verses. |
| `src/Data/Text/index.ts` | Barrel; types before implementations. |
| `src/Data/Models/Bible/BibleVerse.ts` | Holds both representations and projects between them (`projectToLegacy`, `projectBlockToV2`, `toNormalizedV2`). |

### Display

| File | Purpose |
|---|---|
| `src/Services/VerseFormatter.ts` | `formatVerseText(verse)` -> `{ textHtml, isParagraphStart, sectionHeading }`. Also `stripOsisTags` and `highlightSearchTerms`. This is where OSIS/SWORD markup is removed and where words-of-Christ and divine-name spans become `<span>`s. |
| `src/Services/VerseFormatter.test.ts` | Tests. |
| `src/Services/BibleViewService.ts` | Assembles a whole chapter of `ChapterVerse` rows for IPC/HTTP; topic dedup; verse of the day. |
| `src/Services/DictionaryDefinitionFormatter.ts` | Renders a stored dictionary definition: escaping, and newline->`<br />` under a module-level `newline_handling` declaration. |
| `src/Services/DictionaryDefinitionFormatter.test.ts` | Tests. |
| `src/Services/CommentaryLinkProcessor.ts` | Rewrites Bible references inside commentary HTML into links, including bare `8:9` resolved against line context. |
| `src/Services/CommentaryLinkProcessor.test.ts` | Tests. |
| `src/Services/InterlinearService.ts` | Static formatting helpers over `InterlinearWord` rows. Unused outside core - see gotchas. |

### Copy templates

| File | Purpose |
|---|---|
| `src/Services/CopyService.ts` | A self-contained Handlebars-like template engine (`renderTemplate`), `BUILTIN_TEMPLATES`, `TemplateSyntaxError`, import/export of saved templates. |
| `src/Services/CopyService.test.ts` | Tests. |

### Passage templates (separate, unused)

| File | Purpose |
|---|---|
| `src/Services/BibleTextService.ts` | `renderPassage(templateView, passageData)` over a registry of `ITemplateEngine`s; `enrichVerse` builds the template's view model. |
| `src/Services/BibleTextService.test.ts` | Tests. |
| `src/Services/ITemplateEngine.ts` | `render` / `registerFilter` / `validateTemplate`. No implementation exists in this repo. |
| `src/Services/TemplateTypes.ts` | `TemplateEngineType` (`Liquid`, `Handlebars`), `TemplateView`, `createTemplateView`. |

## The storage format

`bible_verse.text` is clean canonical UTF-8 and is already plain - there is no
separate plain-text column. Structured formatting lives in `formatting` as a
`VerseFormatting` payload.

The rule is that `text` carries no markup at all and everything
presentational is *data naming ranges of words*. A `VerseSpan` says what a range
of words **is** (`divine_name`, `supplied`, `words_of_christ`, `emphasis`,
`quotation`, `transliteration`); the renderer owns how it looks. The format is
extended by adding span type names, never by adding presentational attributes.

Word offsets are **0-based and inclusive** over `splitVerseWords(text)` - a plain
whitespace split, unambiguous only because `text` was normalized first. That one
index space is shared by `formatting.spans`, `user_text_markup`, and
`interlinear_word`.

`BibleVerse` also keeps the deprecated legacy representation populated in its
constructor, so renderers that have not moved over see the same verse:

- given `formatting`, it derives `formattingData` via `projectToLegacy` (spans
  of type `words_of_christ` / `supplied` / `divine_name` become the legacy range
  arrays);
- given `formattingData`, it derives `formatting` via `projectBlockToV2` - **block
  data only**. Legacy span offsets are expressed against the *HTML* word sequence
  with an inconsistent base, so copying them across would produce
  confidently-wrong ranges. `verse.toNormalizedV2()` is the real conversion.

## How it works

Reader path, chapter render:

```
BibleRepository.getChapter()
  -> BibleVerse (formatting + formattingData both filled)
  -> BibleViewService.getFormattedChapter()
      -> formatVerseText(verse)  [VerseFormatter]
      -> { verse_id, text, text_html, is_paragraph_start, words_of_christ,
          footnotes, section_heading }
  -> desktop IPC / web route -> renderer
```

Inside `formatVerseText`, in order:

1. Strip legacy `<font ...>` / `</font>`.
2. Replace `<divineName>...</divineName>` with **control-character placeholders**
   (`\x01` / `\x02`), not real tags.
3. Strip the remaining OSIS/SWORD tags via `OSIS_TAG_PATTERN`
   (`divineName|transChange|catchWord|rdg|seg|hi|foreign|inscription|mentioned|name|note|title|q|w`).
4. Detect a paragraph start from a pilcrow (`¶`, removed) or from
   `formattingData.paragraphStart` / `paragraph_start`.
5. If there are words-of-Christ or divine-name ranges, do **one** rebuild pass:
   strip all remaining tags to spaces, split into words, and re-emit with
   `<span class="christ-words">` as the outer span and `<span class="divine-name">`
   as the inner one. Two passes would break the second one's indices, because the
   first inserts markup.
6. Swap the placeholders for real `<span class="divine-name">` tags.
7. `getSectionHeading()`, with residual tags stripped.

Two details in step 5 that are load-bearing: the emit order per word is
close -> separator -> open, so the space between words lands outside both spans
(otherwise you get a visible trailing space inside small-caps or red-letter
styling); and a final regex collapses ` .` back to `.`, because stripping
`them<note>x</note>.` to spaces isolates the period as its own token.

### Divine name

The stored form is a **`divine_name` span**, not `<divineName>` markup -
`normalizeVerseText` maps `<font size="-1">` to it, and the SWORD converter maps
`<divineName>` to it. `projectToLegacy` surfaces it as
`formattingData.divineName`, which is what `formatVerseText` step 5 reads.
`DIVINE_NAME_PATTERN` in step 2 handles the case where literal `<divineName>`
markup is still present in the text.

Casing is normalized in TypeScript (`toDivineNameCase`: "LORD"/"lord" -> "Lord",
skipping leading punctuation) rather than in CSS, because `::first-letter` only
matches block containers and is silently ignored on an inline `<span>` - the
usual `text-transform: lowercase` + `::first-letter { uppercase }` trick renders
as uniform small capitals with no full-height initial. Normalizing here lets the
stylesheet be a bare `font-variant-caps: small-caps`, and makes the result
identical whether the source wrote "Lord" (CrossWire KJV) or "LORD".

### The normalizer

`normalizeVerseText(rawText, legacyFormattingData?)` is a pure function with no
I/O, used when converting legacy source text into the stored format. Its hard
part is the offset base: the legacy converter replaced every HTML tag with a space before
splitting, so `The L<font size="-1">ORD</font> <i>is</i> my shepherd` tokenized
as `The | L | ORD | is | my | shepherd` and `is` landed at index 3 - which looks
1-based against the rendered text but is not. Rather than apply a constant shift,
the normalizer rebuilds both token sequences in one pass and maps legacy indices
through to clean word indices.

Its tag->span mapping was derived from a full inventory of the 29 distinct tag
strings across all 53 shipped Bible modules: `<i>` -> `supplied`,
`<em>/<b>/<strong>` -> `emphasis`, `<cite>/<q>` -> `quotation`, `<font color=red>`
-> `words_of_christ`, `<font size="-...">` -> `divine_name`. Deliberately unmapped:
`<small>` (presentational small caps that is *not* the divine name - ISV's
"BABYLON THE GREAT"), `<sup>` (ABP word-order numerals), `<a>`, `<ul>`, `<li>`,
`<br>`. Only `<sup class="n">` (the SWORD footnote marker, 6 occurrences in all
shipped data) has its content dropped.

`mergeSpans` then merges same-type spans that overlap or touch, because the
legacy HTML routinely splits one logical run across several tags
(`<i>the L</i><i>ord</i>`, a red-letter quotation broken at every `<br />`).

### Dictionary definitions

A dictionary `definition` is **plain text**, not HTML - the SWORD importer runs
every entry through `stripMarkupClean`. A survey of the 25 installed dictionary
modules (~300k entries) found zero HTML tags and one lone `<`, in Webster 1913's
*inequality* entry ("the inequality 2 < 3"). Pushing that column straight into
`dangerouslySetInnerHTML` was wrong twice: newlines collapsed (Nave's uses a
blank line between the 14,586 numbered senses under its headings) and stray angle
brackets became markup.

The authority is a module-level declaration -
`module_info.metadata -> { "newline_handling": "significant" }` - read by
`readNewlineHandling` (which tolerates the camelCase spelling, since authors write
it by hand). When nothing is declared, `definitionHasHtmlMarkup` decides per
entry using a tag **allow-list**, so `2 < 3` stays on the plain-text path.

`dictionaryDefinitionToHtml` escapes the plain-text case and returns the HTML case
untouched. It is **not a sanitiser** - callers still pass the result through
DOMPurify. Callers that run link processing first (which escapes its own text
segments) must not escape twice; they use the two primitives instead:

```ts
const breaks = resolveNewlineHandling(raw, declared) === 'significant';
let html = processCommentaryLinks(raw, ctx);    // escapes text segments
if (breaks) html = newlinesToLineBreaks(html);  // breaks only, no escape
```

### Commentary links

`processCommentaryLinks(html, context)` strips existing (often broken) TSK anchor
tags, splits the input on `(<[^>]+>)` so only text segments are touched, and runs
three patterns per segment:

1. full references with a book name - "Ro 5:5", "2 Tim. 1:7", "Jeremiah 7:16, 14:11";
2. bare `chapter:verse` - resolved against the most recent book named **on the
   same line**, falling back to `context.bookNumber` only when
   `matchBareChapterVerse` is set;
3. bare verse numbers - only when `matchBareVerseNumbers` is set (TSK-style), only
   after a separator, and only for 1-176.

Pattern 1 records every span it matched as *consumed* even when the book lookup
failed, so pattern 2 cannot re-match the `11:18-19` inside "Sirach 11:18-19".
Output goes through a `LinkFormatter`; the default emits
`<a href="#verse-43003016" class="scripture-link">`, and non-HTML clients (CLI,
Markdown) supply their own.

### Copy templates

`CopyService` is a small, self-contained engine - no code execution, purely
declarative. Syntax: `{{var}}`, `{{#each}}` (with `@index` / `@first` / `@last`),
`{{#if}}...{{else}}...{{/if}}`, `{{#unless}}`, `{{#blockquote}}`, `{{separator "\n"}}`.
Dotted paths resolve against a context stack, innermost first.

An unrecognised **section** helper throws `TemplateSyntaxError`; a plain
`{{variable}}` that resolves to nothing still renders empty. That asymmetry is
deliberate: `{{#blockqoute}}` used to fall through to the variable branch and the
template silently lost a chunk of itself, whereas a variable may legitimately be
absent from one passage's context and present in another's. The desktop copy
dialog catches the error and shows `[Template error: ...]` in its live preview.

`{{#blockquote}}` renders its region first and prefixes `> ` afterwards, because
the line structure is only known once loops and conditionals have run. Trailing
newlines stay outside the quote, and a blank line inside becomes a bare `>`.
Nesting composes into `> > x`.

## Gotchas

- **`BibleTextService` / `ITemplateEngine` / `TemplateTypes` have no
  implementation.** Nothing in core implements `ITemplateEngine`; the only
  consumer of `BibleTextService` is its own test. Real copy formatting goes
  through `CopyService`, which is a different engine with a different syntax.
  Do not confuse the two when someone says "the template engine".
- **`InterlinearService` is unmaintained.** Its `getPartOfSpeechColor` returns
  Tailwind class names (`text-blue-700`), which presumes a styling system core
  has no business knowing about, and `parseMorphology` is a stub that checks
  `includes('V')` - so "N" in a Hebrew code matches `Adjective` via
  `includes('A')` only by accident. Do not build on it without rewriting it.
- **`formatVerseText` returns HTML that still needs sanitising.** Same contract as
  `dictionaryDefinitionToHtml`.
- **`stripOsisTags` keeps `divineName` in its alternation on purpose.** It is used
  in plain-text-only contexts (interlinear original-word field, section headings)
  where no styled span is wanted. It is safe inside `formatVerseText` because
  `DIVINE_NAME_PATTERN` always runs first and leaves no bare `<divineName>` behind.
- **`w` is in `OSIS_TAG_PATTERN` and matters.** It is the OSIS word tag - the most
  common tag in a SWORD module, since it carries Strong's numbers. It was missing,
  which made `stripOsisTags` a no-op on interlinear fields and rendered raw markup
  as literal text. Nothing downstream re-parses `<w>`; Strong's data reaches the UI
  through `interlinear_word` columns.
- **Do not let a client hand-copy `VerseFormatter.ts`.** A browser client that
  cannot import the root barrel should reach it through `@bible/core/browser`,
  which exports it - see [Browser subset](browser-subset.md). A copy drifts: the
  `w` alternative in `OSIS_TAG_PATTERN` is exactly the kind of addition that
  lands in core and not in the duplicate.
- **`formattingData` key spellings are inconsistent** -
  `paragraph_start`, `added_words`, `words_of_christ` are snake_case while
  `sectionHeading` is camelCase. Every read accepts both spellings; keep doing
  that.
- **`textPlain` is deprecated.** It is populated equal to `text`. Use
  `verse.getPlainText()`, or just `text` - it is already clean.
- **`parseVerseFormatting` never throws.** Unknown span types, malformed ranges
  and non-object payloads are discarded silently, because a bad annotation must
  not stop a verse being read. If a span "disappeared", check it against
  `VERSE_SPAN_TYPES` and the `end >= start` rule.
- **`stringifyVerseFormatting` returns `null` for an empty payload**, so the
  column holds `NULL` rather than a meaningless `{"v":1}`. But
  `isEmptyVerseFormatting` counts `source_verses` as content - a merged variant
  verse may carry nothing else, and dropping it would lose the only record that
  the merge happened.
- **Footnotes have no `formatting` representation yet.** `getFootnotes()` still reads the
  legacy payload only. Publisher cross-references *did* move, to `verse_link`
  (`source_type='verse'`, `link_type='cross_reference'`); `getCrossReferences()`
  is the legacy accessor.
- **`FormattingData`, `textPlain` and the projection helpers are deprecated.**
  They exist only until `VerseFormatter`, `BibleTextService`, `BibleViewService`,
  `Extensions/ExtensionApiDtos` and the renderers consume `formatting` directly.

## See also

- [Verse identity](verse-identity.md) - verse IDs, a different index space from
  the word offsets used here.
- [USFM export](usfm-export.md) - the same span model written back out as USFM.
- [Module format](module-format.md) - the normative `formatting` column spec.
- [Browser subset](browser-subset.md) - `CopyService` and
  `DictionaryDefinitionFormatter` are re-exported for the web client;
  `VerseFormatter` is not.
