# Audio Bible

**Last verified:** 2026-11-18 (task 0223, branch `feature/audio-desktop`)

Listening to a chapter on the desktop app: recordings (downloaded per book, or streamed from a configured host) and on-device speech (Piper) for everything else. The engine is the shared `@bible/audio` package, the same code the web app runs (see `apps/web/docs/features/audio.md` for the player, providers, resolver, manifests and the Piper internals). This page covers what is specific to the desktop app.

**Off by default.** Feature flag `audio`, in both processes: `KTH_FLAGS=audio` for the main process (unpackaged builds only, like `recite`) and `VITE_KTH_FLAGS=audio` (or `localStorage['kth.flags']` in development) for the renderer. With the flag off, main registers no `kth-audio:` handler, contributes no Piper assets and the renderer module never activates. **Main window only:** detached windows are separate renderers in which feature modules do not run.

## How it fits together

```
 renderer (main window)                                         main process
 ListenButton (readerToolbarItems) ─┐                           electron/modules/audio
 AudioTransportBar (readerBars)      ├─ audioStore (AudioStore)   getInfo ─ config (Piper voices, recordings base)
 AudioPlayerPopup / GateDialog /     │   ├ desktopPorts (panes)   kth-audio://app/audio/...
   LiveRegion (shellOverlays)        │   ├ player + resolver        v1/...          downloads dir, else gateway proxy (Range)
 PlayingVerseController              │   └ Piper worker ──fetch──▶  tts/piper/...   installed AssetManager assets
   (readerPaintControllers)          │                              pronunciation/  installed overlay asset
 Preferences > Audio (AudioSection) ─┘   downloads model ─IPC─▶   downloads* (files under <data dir>/audio-downloads)
```

- **One scheme for everything.** `kth-audio://app/audio/` mirrors the web's `/audio` tree, so the shared code needs no desktop paths. It is registered privileged (standard, secure, fetch API, CORS, stream) in the same `registerSchemesAsPrivileged` call as `ext-ui`. Only GET and HEAD, host `app`, no `..`, dotfiles, backslashes or `:` segments; local files answer Range with 206 or 416.
- **All egress goes through NetworkGateway** (context `audio`), so the offline switch blocks it: streaming answers 503 offline and a download fails with code `offline` ("Network access is off. Turn it on in Preferences to download.").
- **CSP** (`index.html`): `kth-audio:` in `script-src` and `connect-src` (the Piper worker and its runtime), `media-src 'self' blob: kth-audio:`. No remote origin is added: the configured recordings host is reached only through main.
- **Configuration** comes from main (`audio:getInfo`) and is normalized in the renderer by the shared `parseAudioSiteConfig(raw, { allowSchemes: ['kth-audio'] })` (`desktopAudioConfig.ts`). When nothing can play (no engine, no recordings) the module adds no UI.

## Recordings

