# Copy & Export

**Last verified:** 2026-09-08

Verse copying with **five numbered formats**: Block quote, Numbered quote, Inline quote, Verse headings, Custom template. The first four come from `passageMarkup.ts` and render a block tree, written out as source text for the clipboard; the fifth is a user-written Handlebars-style template.

**One dialog, three modes.** `PassageDialog.tsx` is the whole of it. Copying a passage to the clipboard, inserting one into a note and re-formatting one already in a note differ by a `mode` prop and nothing else. `CopyOptionsDialog.tsx` is the Bible pane's adapter on to it (mode `copy`); `notes/editor/VerseExpandPopover.tsx` is the notes editor's (modes `insert` and `reformat`). See [notes-writing.md](notes-writing.md) for the notes side.

**One catalog, one order, one set of numbers.** `formatCatalog.ts` is the single source of truth, so a format number means the same thing in both dialogs. See "The numbered format list" below.

**The engine is `@bible/core`'s, not this app's.** Everything below the chrome - the catalog, the block-tree renderer, the clipboard formats, the option types and their validation - lives in `packages/core/src/Services/PassageFormat/` and is exported through `@bible/core/browser`. The web client's copy dialog is built on the same engine (see [web's copy-export doc](../../../web/docs/features/copy-export.md)), so the two apps offer the same numbered formats with the same output; what each owns is its own UI and its own storage keys. The file table below marks which side of that line each file sits on.

The dialog lays the controls out as **formats and their options on the left, live preview on the right**, so a toggle and its effect on the output are visible in one glance. The preview is rendered by the same call the primary button makes.

It is **portaled** (`PopupPortal` -> `document.body`) at `z-index: 9999`. Neither is optional: dockview's `.dv-dockview { contain: layout }` establishes a containing block for every pane, so a `fixed inset-0` backdrop declared inside one covers the pane rather than the window - and the notes editor's own fixed-position chrome sits at 9998, so Tailwind's `z-50` would open the dialog underneath it.

The dialog has a **fixed** height and a fixed left-column width. Every format brings a different number of controls - Custom template swaps the lot for an editor - and in the "ask me for a reference" path the body starts as a single status line, so a content-sized dialog would open three rows tall and jump to full height when the fetch landed, walking the primary button out from under the pointer. It is sized generously up front instead; only the two columns scroll, and the header and footer stay pinned.

## The numbered format list

| # | Format | Family | Shape | Options it honours |
|---|---|---|---|---|
| **1** | Block quote *(default)* | markup | The whole passage as one quote, broken only where the source text is | its own shape options, plus `markdown` and `textFormat` |
| **2** | Numbered quote | markup | One quote, each verse numbered and on its own line - a *line*, not a paragraph | its own, plus `markdown` and `textFormat` |
| **3** | Inline quote | markup | Reference and quotation on one line, inside the sentence | its own, plus `markdown` (no quote block to decorate) |
| **4** | Verse headings | markup | A heading per verse with the verse quoted beneath it | its own, plus `markdown` and `textFormat` |
| **5** | Custom template | clipboard | Whatever the template says | none - a template is fully user-controlled |

**The numbers are keys.** Pressing `1`-`5` selects that format, and a badge in front of each name says so, with a hint line beneath the list. `resolveFormatShortcut()` claims only a **bare** digit `1`-`9` (`MAX_FORMAT_SHORTCUT`), and the dialog only acts on it when focus is outside a text entry (`utils/textEntry.ts` - inputs, textareas, `<select>`s and contenteditable regions): a reference box is mostly digits, so claiming them there would make the field unusable.

**Where focus lands decides whether the digits work**, which is why the dialog chooses per mode: a path that arrives with its passage already resolved (Tab, re-format) opens on the *format list*, so "John 3:16-17, Tab, `2`, Enter" is a complete insertion; copy mode and "+ Bible Passage" open on the reference box, because there the passage is what the user came to say.

