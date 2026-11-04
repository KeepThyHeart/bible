# @bible/audio-build

Pre-renders whole translations (or chosen books and chapters) to chapter audio files with exact
verse timings, in the hosting layout the web audio player already plays
(`apps/web/docs/features/audio.md`, "Hosting layout"). Readers of those translations then get audio
with no on-device speech processing.

GPL-3.0-or-later, private workspace package. Engines: **Kokoro-82M** (native, first) and **Piper**
(native, second), both on the CPU through `onnxruntime-node`.

## Why it lives in this repo

The text sent to the engine must be exactly what on-device speech uses, or recordings and live
speech would differ and verse timings would drift. So the tool imports the runtime code instead of
copying it:

| Shared with the apps | From |
|---|---|
| `TextPreparer` (verse text, chapter intro, small-caps names, "First John") | `@bible/core` (`packages/core/src/audio/TextPreparer.ts`) |
| Piper phoneme-to-id mapping, phonemizer arguments and output reader, scales | `@bible/core` (`piperPhonemes.ts`); the browser worker uses the same functions |
| Manifest and index types and validators | `@bible/core` (`manifest.ts`); every manifest is validated before it is written |
| `ITtsEngine`, the engine interface | `@bible/core` (`types.ts`); the engines here implement it |
| Module reading | `BibleRepository` over the module's SQLite file (no format parsing of its own) |

## Usage

```bash
pnpm install
pnpm build:core                                  # the tool imports the built core
pnpm --filter @bible/audio-build run build       # tsc to dist/

pnpm audio:build --module=KJV --engine=kokoro --voice=am_michael --chapters=JHN.3,PSA.23
pnpm audio:build --module=KJV --engine=piper --voice=en_US-amy-low --books=JHN --formats=opus
pnpm audio:build --module=KJV --engine=kokoro --dry-run          # what would be rendered, no model loaded
```

`pnpm audio:build --help` lists every option. The main ones:

| Option | Meaning |
|---|---|
| `--module=ABBR` | translation to record; the file is `<modules-dir>/bible_<abbr>.db` (`--modules-dir`, default `$BIBLE_DATA_DIR/modules`, or `--module-file=PATH`) |
| `--engine`, `--voice` | `kokoro` (default) or `piper`; a voice id. Defaults per language: Kokoro `am_michael`, Piper `en_US-amy-medium` |
| `--narrator`, `--rev` | narrator id (default `<engine>-<voice>`) and audio build id (default `1`) |
| `--books=JHN,PSA`, `--chapters=JHN.3,PSA.23-25` | what to record (USFM code, number or English name); neither: the whole module |
| `--out` | audio root, default `$BIBLE_DATA_DIR/audio` (the same rule as `fetch:piper`; the server serves it at `/audio`) |
| `--formats=opus,mp3` | Ogg Opus 32 kbps mono first, MP3 64 kbps mono second |
| `--rate`, `--gap`, `--intro-gap` | speed (1.0), silence between verses (350 ms) and after the intro (700 ms) |
| `--quantization=q8\|fp32` | Kokoro model precision (q8 default) |
| `--jobs=N` | parallel workers (default cores - 1); each has its own copy of the model |
| `--cache-dir` | models and voices, default `~/.cache/bible-audio-build`; never inside git |
| `--force`, `--dry-run`, `--i-have-rights` | render again; list only; override the licence gate |

Needs `ffmpeg` with libopus and libmp3lame on the PATH (or `--ffmpeg=` / `$FFMPEG`). The first run
downloads models: Kokoro from `onnx-community/Kokoro-82M-v1.0-ONNX` (about 90 MB for q8, 330 MB for
fp32, plus 0.5 MB per voice), Piper voices from `rhasspy/piper-voices` (the files `fetch:piper` uses).

## What a run does

For each chapter: prepare the text with core's `TextPreparer`; synthesize the intro ("John, chapter
3.") and every verse on its own (Psalm titles are verse 0); join them with a short silence between
(`--gap`, and `--intro-gap` after the intro) and record `[verse, start, end]` from **sample counts**,
so the times are exact; encode with ffmpeg; write the audio files (each under a temp name, then
renamed), then the manifest, which carries `bytes`, `sha256`, `duration`, `textHash` (a hash of the
prepared text of the whole chapter) and a `build` record (engine, model, voice, rate, gaps).