- **Base:** `BIBLE_AUDIO_RECORDINGS_BASE` (http/https only; there is **no default host**), read at run time, else the value baked in at build time (the same variable, or branding `audioRecordingsBase`). With no host but books on disk, the recorded channel stays on for the downloaded books. It is the directory that holds `v1/`, so for a host laid out like the web app's it ends in `/audio` (`https://example.org/audio`). Without it, recorded audio is off and only downloaded books and Piper play.
- **Streaming:** `kth-audio://app/audio/v1/...` is proxied to `<base>/v1/...` with the Range header passed on, so starting mid-chapter and seeking work.
- **Auto with the network off:** a downloaded book is served from disk first, so it plays and seeks offline; anything else fails over to on-device speech (the resolver's usual fallback).

## Per-book downloads

Preferences > Audio > Downloads (`downloads/AudioDownloads.tsx`, `AudioDownloadsPanel.tsx`), built on the shared `AudioDownloadsModel` (`packages/audio/src/downloads/audioDownloads.ts`):

- Choose a translation (installed Bibles with recordings) and narrator (a select only with two or more), then books grouped Old / New Testament, each with size, state (downloaded, partly downloaded) and "N of M chapters" when only part of the book is recorded. "Select all" per testament, a Whole Bible preset with the total that always asks first; any selection over 500 MB or over the free space asks too, and one that does not fit cannot start.
- Each book downloads its chapter manifests and the one file per chapter this computer plays, plus the translation's `index.json`, so the translation is known to have recordings offline. **The translation's text is installed first** when it is missing (`ensureModuleText`, the module manager's own install).
- Progress (a progress bar and a polite live region), Cancel (finished files stay; the next run resumes file by file; the translation's `index.json` is fetched again every run) and Remove per book.
- **Storage:** files under `<data dir>/audio-downloads/v1/...` (`getAudioDownloadsRoot()`: the app's data directory, `<userData>/data` when packaged, `apps/desktop/data` in development), written by main (`electron/modules/audio/downloadStore.ts`): `.part` file, size and sha256 check, rename, so a cut-off file never looks complete. Free space from `statfs`. Nothing logs which books are downloaded.
- Pack plumbing: the item kind `audio` (`<module>/<narrator>/<rev>/<book>`, requiring its text module; `PackTypes.ts`), `audioBookOffer` and `createAudioPackInstaller` exist, but neither app offers audio books in its offline or starter packs yet: books are downloaded from the picker only.

## On-device speech (Piper)

- The runtime (ONNX Runtime Web 1.22.0, piper-wasm 1.0.0, about 30 MB), three voices (en_US-amy-low, en_US-hfc_female-medium, es_ES-davefx-medium, about 63 MB each) and the pronunciation overlay (`en/KJV.json`, `en-us/lexicon.json` from bible-scripts at a pinned commit) are **AssetManager assets** with pinned sizes and sha256 (`electron/modules/audio/piperManifests.ts`), contributed only with the flag on. Mirrors: `BIBLE_PIPER_RUNTIME_BASE`, `BIBLE_PIPER_VOICES_BASE`, `BIBLE_PRONUNCIATION_BASE` (http/https).
- Installing the runtime installs the overlay with it, so speech sounds the same offline. Nothing downloads until the reader agrees in the gate dialog, which shows the size still to download (the voice, plus the runtime while it is not installed: `pendingBytes`).
- The worker is the shared Piper worker in `direct` storage mode: it fetches the `kth-audio:` URLs instead of using the Cache API (which cannot key a custom scheme). Main serves `piper_phonemize.js` transformed into an ES module; the installed asset stays the upstream bytes.

## Reader integration

- **Tabs are panes.** The store's tab id is the Bible pane's panel id (`desktopPorts.ts`). Audio follows only the pane where Listen was pressed. Navigating that pane elsewhere or closing it stops playback; changing its translation restarts it in the new translation from the same verse.
- **Next chapter** turns only the playing pane: `followToChapter(panelId, book, chapter)` (`verseSlice.ts`) loads the chapter without changing the selection, pushing history or moving Study / Commentary panes.
- **Follow-along** (`PlayingVerseController`, a reader paint controller): toggles `verse--playing` on `[data-verse-id]` rows (tint and an inline-start rule, no size change) and auto-scrolls the pane, pausing 8 s after the reader scrolls. It writes only on change (a no-op class write still triggers the MutationObserver).
- **Player styles:** pop-up (default) or bar, in Preferences or the gear's quick settings: transport, progress, speed, source, voice.
- **Keyboard** (`shortcuts.ts`, a capture-phase window listener): Alt+P play/pause, Alt+Left / Right previous / next verse and Alt+Shift+Left / Right previous / next chapter while audio is active (otherwise Alt+Left keeps its "back" meaning), Alt+Shift+P to the player, Escape back to where focus was. Listed in the Keyboard Shortcuts dialog when the flag is on.

## Files

### Main process (`electron/modules/audio/`)

| File | Description |
|---|---|
| `manifest.ts`, `index.ts`, `flag.ts` | The main module (flag `audio`): `getInfo`, the `kth-audio` handler, the downloads IPC |
| `types.ts` | Scheme, base URLs, asset ids, `AudioModuleApi` |
| `audioProtocol.ts`, `audioScheme.ts`, `gatewayUpstream.ts` | The scheme's route table (pure, injected), its privileges, the NetworkGateway upstream |
| `downloadStore.ts` | Book downloads on disk: present, fetch jobs with progress and cancel, remove, free space, usage |
| `piperManifests.ts`, `info.ts` | Pinned Piper and overlay assets; the config block and recordings base |

Also: `extensions/extUiProtocol.ts` (extra privileged schemes), `services/assets/AssetService.ts` (Piper assets behind the flag), `utils/appPaths.ts` (`getAudioDownloadsRoot`), `index.html` (CSP).

### Renderer (`src/ui/modules/audio/`)

| File | Description |
|---|---|
| `manifest.ts`, `binding.ts`, `module.ts` | Feature module: activates with the flag, fills the slots, Preferences view `preferences:audio` |
| `audioState.ts`, `audioSystem.ts`, `desktopPorts.ts` | The shared `AudioStore` with the pane ports; the system built for `kth-audio:` |
| `desktopAudioConfig.ts`, `desktopPiper.ts`, `audioClient.ts` | Config from main; Piper assets through AssetManager IPC; typed module client |
| `PlayingVerseController.tsx`, `shortcuts.ts` | Follow-along highlight and scroll; keyboard |
| `components/` | Listen button, bar, pop-up, verse pane, quick settings, speed, gate dialog, live region, Preferences section, `audio.css` |
| `downloads/` | Downloads picker, desktop download store over IPC, recordings handle |

Locales: `locales/<lng>/audio.json` (namespace `audio`).

## Testing

Unit tests beside the code (`npx vitest run src/ui/modules/audio electron/modules/audio`); the shared engine is tested in `packages/audio`.

E2E: `e2e/tests/audio.spec.ts` (fixture `e2e/fixtures/audioFixture.ts`, KJV John 3 as a WAV served by a Range-capable server the spec starts): Listen plays, the follow highlight moves, one book downloads from Preferences > Audio, and with the server closed and network access off it plays from disk and seeks. Needs a build with the renderer flag: `VITE_KTH_FLAGS=audio pnpm run build:desktop`, then `rebuild-native:force`, then `xvfb-run -a pnpm exec playwright test --config=e2e/playwright.config.ts e2e/tests/audio.spec.ts`.

Measured (task 0223, Intel i5-10400 VM, en_US-amy-low): Piper synthesizes at about 3.7x real time (3.2x on the first call). Downloads: runtime 29 MB and voice 61 MB on disk (the voice manifests say 63 MB).

## Not verified

- Piper on a slow machine; playback with a real remote recordings host (none is configured; the downloads and streaming paths are tested with fakes and the local fixture).
- macOS and Windows packaged builds (the scheme and CSP are only checked on Linux in development).