**Numbers come from a declared order, not from array position.** `PASSAGE_FORMAT_ORDER` is the contract. A format the registry stops resolving drops out of the catalog without renumbering the ones after it, and a format registered but not listed is appended past the end rather than shuffling the existing numbers. Users learn "3 is inline quote"; a number that moves is worse than no number at all.

### The retired formats: Standard and Combined

Two clipboard formats are **registered but never offered**: `standard` and `combined`, listed in `LEGACY_PASSAGE_FORMAT_IDS` in `formatCatalog.ts`. Standard is a numbered quote written as lines; Combined is an inline quote written as lines, and the markup engine renders both shapes better.

They stay registered because a note already on disk whose `verseExpansion` mark says `data-expansion-format="standard"` must keep its shape when re-formatted (see [notes-writing.md](notes-writing.md)). Deleting the registry entries would turn that into a dead id, so the hiding happens in the *catalog*, not the registry. Note that `getPassageFormatCatalog()` **appends** any registry format the declared order does not mention, so merely dropping the two ids from `PASSAGE_FORMAT_ORDER` would bring them back as #6 and #7. `isLegacyPassageFormat()` is the explicit exclusion, and `formatCatalog.test.ts` pins it.

Three consequences:

- **A stored preference is remapped, not defaulted.** `remapLegacyFormatId()` maps `standard` -> `blockquote-numbered` and `combined` -> `inline-quote` - the shape each is a restatement of - so someone whose last copy was Standard lands somewhere recognisable rather than on whatever happens to be first. Both `getLastUsedPassageFormatId()` and `getLastInsertFormatId()` go through it.
- **A retired format is shown when it is the one selected.** Re-formatting a legacy passage passes its id to `getPassageFormatCatalog({ includeIds })`, so the picker shows a "Standard" row, marked as no longer offered, carrying no number (the digits index the offered list only). Without it the picker would open with nothing selected and Apply would preserve something invisible.
- **The registry keeps its own default.** `DEFAULT_FORMAT_ID` is `standard` because `formatVersesWithFormat()` returns a string of *lines* and cannot fall back to a block-tree format. `DEFAULT_PASSAGE_FORMAT_ID` (`blockquote`) is the dialogs' default, and the two are deliberately different things.

### The output shapes the formats are specified against

Numbered quote on the clipboard, Markdown on, reference before:

```
John 3:16-17 (KJV)

> (16) For God so loved the world, that he gave his only begotten Son, ...
>
> (17) For God sent not his Son into the world to condemn the world; ...
```

Without Markdown the shape is identical, with the `>` markers replaced by a four-space indent - a plain-text block quote has no other way to say "quoted". With `textFormat: 'inline'` the decoration is dropped entirely and the lines stand bare.

Inline quote, reference before:

```
John 3:16-17 (KJV) “For God so loved the world, ... For God sent not his Son, ...”
```

## Files

### Components

