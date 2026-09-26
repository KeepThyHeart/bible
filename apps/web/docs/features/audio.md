# Audio Bible

**Last verified:** this task (0059), on branch `feature/audio`

Listening to a chapter: pre-generated recordings where an installation has them, and on-device text-to-speech (Piper) for everything else. Both channels sit behind one player and a set of interfaces, so any part that renders, fetches, caches or times audio can be replaced without touching the rest.

**Off by default.** The feature is switched on with `features.audio: true` in `site-config.json`. Until then the server mounts no `/audio` route, `/api/config` carries no `audio` block, the client never loads any audio code (`main.tsx` imports it dynamically), and the strict Content-Security-Policy is unchanged.

**With zero recordings it still works.** No translation has recordings yet. With no recordings and no engine, the Listen button is disabled with a tooltip saying why. With an engine configured, on-device speech plays any translation whose language it has a voice for. A recording, when one exists, is preferred automatically.

## How it fits together

```
 Bible toolbar "Listen"  -->  audioStore  --> AudioSourceResolver --> providers (recorded, tts:piper, ...)
 transport bar / phone player      |                                        |
 settings tab                      +--> AudioPlayer --> HtmlAudioOutput     +--> IChapterAudio (segments per verse)
                                   |         +--> MediaSessionBridge
                                   +--> follow store (the verse being read) --> highlight + auto-scroll only
```

- **Providers.** `RecordedAudioProvider` plays a published chapter file with verse timings. `TtsAudioProvider` (one per enabled engine, id `tts:<engine>`) asks an `ITtsEngine` to synthesize verse by verse ahead of the playhead and hands the player one WAV per verse. The player does not know which it has.
- **Resolver.** Chooses a provider for a translation: the reader's choice for that translation, else their global choice when usable, else a recording, else the first engine that can speak the language. `sourceStatus()` lists every provider with why an unusable one cannot play (for the source control).
- **Store.** `audioStore` owns preferences, the gates (battery, download), the resolved source, and mirrors player state for components. The fast-changing position and the verse being read live in two small side stores, so a position tick re-renders only the progress bar.
- **Follow-along is a highlight only.** The verse being read gets `verse--playing` (a rule at the inline-start edge plus weight, not colour alone) and, if `autoScroll` is on, the pane scrolls to it (pausing for a few seconds after the reader scrolls). It **never** selects the verse, never changes `studyVerse`, never makes the Study or Commentary panes refresh, and never pushes a history entry. Those change only when the reader clicks or selects a verse. Play starts at the selected verse. When reading moves into the next chapter the page is turned with `navigateTo(..., { follow: true })`, which leaves the selection alone as well. If the reader navigates the playing tab elsewhere, closes it, or changes its translation, playback stops or restarts in the new translation from the same verse.
- **Desktop and phone differ only in layout.** Desktop docks `AudioTransportBar` under the toolbar. On phones Listen opens the full-screen `AudioPlayerScreen` (a dialog: focus moves in and back, Escape and the Android Back button close it, playback continues) and a mini-player shows above the bottom bar in every view. `audioStore.layout` is set by `DesktopApp` and `MobileApp`.
- **Gates.** Before the first sound of a play: on a phone, one notice per engine per device says speech costs battery (and, when the voice is not downloaded yet, its size: "Download and play"); on any layout a not-yet-downloaded voice asks before downloading. Nothing is downloaded or played until the reader confirms.
- **Errors and notices** are shown inline in the same status line on both layouts (the app has no toast): retry, resume (autoplay blocked), "use on-device speech" (only when an engine exists for the language), and a dismissable notice when a preference could not be honoured.

## Configuration

`site-config.json` (see `apps/web/config/site-config.example.json` and the schema):

```json
{
  "features": { "audio": true },
  "audio": {
    "dir": "audio",
    "base": "/audio",
    "recorded": true,
    "tts": {
      "engines": [{
        "id": "piper", "enabled": true,
        "defaultVoices": { "en": "en_US-amy-low" },
        "voices": [{ "id": "en_US-amy-low", "label": "Amy", "language": "en-US", "quality": "low",
                     "downloadBytes": 63104526, "files": ["voices/en_US-amy-low.onnx", "voices/en_US-amy-low.onnx.json"] }]
      }]
    }
  }
}
```

