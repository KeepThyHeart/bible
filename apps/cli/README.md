# `@bible/cli`

A lightweight, read-only terminal Bible reader, built as a single
self-contained executable: no runtime to install.

One screen (`src/screens/Main.ts`): a main pane on the left — the Bible in
reading mode, or the open study resource in study mode — and, on a wide
enough terminal, a narrower right-hand pane showing the current verse and the
keyboard-shortcut legend for whatever is active. Study mode's resources
(cross references, commentaries, topics, dictionaries, books, history,
bookmarks, options, search results) mostly use the same "type a number, press
Enter" list; options is a plain up/down-then-left/right menu. The module
library (`^O`) is a second screen pushed on top.

## Requirements

[Bun](https://bun.sh), for development and for producing the executable. End
users need nothing; the compiled binary embeds its own runtime.

Bun is a `devDependency` of this package, so `npm install` at the repo root
provides it. No other workspace needs it: if Bun is missing, the compile step
prints a skip notice and the rest of the build proceeds.

The CLI consumes `@bible/core` from its compiled output, so build core first
(from the repo root):

```bash
npm run build:core
```

## Commands

From the repo root:

```bash
npm run dev       -w @bible/cli    # run from source
npm run test      -w @bible/cli    # bun test
npm run typecheck -w @bible/cli    # tsc --noEmit
npm run smoke     -w @bible/cli    # compile probe, from source
npm run kjv       -w @bible/cli    # generate the bundled KJV (see below)
npm run build     -w @bible/cli    # compile for this machine -> build/
npm run build:all -w @bible/cli    # compile all four targets -> build/
npm run clean     -w @bible/cli    # remove build/
```

Targets are `bun-windows-x64`, `bun-linux-x64`, `bun-darwin-arm64` and
`bun-darwin-x64`, all cross-compiled from one machine. Output goes to
`apps/cli/build/`.

`bible --help` lists the command-line forms: open at a reference
(`bible "jo 3:16"`), search (`bible everlasting life`), `--keys`, `--version`.

## Modules

The CLI reads the same module files (`bible_*.db`, `commentary_*.db`, ...) as
the desktop and web apps. It scans these places, in priority order, and uses the
ones that exist:

1. `$BIBLE_HOME/modules`, when `BIBLE_HOME` is set
2. `~/.bible/modules`
3. an installed desktop app's user data (`<appData>/*/data/modules`)
4. an installed desktop app's bundled modules
5. `<repo>/data/modules`, found by walking up from the working directory when
   run inside a checkout

Modules are opened read-only. If the same translation is found twice, the newer
module format wins, then the higher-priority root. `^O` lists everything found,
with the reason for any file that cannot be used.

The tests that need a real module read them from the repo's `data/modules` and
skip themselves when it is absent, so a green run in a checkout with no modules
does not exercise the repository round-trip.

## The bundled KJV

`src/assets/bible_kjv.db` is embedded in the executable and written to
`~/.bible/modules` on first run, so a fresh machine has a Bible to read. The
file is **generated, not checked in**:

```bash
npm run kjv -w @bible/cli    # bun scripts/build-kjv.ts
```

`scripts/build-kjv.ts` copies `<repo>/data/modules/bible_kjv.db` (or
`--source=<path>`), drops the largest table, empties the search-cache tables,
verifies that a phrase query still answers, and writes the asset (or
`--out=<path>`). It uses `bun:sqlite`, so it needs no native npm module. The
result is about 10 MB, against 49 MB for the full module.

`scripts/build.js` runs it automatically when the asset is missing. With no
module library to build from (CI, a fresh clone) it writes an empty placeholder
instead: that build compiles and runs but reports that it ships no bundled
Bible.

## Layout

```
src/
  index.ts        argument handling and the "is this a terminal" check
  version.ts      build identity; the version is injected by --define
  smoke.ts        compile probe (see below)
  assets/         files embedded into the executable
  app/
    startup.ts          empty ~/.bible -> first drawn frame, in order
    App.ts              the shell: terminal, input line, session, persistence
    frame.ts            the chrome every screen is drawn inside
    input.ts            the input line: reference, search, or a chapter step
    library.ts          open modules, the canon, core's navigation service
    state.ts            ~/.bible/state.db: last place, options, bookmarks,
                        last commentary; the only file this app writes
    layoutConfig.ts     constants for the main/right-pane split
    history.ts          this-session navigation history (`h`)
    studyPanes.ts       pure data for x/c/m/t/d/k: no rendering, no keys
    commentaryMarkup.ts HTML/Markdown module content -> terminal rows
    search.ts           full-text search (`/` on text that is not a reference)
    bookmarks.ts        add/rename/re-point/reorder/delete (`b`)
    verseText.ts        formatting.spans -> styled runs (red letter, LORD, italics)
    selection.ts        ranges: anchor + cursor, shift+arrow, the summary line
  data/
    BunSql.ts     ISql over bun:sqlite: the only binding to @bible/core
    modules.ts    module discovery across the roots above
    firstRun.ts   extraction of the embedded KJV
    bookIndex.ts  proximity-search index
  screens/
    types.ts      the screen contract
    Main.ts       the main pane, the right pane and every study view
    Modules.ts    the module library (`^O`), with a reason for every
                  unusable file
  term/
    screen.ts     diffing renderer over the alternate screen buffer
    style.ts      colour capability, the theme, SGR emission
    keys.ts       escape-sequence decoding
    raw.ts        raw mode, input pump, resize, terminal restoration
    layout.ts     wcwidth and the one wrapping implementation
    reading.ts    the two reading modes, as attributed styled rows
    markdown.ts   the Markdown parser commentaryMarkup.ts falls back to
    animate.ts    stepped scrolling
    clipboard.ts  OSC 52 and the native helpers
    keyProbe.ts   `--keys`, the terminal compatibility instrument
scripts/
  build.js        bun build --compile, run by Node so a Bun-less machine skips
  build-kjv.ts    generate the bundled KJV asset
  make-fixture.ts a minimal FTS5 database, so CI can run the compile probe
```

`screens/types.ts` is the contract `Main.ts` and `Modules.ts` both follow: the
shell (`app/App.ts`) owns the chrome and the input line, and a screen returns a
view and an action rather than performing one. Everything under `app/` besides
`App.ts` itself is deliberately *pure* (no rendering, no keys): `Main.ts` is the
only place that turns that data into rows and owns a key.

## Keys

The right pane's legend lists these live, with a count beside each where one
applies (on a terminal too narrow for it, the footer's one-line hint does the
same job, and `s` peeks at the full legend — see below); this is the same
table for reference.

**Reading mode** (main pane: the Bible):

| Key | Does |
|---|---|
| `up` `down` | Move the verse cursor, rolling into the neighbouring chapter at either end |
| `n` `>` / `p` `<` | Next / previous chapter |
| `x` `c` `m` `t` `d` `k` | Cross-references, commentaries, last commentary, topics, dictionaries, books — each enters study mode |
| `h` `o` `b` | History, options (translation, layout, colour, ...), bookmarks — also study mode |
| `s` | On a narrow terminal (no right pane): peek at the shortcut legend, without leaving reading mode. No effect on a wide one — the right pane already shows it |
| `/` | Go to a passage, or search if it doesn't parse as one — opens a popup with usage text and, once something is typed, a live preview of where it goes |
| `shift+up` `shift+down` | Extend a range. `v` then `down` if your terminal keeps shift+arrow |
| `alt+c` or `y` | Copy the cursor verse, or the selected range |
| `^O` | The module library |
| `q` | Quit |

**Study mode** (main pane: the open resource — `x`/`c`/`m`/`t`/`d`/`k`/`h`/`o`/`b` above):

| Key | Does |
|---|---|
| `up` `down` / `pgup` `pgdn` / `space` | Scroll the resource — the verse cursor is untouched |
| `<` `>` | Step the verse cursor one at a time, staying on the same resource, for the views that follow the cursor (cross references, commentaries, topics). In a commentary entry, a step that would land inside the passage already showing is held rather than applied — `f` shows it anyway |
| a digit, then `Enter` | Pick a numbered row, in the views that list one |
| `up` `down` (in Options) | Select a setting |
| `left` `right` (in Options) | Change the selected setting's value |
| `?` | Expand/collapse the right pane's shortcut legend, for when there are more than fit |
| `esc` | Back — one level, or out to reading mode |
| `s` | Back to reading mode |

`/` is shared: it always opens the popup, wherever you are.

**A letter command fires only while the input line is empty (closed).** With
the line open, every printable key is text: `s` is either "back to reading" or
the first letter of `still small voice`, and both cannot be true of the same
keystroke. `/` opens the line; there is no separate search prefix or command
character to remember, and `//text` forces a search for text that would
otherwise parse as a reference.

## `bible --keys`

Prints what the current terminal actually sends for each key, and tracks which
of the bindings the app depends on have been seen. Terminals disagree here, and
several intercept `alt+digit` outright, so this is measured rather than assumed,
which is why `alt+c` also has the `y` fallback in the Keys table above.

## The compile probe

`src/smoke.ts` exists because a hello-world binary proves nothing about the
things this app actually needs. It checks three:

| Check | Why it matters |
|---|---|
| `@bible/core` loads | The barrel pulls the whole Data layer. If it resolves under `--compile`, every later import does. |
| `bun:sqlite` read-only + FTS5 `MATCH` | Search is FTS5; modules are opened read-only and never written. |
| An embedded asset is readable | How the bundled KJV ships inside the binary. |

```bash
# from apps/cli
bun scripts/make-fixture.ts /tmp/fixture.db       # a minimal module for the probe
bun src/smoke.ts /tmp/fixture.db                  # from source
node scripts/build.js --entry=smoke --local       # compiled
./build/smoke-linux-x64 /tmp/fixture.db           # then run it
```

Both must pass. Running from source proves the code; running the compiled
binary proves the toolchain. CI (`.github/workflows/cli.yml`) does exactly this
and then cross-compiles all four targets.

## Rules

- Never write to a module `.db`. Modules are opened read-only.
- Never write outside `~/.bible/`.
- `@bible/core` is consumed, not modified.
