# @bible/extension-ui

Client-side SDK for Bible app extensions that render their own UI. An extension panel runs in a sandboxed iframe with no direct access to the host, so everything it needs -- navigation, verse popups, theming, network access -- is requested over a typed RPC bridge. This package is that bridge, plus the verse-reference parsing an extension usually wants alongside it.

Extensions that only run headless logic do not need this package; it is for the ones that draw something.

## Usage

```typescript
import { BibleExtUI } from '@bible/extension-ui';

const bible = BibleExtUI.init();

bible.linkVerses(document.body);       // turn "John 3:16" in the DOM into live links
bible.navigateToVerse(43003016);       // John 3:16
```

`init()` establishes the RPC channel to the host and returns a handle. Call `dispose()` when the panel unmounts to drop the channel and every subscription made through it.

## API

**Navigation**

- `navigateToVerse(verseId)` -- move the host's Bible pane to a verse id
- `navigateToReference(ref)` -- same, from a human reference such as `"Rom 8:28"`

**Popups**

- `showVersePopup(verseId, rect)` -- ask the host to show its verse popup, anchored to a rect in the iframe's coordinate space
- `hideVersePopup()`

**Events** -- each returns a `Disposable`

- `onActiveVerseChanged(cb)` -- fires when the user moves in the Bible pane
- `onThemeChanged(cb)` -- fires when the host theme changes

**Theme**

- `getTheme()` -- resolves to the host's current `ThemeInfo`, so a panel can match the app rather than guess

**Locale**

- `getLocale()` -- resolves to `{ locale, direction }` for the host's current UI locale (`direction` is `'ltr'` or `'rtl'`); read-only, no permission needed

**Styling and the UI kit**

- `useHostStyles(opts?)` -- links the host's `theme.css` and `kit/1/kth.css` (`{ kthCss: false }` skips the second), sets `<html data-theme>`, and follows live theme switches: on `theme.changed` it re-links `theme.css?theme=<id>` and keeps the old sheet until the new one loads, so there is no flash. A static `<link>` to the host stylesheets in your HTML is adopted rather than duplicated. Returns `{ dispose() }`.
- `loadKit({ components?, timeoutMs? })` -- loads the host-served `kth-*` custom elements (see below) and initialises them with the host locale. Returns `{ version, ready, dispose() }`; `ready` resolves once the elements are defined and rejects if the script fails to load, times out, or is an incompatible version.

**Linkifying**

- `linkVerses(root, opts?)` -- scans a DOM subtree for verse references and makes them navigable, so an extension does not have to write its own reference matcher

**Network**

- `fetch(url, init?)` -- proxied through the host, which applies the extension's declared network permissions. The iframe's own `fetch` is not a substitute: the sandbox blocks it.

**Reference parsing** -- also exported standalone, for use without a UI

- `parseReference(ref)`, `scanText(text)`, `calculateVerseId(book, chapter, verse)`, `getBookNumber(name)`, `getBookName(number)`

`RpcClient` is exported too, for extensions that want to talk to the host directly rather than through `BibleExtUI`.

## UI kit

The host serves ready-made custom elements, so a panel does not have to build a reference picker. The kit is **not bundled into this package**: `loadKit` only adds `<script src="ext-ui://host/kit/1/kth-kit.js">` at runtime. Declare the kit in `extension.json` (it requires the `ui:contribute-pane` permission) and list the components you use:

```json
"permissions": ["bible:read", "ui:contribute-pane"],
"uiKit": { "version": "1", "components": ["kth-reference-picker"] }
```

```html
<link rel="stylesheet" href="ext-ui://host/theme.css">
<link rel="stylesheet" href="ext-ui://host/kit/1/kth.css">
<kth-reference-picker id="ref" label="Go to reference"></kth-reference-picker>
```

```typescript
import { BibleExtUI, type KthReferenceChangeDetail } from '@bible/extension-ui';

const bible = BibleExtUI.init();
bible.useHostStyles();

const kit = bible.loadKit({ components: ['kth-reference-picker'] });
kit.ready.catch((err) => console.error('UI kit unavailable', err));

document.getElementById('ref')?.addEventListener('kth-change', (e) => {
  const { verseId } = (e as CustomEvent<KthReferenceChangeDetail>).detail;
  void bible.navigateToVerse(verseId);
});
```

Components: `kth-reference-picker` (`kth-change`, detail `KthReferenceChangeDetail`), `kth-book-chapter-picker` (`kth-pick`, `KthPickDetail`), `kth-highlight-swatch` (`kth-change`, `KthSwatchChangeDetail`). Events bubble. Render `kth-*` elements childless (the kit owns their contents), and set object properties such as `labels` from script. For panel tests, `@bible/extension-testing` has `createMockPanelHost()` and `loadUiKit()`.

## Verse ids

A verse id is a single integer, `book * 1000000 + chapter * 1000 + verse`, so John 3:16 is `43003016`. `calculateVerseId` builds one and `parseReference` returns one, so ids rather than strings can be passed across the bridge.

## Related packages

- [`@bible/create-extension`](../create-extension) -- scaffold a new extension project
- [`@bible/extension-testing`](../extension-testing) -- mock host, fixtures and the `bible-ext-smoke` harness
- [`word-count-example`](../word-count-example) -- a complete reference extension

## License

MIT. See [`LICENSE`](./LICENSE).

This package is deliberately permissive while the app itself is GPL-3.0-or-later: it is bundled into the extensions people build, so an MIT licence here is what lets an extension ship under any licence its author chooses, commercial ones included. It has no dependencies, so nothing copyleft travels with it.