`dir` is the directory served at `/audio` (relative to the data directory). `base` is where the client looks for recordings: `/audio` (this server) or an https origin the operator opted in to (then added to the CSP's `media-src` and `connect-src`, and nothing else is). An engine's `assetBase` defaults to `<base>/tts/<id>`. Voice `files` are relative to it and may not leave it. Both the server and the client normalize the block with the same function (`parseAudioSiteConfig`), so a broken entry loses that entry, not the feature. A `/`-relative base is served under the app's own base path when the app is hosted under a sub-path.

## Hosting layout (under `<data>/audio`, served at `/audio`)

```
v1/{module}/index.json                                  per-translation index (mutable, short cache)
v1/{module}/{narrator}/{rev}/{book}/{ccc}.json          chapter manifest (immutable)
v1/{module}/{narrator}/{rev}/{book}/{ccc}.ogg|.mp3|...  chapter audio (immutable, Range requests)
tts/{engine}/...                                        an engine's runtime and voice files
```

Only `v1` and `tts` are served, dotfiles and `..` are refused, a miss is a real 404 (never the SPA shell), and there are no directory listings. `express.static` provides Range support, which starting a chapter mid-way and seeking need.

**Index** (`kth-audio-index/1`): `{ module, narrators: [{ id, label, language, rev, books: [book numbers fully recorded], chapters?: { "43": [3, 4] } }] }`.

**Chapter manifest** (`kth-audio-chapter/1`): `{ module, book, chapter, narrator, rev, textHash?, duration, files: [{ codec, mime, path, bytes, sha256? }], intro?: [start, end], verses: [[verse, start, end], ...] }`. `path` is relative to the chapter's directory (`43/003.ogg`). The player uses the first file whose MIME type the browser can play (`canPlayType`), so a build with Ogg Opus first and an MP3 second works on every browser. Psalm titles are verse 0. Validators and JSON Schemas are in `packages/core/src/audio/manifest.ts` and `manifestSchema.ts`; the e2e fixture (`e2e/audioFixture.ts`) is a worked example.

**Generating recordings is out of scope for this feature** (the pipeline is a separate piece of work). Anything that writes files in this layout will be played.

## On-device speech: Piper

Piper runs in a module Web Worker with ONNX Runtime Web and the espeak-ng phonemizer. The upstream library loads all of these from cdnjs, jsDelivr and huggingface.co, which the CSP blocks (and the privacy default forbids), so **everything is self-hosted** under `<audio dir>/tts/piper/`:

```
runtime/ort.wasm.min.mjs, ort-wasm-simd-threaded.mjs, ort-wasm-simd-threaded.wasm     ONNX Runtime Web 1.22.0 (MIT)
runtime/piper_phonemize.js (wrapped as an ES module), .wasm, .data                    @diffusionstudio/piper-wasm 1.0.0 (MIT; espeak-ng is GPL-3.0)
voices/<voice>.onnx and <voice>.onnx.json                                             rhasspy/piper-voices (each voice has its own licence: check its MODEL_CARD)
```

Install them with the script, then paste the config block it prints:

```bash
npm run fetch:piper -w @bible/web -- --voice=en_US-amy-low --voice=es_ES-davefx-medium
npm run fetch:piper -w @bible/web -- --runtime-only
node apps/web/scripts/fetch-piper-assets.mjs --dest=/srv/bible/data/audio --voice=en_US-hfc_female-medium
```

`BIBLE_DATA_DIR` is honoured as by the server; `PIPER_VOICES_BASE` points at another voices mirror; `FORCE_PIPER_FETCH=1` re-downloads. The runtime is about 29 MB and a medium voice about 60 MB; the client downloads them once, on the first play (after the reader confirms), into the `kth-tts-models` cache.

How it works, and the gotchas that were paid for:

- The worker maps the phonemizer's `phonemes` through the **voice's own `phoneme_id_map`** (BOS, PAD, then each phoneme followed by PAD, then EOS, per sentence). The `phoneme_ids` the phonemizer prints use a default table and fail for voices with another symbol table (`en_US-amy-low` has 130 symbols): `vits-web` works around this only for the voices it was tested with. Text is split into sentences so each gets its own boundaries.
- Speed is `length_scale / rate` (no pitch artefacts). ONNX Runtime and the phonemizer get their wasm bytes from the cache (`wasmBinary`, `getPreloadedPackage`), so a voice works offline; only the two small scripts are loaded by URL (the PWA service worker caches those too, see `AUDIO_ENGINE_RUNTIME_CACHE_PATTERN`).
- One voice is kept in memory. One request runs at a time. Aborting a request rejects it at once and drops its late result; the worker is kept because the model is expensive to load. A crash or a request that stops making progress terminates and recreates the worker (`WorkerTtsEngine`).
- One thread unless the page is cross-origin isolated (it is not by default).
- `scripts/fetch-piper-assets.mjs` uses Node `fetch`; on the machine this was built on Node could not reach `us.aws.cdn.hf.co` (voice files redirect there) while `curl` could. If the download fails with a connect timeout, fetch the voice files with `curl -L` into `voices/`.

A second engine (Kokoro, phase 2) would add a `TtsEngineFactory` to the registry in `bootstrap.ts`; the settings screen, the resolver and the popover build themselves from what an engine reports, so nothing else changes. `LazyTtsEngine` answers capabilities and voice lists from the factory and site config without loading the engine.

## Caches and preferences

| Where | What |
|---|---|
| Cache API `kth-audio-manifests`, `kth-audio-chapters` | manifests and recorded chapter files (recently played chapters, size-limited LRU) |
| Cache API `kth-tts-models` | engine runtimes and voices, never expired automatically |
| `localStorage` `bible-audio-prefs` | source (global and per translation), voice per engine and language, speed, follow-along, auto-scroll, continue, chapter intro, battery notice seen. Validated on load; independent of the settings store |

The Cache API is used directly from the page (not through the service worker) so recordings and voices are cached whether or not the PWA is enabled; the PWA build adds routes for the same caches so seeking in a cached chapter works offline.

## Keyboard, accessibility

Alt+P play/pause, Alt+Left / Alt+Right previous / next verse, Alt+Shift+Left / Right previous / next chapter (registered in `keybindingRegistry`; the arrows act only while audio is active and never while typing, so Alt+Left stays "browser back" otherwise; on macOS Option+P types another character, use the buttons). Listed in the Help dialog when audio is on. Controls have labels and `aria-pressed`; the progress control is a native range input with a "verse N of M" value text; a polite live region announces started, paused, resumed, stopped, chapter changes and errors (never the position); the playing tab has a speaker mark; the phone player is a modal dialog with focus in and out; status lines use `role="alert"` for errors; reduced motion stops spinners.

## File map

### Core (`packages/core/src/audio/`)

| File | Description |
|---|---|
| `types.ts` | All the interfaces: `IAudioProvider`, `IChapterAudio`, `ITtsEngine`, `IAudioPlayer`, `IAudioOutput`, `IManifestSource`, `IAudioLocator`, `IAssetCache`, `IAudioSourceResolver`, `ITextPreparer`, `TtsEngineFactory`, `AudioPrefs`, `AudioSiteConfig`, `AudioError` codes |
| `manifest.ts`, `manifestSchema.ts` | Validators for the index and chapter manifest, timing helpers, JSON Schemas |
| `config.ts` | `parseAudioSiteConfig` (shared by server and client), `audioExternalOrigins` (for the CSP) |
| `registry.ts` | `Registry<T>`, the shape of the plugin registries, for providers and engine factories |

### Server (`apps/web/server/`)

| File | Description |
|---|---|
| `routes/audioRoutes.ts` | `/audio`: the two served trees, Range, immutable caching, traversal-safe |
| `cspDirectives.ts` | `media-src 'self' blob:` (only when audio is on) plus the configured remote origins |
| `SiteConfig.ts` | `features.audio`, the `audio` getter (dir, client block, external origins) |

### Client, audio layer (`apps/web/src/audio/`)

| File | Description |
|---|---|
| `bootstrap.ts`, `initAudio.ts` | Assemble providers, resolver, player and media session from the config; connect them to the stores. `initAudio` is loaded dynamically from `main.tsx` only when the feature is on |
| `AudioPlayer.ts` | The one player: generation-guarded queue, verse events, seek, chapter end, prefetch. Rules are in its header |
| `HtmlAudioOutput.ts` | One shared `<audio>` element behind `IAudioOutput` |
| `RecordedAudioProvider.ts`, `HttpManifestSource.ts`, `CdnAudioLocator.ts` | The recorded channel and its URL scheme |
| `tts/TtsAudioProvider.ts`, `tts/TtsChapterAudio.ts` | The speech channel: look-ahead queue, one WAV per verse |
| `tts/WorkerTtsEngine.ts`, `tts/serveTtsWorker.ts`, `tts/ttsWorkerProtocol.ts`, `tts/LazyTtsEngine.ts` | Engine-independent worker plumbing and lazy loading |
| `tts/piper/` | `PiperEngine`, `piperFactory`, `piperWorker` (entry), `piperHandlers` (the algorithm, dependency-injected for tests), `piperConfig` (file layout) |
| `AudioSourceResolver.ts` | Which provider and voice plays a translation; `sourceStatus` |
| `AssetCache.ts`, `cacheNames.ts`, `audioStorage.ts` | Cache API and in-memory `IAssetCache`, cache names shared with the service worker, storage usage and clearing |
| `TextPreparer.ts` | Verse markup to speakable text; chapter intro ("John, chapter 3.") per language |
| `MediaSessionBridge.ts` | Lock-screen and media-key controls |
| `audioPrefs.ts`, `config.ts`, `registries.ts`, `wav.ts`, `audioShortcuts.ts` | Preferences, client config accessor, registries, WAV encoding, shortcuts |
| `testing.ts`, `uiRig.ts` | Test doubles: fake media element, output, providers, TTS engine, manifest source; a rig wiring the real store and player to them |

### Client, state and UI

| File | Description |
|---|---|
| `src/stores/audioStore.ts` | The store the UI talks to (plus `PositionStore` and `FollowStore`) |
| `src/stores/bibleStore.ts` | `navigateTo({ follow, tabId })`: a page turn that leaves the selection, hash and Study panes alone |
| `src/hooks/useFollowScroll.ts`, `useNowPlaying.ts` | Auto-scroll to the verse being read; the "what is playing" view model |
| `src/components/BiblePane/BibleToolbar.tsx`, `AudioTransportBar.tsx`, `BibleTabBar.tsx`, `VerseRenderer.tsx`, `BibleContent.tsx` | Listen button, desktop bar, speaker mark on the tab, `verse--playing` |
| `src/components/AudioPlayerScreen.tsx`, `AudioMiniPlayer.tsx` | Phone player and mini-player (`MobileApp.tsx` mounts them and puts the player first in the Back-button priority list) |
| `src/components/audio/` | Shared pieces: status line, transport buttons, progress, source panel, controls, gate dialog, live region, source list hook |
| `src/components/Dialogs/AudioSettingsTab.tsx` | Settings > Audio |
| `src/styles/_audio.scss` | All audio styles (theme tokens only) |
| `src/sw.ts`, `src/utils/swCachePatterns.ts` | PWA routes for manifests, chapters and engine runtimes |
| `scripts/fetch-piper-assets.mjs` | Installs the Piper runtime and voices |
| `e2e/audioFixture.ts`, `e2e/tests/audio-e2e.spec.ts` | Fixture recording of John 3 (KJV) and the specs |

## Testing

Unit tests sit beside the code and use fakes only (`FakeManifestSource.withChapters` is the fixture manifest; `FakeTtsEngine` stands in for Piper), so everything runs with zero recordings. The Piper handlers are tested with a fake ONNX Runtime and phonemizer, and `PiperEngine` through the real worker protocol. `src/audio/localeKeys.test.ts` checks that every locale key the code uses exists in English and that es and zh-Hans have the same keys and parameters. E2E: `npx playwright test --config=e2e/playwright.config.ts audio-e2e` (needs a built client and the modules the suite lists; see `e2e/README.md`).

## Not verified here

- iOS Safari: Ogg Opus playback (the MP3 fallback covers it), autoplay after the gate, background playback with the screen locked, `resume()` calling `play()` synchronously from a gesture.
- A real phone: speech real-time factor, battery use, memory with a 60 MB model plus 29 MB runtime.
- The full Piper download and a voice other than English (`en_US-amy-low` was run end to end in headless Chrome; the phonemizer and symbol-table handling is generic, but other languages were not listened to).
- Whether the generated speech is *intelligible*: only its length and level were checked, nobody listened.
- Kokoro (phase 2) and the recording pipeline (separate work) are not built; their seams are (`TtsEngineFactory.capabilities`, `WorkerTtsEngine`, the manifest layout).

## Spike findings (A0)

Measured on a Linux VM (6 cores, no GPU pass-through worth mentioning) with Google Chrome 153 driven by Playwright, headless, on 2026-09-25. Library: `@diffusionstudio/vits-web` 1.0.3 (a browser build of Piper, ONNX Runtime Web 1.18 plus an espeak-ng WASM phonemizer), voice `en_US-hfc_female-medium`. The measuring page was a throwaway and is not in the repository.

| Measurement | Result |
|---|---|
| Voice download (medium quality) | 63.2 MB (25 s on the test connection) |
| Runtime download | ONNX Runtime `ort-wasm-simd.wasm` 10.6 MB, phonemizer `piper_phonemize.wasm` 0.6 MB, espeak-ng data `piper_phonemize.data` 18.1 MB: about 29 MB, more than the 10 MB the design assumed |
| First synthesis of one 8.5 s verse | 7.9 s (includes runtime instantiation and model load) |
| Second synthesis of the same verse | 5.3 s, real-time factor 0.62 (faster than real time) |
| Threads | ONNX Runtime fell back to one thread: multi-threaded WASM needs cross-origin isolation, which the app does not enable |
| Output | 22.05 kHz mono 16-bit PCM; wrapped in a WAV Blob it played in an `<audio>` element |
| `canPlayType` in Chrome | `audio/ogg; codecs=opus` probably, `audio/mpeg` probably, `audio/wav` maybe |
| WebGPU | present in this Chrome (`navigator.gpu`), not used by Piper here |

**Measured again with the shipped engine (A9)**, same machine and browser, voice `en_US-amy-low` (63 MB), the runtime self-hosted, one thread: voice and runtime download from localhost 3.4 s, a 28-word verse (8.7 s of audio at 16 kHz) synthesized in 2.2 to 2.7 s (real-time factor 0.25 to 0.3), speed 1.5 shortened it to 6.9 s. The engine was driven through the real worker in headless Chrome; the throwaway harness is not in the repository.

What this means for the build:

- **The library loads its runtime and voices from third-party origins** (cdnjs, jsDelivr, huggingface.co). The app's Content Security Policy allows only `'self'`, and the privacy default must stay intact, so the runtime files and voice models are self-hosted: the engine adapter takes every URL from configuration (`assetBase`), and the server exposes them under `/audio/` (see the server section). Operators may opt in to a remote origin, which is then added to `connect-src` and `media-src`.
- **The first synthesis is slow** (runtime and model load), so the player shows a "Preparing" state and starts synthesizing the selected verse before anything else.
- **Real-time factor 0.62 on a desktop CPU with one thread** leaves little headroom on a phone, so on-device speech pre-buffers verses ahead (look-ahead queue) and warns about battery on phones.
- **Not checked here** (no device available): Ogg Opus playback on current iOS Safari, real-phone real-time factor and battery use, background playback with the screen locked, Kokoro (phase 2). The MP3 fallback from the recorded manifest format stays in place, and the recorded provider picks the first file whose MIME type passes `canPlayType`, so an Ogg-less Safari simply gets the MP3.
