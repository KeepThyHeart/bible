# E2E Tests

Playwright-based end-to-end tests for the Electron desktop app.

## Prerequisites

### 1. Data directory and module databases

The `apps/desktop/data/` directory and all `.db` files are **gitignored** - they must be set up locally before tests can run. The data directory must contain:

```
apps/desktop/data/
+-- main.db                              # Reference database (Bible books, module registry)
+-- tag_graph.db                         # Tag graph for entity relationships (optional, for study/topics tests)
+-- modules/
    +-- bible_kjv.db                     # KJV Bible (default; app falls back to first available)
    +-- topical_nave.db                  # Nave's Topical Bible (for study/topics pane tests)
    +-- topical_torrey.db                # Torrey's Topical Index (for study/topics pane tests)
    +-- xref_tsk.db                      # Treasury of Scripture Knowledge (for cross-reference tests)
    +-- commentary_*.db                  # At least one commentary (for study pane commentary tests)
    +-- (other module .db files)
```

**Setup steps:**

1. Place module `.db` files in `apps/desktop/data/modules/`. At minimum you need **one Bible module** (e.g., `bible_kjv.db`) for any tests to pass. The app defaults to KJV (John 3) at startup; if KJV is missing, it falls back to the first available Bible.

2. For **study pane** and **topics pane** tests, you also need:
   - `topical_nave.db` and `topical_torrey.db` in `data/modules/`
   - `xref_tsk.db` in `data/modules/`
   - `tag_graph.db` in `data/` (top level, not in modules/)

3. Start the app once. `main.db` is created and migrated on first run (`electron/utils/initMainDatabase.ts`), and every module found in `data/modules/` is registered at startup (`electron/utils/moduleDetector.ts`). Modules added later are picked up the next time the app starts.

### 2. Build the app

E2E tests run against the **built** app in `out/`, not dev mode.

```bash
npm run build          # from repo root - builds core + desktop + web
```

**Important:** If you changed files in `packages/core/src/`, you must run `npm run build:core` (or `npm run build`) before `npm run build:desktop`. Stale `dist/` output causes runtime errors like `"X is not a constructor"`.

### 3. Rebuild native modules for Electron

The SQLite driver (`better-sqlite3-multiple-ciphers`) must be built for Electron's Node.js ABI, not the system Node.js. (`keytar` is a Node-API module and needs no Electron build.) If you see errors like:

```
The module was compiled against a different Node.js version using NODE_MODULE_VERSION 137.
This version of Node.js requires NODE_MODULE_VERSION 130.
```

**Automatic:** `npm run build:desktop` (and `npm run build`) runs `electron-rebuild` via a `postbuild` npm lifecycle hook in `apps/desktop/package.json`. So a normal build should leave native modules in the correct state.

**Manual (if needed):**

```bash
cd apps/desktop && npx electron-rebuild
```

Run this manually if you installed new packages (`npm install`) or changed the Node.js version without running a full build.

### 4. Display server (Linux)

Electron requires a display server. On Linux desktops this is already available. For headless CI, use `xvfb-run`:

```bash
xvfb-run npx playwright test ...
```

## Quick Start (from scratch)

```bash
# 1. Install dependencies
npm install

# 2. Place module .db files in apps/desktop/data/modules/
#    At minimum: bible_kjv.db (or any bible_*.db)
#    For full tests: also topical_nave.db, topical_torrey.db, xref_tsk.db
#    Place tag_graph.db in apps/desktop/data/

# 3. Build everything (electron-rebuild runs automatically as postbuild)
npm run build

# 4. Start the app once so main.db is created and the modules are registered
npm run dev

# 5. Run tests
npx playwright test --config=e2e/playwright.config.ts --reporter=list
```

## Running Tests

```bash
cd apps/desktop

# Run all E2E tests
npx playwright test --config=e2e/playwright.config.ts --reporter=list

# Run a specific test file
npx playwright test --config=e2e/playwright.config.ts e2e/tests/study-pane.spec.ts --reporter=list

# Run a single test by name
npx playwright test --config=e2e/playwright.config.ts e2e/tests/pop-out.spec.ts --grep "Commentary:" --reporter=list
```

## Type-checking the specs

```bash
npm run typecheck:e2e -w @bible/desktop     # or `npm run typecheck:e2e` from the repo root for both packages
```

The e2e directory sits outside `tsconfig.json`, which covers `src/` and `electron/` only, so `e2e/tsconfig.json` covers it instead and the script above runs in about a second. Without it a spec that calls a helper that does not exist, or passes it the wrong arity, surfaces only as an opaque Playwright timeout inside a four-worker Electron run.

Two conventions follow from how these specs are written:

