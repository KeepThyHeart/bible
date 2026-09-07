# API Contracts

`src/Api/` declares the operation surface a *first-party* client needs - every read and write an Electron IPC layer, an Express REST layer, or a CLI would expose - as plain TypeScript interfaces with no implementation. Read this before adding a new IPC channel or REST route, so the new operation lands in the same shape on every platform.

## Status

There are no first-party clients in this repository yet - `apps/` is empty, and `packages/core` is the only workspace with source in it. So nothing implements these interfaces today, and there is nothing for them to describe inaccurately.

When the first adapter is written, it should declare `implements IBibleApi` (or the relevant sibling) so the compiler holds it to the contract. Doing that on a new adapter costs nothing; retrofitting it onto one that already ships is what turns it into a project, so the cheap moment is the first one.

## Files

| File | Purpose |
|---|---|
| `src/Api/index.ts` | Barrel over all seven files. |
| `src/Api/ApiTypes.ts` | Every request/response shape: `PassageRange`, `BibleModuleSummary`, `FormattedVerse`, `Footnote`, `ChapterResult`, `SearchOptions`, `VerseSearchResult`, `InterlinearWord`, `BookInfo`, the commentary/dictionary/user-data/session/search result types, and the book/topical/cross-reference summaries. |
| `src/Api/IBibleApi.ts` | Module discovery, book reference data, verse/passage/chapter retrieval, per-module search, interlinear, plus two batch conveniences (`getInitialData`, `getVerseTexts`). |
| `src/Api/ICommentaryApi.ts` | Commentary module discovery, entry retrieval, `hasContentForVerse`, next/previous verse with content, search, and `batchRestoreSession`. |
| `src/Api/IDictionaryApi.ts` | Dictionary discovery, entry lookup by id or key, search, and Strong's occurrence queries. |
| `src/Api/IUserDataApi.ts` | User cross-references, highlights, notes, and collections/bookmarks. |
| `src/Api/ISessionApi.ts` | Session CRUD plus defaults and the autosave session. |
| `src/Api/ISearchApi.ts` | Text search, index management, saved searches, history, and semantic search. |

## How it works

There is nothing to trace: these files contain only `export interface`. They compile to nothing and impose no runtime cost. Their job is to be the one written-down answer to "what can a client ask for, and in what shape does the answer come back", so that clients on different platforms do not drift into two different vocabularies.

The contract is written for a transport boundary (IPC, HTTP) rather than for in-process calls. Two consequences show up throughout: every method returns a `Promise`, including ones the underlying repositories answer synchronously, and there are batch conveniences - `getInitialData`, `getVerseTexts`, `batchRestoreSession` - that exist to spare a client a round-trip per item.

Root exports are deliberately narrow. `src/index.ts` re-exports only the six interfaces, as types:

```ts
export type { IBibleApi } from './Api/IBibleApi';
export type { ICommentaryApi } from './Api/ICommentaryApi';
// ... IDictionaryApi, IUserDataApi, ISessionApi, ISearchApi
```

`ApiTypes.ts` is **not** star-exported from the root, because `SearchOptions` and `SearchResult` there collide with the same names in `src/types/search.ts` (which the root does export). Import them by path instead:

```ts
import type { FormattedVerse, ChapterResult } from '@bible/core/Api/ApiTypes';
```

## Relationship to the Extensions API

`src/Extensions/` is a **different contract for a different audience**, and it reuses several of the same interface names. The confusion is real enough that `src/index.ts` exports it under a namespace alias specifically to avoid a collision:

```ts
export * as Extensions from './Extensions';   // Extensions.IBibleApi, Extensions.BibleVerseDto, ...
export { EXTENSION_API_VERSION } from './Extensions/ExtensionApiTypes';
```

| | `src/Api/` | `src/Extensions/` |
|---|---|---|
| Audience | The app's own shell (IPC, REST, CLI) | Third-party extension authors |
| Stability | Internal; change it with the clients | Versioned (`EXTENSION_API_VERSION`, currently `1.0.0`) with a compatibility promise |
| Transport | Whatever the platform uses | RPC envelopes (`RpcEnvelope.ts`) through `ExtensionRpcRouter`, behind a permission guard |
| Entry point | Client implements the interface | Host injects `BibleExtensionAPI` into the worker's `activate(api)` |
| Types | `FormattedVerse`, `ChapterResult`, ... | `BibleVerseDto`, `BibleModuleInfoDto`, ... (`ExtensionApiDtos.ts`) |

The overlapping names are genuinely different interfaces. `Api/IBibleApi.getVerse(abbreviation, verseId)` returns a `FormattedVerse | null`; `Extensions.IBibleApi.getVerse(verseId, {module})` returns a `BibleVerseDto`, is capped at 500 verses per `getRange`, carries `iterateVerses` / `registerProvider` / event emitters, and is gated on the `bible:read` permission. See [Extensions & plugins](extensions-plugins.md).

Like `src/Api/`, the Extensions contract has no host-side implementation in this repository; it is implemented by whichever app embeds the extension host.

## Gotchas

- **Nothing enforces these interfaces yet.** They are a design reference until a client declares `implements`. Changing one breaks no build today.
- **`SearchOptions` and `SearchResult` are declared twice in the package.** `src/Api/ApiTypes.ts` has `SearchOptions {limit, offset, additionalModules}` and `SearchResult {query, module, results, totalCount}`; `src/types/search.ts` has entirely different ones (the latter re-exported from the `SavedSearch` model). Only the `src/types/search.ts` pair reaches the root barrel. Always import the `Api` versions by path. Worth renaming while nothing imports either one.
- **The `Extensions` namespace alias is load-bearing.** `Extensions.IBibleApi`, `Extensions.ICommentaryApi`, and `Extensions.IDictionaryApi` share names with the `Api/` interfaces; a star export of `./Extensions` from the root would be a compile error. Same reasoning applies to `export * as Usfm from './Export'`.
- **`ISearchApi` documents future work in a comment**: search methods are meant to grow an optional `PassageRange[]` filter. Keyword search can push that into SQL; semantic search would need post-retrieval filtering.

## See also

- [Extensions & plugins](extensions-plugins.md) - the versioned third-party contract.
- [Controllers](controllers.md) - the stateful layer a client usually sits on top of.
- [Data layer](data-layer.md) - where the models these DTOs flatten actually live.
