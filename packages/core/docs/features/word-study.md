# Word Study

`src/WordStudy/` (pure, in `@bible/core/browser`), `src/Services/WordStudyService.ts` and `src/Services/WordGroupStore.ts` (Node side). Both apps wrap them in their own UI. Read this before changing what a word study can study or how it counts.

## What a study is

A study answers "everything about this word" for one installed Bible module: every occurrence, a chart of the forms/renderings, a book distribution, the word family and a semantic-range summary. The subject is one of two kinds:

| Subject | Data used | Needs |
|---|---|---|
| `{ kind: 'strongs', strongs }` | `interlinear_word` rows (`gloss` = the translation's own rendering), plus the Strong's dictionaries | a Strong's-tagged module (kjv, asv, bsb, ...) |
| `{ kind: 'group', group }` | the module's verse `text`, matched in JavaScript | any Bible module, in any language |

Word studies are **not limited to Greek/Hebrew**. A `WordGroup` is a user-defined list of words treated as one subject (a custom synonym / variant list), so "love, loved, loveth, beloved" studies English forms of "love" in any translation.

## Files

| File | Purpose |
|---|---|
| `WordStudy/wordText.ts` | `tokenizeVerseWords` (whitespace index space, same as highlights/interlinear), `foldWord` (NFD, strips accents, Hebrew points; final sigma), `foldLemma` |
| `WordStudy/stemmers.ts` | `porterStem` (English, plus archaic `-eth`), light suffix stemmers for es/pt/fr/it/de/nl, `getStemmer(lang)`, `registerStemmer(lang, fn)` |
| `WordStudy/wordGroup.ts` | `WordGroup`, `compileWordGroup(group, language)` -> `matchText(text)`, `normalizeWordGroup`, `groupFromQuery`, `countForms` |
| `WordStudy/strongsDefinition.ts` | `parseStrongsDefinition` - the one parser for CrossWire Strong's definitions (header, sense, KJV list, from/see/compare) |
| `WordStudy/renderings.ts` | `normalizeRendering`, `groupRenderings` (head or phrase mode; head folds inflections through the stemmer), `glossMatchesRendering` |
| `WordStudy/types.ts` | DTOs (`WordStudyOverview`, `WordOccurrencePage`, ...), `IWordStudyProvider`, `ISemanticRangeSource` |
| `Services/WordStudyService.ts` | `resolve`, `getOverview`, `getOccurrences`; `StrongsSenseSource` |
| `Services/WordGroupStore.ts` | Saved groups in the core user-data store (owner `app:word-study`, collection `groups`) so they back up and sync like other user data |
| `Data/Repositories/BibleRepository.ts` | `countStrongs`, `countStrongsByBook`, `getStrongsGlossCounts`, `getStrongsMorphCounts`, `getStrongsHits` |

## Word group syntax

Each entry of `WordGroup.terms`:

- `love` - a word; with stemming on it also matches inflections (love, loved, loveth, loving)
- `lov*` - prefix wildcard, never stemmed
- `=loved` - exact form only (accent- and case-insensitive)
- `loving kindness` - a phrase of consecutive words
- `exclude` lists forms that must never match (`lovely`; the Porter stemmer conflates it with love)

Matching is accent-insensitive in every script (Greek, Hebrew points, Latin diacritics). Hyphenated words also match on their parts. Stemming applies only when the group asks for it (`stem !== false`) and a stemmer exists for the module's `languageCode`; otherwise use variants and wildcards. Add a language with `registerStemmer('xx', fn)`.

Occurrences carry 0-based inclusive word indices in the same whitespace-split index space the rest of the app uses, so the UI can highlight the matched words.

## How it is computed

- **Strong's studies:** aggregate SQL on `interlinear_word` (variants from `StrongsNumberHelper.toInterlinearVariants`, which covers Hebrew zero-padding). Renderings are grouped by head word (stoplist) and folded with the module language's stemmer. Family comes from `WordFamilyService`, one hop, each member with its count. The semantic range is built from Strong's sense text plus observed renderings and is labelled as such; further sources plug in through `ISemanticRangeSource`.
- **Group studies:** the service scans the module's `bible_verse.text` (about 31k rows) with the compiled matcher; the last 6 scans are cached by (module, terms). Forms are counted per matched surface form.
- `resolve(query)` maps "G25", "g0025", Greek script or a transliteration to Strong's candidates through a lazily built folded index of both dictionaries. Anything else is the caller's cue to make a group with `groupFromQuery`.

## Known limits

- Strong's studies need Strong's-tagged modules; other modules only support group studies.
- The light stemmers (non-English) are deliberately conservative and approximate; English uses the Porter algorithm.
- No lemma-aware matching for inflected languages without a stemmer (Greek, Hebrew): list the forms as variants, or use `Strong's` on a tagged module.
- The Strong's dictionaries carry no Hebrew script headwords, so Hebrew lookup by lemma works by transliteration only.
- The semantic range is a usage summary, not a lexicon; licensed lexicon/domain data would come later as an `ISemanticRangeSource` (see task 0064's design).