Layout, under `--out`:

```
v1/{module}/index.json
v1/{module}/{narrator}/{rev}/{book}/{ccc}.json   manifest (kth-audio-chapter/1)
v1/{module}/{narrator}/{rev}/{book}/{ccc}.ogg    Opus, preferred
v1/{module}/{narrator}/{rev}/{book}/{ccc}.mp3    fallback
```

- **Resume.** A chapter is skipped when its manifest exists and validates, its `textHash` and `build`
  record equal the ones this run would produce, and every listed file is on disk with the recorded
  size. A different voice is a different narrator. Changing the speed, gaps, model precision, or the
  text re-renders; so does asking for a format the chapter lacks. `--force` re-renders everything selected.
  A manifest is written last, so an interrupted run leaves no chapter that looks finished.
- **Index.** After a run `index.json` is rebuilt from the manifests on disk: `books` lists books with
  every chapter recorded, `chapters` the chapters of partial books. Other narrators' entries are kept
  as they are. Each narrator entry has `provenance` (engine, model, voice and the translation's text,
  each with licence, URL and attribution text).
- **Failures.** A failed chapter is logged and the run continues; the exit code is 1 if any failed (2 for a bad
  command line).
- **Progress.** One line per chapter (audio length, real-time factor, estimated time left) and a summary.

## Licences

The tool refuses a translation whose module metadata does not clearly allow audio derivatives
(public domain, CC0, CC-BY, CC-BY-SA, GPL, MIT and similar; anything NC/ND, proprietary or with no
licence) unless `--i-have-rights` is given. The translation's licence and attribution go in the index.

| Part | Licence |
|---|---|
| Kokoro-82M model and voices (hexgrad), ONNX build (onnx-community) | Apache-2.0 |
| `kokoro-js`, `onnxruntime-node`, `@huggingface/transformers` | Apache-2.0 / MIT |
| Piper (rhasspy/piper) and the VITS runtime | MIT |
| Piper voices | each voice's own licence, in its `MODEL_CARD` (the index records what the card says, or links to it) |
| espeak-ng phonemizer (`@diffusionstudio/piper-wasm` 1.0.0 wraps it) | GPL-3.0-or-later (wrapper MIT) |

## Memory and speed

Each job holds its own model: about 700 MB resident for Kokoro q8 (1.4 GB for fp32) and about 350 MB for a
Piper medium voice. With 7 GB of RAM use `--jobs=1` or `2` for Kokoro. Threads are split between jobs
(`cores / jobs` ONNX threads each). Measured real-time factors and the estimate for a whole translation
are in the task's delivery notes.

## Adding an engine

Implement `ITtsEngine` (`src/engines/kokoro.ts` is the shortest example), describe it with an
`EngineDefinition` (id, languages, voices, default voice, model label, memory, credits) and add one
`registerEngine(...)` line in `src/engines/registry.ts`.

## Tests

`pnpm --filter @bible/audio-build test` uses a fake engine (a sine of known length) and real ffmpeg: timings,
gaps, intro and verse 0, index rebuild, resume and `textHash`, atomic writes, manifest validation, the
selection parser and the licence gate. `src/parity/piperParity.test.ts` runs the browser's Piper handler
and the native Piper engine on the same verses with a recording fake ONNX Runtime and asserts the model
inputs are identical.

## Measured speed (6 cores, no GPU, one job)

Real-time factor is render time divided by audio length (below 1 is faster than real time). KJV John 3
(about 4 minutes): Kokoro q8 1.1-1.4 (am_michael 1.15, af_heart 1.10, bf_emma 1.38), Piper
`en_US-amy-low` 0.04. The whole KJV is about 80 hours of audio, so roughly 90 hours of Kokoro render
on one job (less with `--jobs`, which shares the six cores: about 0.7 GB per Kokoro job) or about
3 hours with Piper low.

Run one build per module at a time: `index.json` is rebuilt without a lock, so two runs finishing together could drop one narrator entry.
