# Audio pronunciation overlay

**Status:** implemented on `feature/kjv-phonemes` (core, browser Piper, native Piper, Kokoro, serving, install); data on bible-scripts `feature/pronunciation`. Neither is pushed, so the GitHub fallback of the installer does not work yet. Not yet heard by anyone: the splicing is verified on phonemes, not by ear.

On-device speech (Piper) and `tools/audio-build` (Kokoro, Piper) both get their phonemes from espeak-ng, which mispronounces names (Melchizedek as "mel-CHAI-zdek"), archaic forms ("hast" as "haste", "saith" as "sayth" instead of "seth"), and homographs whose sound depends on the sentence ("had read", "blessed are" vs "God blessed them", "the bow" vs "bow down"). The overlay fixes these with IPA, in **American English**, following the **common American Protestant reading-aloud tradition**.

## Data

The data is kept in the **bible-scripts** repository (`pronunciation/`, with its own `README.md`, `CONVENTIONS.md` and `scripts/pronunciation/check.js`), so this repository holds only the code that reads it and does not grow with every language and translation. Three layers, all IPA in espeak-ng style (same symbol set and stress placement espeak prints, so it maps through a Piper voice's `phoneme_id_map` and Kokoro's vocabulary unchanged):

```
en-us/lexicon.json   kth-pron-lexicon/2   word -> IPA, and the IPA of each meaning of a homograph   every module in the locale
en/KJV.json          kth-pron-senses/1    verse + word index -> meaning label                       every locale of the language
en-us/KJV.json       kth-pron-module/1    verse + word index -> IPA (optional, single occurrences)  one module in one locale
index.json           kth-pron-index/1     every file with its size and SHA-256
```

```json
// en-us/lexicon.json
{ "format": "kth-pron-lexicon/2", "locale": "en-us", "tradition": "...",
  "entries": { "hast": "hˈæst", "saith": "sˈɛθ", "Melchizedek": "mɛlkˈɪzᵻdɛk" },
  "senses": { "blessed": { "adjective": "blˈɛsᵻd", "verb": "blˈɛst" } } }
// en/KJV.json
{ "format": "kth-pron-senses/1", "module": "KJV", "language": "en",
  "verses": { "GEN.1.22": { "hash": "<FNV-1a 64 of the spoken text, 16 hex>", "words": { "2": ["blessed", "verb"] } } } }
```

- **Why the split:** which meaning a homograph has ("God blessed them" is the verb) is the same in every accent, while how a meaning sounds is not. An `en-gb` lexicon with its own `senses` reuses `en/KJV.json` unchanged; a new translation needs only its senses file.
- **Word index** is the index of the word among `\p{L}+('\p{L}+)*` tokens of the *spoken* text (`TextPreparer.verse()` output), so markup, footnotes and brackets do not shift it.
- **Capitalised lexicon keys** (`Job`) match only capitalised words, so a name never changes a common word spelt the same way; lower-case keys match any case.
- **Hash** (FNV-1a 64, synchronous in the browser) and the stored word tie an occurrence to the text it was decided for. If a module update changes the verse, its entries are ignored (and the build tool reports them) instead of landing on the wrong word.
- **Precedence:** locale override > the occurrence's meaning through the lexicon's `senses` > lexicon entry > espeak. A meaning the locale has no IPA for falls through.
- **Possessives** are derived: a word ending in `'s` with no entry of its own takes its base's entry plus `z`, `s` or `ᵻz` by the base's last sound.
- **Size:** the KJV en-us data is 2,126 words, 45 homographs, 1,781 occurrences in 1,652 verses: 206 KB raw, about 50 KB gzipped. It is fetched once with the voice (same cache, `tts-models-v1`), not bundled.

## Runtime changes

