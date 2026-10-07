# Word Count Extension

A minimal reference extension that displays a word count for the current Bible chapter in the status bar.

## What it does

- Listens for the active verse to change in the Bible pane
- Fetches all verses in the current chapter
- Counts total words (stripping any HTML markup)
- Displays the result in the status bar (e.g., "Words: 342"); clicking it opens the app
- Adds a **Word Count** app to the app switcher: the chapter's reference, total words and verse count, the ten most frequent words (case-folded, common English words skipped) and a bar list of words per verse. It shows an empty state until a chapter is known, and follows the host's light/dark theme
- Puts a compact badge on the app's switcher entry (`342`, `1.2k`) with the label "342 words in this chapter"
- Contributes the command "Word Count: Open" (`ext.bible-app.word-count.open`)

## Installation (sideload)

1. Copy this `word-count-example/` folder into the app's extensions directory (the folder name there is yours to choose; the app identifies the extension by the `id` in `extension.json`):
   - Linux: `~/.config/bible-desktop-app/extensions/`
   - macOS: `~/Library/Application Support/bible-desktop-app/extensions/`
   - Windows: `%APPDATA%\bible-desktop-app\extensions\`
2. Restart the app (or reload extensions if supported).
3. The extension activates on startup and shows a "Words: --" item in the status bar.

## The app

`contributes.apps` declares the app (`counts`, `ui/app.html`, icon `media/counts.svg`); the permission `ui:contribute-app` is asked at install, and the activation event `onApp:counts` starts the worker when the user opens it.

- **Messaging:** the app page runs sandboxed in an `ext-ui://` iframe with no `api.*`. The host identifies it as `panelId = 'app:counts'` (and `appId = 'counts'` on `PanelMessageSender`); the page cannot choose that. It sends `{ type: 'getStats' }` with `panel.invoke`, answered by the worker's `api.panels.onMessage` handler, and the worker pushes `{ type: 'stats', stats }` with `api.panels.postMessage(msg, { panelId: 'app:counts' })` while the app is visible (`api.apps.onDidChangeVisibility`).
- **No bundler:** `ui/app.js` is plain JS and speaks the SDK's small postMessage RPC directly. With a bundler, use `@bible/extension-ui` (`postToWorker`, `onWorkerMessage`, `useHostStyles`) instead. Page scripts must be external files (the CSP has no inline script).
- **Opening from the worker:** `api.apps.open('counts')` resolves `true` only when the host saw a recent user gesture in this extension's own UI (a click in its panel or app, a command run, a notification action); otherwise it resolves `false`. Here it runs from the declared command, so it is always user-initiated.
- **Older hosts:** every `api.apps` call is feature-detected, so the status bar item still works where extension apps do not exist.

## What it demonstrates

- **Extension manifest** (`extension.json`) with permissions, activation events, and metadata
- **Lifecycle hooks** (`activate` / `deactivate`) for setup and teardown
- **Event subscription** via `api.events.subscribe('verse.activeChanged', ...)`
- **Bible data access** via `api.bible.getRange()` to read passage text
- **Extension app** with a badge, a command and the app/worker message channel
- **Status bar contributions** via `api.ui.registerStatusBarItem()`
- **Disposable pattern** for cleaning up subscriptions and UI contributions

## Permissions used

| Permission      | Why                                            |
|-----------------|------------------------------------------------|
| `bible:read`    | Read verse text from the active Bible module   |
| `ui:status-bar` | Register a status bar item to display the count|
| `ui:contribute-app` | Add the Word Count app and its badge to the app switcher |

## Files

```
word-count-example/
  extension.json   - Extension manifest
  package.json     - npm package config (wires the `smoke` script)
  src/main.js      - Extension entry point (CommonJS, plain JS)
  ui/app.html      - The app page (loads host theme + kit CSS)
  ui/app.js        - App logic (external script; CSP forbids inline)
  ui/app.css       - App styles (host tokens, logical properties)
  media/counts.svg - App icon
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
