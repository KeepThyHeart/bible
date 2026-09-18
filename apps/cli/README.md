# `@bible/cli`

A lightweight, read-only terminal Bible reader. Single self-contained
executable — no runtime to install.

**Status: one screen (2026 redesign, task 0001-bible-cli).** The original
17-screen app — tabs, a `:` command palette, parallel versions, fixed-geometry
columns, a separate help page and search-syntax page — was deliberately
simplified away at the human's request. What ships now is one screen
(`src/screens/Main.ts`): a Bible pane, and a Study pane beside it on a wide
terminal (or swapped in for it on a narrow one) that shows cross references,
commentaries, topics, dictionaries, books, history, bookmarks, options and
search results, all through the same "type a number, press Enter" list. The
module library (`^O`) is the one old screen the human specifically asked to
keep, over the original design's own plan to remove it.

The task thread (`0001-bible-cli`) is the design conversation — message 01 has
the wireframes and the fourteen questions this was built from — and
`src/screens/Main.ts`'s own docblock records the build order, phase by phase.
[`/docs/planning/cli/`](/docs/planning/cli/) describes the *original* design and
is kept for the history; each file there says so.

## Requirements

[Bun](https://bun.sh) — for development and for producing the executable. End
users need nothing; the compiled binary embeds its own runtime.

Bun is a `devDependency` of this package, so `npm install` at the repo root
provides it. It is not required by any other workspace: if Bun is missing, the
compile step prints a skip notice and the rest of the build proceeds.

## Commands

```bash
npm run dev       -w @bible/cli    # run from source
npm run test      -w @bible/cli    # bun test
npm run smoke     -w @bible/cli    # compile probe, from source
npm run typecheck -w @bible/cli    # tsc --noEmit
npm run build     -w @bible/cli    # compile for this machine → build/
npm run build:all -w @bible/cli    # compile all four targets → build/
```

Tests that need a real module read them from the repo's `data/modules`, and skip
themselves when one is not present, so a green run in an empty checkout does not
prove the repository round-trip.

Targets are `bun-windows-x64`, `bun-linux-x64`, `bun-darwin-arm64` and
`bun-darwin-x64`, all cross-compiled from one machine.

## Layout

```
src/
  index.ts        argument handling and the "is this a terminal" check
  version.ts      build identity; the version is injected by --define
  smoke.ts        compile probe (see below)
  assets/         files embedded into the executable
  app/
    startup.ts          empty ~/.bible → first drawn frame, in order
    App.ts               the shell: terminal, input line, session, persistence
    frame.ts             the chrome every screen is drawn inside
    input.ts             the input line: reference, search, or a chapter step
    library.ts           open modules, the canon, core's navigation service
    state.ts             ~/.bible/state.db — last place, options, bookmarks,
                          last commentary; the only file this app writes
    layoutConfig.ts       named constants for the wide/narrow split (question 14)
    history.ts            this-session navigation history, ported from the
                          desktop/web apps' addHistoryEntry (`h`)
    studyPanes.ts         pure data for x/c/m/t/d/k — no rendering, no keys
    commentaryMarkup.ts   HTML/Markdown module content → terminal rows
    search.ts             full-text search (`/` on text that is not a reference)
    bookmarks.ts          add/rename/re-point/reorder/delete (`b`)
    verseText.ts         formatting.spans → styled runs (red letter, LORD, italics)
    selection.ts         ranges: anchor + cursor, shift+arrow, the summary line
  data/
    BunSql.ts     ISql over bun:sqlite — the only binding to @bible/core
    modules.ts    module discovery across the five roots
    firstRun.ts   extraction of the embedded KJV
    bookIndex.ts  proximity-search index — read this before using NEAR
  screens/
    types.ts      the screen contract every other screen implements
    Main.ts       the only screen: the Bible pane, the Study pane, every
                  study view (x/c/m/t/d/k/h/o/b, search results) as one
                  "type a number, Enter" list
    Modules.ts    the module library (`^O`), with a reason for every
                  unusable file — the one old screen the redesign kept
  term/
    screen.ts     diffing renderer over the alternate screen buffer
    style.ts      colour capability, the theme, SGR emission
    keys.ts       escape-sequence decoding
    raw.ts        raw mode, input pump, resize, terminal restoration
    layout.ts     wcwidth and the one wrapping implementation
    reading.ts    the two reading modes, as attributed styled rows
    markdown.ts   the Markdown parser commentaryMarkup.ts falls back to
    clipboard.ts  OSC 52 and the native helpers
    keyProbe.ts   `--keys`, the terminal compatibility instrument
scripts/
  build.js        bun build --compile, run by Node so a Bun-less machine skips
  make-fixture.ts a minimal FTS5 database, so CI can run the probe
```

`screens/types.ts` is the contract `Main.ts` and `Modules.ts` both follow: the
shell (`app/App.ts`) owns the chrome and the input line, and a screen returns a
view and an action rather than performing one. Everything under `app/` besides
`App.ts` itself is deliberately *pure* — no rendering, no keys — on the same
split `history.ts` and `studyPanes.ts` set: `Main.ts` is the only place that
turns that data into rows and owns a key.

## The bundled KJV

`src/assets/bible_kjv.db` is **generated, not checked in**:

```bash
node scripts/build-cli-kjv.js     # 49.3 MB module → 10.4 MB trimmed
```

It is an ordinary module with `interlinear_word` removed — that one table is
three quarters of the file. Without it, `scripts/build.js` writes an empty
placeholder so the package still compiles, and the app reports that it ships no
bundled Bible.

## Keys

The Study pane's hints line lists these live, with a count beside each where
one applies; this is the same table for reference.

| Key | Does |
|---|---|
| `↑` `↓` | Move the verse cursor, rolling into the neighbouring chapter at either end |
| `n` `>` / `p` `<` | Next / previous chapter |
| `x` `c` `m` `t` `d` `k` | Cross-references · commentaries · last commentary · topics · dictionaries · books |
| `h` `o` `b` | History · options (translation, layout, colour, …) · bookmarks |
| `s` | Show/hide the Study pane (wide) or swap to/from it (narrow) |
| `/` | Go to a passage, or search if it doesn't parse as one |
| `pgup` `pgdn` / `space` | Scroll the Study pane — the arrows stay verse keys everywhere |
| `shift+↑` `shift+↓` | Extend a range. `v` then `↓` if your terminal keeps shift+arrow |
| `alt+c` or `y` | Copy the cursor verse, or the selected range |
| `^O` | The module library — the one old screen this redesign kept |
| `q` | Quit |
| a digit, then `Enter` | Pick a numbered row in whichever list is open |
| anything else printable | Typed into the input line, once `/` has opened it |

**A letter command fires only while the input line is empty (closed).** With
the line open, every printable key is text — `s` is either "study" or the
first letter of `still small voice`, and both cannot be true of the same
keystroke. `/` opens the line; there is no separate search prefix or command
character to remember, and `//text` forces a search for text that would
otherwise parse as a reference.

## `bible --keys`

Prints what the current terminal actually sends for each key, and tracks which
of the bindings the app depends on have been seen. Terminals disagree here, and
several intercept `alt+digit` outright, so this is measured rather than assumed
— which is why `alt+c` also has the `y` fallback in the Keys table above.

## The compile probe

`src/smoke.ts` exists because a hello-world binary proves nothing about the
things this app actually needs. It checks three:

| Check | Why it matters |
|---|---|
| `@bible/core` loads | The barrel pulls the whole Data layer. If it resolves under `--compile`, every later import does. |
| `bun:sqlite` read-only + FTS5 `MATCH` | Search is FTS5 (DesignSpec §3.1); modules are opened read-only and never written. |
| An embedded asset is readable | How the trimmed KJV ships inside the binary. |

```bash
npm run smoke -w @bible/cli                       # from source
npm run build -w @bible/cli -- --entry=smoke      # compiled
./build/smoke-windows-x64.exe                     # then run it
```

Both must pass. Running from source proves the code; running the compiled
binary proves the toolchain, which is the part that was actually in doubt.

## Rules

- Never write to a module `.db`. Modules are opened read-only.
- Never write outside `~/.bible/`.
- `@bible/core` is consumed, not modified — see DesignSpec §2.4.
