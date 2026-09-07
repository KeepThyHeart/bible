# Copy & Export

**Last verified:** qa_claude working tree (2026-09-05)

Copy a passage to the clipboard, in one of the four numbered passage shapes
`@bible/core` offers.

## The engine is core's; this app owns the chrome and the storage

The formatting used to be written out inline in `CopyDialog.tsx` — 1362 lines,
of which `getFormattedText()` and `renderPreview()` were two parallel
implementations of the same output (the second existing only so that words of
Christ could be shown in red), plus `refInline`, `refOwnLine`, `mdRef`,
`mdHeading`, `mdVerseNum`, `paragraphMarkdown`, `fullMarkdown`,
`buildHtmlForCopy`, `verseLabel`, `cleanVerseText` and `stripHtml`. All of that
is gone. `packages/core/src/Services/PassageFormat/`, exported through
`@bible/core/browser`, is now the single implementation, shared with the desktop
app — see [desktop's copy-export doc](../../../desktop/docs/features/copy-export.md)
for how the engine itself is put together.

What is left here is a Preact shell: a reference box, a numbered format list,
the option controls, a preview, and the clipboard call.

## Files

| File | Description |
|---|---|
| `src/components/Dialogs/CopyDialog.tsx` | **The dialog.** Reference box, numbered format list, per-format options, live preview, copy button. Also holds `parseReferenceRange` and the chapter-fetching effects, which are about *which verses*, not about how they are laid out |
| `src/components/Dialogs/copyPreferences.ts` | The `localStorage` half: the `bible-reader-copy-*` keys, and the migration of a format id written before the catalogue was shared. The *meaning* and the validation are core's |
| `src/hooks/useAppShared.ts` | Owns the global **Ctrl+C** key handler that opens the dialog (only when `window.getSelection()` is empty) |
| `src/hooks/useContextMenu.ts` | Right-click menu; the `copy` action calls `setCopyOpen(true)` |

## The numbered format list

`getPassageFormatCatalog()` is the one ordered, numbered list both apps read, so
"format 3" names the same shape here as in the desktop app.

| # | Format | Shape |
|---|---|---|
| **1** | Block quote *(default)* | The whole passage as one quote, broken only where the source text is |
| **2** | Numbered quote | One quote, each verse numbered and on its own line |
| **3** | Inline quote | Reference and quotation on one line, inside the sentence |
| **4** | Verse headings | A heading per verse with the verse quoted beneath it |

The catalogue's fifth entry, **Custom Template**, is filtered out — it needs a
template editor beside it and stays hidden for the v2 release, exactly as the
old `template` format was. The filter is on `family === 'markup'`, which excludes
the whole clipboard family (core's retired `standard` and `combined`, plus
`template`) in one rule and is why the selected format can be typed as a
`PassageMarkupFormatId`. It does **not** renumber anything: `blockquote` is 1
and `heading-per-verse` is 4 here as they are on the desktop, and un-hiding the
template later restores 5 rather than shuffling the others.

**The numbers are keys.** Pressing `1`–`4` selects that format, a badge in front
of each name says so, and a hint line under the list explains the badges. The
badge is `aria-hidden` — it is a keyboard hint, not part of the format's name.
A digit is claimed only when it is bare (a modifier means the user is reaching
for something else) and only when focus is outside a text entry: the reference
box is mostly digits, so claiming them there would make the field unusable. A
number past the end of the list — `5`, the hidden template — does nothing.

The list is a radio group (`role="radiogroup"` with native radios), which is
what a single-choice list *is*, and which brings arrow-key navigation for free:
arrowing down the list plays each shape through the preview beside it.

## Layout

Formats and their options on the left, live preview on the right, so a toggle
and its effect on the output are one glance apart. Under 760px the two columns
stack and the preview lands beneath the list.

## The preview is the block tree, not a second formatter

`renderPassageMarkup()` returns blocks tagged `paragraph | heading | quote |
placeholder`, and every line carries both an `html` flavour (red-letter spans
intact) and a `text` one. `MarkupPreview` renders those blocks, so the preview
shows the real structure — a `<blockquote>`, real `<h3>`s — and colours the
words of Christ without knowing which words those are. That is what replaced
`renderPreview()`, whose whole reason for existing was that it could show red
where the flat string could not.

Two things the preview honours beyond the blocks:

- **Text format `inline`** drops the `<blockquote>` wrapper, because the copied
  text carries no quote decoration in that mode either.
- **Markdown previews as its own source text**, in a `<pre>`. It reaches the
  clipboard as literal markup, so rendering the structure would show styling
  the paste will not carry.

Line HTML is passed through `utils/sanitize`: it originates in a module's
`text_html`, which is third-party markup.

## Options

Only controls the selected format can act on are rendered; a control that would
do nothing is absent rather than inert. Which ones apply comes from core's
`PassageMarkupFormatMeta.controls`.

| Option | Formats | Effect |
|---|---|---|
| Reference | all four | Before, After, or None |
| Verse numbers | all four | In parentheses (16), Superscript ¹⁶, or None |
| Heading level | Verse headings | H1–H6 |
| Quote marks | Inline quote | `“”`, `‘’`, or none |
| Room to comment | Numbered quote, Verse headings | A labelled paragraph under each verse |
| Display translation | all | `(KJV)` on the reference |
| Words of Christ in red | all | Red-letter runs survive into the `text/html` clipboard flavour |
| Markdown formatting | all | Block quotes as `> ` lines, headings as `#` |
| Text format | all but Inline quote | Block quote (`> ` in Markdown, four-space indent otherwise) or Inline (bare text) |

The last two are `AdvancedCopyOptions` rather than shape options, because they
are questions about the *clipboard* rather than about the shape. An inline
quotation has no quote block to decorate, so it is not offered Text format.

Markdown no longer italicises the reference or bolds verse numbers as the old
`mdRef`/`mdVerseNum` did: it decorates *structure* only, matching the desktop
app's specified output.

## The two clipboard flavours

`text/plain` is always written: the block tree run through
`passageMarkupToSourceText`, honouring Markdown and the block-quote choice. A
plain-text block quote has no `>`, so it is set off by a four-space indent.

`text/html` is written alongside it when **Words of Christ in red is on and
Markdown is off** — the same rule the desktop app applies. It is
`passageMarkupToHtml(markup)`, the block tree itself, so pasting "Verse
headings" into a document gives real headings and a real block quote rather
than a run of quote markers. Writing HTML beside Markdown would let a rich
editor pick the HTML and silently discard the Markdown the user asked for, so
that case writes plain text only.

The plain flavour is derived from the source text with core's `stripHtmlTags` +
`decodeHtmlEntities` rather than a detached `<div>`'s `textContent`: those are
DOM-free and, unlike the whitespace-collapsing `stripHtml`, preserve the line
structure the passage was written into. If `navigator.clipboard.write` is
unavailable or refused, the copy falls back to `writeText` with the plain
flavour.

## Persistence

| Key | Holds |
|---|---|
| `bible-reader-copy-format` | the selected format id |
| `bible-reader-copy-markup-options` | `{ [formatId]: PassageMarkupOptions }` — one record per shape |
| `bible-reader-copy-options` | `AdvancedCopyOptions` (of which only `textFormat` is still editable) |
| `bible-reader-copy-markdown` | the Markdown flag, `'1'`/`'0'` |

All are written as they change rather than on Copy, so dismissing with Escape
throws away the copy and never the settings. Markdown keeps its own key rather
than riding in the options blob because that is where existing users'
preference already is; `loadAdvancedOptions()` folds the two back together.

Shape options are per format, for the reason core's defaults differ per format:
heading level means nothing to an inline quotation and quote marks mean nothing
to a heading, so one shared record would make the user re-choose every time
they switched shape.

**Everything read back is normalized** through core's
`normalizeAdvancedCopyOptions` / `normalizePassageMarkupOptions`, per field, so
a stale field or an enum value from an older build costs the user that one
setting rather than all of them.

### Migrating off the old format list

This dialog used to have a list of its own — `standard`, `plain`, `paragraph`,
`full`, `advanced`, `template` — and an existing user's stored id is one of
those. `loadFormatId()` handles it in two steps:

1. `remapLegacyFormatId()` moves core's retired ids onto the shape each was a
   weaker restatement of, so `standard` lands on **Numbered quote**.
2. Anything that still does not resolve against the offered list — `plain`,
   `paragraph`, `full`, `advanced`, or `template` (which exists but is hidden)
   — falls back to `DEFAULT_PASSAGE_FORMAT_ID`, **Block quote**. An unselected
   list with a blank preview would be worse than landing somewhere sensible.

## Triggers and keys

- **Ctrl+C** when no text is selected opens the dialog; when text *is* selected
  the browser's native copy runs instead, so dragging out a phrase still works.
- Right-click context menu "Copy Passage..."
- **1**–**4** pick a format, unless focus is in a text field.
- **Enter** copies and closes — so Ctrl+C, Enter is the whole gesture. Ignored
  while a `<textarea>` or a `<button>` has focus, which own Enter themselves.
  Clicking the copy button instead leaves the dialog open and shows "Copied!",
  so a second copy after tweaking options costs no reopen.
- **Escape**, and a click on the overlay, close without copying.
- The reference box takes "John 3:1-5", "John 16-21", "John 16:1-17:5", a whole
  book, or a bare "1-5" read against the open chapter, and adjusts the passage
  without closing. A shift-click passage selection in the Bible pane (see
  [Bible Pane](bible-pane.md)) prefills it with the whole range.

`parseReferenceRange` stays local rather than moving to core's
`ReferenceParser`: it also accepts the two book-less forms above, read against
the tab already open, and reports a whole-book request as a flag the
chapter-fetching effect acts on. Core's parser answers a different question —
what passage does this string name, in isolation.

One consequence of core owning the reference *string*: a whole-book copy is now
cited as "John 1:1-21:25 (KJV)" rather than "John", because
`buildPassageReference` reads the span off the verses.

## Tests

`src/components/Dialogs/CopyDialog.test.tsx` — 60 tests: the offered list and
its numbering, the template's absence, the radio group, the digit shortcuts and
their text-entry guard, the reference box widening the passage without closing,
the preview as real structure for each shape and following each option
(including red letters), option visibility per format, Markdown as a restyling
of whichever format is selected, both clipboard flavours and the fallback, the
Enter gesture with its focus exceptions, and preference persistence including
the legacy-id migration.

The file pins `@vitest-environment jsdom`, for the reason
`src/utils/sanitize.test.ts` sets out: under happy-dom 15 DOMPurify mangles its
own output, dropping a fragment's leading text node and the first element's
attributes — which is exactly the verse number and the red-letter span.

The output *shapes* themselves are pinned in core, by
`packages/core/src/Services/PassageFormat/passageMarkup.test.ts`, and are not
re-derived here.

`e2e/tests/ui-e2e.spec.ts` checks the dialog opens from the context menu with
its four-radio format list and closes on Escape.