1. **Core, `packages/core/src/audio/pronunciation.ts` (new, pure):** parse and validate both formats; `applyPronunciation(text, ctx) -> string`, which replaces overridden words with an inline marker `⟦word|ipa⟧` (the original word is kept, so an engine without support strips the marker and speaks the word). Markers contain none of `. ! ? ; :`, so both sentence splitters (core `splitSentences`, `TtsChapterAudio.splitSentences`) keep working.
2. **Where it is applied:** a `PronouncingTextPreparer` decorator around `TextPreparer`, built with the overlay for the module, used by `TtsChapterAudio` (it already has `ref.moduleAbbr`, book and chapter) and by `tools/audio-build`'s `prepareChapterText`. The chapter's `textHash` then includes the markers, so a changed pronunciation re-renders exactly the affected recorded chapters. The displayed text never changes.
3. **Piper (`planPiperPhonemizer` / `phonemizePiper` in `piperPhonemes.ts`, shared by the browser worker and the native tool):** each marked sentence is phonemized whole with a stand-in word in place of each correction (`mango`, or `olive` before a vowel sound), so the neighbouring words keep espeak's context ("the" before a vowel, "of the" run together). The stand-in's phonemes are then swapped for the correction's IPA (matched without stress marks, at word boundaries). If a stand-in cannot be found, the sentence is cut at the markers instead, and failing that it is spoken without corrections. Unmarked sentences get exactly the arguments they had before. A correction with a symbol the voice's `phoneme_id_map` lacks is read as its word. Measured on 600 random content words of the KJV: 93% of splices give phonemes identical to espeak's own; the rest differ only in stress weight or a linking r.
4. **Kokoro (`tools/audio-build/src/engines/kokoro.ts`):** the plain runs are phonemized by kokoro-js itself (it does not export its phonemizer, so `kokoroPhonemes` runs `generate()` on a copy of the instance whose tokenizer records the phoneme string and stops before the model; a test pins this against the real package), the corrections' IPA goes between them, then `tokenizer` and `generate_from_ids`. British voices get the words.
5. **Engines opt in** with `TtsEngineCapabilities.pronunciation` (web) or `EngineDefinition.pronunciation` (audio-build); any other engine is sent plain text. The overlay is chosen by the voice's language (`en-US` voice, `en-us` files).
6. **Delivery:** `fetch:piper` installs the overlay into `<audio dir>/pronunciation/` from `--pronunciation-src=DIR|URL`, else a bible-scripts checkout next to this repository (`../bible-scripts/pronunciation`), else GitHub at the bible-scripts commit pinned in `PRONUNCIATION_REF` (env `PRONUNCIATION_REF` overrides). Every file is checked against the source's `index.json` (size, SHA-256, valid JSON) before anything is written, and files the index no longer lists are removed (`--pronunciation-only`, `--no-pronunciation`). The server serves that folder at `/audio/pronunciation/` with `Cache-Control: no-cache`; the browser (`PronunciationStore`) fetches the lexicon, the language senses and the locale overrides, keeps a copy in the models cache for offline use, and treats a 404 as "no layer". `audio-build` reads `<out>/pronunciation` (as installed), else the sibling bible-scripts checkout (`--pronunciation=DIR`, `--no-pronunciation`), and logs entries skipped because their verse changed.
7. **Updating the data:** change it in bible-scripts, run `check.js --write-index`, commit there, then move `PRONUNCIATION_REF` here to that commit. The pin keeps an app version and the data it was tested with together.

## Tests

- `packages/core/src/__tests__/audioPronunciation.test.ts`: parsing the three layers, hashing, capitalisation, possessives, compounds, occurrence matching and precedence, the placeholder and split plans and their fallbacks (fake phonemizer).
- `tools/audio-build/src/pronunciation.test.ts`: loading the layers from disk (small fixture overlay), splice parity with the real espeak build, the Kokoro probe against the real kokoro-js, and the chapter hash changing with a correction. With the real data available (`KTH_PRONUNCIATION_DIR`, or a bible-scripts checkout next to this repo) it also checks that nothing is dropped, only espeak symbols are used, every meaning is defined, and every KJV occurrence in the fixture module lands on its word; without it those checks are skipped.
- `apps/web/src/modules/audio/lib/tts/pronunciationStore.test.ts`, the overlay block in `TtsAudioProvider.test.ts`, the route test, and `scripts/fetch-piper-assets.test.ts` (index verification, pruning, source order; installs the real data when the sibling checkout exists).

## Data tooling

- `tools/audio-build/scripts/pronunciation-dump.mjs` dumps every distinct word (IPA from the shipped espeak build, counts, capitalisation, sample refs, whether espeak found it in its dictionary) and every verse's phonemes. Re-run it after an espeak or TextPreparer change to see what moved.
- bible-scripts `scripts/pronunciation/check.js` validates the files (format, locale, espeak symbols, stress placement, every meaning defined), keeps `index.json` current, and with `--verify-dump=verses.jsonl` checks every occurrence against the module text. Still to add: listing lexicon entries now equal to espeak's output (removable).

## Review method used for the KJV

Distinct words were reviewed once each (names, archaic forms, rare words) instead of reading the whole Bible as phonemes: espeak says a word the same way everywhere except for homographs. Homographs were judged occurrence by occurrence in their verse against a fixed table of senses (bible-scripts `pronunciation/CONVENTIONS.md`). Well-known names whose pronunciation is disputed went to the owner; obscure ones were decided by the reviewer.
