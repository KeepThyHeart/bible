# Bible test fixture

A small committed subset of the real Bible data, used when a run is not given a data directory:

- desktop e2e (`apps/desktop/e2e`) and web e2e (`apps/web/e2e`): used unless `BIBLE_E2E_DATA_DIR` is set
- ui-driver desktop (`drive start desktop`): used unless `BIBLE_DESKTOP_DATA_DIR` is set

Contents (about 8 MB; the generator refuses 10 MB or more):

| Path | What |
|---|---|
| `main.db` | reference tables plus `module_metadata` for the 5 modules; user tables empty |
| `modules/bible_kjv.db`, `bible_asv.db` | verses and interlinear words for the chapters below |
| `modules/commentary_wesley.db` | every entry overlapping those chapters (OT and NT) |
| `modules/commentary_barnes.db` | the NT entries overlapping those chapters (~0.5 MB) |
| `modules/dictionary_amtract.db` | whole dictionary |
| `notes/Sample note.bn` | study note on John 3:16, seeded into `<userData>/BibleReader/` |
| `manifest.json` | per-file sha256, source and subset `content_sha256`, chapter list |
| `LICENSES.md` | per-module licence (see it: KJV is GPL-2.0-or-later, the rest public domain) |

Chapters (book:chapter): Gen 1, 3; Ex 1; Lev 1; Ps 23; Prov 19; Mt 10, 15, 18; Mk 2; Lk 15;
John 1-4; Rom 1, 8; Rev 1. The list is `FIXTURE_CHAPTERS` in the generator.

## Never use in place

The app writes `main.db` and builds a keyword index at startup. Always copy first
(`copyFixture(dest)` in `copy.mjs`; `seedNotes(userData)` for the sample note).
The keyword index is not committed: the app builds it per run (about a second).
Specs that need other modules call `fixtureHas('Clarke')` and skip when the fixture is in use.

## Rebuild

Needs the real data dir (read-only; default `<repo>/data`, then `apps/desktop/data`) and a built core:

```
pnpm run build:core
pnpm run fixtures:bible                       # or: node scripts/fixtures/build-bible-fixture.mjs --source <dataDir>
node scripts/fixtures/build-bible-fixture.mjs --source <dataDir> --check   # is the committed fixture current?
```

The generator snapshots each source with `VACUUM INTO`, deletes rows outside the chapter set,
drops the empty fts5 `book_search_index` (rejected by `validate-module.js`), recomputes
`content_sha256` with `@bible/core`, leaves journal mode `DELETE`, validates every module
with `apps/desktop/scripts/validate-module.js` and writes `manifest.json`.
Regenerate only on purpose: the `.db` files are binary in git.
