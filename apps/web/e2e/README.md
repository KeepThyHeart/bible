# Web E2E tests

Playwright against the real Express server and the built client, in five browser
projects: `desktop-chrome`, `tablet-chrome`, `mobile-chrome`, `mobile-safari`,
`desktop-safari`.

## Running

```bash
pnpm --filter @bible/web run test:e2e            # builds the client, then runs every project
```

For a faster inner loop, skip the rebuild and drive Playwright directly:

```bash
cd apps/web
pnpm exec playwright test --config=e2e/playwright.config.ts --project=desktop-chrome
pnpm exec playwright test --config=e2e/playwright.config.ts e2e/tests/ui-e2e.spec.ts
pnpm exec playwright test --config=e2e/playwright.config.ts --grep "verse range"
```

`pnpm run test:e2e` rebuilds the client because the server serves
`dist/client`, not the Vite dev server. If you change anything under `src/`
without rebuilding, the suite runs against the previous bundle.

First run on a machine also needs the browsers:

```bash
pnpm exec playwright install
```

## What the suite runs against

`e2e/prepareData.ts` assembles `e2e/.data` (gitignored) before the server
starts, and the config hands it to the server as `BIBLE_DATA_DIR`:

- **`main.db`** — a `VACUUM INTO` snapshot of the first module registry it finds,
  looking in `apps/web/data` (a registry left by an older checkout), then the
  repo-root `data/` that `pnpm run setup` fills, then the desktop app's `data`.
  Module `.db` files are read in place from wherever that registry's modules
  live; nothing is copied.
- **`site-config.json`** — a copy of `e2e/fixtures/site-config.json`, which pins
  auth off and the visible module set. Without this the suite would pass or fail
  according to which modules a developer happened to switch on.

Nothing in `apps/web/data` or the desktop app's `data` is written to.

If no registry has installed modules, or the ones the specs name (KJV, ASV,
Barnes, AmTract) are missing, the run stops before the first test with a message
saying what to install and to run `pnpm run init`.

`e2e/globalSetup.ts` then warms the server by reading the chapters the specs
open. Module databases are opened lazily and the first read faults tens of MB
off disk; with every worker starting at once, that cost used to land inside the
first tests and fail them on timeouts unrelated to what they tested.

- **`audio/`** — written by `e2e/audioFixture.ts`: one recorded chapter (John 3,
  KJV, a generated tone, half a second per verse) published the way a real build is.
  The fixture config turns `features.audio` on, so `audio-e2e.spec.ts` can play it;
  every other translation has no recording and no speech engine is configured, which
  is the state the feature ships in.

The fixture also turns off `features.offlineAutoDownload`. In normal use the app
caches a lite copy of each translation in the browser, which in a test run means
a multi-MB download and an OPFS import in every fresh context — enough
background work to push assertions past their timeouts.

## Type-checking the specs

```bash
pnpm --filter @bible/web run typecheck:e2e     # or `pnpm run typecheck:e2e` from the repo root for both packages
```

`tsconfig.json` excludes `e2e/**/*`, so nothing type-checked these specs: a
helper called with the wrong arity showed up only as a Playwright timeout,
across five viewport projects. `e2e/tsconfig.json` covers the directory and the
script runs in about a second.

## Notes

- **No fixed sleeps.** `waitForTimeout` is not a wait for anything — it is
  slower than needed on a warm run and too short when five projects share the
  machine. Use a retrying assertion (`expect(...).toBeVisible({ timeout })`),
  `waitForSelector`, or `expect.poll`.
- **No `if (await x.isVisible())` around the assertions.** A guard like that
  turns the absence of the thing under test — usually the exact regression the
  test is named for — into a pass. If a condition really is environment-
  dependent, `test.skip(condition, reason)` says so in the report; a silent
  early return does not.
- The server is always started by Playwright. A server already on port 3100 was
  started with some other data directory and build, so the config does not reuse
  it — the run fails instead of testing the wrong thing. Set `PW_REUSE_SERVER=1`
  to point the suite at a server you are running yourself.
- Specs that assert against a scroll container are desktop-only: mobile layouts
  scroll an outer `.mobile-scroll-wrapper` instead.
- Loading a chapter selects its first verse, so a test that wants to prove
  clicking selects a verse must click a different one — clicking the selected
  verse toggles it off.

## RTL visual baselines

`tests/rtl-visual.spec.ts` (task 0076) holds two groups of tests for right-to-left UIs (`ar`):

- **Structural assertions** run with the normal suite: `<html dir="rtl" lang="ar">`, scripture
  keeping its own (LTR) direction inside the RTL UI, the verse context menu staying inside the
  viewport at either edge, and arrow-key roving focus following the logical direction.
- **Visual baselines** (`en` and `ar`, about ten key screens) run only with `RTL_VISUAL=1` on Linux and
  are skipped otherwise.
- Projects: `desktop-chrome` and `mobile-chrome` only. The language is set through `localStorage.i18nextLng`.

Generate or refresh the baselines (an explicit action, never automatic):

```bash
RTL_VISUAL=1 pnpm --filter @bible/web exec playwright test --config=e2e/playwright.config.ts rtl-visual --project=desktop-chrome --project=mobile-chrome --update-snapshots
```

Compare against them:

```bash
RTL_VISUAL=1 pnpm --filter @bible/web exec playwright test --config=e2e/playwright.config.ts rtl-visual --project=desktop-chrome --project=mobile-chrome 
```

Notes:

- Linux only. The apps use system fonts, so baselines are per machine until language-pack fonts
  are bundled; regenerate them when the font set changes.
- **Baselines are not committed yet.** They could not be generated in the data-less worktree the
  specs were written in (the Bible modules are git-ignored). Generate them on a machine with data,
  review the images by eye, then commit the `*-snapshots/` folder next to the spec.
- Masked regions (version strings, clocks, offline badge) are blanked before comparison.
