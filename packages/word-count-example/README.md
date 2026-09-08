# Word Count Extension

A minimal reference extension that displays a word count for the current Bible chapter in the status bar.

## What it does

- Listens for the active verse to change in the Bible pane
- Fetches all verses in the current chapter
- Counts total words (stripping any HTML markup)
- Displays the result in the status bar (e.g., "Words: 342")

## Installation (sideload)

1. Copy this `word-count-example/` folder into the app's extensions directory (the folder name there is yours to choose; the app identifies the extension by the `id` in `extension.json`):
   - Linux: `~/.config/bible-desktop-app/extensions/`
   - macOS: `~/Library/Application Support/bible-desktop-app/extensions/`
   - Windows: `%APPDATA%\bible-desktop-app\extensions\`
2. Restart the app (or reload extensions if supported).
3. The extension activates on startup and shows a "Words: --" item in the status bar.

## What it demonstrates

- **Extension manifest** (`extension.json`) with permissions, activation events, and metadata
- **Lifecycle hooks** (`activate` / `deactivate`) for setup and teardown
- **Event subscription** via `api.bible.onDidChangeActiveVerse`
- **Bible data access** via `api.bible.getRange()` to read passage text
- **Status bar contributions** via `api.ui.registerStatusBarItem()`
- **Disposable pattern** for cleaning up subscriptions and UI contributions

## Permissions used

| Permission      | Why                                            |
|-----------------|------------------------------------------------|
| `bible:read`    | Read verse text from the active Bible module   |
| `ui:status-bar` | Register a status bar item to display the count|

## Files

```
word-count-example/
  extension.json   - Extension manifest
  package.json     - npm package config (wires the `smoke` script)
  src/main.js      - Extension entry point (CommonJS, plain JS)
  README.md        - This file
```

## Validating hooks

Run `npm run smoke` to validate hooks against the default corpus — manifest
contributions and event subscribers are exercised for crashes, timeouts,
permission violations, and malformed returns. Endpoint-backed hooks
(hovers, decorators, providers) report as `skip` in the in-process harness.

See the [testing guide](/developer/extensions/testing#quick-start) for
details on the pipeline, corpus merging, and the failure taxonomy.

## License

MIT. See [`LICENSE`](./LICENSE).

Permissive on purpose, and deliberately different from the repository root, which is GPL-3.0-or-later: this is reference code meant to be copied as the starting point for a real extension, so copying it must not impose a licence on the result.
