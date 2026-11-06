# @bible/ui-driver

Drive the web app and the Electron desktop app as text, from Bash, across turns.
You get an accessibility snapshot with short refs (`[r12] button "Search"`), act on refs, and
each action replies with only what changed. A screenshot costs ~1.5k tokens and has no refs;
a full snapshot of a main screen is 300–1000 tokens, and a typical action reply is 20–80.
Use it for exploratory testing: many cheap steps. Use screenshots for visual judgement.

## Quick start

```bash
alias drive='node packages/ui-driver/bin/drive.ts'   # from the repo root
drive start web            # local server on fixture data (needs a built client), or: drive start desktop
drive snapshot             # the whole screen, with refs
drive click r9             # replies with the diff it caused
drive fill r10 love one another --enter
drive errors               # console errors, page errors, failed requests since the last `errors`
drive check                # heuristics: unnamed controls, overflow, covered/overlapping, focus, i18n
drive stop
```

The first command starts a per-session daemon (unix socket); later commands reuse it. Sessions:
`--session NAME` or `DRIVE_SESSION=NAME` for parallel sessions; `DRIVE_DIR=/path` puts the socket,
transcript, screenshots and server log in a directory you choose (otherwise
`$TMPDIR/bible-ui-driver/<session>/`). `drive serve --stdio` reads one command per line and answers
one JSON line each, for a long-running harness instead of the daemon. The daemon exits after
30 minutes idle.

Prerequisites: `pnpm run setup` (modules), then `pnpm run build:web` and/or `pnpm run build:desktop`.
`start` says what to build when something is missing.

## Commands

`drive help` prints them all; `drive help CMD` one. Every action takes `--quiet` (`-q`, reply `ok`
plus errors, no diff) and `--timeout ms` (default 5000).

| Command | Notes |
|---|---|
| `start [web\|desktop\|path/to/manifest.json] [--url URL] [--viewport WxH] [--headed] [--keep]` | `--url https://bible.keepthyheart.com` drives the live site **read-only** (only GET/HEAD/OPTIONS go out; others are blocked and listed under `errors`). A loopback `--url` (`http://127.0.0.1:PORT`, `localhost`) drives a local server that is already running, normally (not read-only), and starts no server of its own: several sessions can share one server (another session's, or one started by hand) to save memory. `--keep` keeps the throwaway profile. |
| `stop`, `status` | |
| `snapshot [rN] [--depth N] [--max N] [--visible] [--all]` | `rN` scopes to one element (a native `<select>` then lists its options); `--visible` only what is in the viewport, and only the modal dialog when one is open (menus and popovers are not filtered); long lists show 9 items and a count; 150 lines max unless `--max`/`--all`. |
| `diff` | Changes since the last snapshot or action. Actions already include it. |
| `find [TEXT] [--role ROLE]` | Search names/values of the whole page without printing it (TEXT optional with `--role`). Cheapest way to get a ref. |
| `click rN [--right]`, `dblclick rN`, `hover rN` | |
| `type rN TEXT [--enter]`, `fill rN TEXT [--enter]` | `type` sends keystrokes and appends; `fill` replaces. |
| `press KEY`, `press rN KEY` | Playwright key names: `Enter`, `Escape`, `Tab`, `Control+k`. |
| `select rN OPTION` | Native `<select>` only (by label, then value). |
| `check rN`, `uncheck rN` | Checkboxes, radios, switches. |
| `scroll [rN] [up\|down\|left\|right] [px]` | No ref: wheel the page. `scroll rN`: bring into view. |
| `goto URL\|/path`, `back`, `forward`, `reload` | |
| `resize WxH` | |
| `wait TEXT`, `wait gone TEXT\|rN`, `wait rN`, `wait idle`, `wait url TEXT`, `wait MS` | Replies with the diff, like an action. |
| `errors [--all] [--warn] [--clear]` | New since the last `errors` unless `--all`. |
| `check [names overflow overlap focus i18n narrow tab all]` | Without kinds: the cheap five. `narrow` re-checks layout at 360 px wide and restores; `tab` presses Tab until focus wraps (max 80) and reports the order, invisible stops and traps, then puts focus back. `narrow` and `tab` change layout/focus while they run. |
| `screenshot [rN] [--full] [--path P]` | Returns the path; read the image only when you need to see it. |
| `log [--tail N]`, `log --playwright [--path P]` | The session transcript, or a Playwright spec that replays it (review locators before committing it as a test). |
| `pages`, `page N` | Popups and extra windows. |

## Reading replies

```
page "Keep Thy Heart Bible Reader" /#/KJV/1/1 1280x800 focus=r10
[r8] banner
  [r10] textbox "Press / or Ctrl+K to search" ="love"
  [r22] button "Recent passages" collapsed
  "Genesis 1 loaded"                       <- text
  … +41 more (clickable×31, button×8)      <- collapsed list: snapshot r16 --all, or find
```

`clickable` is an element with no ARIA role that behaves like a control (pointer cursor, tabindex,
onclick): a finding in itself if it should be a button. States: checked/unchecked/mixed,
expanded/collapsed, selected, pressed, disabled, focused, required, invalid, current, readonly, modal.

Action replies (diff):

```
focus: body → r177
+ [r177] dialog "Theme" focused modal (+4 inside)
    [r178] button "Light"
~ [r10] textbox "Search": ="" → ="love"
- [r7] button "Open"
~ [r66] complementary "Study panel": 2 changed, +23, -5; first: …   <- many changes folded
! 1 new error: [console] TypeError: x is undefined (main.js:12)
! focus lost: r5 was removed, focus is on body
```

`ok` alone means the action changed nothing visible. A failure names the cause:
`click r158 failed: covered by div.fixed.inset-0[testid=first-run-language-backdrop]`.

Refs stay the same while an element exists, and also when the framework re-renders it as an
equivalent element (same role, name and parent). A ref whose element is gone gives
`stale ref r12 (was button "Save"): element gone; run snapshot`.

## Sample session (web, recorded; ~450 tokens of replies in all)

```
$ drive start web
started web http://127.0.0.1:40625 (local server, fixture data) in 4.0s (session default)
page "Keep Thy Heart Bible Reader" /#/KJV/1/1 1280x800
$ drive find Theme
[r12] button "Theme"  < [r8] banner
$ drive click r12
focus: body → r83
+ [r83] dialog "Theme" focused modal (+4 inside)
    [r84] button "Light"
    [r85] button "Dark"
    [r86] button "Sepia"
$ drive click r179
stale ref r179: element gone; run snapshot
$ drive fill r10 love one another --enter
focus: r83 → body
~ "19 results" (was "Genesis 1 loaded")
~ [r10] textbox "Press / or Ctrl+K to search": ="" → ="love one another"
~ [r11] button: name "Go to Passage" → ""
+ [r88] button "Go to Passage"
~ [r83] dialog "Theme": -focused
~ [r66] complementary "Study panel": 2 changed, +22, -11; first: [r89] button "Search"
$ drive check
check: 2 issues
unnamed 1: [r11] button has no accessible name
modal-background 1: [r83] dialog "Theme" modal 57 controls behind the open modal are not inert/aria-hidden (screen readers still reach them)
$ drive errors
none new
$ drive log --playwright
wrote $DRIVE_DIR/repro.spec.ts (7 steps; review locators before committing)
$ drive stop
stopped session default (7 commands; transcript $DRIVE_DIR/transcript.jsonl)
```

(`r179` was a typo; it now answers `unknown ref r179 (refs so far: r1..r87)`. A ref whose element is gone answers `stale ref r12 (was button "Save")`.)

## When to use a screenshot instead

- Anything visual: colours, contrast, alignment, spacing, icons, "does it look right".
- Canvas, SVG drawings, images and video, which the tree only names.
- When a reply surprises you (an element the tree says is there but a click lands elsewhere):
  one screenshot settles it.

The `check` heuristics are hints, not verdicts: `covered` and `overlap` use hit-testing at the
element's centre (a button laid inside a text field, like a search box's clear button, is not an
overlap); `i18n` flags key-like strings (`settings.title`), unresolved placeholders (`{{count}}`)
and, on a non-English page, English-looking text, short English names of controls, tablists,
regions and dialogs ("Refresh"), and native `<select>` options, skipping content inside an
English `[lang]` block. `narrow` and `tab` change layout and focus: a dialog or menu they close is
reported (`closed: …`), and a tab walk that hits the 80-stop cap says so instead of reading clean.

