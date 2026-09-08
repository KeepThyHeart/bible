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

## Fixtures

`fixtures` carries realistic sample data so tests are not built on invented shapes -- verses (`VERSE_JOHN_3_16`, `VERSES_GEN_1_1_3`, ...), modules, commentary and dictionary entries, notes, highlights, bookmarks, collections, interlinear tokens and parsed references. Import the namespace or the individual constants:

```ts
import { fixtures, VERSE_JOHN_3_16 } from '@bible/extension-testing';
```

## Smoke harness

The `smoke` export, and the `bible-ext-smoke` CLI, enumerate every hook an extension's manifest declares and invoke each one across a corpus of inputs -- ordinary values, edge cases and inputs the extension has no permission for. It reports which hooks passed, which threw, and which were skipped with the reason, rather than faking a pass.

```bash
npx bible-ext-smoke          # from an extension project root
```

Two CLIs ship with the package:

- `bible-ext` -- extension developer commands
- `bible-ext-smoke` -- the smoke suite above, wired into generated projects as `npm run smoke`

Both are built from `src/` into `dist/`, so run `npm run build` in this package before invoking them from a checkout.

## Realm mode

Beyond the mock path, the harness can drive an extension inside the real QuickJS sandbox rather than against a mock object, which is what proves an extension does not depend on ambient authority the sandbox denies. This package deliberately does not import a QuickJS engine -- the desktop app supplies one, so the dependency runs desktop to extension-testing and never the reverse. See `createRealmSmokeHarness` and the `RealmFactory` type.

## Related packages

- [`@bible/create-extension`](../create-extension) -- scaffold a new extension project
- [`@bible/extension-ui`](../extension-ui) -- client-side SDK for extension panels
- [`word-count-example`](../word-count-example) -- a complete reference extension, used as this package's integration fixture

## License

GPL-3.0-or-later. See [`LICENSE`](./LICENSE).
