# @bible/create-extension

Scaffolds a new Bible app extension project from a single command. It writes a complete, buildable starting point -- manifest, TypeScript config, bundler config, entry point and a passing test -- so a new extension runs in the app without any further setup.

## Usage

```bash
npx @bible/create-extension my-extension
```

Or, once installed globally:

```bash
create-bible-extension my-extension
```

```
Usage: create-bible-extension <name> [options]

Arguments:
  name          Extension name (e.g. "greek-tools", "daily-reading")

Options:
  --local-sdk=<dir>  Resolve @bible/core and @bible/extension-testing from
                     packed tarballs in <dir> instead of a registry
  --help             Show this help message
```

The name is converted to kebab-case for the directory and manifest `id`, and to Title Case for the display name, so `create-bible-extension "Greek Tools"` and `create-bible-extension greek-tools` produce the same project.

### `--local-sdk`, and why it is needed today

The generated project depends on `@bible/core` (types only) and `@bible/extension-testing` (the mock host). Neither is published to a registry yet, so outside this repository `npm install` cannot resolve them and fails on the first command a new author runs.

Until they are published, pack them and point the scaffold at the tarballs:

```bash
# in the Bible repository
npm run pack:sdk            # builds and packs into build/sdk/

# anywhere else
npx @bible/create-extension my-extension --local-sdk=../bible/build/sdk
```

That writes `file:` specifiers into the generated `package.json` instead of version ranges. Everything else about the project is identical, so switching to registry versions later is a two-line edit.

Tarballs rather than a `file:` link to `packages/core` directly: npm symlinks a directory dependency, which would leave an author typechecking against `src/` and able to depend on files the package's `files` list would never ship.

## What it generates

```
my-extension/
  extension.json        - Extension manifest (id, permissions, entry point)
  package.json          - npm config, wired to esbuild and vitest
  tsconfig.json         - TypeScript config
  esbuild.config.mjs    - Bundles src/main.ts to dist/main.js (--watch supported)
  vitest.config.ts      - Test config
  .gitignore
  .bibleignore          - What `bible-ext package` leaves out of the .zip
  src/main.ts           - Entry point with activate() / deactivate()
  src/verseUtils.ts     - Verse id helpers
  src/bible-env.d.ts    - Ambient types for the sandbox realm
  test/main.test.ts     - Passing tests against the mocked host
  ui/index.html         - Starter panel, wired to the @bible/extension-ui SDK
  ui/styles.css         - Panel styles, using the host's theme variables
  README.md             - Per-project readme
```

`extension.json` carries a `$schema` pointing into `node_modules/@bible/core`, so an editor validates the manifest as you type it and completes `permissions`, `activationEvents` and every contribution point. The schema ships with the package; there is no network fetch and nothing to configure.

The generated `main.ts` demonstrates the lifecycle the host actually calls: it activates, binds its command handler with `api.runtime.expose`, subscribes to `bible.onDidChangeActiveVerse`, and deactivates cleanly. `api` is typed as `Extensions.BibleExtensionAPI` via `import type`, which is erased at build time -- so the bundle carries no dependency on `@bible/core` and an MIT extension takes on none of its licence.

**The `runtime.expose` call is the load-bearing one.** A `handlerEndpoint` in `extension.json` is a *name*, not a function: a function cannot survive the RPC hop to the host. Declaring a command without binding its endpoint produces an item in the command palette and the Tools menu that silently does nothing. The generated test asserts the binding for exactly that reason.

The generated tests use [`@bible/extension-testing`](../extension-testing) so they run with no Electron, no app and no database.

## Next steps in a generated project

```bash
cd my-extension
npm install
npm run build      # typecheck, then esbuild -> dist/main.js
npm test           # vitest against the mock host
npm run validate   # bible-ext validate: manifest + the files it points at
npm run smoke      # bible-ext-smoke, drives every declared hook
npm run package    # bible-ext package -> build/<id>-<version>.zip
```

`npm run package` produces a **`.zip`**, which is what the app installs. `npm pack` produces a registry tarball, which nothing in the platform can read -- do not confuse the two.

## Loading it in the desktop app

The fast loop is Developer Mode, which runs the extension in place from your build directory rather than a copy:

1. Preferences > Extensions, turn on **Developer Mode**.
2. **Load unpacked extension...** and pick the project folder.
3. `npm run watch` in a terminal. The host re-reads the directory when the build output changes.

To test the real install path instead, run `npm run package` and install the resulting `.zip`. The app identifies an extension by the `id` in `extension.json`, never by the folder name.

## Related packages

- [`@bible/extension-ui`](../extension-ui) -- client-side SDK for extensions that render a panel in an iframe
- [`@bible/extension-testing`](../extension-testing) -- mock host, fixtures, the `bible-ext` CLI and the `bible-ext-smoke` harness
- [`word-count-example`](../word-count-example) -- a complete reference extension

## License

MIT. See [`LICENSE`](./LICENSE).

Permissive on purpose, while the app itself is GPL-3.0-or-later: this tool copies its templates verbatim into the project it generates, so an MIT licence is what lets the resulting extension ship under any licence its author chooses, commercial ones included. Generated projects are stamped MIT to match.
