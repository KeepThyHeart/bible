# @bible/speech

On-device speech for recite and hands-free mode. Whisper through transformers.js (ONNX Runtime Web, WebGPU when
the adapter has `shader-f16`, WASM otherwise) in a Web Worker; microphone capture to 16 kHz mono through an
AudioWorklet; an energy VAD; `PcmListener` (end-pointing); platform TTS; and `SpeechService`, the
`ISpeechApi` the Memory module and the extension host consume. No audio or text leaves the device.

Consumed as source by the web app (`apps/web/src/speech/webSpeech.ts`, lazy, never in the entry chunk) and the
desktop renderer (`apps/desktop/src/ui/modules/speech`). The model files come from the Downloads module
(asset kind `stt-model`, sha256-pinned in `src/models/whisperModels.ts`; `scripts/speech/pin-whisper-models.mjs`
regenerates the table). The host comes from branding `speechModelBaseUrl` (desktop: env
`BIBLE_SPEECH_MODEL_BASE_URL`), default Hugging Face; a mirror keeps the `<repo>/resolve/<rev>/<path>` layout.

## Tests

- `pnpm --filter @bible/speech test`: unit tests with fakes (no model).
- Opt-in, real model in Node: `SPEECH_IT=1 pnpm --filter @bible/speech test -- test/integration`
  (`SPEECH_MODEL=tiny|base`, default `base`; downloads the q8 model once into `~/.cache/bible-speech-models`,
  `SPEECH_MODEL_DIR` overrides; skipped when offline). Runs the PCM fixtures through the real engine and grades
  them with the Memory grader.
- Fixtures: `test/fixtures/*.wav` (16 kHz mono) and `fixtures.json`, made by
  `python3 scripts/speech/make-fixtures.py` from the OS espeak-ng library (needs `libespeak-ng1` and `ffmpeg`;
  two voices, `en-us` and `en-gb+f3`; five KJV passages, plus skipped-words and swapped-words versions for the
  first voice). Real recordings can replace them: keep the `fixtures.json` shape.

## Dev harness (web)

`pnpm --filter @bible/web exec vite`, then open `http://localhost:5173/dev/speech.html`: model download, mic test,
recite and hands-free with the real grader, a fake mic that plays a WAV, and a bench panel (load time, real-time
factor, heap). Dev server only; `vite build` never includes it.
