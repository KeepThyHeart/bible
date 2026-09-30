# Keyword marks

`src/KeywordMarks/` colours every occurrence of a word, phrase, Strong's number or connective ("therefore", "for", "but") in the chapter being read, so repetition and the flow of an argument show at a glance. It is pure TypeScript in the `@bible/core/browser` barrel; the desktop and web apps wrap it in their own UIs.

## Files

| File | Purpose |
|---|---|
| `types.ts` | `KeywordSet`, `KeywordMark`, `MatchRule` (`word`, `phrase`, `strongs`, `connective`), `MarkStyle`, the eight colour slots `mark.1` to `mark.8`, the closed symbol list, `ChapterInput`, `MatchResult`. |
| `matcher.ts` | `matchKeywordMarks(chapter, sets)`: hits per verse and counts per mark; `occurrencesOf` for stepping through a mark. |
| `connectives.ts` | The connective lexicon (English, Spanish): surface forms per category plus the Greek and Hebrew Strong's numbers that anchor them. |
| `builtins.ts` | Read-only built-in sets ("Connectives" per language). Never stored. |
| `layer.ts` | `toDecorationLayer`: result to a `LayerDecorations` with `tokens` targets, ready for `resolveVerseDecorations`. |
| `suggest.ts` | `suggestKeywords`: frequent content words, grouped by Strong's when interlinear rows exist. |
| `validate.ts` | `validateKeywordSet` for untrusted JSON; `exportKeywordSet` / `importKeywordSet`. |
| `service.ts` | `KeywordSetService` (built-ins plus a store, change events), `IKeywordSetStore`, `MemoryKeywordSetStore`, `StorageKeywordSetStore` (localStorage-shaped). |
| `UserDataKeywordSetStore.ts` | Store over `IUserDataRepository` (browser-safe, in both barrels): desktop passes SQLite, web the in-memory user-data store. |

## How it works

Marks are rules, matched fresh at render time against the chapter and translation on screen; no positions are stored and nothing is written to `user_text_markup`. Words are compared NFC-normalised and case-folded on `WordInfo.text`; a phrase matches consecutive tokens inside one verse. Strong's rules paint the English span of each interlinear row that carries the number.

A connective category matches surface forms. With interlinear rows the hit only counts when it overlaps a row carrying an anchor number, which removes "for" the preposition. Without rows the hit is kept and flagged `loose` (drawn dotted, "approximate"). `MatchResult.needsInterlinear` and `wantsInterlinear` tell the app to fetch rows.

`toDecorationLayer` emits underline, optional tint, emphasis and a symbol badge per mark, with `order: 50` and layer key `core::keywords`. The layer joins the extension and highlight layers passed to the existing `resolveVerseDecorations`, so it composes with them for free. Colours are theme keys resolving to `--theme-mark-N-rgb`.

## Persistence

One `user_data_item` per set: owner `app:keyword-marks`, collection `sets`, key = set id, JSON value. Backup treats it as content (newest wins). Which sets are switched on per Bible tab is app session state, not part of the set. Web uses the same `UserDataKeywordSetStore` over `getUserData()` (`apps/web/src/keywordMarks/userDataSetStore.ts`); the old `kth.keywordSets` localStorage array is migrated in once with `migrateLocalStorage`, and other tabs' changes reload the sets. `StorageKeywordSetStore` remains for hosts with only a key-value store.

The colour-safe option is a registry setting, `keywordColorSafe` (device scope, default on): web Settings > Theme and the desktop Keywords popover both read and write it.

## Not in v1

The "Key people and themes" set, book-wide counts, saving marks as highlights, an extension read API, morphology (imperative) rules and Chinese word matching (whitespace tokenising).