- **`globalThis`, not `window`, inside `evaluate` callbacks.** The Electron fixture is itself named `window`, so `window.evaluate(() => window.innerWidth)` resolves that inner `window` to the Playwright `Page` as far as TypeScript is concerned. The renderer globals the suite reaches for are declared in `renderer-globals.d.ts`.
- **No fixed sleeps.** `waitForTimeout` is not a wait for anything - it is slower than needed when the app is warm and too short when four Electron instances are sharing the machine. Use a retrying assertion (`expect(...).toBeVisible({ timeout })`), `waitForSelector`, or `expect.poll`. The handful of sleeps that remain are in `highlight-diagnosis.spec.ts` and `highlight-utils.ts`, each with a comment explaining why waiting for the thing would destroy the diagnostic the test exists to produce.

## Test Architecture

- **Fixture:** `fixtures/electron.fixture.ts` - launches Electron from `out/main/index.js`, waits for `[data-testid="app-loaded"]`, and provides `electronApp` and `window` to tests.
- **Config:** `playwright.config.ts` - 60s timeout, 4 parallel workers, HTML + list reporters.
- **Environment:** Tests run with `NODE_ENV=test`. This triggers test-specific behavior:
  - **Encryption key:** Uses a deterministic key instead of OS keychain (keytar), avoiding DBus/keyring hangs.
  - **User data:** Each test worker gets an isolated directory at `e2e/test-data/worker-N/`.
  - **Module data:** Shared - all workers read from `apps/desktop/data/modules/`.

## Never repair the state under test

Never guard an assertion behind `if (await x.isVisible())` — a missing element turns the check into a silent pass. That rule has a second half: **a setup step must not put the app into the state the test is about to assert.** A `beforeEach` like this one is the shape to watch for:

```ts
if (!await checkbox.isChecked()) await checkbox.check({ force: true });
```

Reasonable-looking, and fatal. If Study mode stops turning interlinear on, every test in the file still passes, because the suite ticks the box itself before looking.

If the default matters, assert it (`await expect(checkbox).toBeChecked()`) and give it a test of its own, so the failure reads as "Study mode no longer turns interlinear on" rather than as the whole file breaking. Reserve `check()` in setup for state the tests genuinely do not care about.

The same shape hides behind `test.skip` on a zero count: skipping when the toggle is missing turns "the control was deleted" into a green run.

## Packaged-build tests (asar)

`extension-host-asar.spec.ts` is the one spec that does **not** use `fixtures/electron.fixture.ts`. Every other test launches the unpacked `out/main/index.js`, which never exercises `app.asar`. That spec launches the **packaged binary** instead, because it exists to verify that `ExtensionHost` can `utilityProcess.fork()` the extension worker (`out/main/extension-runtime/index.js`) from *inside* the asar archive.

It skips itself, loudly, when no packaged build is present. To run it:

```bash
npm run build                       # repo root - core + desktop
cd apps/desktop
npx electron-builder --win --dir    # or --linux --dir / --mac --dir
npx playwright test --config=e2e/playwright.config.ts e2e/tests/extension-host-asar.spec.ts --reporter=list
```

`--dir` skips the installer and just produces `dist/win-unpacked/`, which is all the test needs. Extensions are sideloaded into `<packaged resources>/data/extensions/` (`ExtensionHost` auto-registers any valid directory found there with the default-granted permissions, so no consent dialog appears) and the test cleans them up afterwards.

The spec's third test is annotated `test.fail()` - it documents a known extension-host bug (`manifest.main` is never resolved against the extension's install directory) and will start reporting "expected to fail but passed" once that bug is fixed. See the header comment in the spec for the details.

## Module Requirements by Test

