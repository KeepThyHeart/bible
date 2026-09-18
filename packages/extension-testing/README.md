# @bible/extension-testing

Testing utilities for Bible app extensions. Provides a mock host API, a test host that drives the real activation lifecycle, ready-made fixtures, and a smoke harness that exercises every hook an extension declares -- so an extension can be tested with no Electron, no running app and no databases.

## Usage

```ts
import { createMockApi, createTestHost, fixtures } from '@bible/extension-testing';

const api = createMockApi({
  bible: { getVerse: async () => fixtures.VERSE_JOHN_3_16 },
});

const host = createTestHost({ api });
await host.activate(extension);
```

`createMockApi(overrides)` returns a full host API with everything stubbed, so a test only overrides the handful of calls it cares about. `createTestHost` runs the same `activate` / `deactivate` sequence the real host does, which is what catches an extension that registers during activation but never cleans up.

### `api.storage` is real, not stubbed

Most namespaces resolve a fixed default. Storage does not, because persistence is usually the thing being tested and a `set` the next `get` cannot see makes such a test pass no matter what the extension does.

- **KV** (`get` / `set` / `delete` / `keys`) and **secrets** round-trip through in-memory maps, per api object. Values go through `JSON.stringify` on the way in, exactly as the host does, so a value that could not cross the RPC boundary is rejected here too.
- **`openDatabase(name)`** returns a `MockExtensionDatabase` -- an `IExtensionDatabase` plus a `statements` log, a `transactions` log and `isClosed`. Re-opening the same name returns the same handle; using a closed one throws.
- **`transaction(work)`** calls `work`, resolves with its result, rethrows its error, and refuses to nest -- as the host's registry does. Statements issued inside a transaction that throws are **discarded** from `statements` and kept under `transactions[i].attempted`, so a rollback is something a test can actually assert.

There is no SQL engine: `query` / `queryOne` / `run` record the statement and return the empty defaults. A test that needs rows back should override `storage.openDatabase` with its own fake.

## Fixtures

`fixtures` carries realistic sample data so tests are not built on invented shapes -- verses (`VERSE_JOHN_3_16`, `VERSES_GEN_1_1_3`, ...), modules, chapter extents (`CHAPTERS_JOHN`), commentary and dictionary entries, notes, highlights, bookmarks, collections, interlinear tokens and parsed references. Import the namespace or the individual constants:

```ts
import { fixtures, VERSE_JOHN_3_16 } from '@bible/extension-testing';
```

## Smoke harness

The `smoke` export, and the `bible-ext-smoke` CLI, enumerate every hook an extension declares -- in the manifest and at activation time -- and invoke each one across a corpus of inputs: ordinary values, edge cases and inputs the extension has no permission for.

```bash
npx bible-ext-smoke          # from an extension project root
```

Commands, hovers, decorators, providers, and the context-menu and status-bar items that name a command are all driven through the endpoint the extension bound with `api.runtime.expose(...)` -- the same address the host dispatches to in the app. Which means the verdicts are:

| Outcome | Reported as |
| --- | --- |
| The handler ran and returned | **pass** |
| The handler ran and threw, hung, tripped a permission check, or fetched an undeclared host | **fail** |
| The contribution is declared and nothing bound its endpoint | **fail** (`unbound-endpoint`) |
| A panel type, a highlight style, or a status-bar item with no command | **skip** |

The third row is the one that matters most. A command whose `handlerEndpoint` nobody exposed still appears in the palette and does nothing when chosen -- nothing logs, nothing throws -- so the smoke run is the only place it can be caught. It is a failure, not a skip. A skip is reserved for contributions with no code behind them at all, and always carries the reason.

Two CLIs ship with the package:

- `bible-ext` -- extension developer commands (below)
- `bible-ext-smoke` -- the smoke suite above, wired into generated projects as `npm run smoke`

Both are built from `src/` into `dist/`, so run `npm run build` in this package before invoking them from a checkout.

## `bible-ext`

```
bible-ext validate [path]   Check extension.json and the files it references
bible-ext smoke    [path]   Run the smoke-test suite against an extension
bible-ext package  [path]   Build the distributable .zip
```

**`validate`** runs the same manifest schema the host runs, then checks that every path the manifest points at actually exists -- `main`, `icon`, each panel `uiEntry`, and contributed themes, icons, styles and font files. Those two checks answer different questions: the schema says the manifest is well-formed, and can say nothing about whether `dist/main.js` was ever built. Shipping an archive whose entry point was cleaned away installs without complaint and fails at activation, on a user's machine, looking like a host bug. It needs no realm and no corpus, so it is cheap enough to run in CI on every push.

**`package`** produces the artifact the app actually installs: a `.zip` with `extension.json` at the root. This is not what `npm pack` produces -- that is a registry tarball with everything under `package/`, and nothing in the platform can read it. The archive is validated before it is written, and refused if a referenced file is missing.

Files are excluded by a `.bibleignore` (one pattern per line, `#` for comments, trailing `/` for a directory) on top of a built-in list: `node_modules/`, `.git/`, `*.zip`, `*.tgz`, `*.map`. It is a deliberately small subset of gitignore syntax rather than a near-miss reimplementation, because the failure mode of *almost* gitignore is an author shipping a file they believed was excluded.

Archives are **byte-for-byte reproducible**: every entry carries a fixed timestamp rather than its mtime, so the same input tree always yields the same SHA-256. `installFromCatalog` verifies a published digest before unpacking, and a hash that changed on every build would make that check impossible for an author to reproduce. `package` prints the digest for exactly that use.

Both commands take `--json` for machine-readable output and return a non-zero exit code on failure.

## Realm mode

Beyond the mock path, the harness can drive an extension inside the real QuickJS sandbox rather than against a mock object, which is what proves an extension does not depend on ambient authority the sandbox denies. This package deliberately does not import a QuickJS engine -- the desktop app supplies one, so the dependency runs desktop to extension-testing and never the reverse. See `createRealmSmokeHarness` and the `RealmFactory` type.

## Related packages

- [`@bible/create-extension`](../create-extension) -- scaffold a new extension project
- [`@bible/extension-ui`](../extension-ui) -- client-side SDK for extension panels
- [`word-count-example`](../word-count-example) -- a complete reference extension, used as this package's integration fixture

## License

GPL-3.0-or-later. See [`LICENSE`](./LICENSE).
