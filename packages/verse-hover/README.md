# Verse Hover

A drop-in script that finds Bible references on a web page ("John 3:16", "Rom. 8:28", "1 Cor 13:4-7"),
turns them into links, and shows the verse in a popup on hover (tap on a phone).
Self-hostable, no dependencies, no Node.js needed on your server. GPL-3.0-or-later.

## Quick start (static files, no server code)

1. Generate the verse files from a translation `.db` (needs PHP or Node once, on your own machine):

   ```
   php verse-hover.php build-static --db=bible_kjv.db --out=bible-data --gzip
   ```
   About 1.7 MB gzip per translation, one small file per chapter (a hover costs ~1.4 KB). Upload `bible-data/`.
2. Upload `verse-hover.min.js` and `verse-hover-ui.min.js` (or the one-file `verse-hover.all.min.js`).
3. Add one tag:

   ```html
   <script src="/verse-hover.min.js" defer
           data-vh='{"source":{"type":"static","base":"/bible-data/"},"translation":"KJV"}'></script>
   ```

## Quick start (PHP endpoint)

Put `verse-hover.php` next to the `.db` (keep the `.db` out of the web root or deny it; see `php/README.md`), then:

```html
<script src="/verse-hover.min.js" defer data-vh='{"source":{"type":"php","url":"/verse-hover.php"},"translation":"KJV"}'></script>
```
PHP 7.4+ with `pdo_sqlite` or `sqlite3`; the database is opened read-only.

## Files and sizes (min + gzip)

| File | Size | Purpose |
|---|---|---|
| `verse-hover.min.js` | ~7 KB | core: finds references, links them, loads the UI half on idle |
| `verse-hover-ui.min.js` | ~6 KB | popup, data client, default CSS (loaded by the core, next to it) |
| `verse-hover.all.min.js` | ~12.5 KB | the two above in one file (no second request) |
| `verse-hover-plus.min.js` | ~2 KB | optional chapter reader; loaded only for `click: 'reader'` |
| `locales/vh-locale-xx.js` | ~1.3 KB | an extra language's book names (`"locale":["en","es"]`) |
| `verse-hover.css` | | the default stylesheet, for `theme: 'none'` sites that want to link it |

## What gets linked

A reference needs at least a chapter: "Romans 8", "John 3:16-18", "Gen 1-3", "Rom 3:23; 6:23, 25".
**A book name on its own ("Job", "II Corinthians") is never linked.** Matching is scored 0-100;
`threshold` is `"strict"` (80), `"normal"` (60, default), `"loose"` (40) or a number.
At `normal`, "Is 1:5" and "Isaiah 53" are linked, "is 1" and "Mark 4" are not (use `"loose"`, or mark it by hand:
`<span data-vh-ref="John 3:16">that verse</span>`). Skipped: `a button script style textarea input select code pre kbd svg`,
`[contenteditable]`, `[translate=no]`, `.vh-skip`, `[data-vh=off]`. Not detected: a reference split across elements.

## Configuration (`data-vh` JSON, `window.VerseHoverConfig`, or `VerseHover.init({...})`)

| Option | Default | |
|---|---|---|
| `source` | `{type:'php',url:'verse-hover.php'}` | or `{type:'static',base,compressed:'none'\|'gzip'}` or `{type:'custom',load(req)}` |
| `translation`, `translations` | `'KJV'` | `translations` enables a version suffix: "John 3:16 (ASV)" |
| `scope` | whole page | CSS selector(s): only text inside matching elements is scanned (and new nodes inside them) |
| `skip` | | extra selectors never scanned |
| `threshold`, `requireVerse`, `ignore` | `'normal'`, `false`, `[]` | `ignore`: book aliases never linked |
| `load` | `'lazy'` | `'eager'` fetches every chapter on the page (max 40) after the scan |
| `context` | `0` | `2` or `{before,after}`: neighbouring verses for a single verse (never across a chapter, none for ranges) |
| `chapterPreview` | `5` | verses shown for a chapter-only reference |
| `click` | `'popup'`, or `'link'` with `linkUrl` | `'popup'`, `'link'`, `'reader'`, `'none'` |
| `linkUrl` | | `https://example.org/read/{version}/{bookName}/{chapter}/{verse}`; placeholders: `version book bookName chapter verse endChapter endVerse ref`. Only http(s) and relative URLs. |
| `wordsOfChrist` | `true` | words of Christ in red; `false`, or CSS `--vh-words: inherit`, turns it off |
| `theme`, `style` | `'auto'` | `style` sets `--vh-*` variables: `bg fg muted accent link border words font fontSize lineHeight maxWidth radius shadow` |
| `template` | built in | markup with `data-vh-slot` slots (below) or `'#template-id'` |
| `verseLayout`, `showVerseNumbers`, `showVersion`, `showHeadings`, `formatting` | `inline`, `true`, `true`, `false`, `true` | |
| `hoverDelay`, `hideDelay` | `150`, `250` | ms |
| `classPrefix`, `nonce`, `uiUrl`, `plusUrl` | `'vh-'` | |

Events: `vh:ready`, `vh:open`, `vh:close` on `document`. API: `VerseHover.init/scan/unscan/parse/open/close/setTranslation/addLocale/destroy`.

### Templates

```html
<template id="my-vh">
  <div><strong data-vh-slot="ref"></strong> <small data-vh-slot="version"></small>
    <div data-vh-slot="verses"><p data-vh-slot="verse"><sup data-vh-slot="num"></sup> <span data-vh-slot="text"></span></p></div>
    <a data-vh-slot="link"></a> <span data-vh-slot="copyright"></span></div>
</template>
```
Slots: `ref version version-name verses verse num text heading link copyright close status`.
Data is only ever inserted with `textContent`.

### CSS classes

Links: `vh-ref`, `vh-ref--range`, `vh-ref--chapter`. Popup: `vh-pop`, `--above`, `--below`, `--sheet` (phones), `--pinned`, `--loading`, `--error`;
parts `vh-pop__head ref ver body foot link close copy`; verses `vh-v`, `vh-v--target`, `vh-v--ctx`, `vh-v__num`, `vh-v__text`;
words `vh-w-s` (supplied, italic), `vh-w-w` (words of Christ), `vh-w-d` (divine name). Every default rule is in `@layer vh` with
zero specificity (`:where`), so any rule of yours wins without `!important`.

## Security and privacy

No cookies; requests are `GET` with `credentials: 'omit'`. Works under a strict CSP (`script-src 'self'`; styles via `adoptedStyleSheets`, or a
`nonce` for the `<style>` fallback). Verse text, headings and copyright text never go through `innerHTML`. `linkUrl` rejects `javascript:`.
`build-static` refuses translations whose licence is not public domain or open unless `--force-license`.

## Development

```
pnpm --filter @bible/verse-hover run build   # dist/
pnpm --filter @bible/verse-hover test        # unit tests (vitest)
pnpm --filter @bible/verse-hover test:e2e    # Playwright (builds and serves demo/article.html)
pnpm --filter @bible/verse-hover run size    # CI size gate
node scripts/gen-locales.mjs                 # regenerate src/locales from packages/core/src/Reference/locales
node scripts/release.mjs                     # release/verse-hover-<version>.zip
php php/tests/run.php --both                 # PHP tests, PDO and SQLite3
```
Book names come from `packages/core/src/Reference/locales/*.json` (task 0077's data) via `gen-locales`, so there is one source.
