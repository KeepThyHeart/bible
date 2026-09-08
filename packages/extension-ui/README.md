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

**Linkifying**

- `linkVerses(root, opts?)` -- scans a DOM subtree for verse references and makes them navigable, so an extension does not have to write its own reference matcher

**Network**

- `fetch(url, init?)` -- proxied through the host, which applies the extension's declared network permissions. The iframe's own `fetch` is not a substitute: the sandbox blocks it.

**Reference parsing** -- also exported standalone, for use without a UI

- `parseReference(ref)`, `scanText(text)`, `calculateVerseId(book, chapter, verse)`, `getBookNumber(name)`, `getBookName(number)`

`RpcClient` is exported too, for extensions that want to talk to the host directly rather than through `BibleExtUI`.

## Verse ids

A verse id is a single integer, `book * 1000000 + chapter * 1000 + verse`, so John 3:16 is `43003016`. `calculateVerseId` builds one and `parseReference` returns one, so ids rather than strings can be passed across the bridge.

## Related packages

- [`@bible/create-extension`](../create-extension) -- scaffold a new extension project
- [`@bible/extension-testing`](../extension-testing) -- mock host, fixtures and the `bible-ext-smoke` harness
- [`word-count-example`](../word-count-example) -- a complete reference extension

## License

MIT. See [`LICENSE`](./LICENSE).

This package is deliberately permissive while the app itself is GPL-3.0-or-later: it is bundled into the extensions people build, so an MIT licence here is what lets an extension ship under any licence its author chooses, commercial ones included. It has no dependencies, so nothing copyleft travels with it.
