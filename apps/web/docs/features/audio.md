# Audio Bible

Listening to a chapter: pre-generated recordings where an installation has them, and on-device text-to-speech (Piper first) for everything else. Both channels sit behind one player and a set of interfaces, so any part that renders, fetches, caches or times audio can be replaced without touching the rest.

The design (architecture, interface sketches, manifest format, open questions) was written up in task 0059 and the answers are folded into this document. This page is the developer map of what was built.

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

What this means for the build:

- **The library loads its runtime and voices from third-party origins** (cdnjs, jsDelivr, huggingface.co). The app's Content Security Policy allows only `'self'`, and the privacy default must stay intact, so the runtime files and voice models are self-hosted: the engine adapter takes every URL from configuration (`assetBase`), and the server exposes them under `/audio/` (see the server section). Operators may opt in to a remote origin, which is then added to `connect-src` and `media-src`.
- **The first synthesis is slow** (runtime and model load), so the player shows a "Preparing" state and starts synthesizing the selected verse before anything else.
- **Real-time factor 0.62 on a desktop CPU with one thread** leaves little headroom on a phone, so on-device speech pre-buffers verses ahead (look-ahead queue) and warns about battery on phones.
- **Not checked here** (no device available): Ogg Opus playback on current iOS Safari, real-phone real-time factor and battery use, background playback with the screen locked, Kokoro (phase 2). The MP3 fallback from the recorded manifest format stays in place, and the recorded provider picks the first file whose MIME type passes `canPlayType`, so an Ogg-less Safari simply gets the MP3.