Focus on an element without a ref is shown by what it is, e.g. `focus: r12 → (div#pane)`.

Several web sessions can share one local server: start it once (or let one session start it),
then `drive start web --url http://127.0.0.1:PORT` in the others.

## Manifests

Each app has `driver.manifest.json` (`apps/web/`, `apps/desktop/`): how to build-check, prepare
fixture data, start and wait for it, the throwaway profile and the viewport. See `Manifest` in
`src/types.ts`. Strings may use `${port}`, `${profile}`, `${url}`, `${tmp}`, `${repoRoot}`,
`${manifestDir}` and `${prepare.KEY}` (from the JSON the prepare command prints last).

- Web: runs `apps/web/server` on a free port against the same fixture data the e2e suite builds
  (`apps/web/e2e/.data`), with app state in the throwaway profile. `--url` is allowed only for the
  origins in `external.allow`, always read-only.
- Desktop: launches the built `out/main/index.js` with a fresh `ELECTRON_USER_DATA`. A fresh profile
  opens on the first-run dialogs (language, then network: "Stay offline").

## Development

```bash
pnpm --filter @bible/ui-driver test        # unit tests (runtime tests use headless chromium)
pnpm --filter @bible/ui-driver typecheck
pnpm --filter @bible/ui-driver lint
pnpm --filter @bible/ui-driver e2e         # smoke: drives the CLI against web and desktop (needs builds)
pnpm --filter @bible/ui-driver e2e:popout  # popped-out notes window: toolbar, indent, Ctrl+F, reference hover (needs the desktop build; xvfb-run -a on a headless Linux box; skips when it cannot run)
```

No build step: Node runs the TypeScript directly (type stripping), so `.ts` imports carry their
extension and only erasable syntax is allowed. `src/page/runtime.js` is injected into every
document as plain JavaScript; it computes roles, names, states and refs, and runs the audits.
