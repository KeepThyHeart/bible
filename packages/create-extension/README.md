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
  --help        Show this help message
```

The name is converted to kebab-case for the directory and manifest `id`, and to Title Case for the display name, so `create-bible-extension "Greek Tools"` and `create-bible-extension greek-tools` produce the same project.

## What it generates

```
my-extension/
  extension.json        - Extension manifest (id, permissions, entry point)
  package.json          - npm config, wired to esbuild and vitest
  tsconfig.json         - TypeScript config
  esbuild.config.mjs    - Bundles src/main.ts to dist/main.js (--watch supported)
  vitest.config.ts      - Test config
  src/main.ts           - Entry point with activate() / deactivate()
  src/verseUtils.ts     - Verse id helpers
  src/bible-env.d.ts    - Ambient types for the host API
  test/main.test.ts     - A passing test against the mocked host
  README.md             - Per-project readme
```

The generated `main.ts` demonstrates the lifecycle the host actually calls: it activates, subscribes to `bible.onDidChangeActiveVerse`, and deactivates cleanly. The generated test uses [`@bible/extension-testing`](../extension-testing) so it runs with no Electron, no app and no database.

## Next steps in a generated project

```bash
cd my-extension
npm install
npm run build      # esbuild -> dist/main.js
npm test           # vitest against the mock host
npm run smoke      # bible-ext-smoke, drives every declared hook
```

To load it in the desktop app, copy the project folder into the app's extensions directory and restart. The app identifies the extension by the `id` in `extension.json`, not by the folder name.

## Related packages

- [`@bible/extension-ui`](../extension-ui) -- client-side SDK for extensions that render a panel in an iframe
- [`@bible/extension-testing`](../extension-testing) -- mock host, fixtures and the `bible-ext-smoke` harness
- [`word-count-example`](../word-count-example) -- a complete reference extension

## License

GPL-3.0-or-later. See [`LICENSE`](./LICENSE).