| File | Description |
|---|---|
| `src/ui/components/PassageDialog.tsx` | **The dialog.** One component, three modes (`copy` / `insert` / `reformat`): reference box, translation picker, format list, per-format options, live preview, primary action. Portaled at `z-index: 9999`, fixed height, two columns. Also hosts the inline custom-template editor (`loadUserTemplates` / `upsertUserTemplate` / `saveActiveTemplateText`) |
| `src/ui/components/CopyOptionsDialog.tsx` | The Bible pane's adapter on to it - turns a `VerseContext` and a translation abbreviation into the dialog's vocabulary and opens it in `copy` mode |
| `src/ui/components/notes/editor/VerseExpandPopover.tsx` | The notes editor's adapter - `insert` / `reformat`, plus the two things only a document needs (`asBlock`, the skip-format-menu checkbox). See [notes-writing.md](notes-writing.md) |
| `src/ui/components/notes/editor/usePassageResolver.ts` | Reference parsing, translation choice and **debounced** fetching, shared by every mode. Parses with `allowWholeBook: true` (this dialog only ever takes a reference, so a bare `"John"` is unambiguous - unlike the search box, where it is a word to look for) and resolves the span with `verseExpansionService.resolveReferenceRange` rather than its own arithmetic, so `"John 3"`, `"John 3-5"` and a whole book all resolve to the end of the span rather than to a single verse. Seeded with `initialVerses` so a caller that already has a passage does not blank and re-fetch |
| `src/ui/components/shared/VerseFormatPicker.tsx` | The format chooser - one radio per format in `formatCatalog` order, each with its number badge, name and description. The descriptions are load-bearing: the list is short because two entries would otherwise look alike, and saying what each one does is the other half of that. A retired format appears only when it is the one selected |
| `src/ui/components/FormatOptionsPanel.tsx` | The two options every format understands: "Display translation" and "Words of Christ in red". Rendered by every mode of the passage dialog |
| `src/ui/components/PassageMarkupOptionsPanel.tsx` | The shape controls for whichever of the four note-insertion formats is selected - reference placement, verse numbering ("In parentheses (16)" / "Superscript ¹⁶" / "None"), heading level, quote marks, comment room |

### Services

