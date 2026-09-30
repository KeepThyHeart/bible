# Text tools (`@bible/core/browser`)

Pure, DOM-free language text tools shared by keyword marks (0065), word study (0064), measures (0069),
similar passages (0070) and recite (0071). Import from `@bible/core/browser` (or `@bible/core`).

| Module | What | Main exports |
|---|---|---|
| `language.ts` | language tags | `primaryLanguage`, `canonicalLanguage` (`spa` -> `es`) |
| `tokenize.ts` | plain text -> words in the **word-index space** | `tokenizeVerseWords`, `tokenizePhrase` |
| `normalize.ts` | comparison forms | `normalizeToken` (light, keeps accents), `foldWord` / `foldLemma` (accent/case-insensitive, any script), `normalizeArchaic` (thou -> you, loveth -> loves) |
| `stemmers.ts` | per-language stemmers | `porterStem` (English + archaic `-eth`), `getStemmer`, `hasStemmer`, `registerStemmer`; light stemmers es/pt/fr/it/de/nl |
| `stopwords.ts` | function-word lists (en, es) | `getStopWords`, `isStopWord`, `registerStopWords` |
| `matcher.ts` | word/phrase/prefix/exact matching | `findPhraseMatches`, `compileTermMatcher`, `parseTermQuery`, `countForms` |

## Index space

Tokens are whitespace pieces, pure-punctuation pieces included, exactly like `extractWords()` /
`extractWordsWithFormatting()` in `Services/WordIndexing` (HTML input). Use `WordIndexing` for verse HTML,
`tokenizeVerseWords` for plain text; indices agree (tested). Match ranges (`start`/`end`) are in that space.

## Term matcher

```ts
const m = compileTermMatcher({ terms: ['love', 'lov*', '=world', '"God is"'], exclude: ['lovely'], language: 'en' });
m.matchText('For God so loved the world'); // [{ start: 3, end: 3, form: 'loved', term: 'love' }, ...]
```

Term syntax: `word` (stemmed when `stem !== false` and the language has a stemmer), `pre*` (prefix, never stemmed),
`=exact` (folded exact form only), `two words` (phrase). `exclude` forms never match. `archaic: true` folds
archaic English on both sides. No stemmer for the language means terms match as exact folded words; list variants
or use prefixes.

## Migrations

- Keyword marks (0065): `KeywordMarks/matcher.ts` now uses `normalizeToken`, `tokenizePhrase`, `findPhraseMatches`
  from here (same names still re-exported from `KeywordMarks`); suggestion stop words come from `stopwords.ts`.
- Word study (0064, `feature/word-study`): delete `WordStudy/stemmers.ts` and `wordText.ts` and import
  `porterStem/getStemmer/registerStemmer/foldWord/foldLemma/tokenizeVerseWords` from `../Text`; replace the matching
  body of `compileWordGroup` with `compileTermMatcher({ terms: group.terms, exclude: group.exclude, stem: group.stem, language })`
  (`matchText` returns the same `start/end/form/term`); `countForms` and the `-exclude` parsing (`parseTermQuery`)
  are here too. `WordGroup`, `normalizeWordGroup` and `groupFromQuery` stay in word study.
- Recite (0071): replace local stand-ins with `foldWord`, `normalizeArchaic`, `tokenizeVerseWords`.