| Test file | Required modules |
|---|---|
| `bible-pane.spec.ts` | Any `bible_*.db` |
| `commentary.spec.ts` | Any `bible_*.db` + any `commentary_*.db` |
| `dictionary.spec.ts` | Any `bible_*.db` + any `dictionary_*.db` |
| `study-pane.spec.ts` | Any `bible_*.db` + `topical_nave.db` + `topical_torrey.db` + `xref_tsk.db` + commentary modules |
| `topics-pane.spec.ts` | Any `bible_*.db` + `topical_nave.db` + `topical_torrey.db` + `tag_graph.db` (in `data/`) |
| `interlinear.spec.ts` | A Bible with interlinear data (e.g., `bible_kjv.db` with Strong's) |
| `search.spec.ts` | Any `bible_*.db` |
| `highlights.spec.ts` | Any `bible_*.db` |
| `notes.spec.ts` | Any `bible_*.db` |
| `copy.spec.ts` | Any `bible_*.db` |
| `pop-out.spec.ts` | Any `bible_*.db` + any `commentary_*.db` |
| `reference-links.spec.ts` | Any `bible_*.db` + commentary modules |
| `default-layout.spec.ts` | Any `bible_*.db` |
| `narrow-window.spec.ts` | Any `bible_*.db` |
| `module-manager.spec.ts` | Any `bible_*.db` |
| `semantic-search.spec.ts` | Any `bible_*.db` |

## Common Issues

### App hangs / tests timeout during fixture setup

**Cause:** Native module ABI mismatch. The `better-sqlite3-multiple-ciphers` native module is built for system Node.js, not Electron's Node.js.

**Fix:** Run `npm run rebuild-native:force -w @bible/desktop`. The same rebuild runs as a `postbuild` hook, so a fresh `npm run build` fixes it too.

**Root cause detail:** The encryption key is kept with Electron's `safeStorage`; `keytar` is only loaded, lazily and outside test mode, to migrate a key from an older install, so a broken `keytar` binding cannot block test startup.

### Tests fail with "No Bibles available" or blank Bible pane

**Cause:** No Bible module databases in `apps/desktop/data/modules/`.

**Fix:** Place at least one `bible_*.db` file (e.g., `bible_kjv.db`) in the modules directory and restart the app so it is registered.

### Study/Topics tests show "No topical index entries" or "No cross-references"

**Cause:** Missing topical index or cross-reference databases.

**Fix:** Place `topical_nave.db`, `topical_torrey.db`, and `xref_tsk.db` in `data/modules/`, and `tag_graph.db` in `data/`. Then restart the app so they are registered.

### "SQLITE_CONSTRAINT: CHECK constraint failed: module_type"

**Cause:** The `module_metadata` table's CHECK constraint doesn't include `topical_index` or `cross_reference`.

**Fix:** Start the app; `initMainDatabase.ts` applies the migration that widens that CHECK to an existing `main.db`. If the database is older than the migration ledger, delete `apps/desktop/data/main.db` and let the app rebuild it - it holds reference data, module registrations and saved searches, but no notes or highlights.

### Tab clicks timeout with "waiting for element to be visible, enabled and stable"

**Cause:** Electron windows are minimized during tests (to not disturb the user). Minimized windows sometimes don't pass Playwright's actionability checks.

**Fix:** Use `{ force: true }` on click actions for tab elements. This is already done in the pop-out tests and should be applied to any new tests that click dockview tabs.

### Modal dialogs block tab interactions

**Cause:** The app may show modals on startup (e.g., "Set Up Your Notes Folder", module selectors) that intercept pointer events.

**Fix:** Dismiss modals before interacting with tabs. See `dismissModals()` helper in `pop-out.spec.ts`. Common patterns:
- Notes folder setup: click "Use This Folder"
- Module selector: click "Close" or press Escape
- Commentary filter: type in filter input, then press Enter (click is intercepted by modal overlay)

### "Unknown component" in detached window

**Cause:** The component name in `electron/config/paneConfig.ts` doesn't match the COMPONENT_MAP in `src/ui/detached.tsx`.

**Fix:** Ensure both files use the same component name string.

## Test Files

| File | What it tests |
|---|---|
| `ai-disclaimer.spec.ts` | AI-content disclosure on every surface that shows synthesized commentary |
| `bible-pane.spec.ts` | Bible reading, navigation, display modes, verse selection |
| `bookmarks.spec.ts` | Bookmark round trip: save, rename, move, find again |
| `chrome-bands.spec.ts` | Bible pane chrome: the persistent bands above the scripture text |
| `command-registry.spec.ts` | Command registry, when-contexts and keybindings inside a real Electron run |
| `commentary.spec.ts` | Commentary pane, tab switching, verse sync |
| `copy.spec.ts` | Verse copying with different formats |
| `default-layout.spec.ts` | Default pane layout on first launch |
| `diagnostics.spec.ts` | Diagnostics and issue-reporting IPC wiring |
| `dictionary.spec.ts` | Dictionary lookup and browsing |
| `extension-host-asar.spec.ts` | Extension worker spawns and round-trips RPC from inside `app.asar` (packaged build only - see above) |
| `highlight-diagnosis.spec.ts` | Drag-select to floating toolbar to swatch, asserted at each step |
| `highlights.spec.ts` | Verse highlighting and color selection |
| `interlinear.spec.ts` | Interlinear/study mode display |
| `module-manager.spec.ts` | Module browser and management |
| `narrow-window.spec.ts` | Responsive layout in narrow windows |
| `notes.spec.ts` | Notes creation, editing, file management |
| `pop-out.spec.ts` | Pop-out/detach pane to new window |
| `reference-links.spec.ts` | Cross-reference and verse link navigation |
| `search.spec.ts` | Bible text search |
| `semantic-search.spec.ts` | AI-powered semantic search |
| `study-pane.spec.ts` | Study pane: topics, commentaries, cross-refs, pin/unpin, navigation |
| `tab-strip-actions.spec.ts` | Alignment of the dockview tab-strip header actions |
| `topics-pane.spec.ts` | Topics pane: browse, search, hierarchy, tag graph, also-in links |