| File | Description |
|---|---|
| `src/ui/services/verseCopyService.ts` | Orchestrates verse copying with the selected format. Also owns the last-used format/options (`getLastUsedFormatId` for clipboard-only consumers, `getLastUsedPassageFormatId` for the copy dialog), which are **localStorage-backed** and validated per field on read |
| `src/ui/services/verseExpansionService.ts` | Second consumer of the format registry: expands a Bible reference in a note into verse text (`resolveReferenceRange`, `buildExpandedHtml`, `expandReference`). See `notes-writing.md` -> "Expanding a verse reference in place" |
| `src/ui/services/verseFetchCache.ts` | Shared verse-range fetch cache, used by both the hover preview popup and verse expansion, so a previewed reference expands with zero IPC |
| `src/ui/utils/textEntry.ts` | `isTextEntryTarget()` - the guard every single-key shortcut asks before claiming a keypress |
| `src/ui/services/copyFormats/index.ts` | The seam between core's engine and this app's storage. Re-exports the whole of `@bible/core`'s `Services/PassageFormat` (aliasing core's `PassageVerse` back to the `BibleVerse` name the renderer uses) alongside the localStorage modules below, and owns `loadCopyFormatSettings()` - the one place the saved advanced options and active template are assembled for a core format |
| `packages/core/src/Services/PassageFormat/types.ts` | Type definitions for the copy format system: `PassageVerse`, `VerseContext`, `FormatOptions`, `CopyFormat` |
| `packages/core/src/Services/PassageFormat/index.ts` | The engine's public barrel - what `@bible/core/browser` re-exports |
| `packages/core/src/Services/PassageFormat/settings.ts` | `CopyFormatSettings` (a format's saved advanced options plus the active template), `DEFAULT_COPY_FORMAT_SETTINGS` and `resolveCopyFormatSettings()` - the argument every clipboard format's `format()` takes |
| `packages/core/src/Services/PassageFormat/formatRegistry.ts` | Registry of available copy formats; `DEFAULT_FORMAT_ID` |
| `packages/core/src/Services/PassageFormat/formatHelpers.ts` | Verse-text extraction (red letters, paragraph markers), `buildPassageReference`, and the shared `FormatOptions` vocabulary both families build on |
| `packages/core/src/Services/PassageFormat/formatCatalog.ts` | **The one numbered, ordered list every mode reads.** `PASSAGE_FORMAT_ORDER` is the declared order a number comes from; `getPassageFormatCatalog()` resolves it against both engines; `LEGACY_PASSAGE_FORMAT_IDS` / `remapLegacyFormatId()` hide the retired formats without unregistering them; `resolveFormatShortcut()` turns a keypress into a format |
| `packages/core/src/Services/PassageFormat/passageCopyRenderer.ts` | `renderPassageCopy()` - the one renderer behind both fixed formats. Exported so the dialog can preview *unsaved* option edits; the formats' own `format()` takes the saved options as a `CopyFormatSettings` argument, which `verseCopyService` supplies from this app's storage |
| `packages/core/src/Services/PassageFormat/copyOptions.ts` | `AdvancedCopyOptions` type, defaults, and `normalizeAdvancedCopyOptions()` - the per-field validation both apps run over whatever they read back |
| `src/ui/services/copyFormats/advancedOptions.ts` | This app's localStorage persistence for the above (`bible-desktop-copy-advanced-options`). Only the key and the read/write are here; the meaning and the validation are core's |
| `packages/core/src/Services/PassageFormat/standardFormat.ts` | Standard format - a thin wrapper over `renderPassageCopy(..., 'standard')`. **Retired**: still registered so legacy notes keep rendering, never offered |
| `packages/core/src/Services/PassageFormat/combinedFormat.ts` | Combined format - a thin wrapper over `renderPassageCopy(..., 'combined')`. **Retired**, same reason |
| `src/ui/services/copyFormats/customFormat.ts` | The `{var}` custom format, kept so a note saved against a `{var}` template can still be re-rendered. Nothing imports it today beyond the `copyFormats` barrel |
| `src/ui/services/copyFormats/templateParser.ts` | `{var}` template parser |
| `src/ui/services/copyFormats/templateStorage.ts` | `{var}` template storage |
| `packages/core/src/Services/PassageFormat/templateFormat.ts` | Handlebars-style "Custom Template" copy format - uses `renderTemplate` from `CopyService` |
| `src/ui/services/copyFormats/savedTemplates.ts` | Persists Handlebars-style user templates (localStorage) and re-exports built-in templates from `@bible/core` |
| `packages/core/src/Services/PassageFormat/passageMarkup.ts` | The **note-insertion** half of the engine: `blockquote`, `blockquote-numbered`, `heading-per-verse`, `inline-quote`. Both quote shapes group verses by the source's own paragraphs (`paragraphsOf`) and differ only in what separates two verses *within* one paragraph: `RUN_ON` for a plain quote, `SOFT_BREAK` for a numbered one - `<br>` in HTML, a newline in text, i.e. Shift+Enter rather than Enter, so the only blank lines in the output are the ones the text actually has. `passageMarkupToSourceText` prefixes every *physical* line of a quote (the `> ` or the indent), uses two trailing spaces for the Markdown hard break, and rewrites `<br>` back to a newline in `richText` mode - the caller derives the plain clipboard flavour from that string with `textContent`, which would otherwise drop the break and run the verses together. Renders a passage into a small block tree (`renderPassageMarkup`) that `passageMarkupToHtml` / `...ToText` / `...ToSourceText` / `...ToMarkdown` emit - the last two being what the clipboard takes. Pure - built on the same `formatHelpers` and `FormatOptions` as the clipboard formats. See "The two format families" below |
| `packages/core/src/Services/PassageFormat/passageMarkupOptions.ts` | `normalizePassageMarkupOptions()` - what a valid stored markup-option record is, plus the enum lists (`PASSAGE_REFERENCE_POSITIONS`, `VERSE_NUMBER_STYLES`, `QUOTE_MARK_STYLES`, `HEADING_LEVELS`) the option panels build their selects from |
| `packages/core/src/Services/PassageFormat/htmlText.ts` | DOM-free tag stripping and entity decoding, so the engine can run under plain `node` |
| `src/ui/services/copyFormats/passageMarkupPreferences.ts` | This app's storage for the above: per-format options for the four markup formats, the last-used insert format (either family), and the "always use this format" flag. Same best-effort, per-field-validated localStorage pattern as `advancedOptions.ts` |

**The format engine's output escaping is conditional.** `formatVersesWithFormat` returns a newline-separated string whose verse text is *HTML* when `wordsOfChristInRed` is true (`getVerseTextWithRed` returns markup, with `<span style="color: #B71C1C;">` runs) and *raw unescaped text* when it is false (`getCleanVerseText` strips the tags and decodes the entities). Any consumer that parses the result as HTML must sanitise it - the clipboard path and `buildExpandedHtml` both do.

Both stripping paths are string transforms rather than DOM operations, because core is imported by Node scripts and its tests run under `node`. See `packages/core/src/Services/PassageFormat/htmlText.ts` for what that does and does not reproduce of the parser's behaviour, and `htmlText.test.ts` for the case-by-case record.

### Shared engine (in `@bible/core`)

| File | Description |
|---|---|
| `packages/core/src/Services/CopyService.ts` | `renderTemplate()` - small Handlebars-style engine (`{{var}}`, `{{#each}}`, `{{#if}}/{{else}}`, `{{#unless}}`, `{{#blockquote}}`, `{{separator}}`, `{{@index}}`/`{{@first}}`/`{{@last}}`). Also exports `TemplateSyntaxError` and `BUILTIN_TEMPLATES` (Standard, Verse per line, Paragraph, Numbered inline, Quote block, Study notes). Used by both desktop and web. See "The block-quote helper" below |
| `packages/core/src/Services/CopyService.test.ts` | 115 tests covering interpolation, loops, conditionals, nesting, separators, the block-quote helper, unknown-helper errors, and edge cases |

### The block-quote helper

```
{{#blockquote}}{{#each verses}}{{text}}{{/each}}

- {{reference}} ({{version}}){{/blockquote}}
```

renders as

```
> For God so loved the world, ...
>
> - John 3:16 (KJV)
```

The engine emits a **plain string**, so "this is a quotation" has to be carried in the text itself. `> ` is the one notation that survives into Markdown, into a rich-text paste, and into a plain-text note where it still reads as a quotation - it is exactly what a user would type by hand, only without their having to prefix lines whose number they do not know when they write the template.

Two details:

- **Trailing newlines stay outside the quote**, or a region ending in a newline would emit a final `> ` on the empty line after the passage and render as an extra blank quoted line.
- **A blank line inside the region becomes a bare `>`**, not `"> "`. Both are valid CommonMark; the bare one avoids trailing whitespace on every paragraph break.

Nesting composes: an inner region emits `> x`, which the outer prefixes again to `> > x` - CommonMark's nested block quote. The region is rendered *whole* and then prefixed, because its line structure is only known once its loops and conditionals have run.

**An unrecognised `{{#helper}}` is an error.** Section tags are checked against `SECTION_HELPERS` and a typo throws `TemplateSyntaxError`, which `renderCopyTemplate` catches and shows as `[Template error: ...]` in the live preview. Without that check a misspelling such as `{{#blockqoute}}` would resolve as a missing variable and render as nothing at all - the template silently losing a chunk of itself, which is the one class of template mistake the preview cannot help with. Plain `{{variable}}` stays lenient: a name absent from one passage's context and present in another's is ordinary, not a mistake.

## The two format families

The clipboard formats render a passage as **plain lines** - right for a clipboard, which has no structure to put a passage into. A note has: it has blockquotes, headings and paragraphs, and an expository preacher wants the passage laid into them. Expressing "each verse under its own H3, quoted beneath" as newline-separated text and hoping the editor guesses the structure does not work, so `passageMarkup.ts` renders a small block tree instead.

| | Clipboard formats | Note-insertion formats |
|---|---|---|
| Output | newline-separated lines | `PassageMarkupBlock[]` -> HTML / text / Markdown |
| Options | `FormatOptions` + `AdvancedCopyOptions` (one shared record) | `FormatOptions` + shape controls, **per format** |
| Consumers | copy dialog, notes editor | notes editor |

**What is genuinely shared** is everything below the structure: `formatHelpers`' verse-text extraction (red letters, paragraph markers) and its `buildPassageReference`, plus the `FormatOptions` vocabulary - "display translation" and "words of Christ in red" mean the same thing on both sides, and the `FormatOptionsPanel` control is the same component. `verseExpansionService.buildInsertHtml` is the single door on to both, so the notes editor never has to know which family a format id belongs to.

**What is not shared is the shape**, because a `<blockquote>` has no meaning on a clipboard *as markup*. `passageMarkupToSourceText` is the bridge: it renders the same block tree as source text - `#` headings and `> ` quote lines in Markdown, an indented block otherwise - which is exactly what a clipboard consumer wants. The dialog's `copy` mode calls it, which is why the four shapes are the clipboard's list too. (`passageMarkupToMarkdown` is the fully-decorated case of it, kept because `markdown: true, blockQuote: true` is the common one.)

Three things the clipboard path decides for these shapes:

- **The plain-text flavour is source text**, honouring `markdown` and `textFormat` from the shared `AdvancedCopyOptions` - the two questions that are about the clipboard rather than about the shape. `richText` mirrors `renderPassageCopy`'s asymmetry (HTML when red letters are on, raw text when they are off), so the dialog's "is this HTML?" rule needs no special case.
- **The `text/html` flavour is the block tree itself**, via `passageMarkupToHtml` - pasting "Verse headings" into Word gives real headings and a real block quote rather than a run of `>` characters. It is written under the same condition as every other format's: red letters on, and not Markdown.
- **The shape options stay per format.** Every mode renders `PassageMarkupOptionsPanel` and writes through `savePassageMarkupOptions`, so an H2-per-verse layout chosen while copying is an H2 layout when inserting.

## Options

**Universal** - `FormatOptions`, rendered through `FormatOptionsPanel` for every format:

| Option | Effect |
|---|---|
| `displayVersionNumber` | "Include translation": `(KJV)` on the reference |
| `wordsOfChristInRed` | Red-letter runs survive into the `text/html` clipboard flavour |

**Per format** - the markup shapes' own controls, in `PassageMarkupOptionsPanel`, persisted per format id and shown only where they can do anything:

| Option | Formats | Effect |
|---|---|---|
| `referencePosition` | all four | Reference **Before**, **After**, or **None** |
| `verseNumbers` | all four | **In parentheses (16)**, **Superscript ¹⁶**, or **None**. Each option is a *name* with its example beside it |
| `headingLevel` | Verse headings | H1-H3 (`EDITOR_HEADING_LEVELS`; the note editor's schema has no more, though the core type allows H1-H6) |
| `quoteMarks` | Inline quote | `“”`, `‘’`, or none |
| `commentPlaceholders` | the per-verse shapes | A labelled paragraph under each verse to write into |

**Clipboard-only** - two `AdvancedCopyOptions` fields, offered in `copy` mode alongside a markup shape because they are about the *output* rather than the shape:

| Option | Effect |
|---|---|
| `markdown` | Structural Markdown: block quotes as `> ` lines, headings as `###` |
| `textFormat` | **Block Quote** (`> ` in Markdown, four-space indent otherwise) or **Inline** (bare text). Not offered to Inline quote, which has no quote block to decorate |

The rest of `AdvancedCopyOptions` - `includeVerseNumbers`, `newLinePerVerse`, `paragraphBreaks`, `includeChapterHeadings`, `referencePosition` - belongs to the retired Standard and Combined renderer and is not editable. The type and its persistence stay, because `renderPassageCopy` still reads them when a legacy passage is re-rendered.

Three rules the options interact under:

- **Chapter labels.** With chapter headings on, a verse label is the bare number; with them off on a multi-chapter passage it carries the chapter (`(4:1)`), because nothing else in the output says which chapter the verse came from. A chapter boundary breaks the text either way - otherwise the end of one chapter runs straight into the start of the next.
- **Headings sit outside the quote.** `renderPassageCopy` builds the passage as a short list of heading/text blocks, so the block-quote decoration only ever wraps verse lines. `> ### Chapter 4` never happens.
- **Markdown suppresses red letters.** Markdown reaches the clipboard as *source text*; writing the `text/html` flavour alongside it would let a rich editor pick the HTML and silently discard the Markdown. `renderPassageCopy` therefore renders plain verse text whenever `markdown` is on, and `handleCopy` skips the HTML clipboard flavour.

**Markdown decorates structure only.** It does not italicise the reference or bold the verse numbers: the specified output shows a plain `John 3:16-17 (KJV)` and a plain `(16)`, and a reference in asterisks is noise in a document that already sets its own headings.

**Custom template gets the universal flags and nothing else.** A template composes its own reference, its own numbering and its own line breaks, so a "reference placement" control beside it would be a second, silently-ignored answer to a question the template has already answered. The two universal flags *are* offered, because they change the verse **text**, which a template cannot reconstruct on its own.

The reference is built by `buildPassageReference()` rather than `buildReference()`: the passage box accepts "John 3-5" and whole books, and `buildReference` reads the chapter from `VerseContext`, which holds only one.

## Persistence

Separate localStorage keys, each read back per-field with its own fallback so one bad value cannot discard the rest:

| Key | Holds | Owner |
|---|---|---|
| `bible-desktop-last-copy-format` | the copy mode's selected format id | `verseCopyService.ts` |
| `bible-desktop-last-copy-format-options` | `FormatOptions` (translation label, red letter) | `verseCopyService.ts` |
| `bible-desktop-last-copy-options` | the `CopyOptions` record (`includeReference`, `includeVerseNumbers`, `includeTranslation`) used by the plain formatting helpers | `verseCopyService.ts` |
| `bible-desktop-copy-advanced-options` | `AdvancedCopyOptions` | `advancedOptions.ts` |
| `bible-desktop-passage-insert-options` | `{ [formatId]: PassageMarkupOptions }` - one record per note-insertion format | `passageMarkupPreferences.ts` |
| `bible-desktop-last-insert-format` | the notes picker's selected format id (either family) | `passageMarkupPreferences.ts` |
| `bible-desktop-passage-insert-skip-menu` | "always use this format": Tab inserts without asking | `passageMarkupPreferences.ts` |

plus the saved templates and the active template text/name (`bible-desktop-copy-templates`, `bible-desktop-copy-active-template`, `bible-desktop-copy-active-template-name`) in `savedTemplates.ts`. All are written as they change rather than on Copy, so dismissing with Escape does not throw the settings away.

**Two format keys, one dialog.** Copying to a clipboard and writing into a document are different acts, and someone who habitually pastes an inline quote into an email may just as habitually quote a numbered block into a sermon; one dialog does not make one preference. Choosing a *clipboard* format from the notes editor writes both, so "the format I was last using" cannot disagree between the two surfaces for a format they render identically.

**Why the advanced options are not part of `FormatOptions`.** `FormatOptions` is serialised into note content by `VerseExpansionMark` (see [notes-writing.md](notes-writing.md)) - widening it would push a blob of Advanced-only shape settings into every saved `.bn` file, for a format expansions never use.

The markup shape options *are* serialised there, as `PassageInsertOptions` (`FormatOptions` plus the four optional shape fields), and deliberately so: without them "change this passage's format" could not reopen an H2-per-verse passage as an H2 one. They are the settings of a format expansions actually use, and they are optional, so a clipboard-format expansion writes only the two universal flags.

**Why per-format rather than one shared record.** Heading level means nothing to an inline quotation and quote marks mean nothing to a heading, so a single option set is not merely wasteful - it makes the user re-choose every time they switch shape. Each format gets its own record, and the last-used format is remembered so the picker reopens where they left it.

## Tests

| File | Description |
|---|---|
| `packages/core/src/Services/PassageFormat/passageCopyRenderer.test.ts` | The registry's three-format list; both specified output shapes; each shape ignoring the other's options; reference placement, verse numbers, paragraph and chapter breaks, Markdown, chapter-carrying labels; and that a format renders through the `CopyFormatSettings` it is handed |
| `src/ui/services/copyFormats/advancedOptions.test.ts` | This app's half: the options round-trip its storage key, degrade per field on a bad value, and `loadCopyFormatSettings()` carries both the saved options and the active template |
| `packages/core/src/Services/PassageFormat/passageMarkup.test.ts` | The four note-insertion shapes with and without each option, the chapter-carrying labels, escaping, and the text/source-text/Markdown renderings - including the clipboard's Markdown and quote-decoration choices, and that `passageMarkupToMarkdown` is the fully-decorated case of `passageMarkupToSourceText` |
| `src/ui/services/copyFormats/passageMarkupPreferences.test.ts` | Per-format options round-trip a restart and stay independent; per-field fallback; last-used format; the skip-the-menu flag |
| `src/ui/components/FormatOptionsPanel.test.tsx` | The two universal options, resolved against the real `en` catalog |
| `packages/core/src/Services/PassageFormat/formatCatalog.test.ts` | The catalog's order and numbering, that one id has exactly one number whichever way it is looked up, that numbers come from the declared order rather than from a resolved position, that the shortcut claims only bare digits inside the list - and the retired formats: never offered (including through the "append what the order does not mention" path), still resolvable, included on request, and remapped onto the shape each replaced |
| `src/ui/components/shared/VerseFormatPicker.test.tsx` | The picker: every offered format in catalog order under its catalog number, the number kept out of the accessible name, selection following the arrow keys, Enter left alone for the dialog, and a retired format appearing only when it is the one selected |
| `packages/core/src/Services/PassageFormat/formatHelpers.test.ts` | Verse-text extraction and reference building |
| `packages/core/src/Services/PassageFormat/htmlText.test.ts` | The DOM-free tag stripping and entity handling, pinned case by case - words-of-Christ spans, the divine name, italics and `<transChange>` added words, footnote markers and note bodies, entities - plus the three divergences a string transform cannot avoid (no tag balancing, a named entity kept as written, a bare `>` left unescaped) |
| `src/ui/components/CopyOptionsDialog.test.tsx` | The `copy` mode end to end: dialog chrome, that it is portaled out of the pane, Escape, the five-radio format list with its number badges and descriptions, the retired formats' absence, per-format option visibility, output shapes through the live preview, the verse-number labels, the block-quote helper's place in the variable reference, per-format persistence, the structural HTML flavour, and the digit shortcuts with their text-entry guard |
| `e2e/tests/copy.spec.ts` | Copy format and template tests (E2E) |

## The two clipboard flavours

`verseCopyService.copyToClipboard(text, html?)` writes `text/plain` and, when "Words of Christ in red" is on (the default) and the output is not Markdown, `text/html`. A rich editor such as the Notes TipTap editor takes the HTML flavour; `NoteEditor` registers no paste transform, so whatever is written here is what lands in the note.

`PassageDialog` builds that HTML by turning newlines into `<br>` - one `<br>` per newline, and nothing extra for an empty line, so the single blank line `passageCopyRenderer` puts between the reference and the passage arrives in a note as one break. Guarded by the "clipboard flavours" test in `CopyOptionsDialog.test.tsx`, which counts `<br>` against the newlines in the plain-text flavour. A markup shape never takes this path - its rich flavour is the block tree itself.

## Exporting notes

The export path a user can reach is **Export My Notes...**, the `notes.export` command in `commands/notesCommands.ts`, handled directly in `App.tsx`; see [notes-writing.md](notes-writing.md).
