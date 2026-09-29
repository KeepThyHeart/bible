# Genealogy Explorer (Family tree)

Family tree mode of the Study pane: the line from Adam to Christ, an hourglass view around any person and the tribes of Israel. The data model, queries and layouts are in core (see [Core genealogy](../../../../packages/core/docs/features/genealogy.md)); the shared components live in `@bible/ui`. The web app only supplies the dataset and a pane around them.

## Feature flag

`features.genealogy` in `site-config.json`, **off by default and only honoured together with `features.tagGraph`** (`SiteConfig.features.genealogy` is `tagGraph && genealogy`). The client reads it as `isGenealogyEnabled()` in `src/utils/clientConfig.ts`. With it off there is no mode tab, no mobile section, no "Show family tree" action and no request to `/api/taggraph/genealogy`.

## Key Files

| File | Purpose |
|---|---|
| `src/components/StudyPane/GenealogyPane.tsx` | Loads the dataset once, builds `GenealogyGraph` and a `createGenealogyStore()` store, renders `GenealogyExplorer` with `computeGenealogyLayout`. Owns the loading / empty / error (with Retry) states. `resolvePersonId()` maps a tag-graph person to a genealogy person: id, then `externalIds`, then name |
| `src/components/StudyPane/StudyPane.tsx` | Desktop Study pane. With the flag on it shows a Study / Family tree tab strip; Family tree replaces the sections with `GenealogyPane` |
| `src/components/MobileStudyPane/MobileStudyPane.tsx` | Phones: a "Family tree" section opens a full-screen sheet (same overlay classes as the Topics browser) holding `GenealogyPane` with `compact` |
| `src/components/StudyPane/TopicsBrowser.tsx` | A "Show family tree" button on a **people** entity's detail view, rendered only when `onShowFamilyTree` is passed |
| `src/components/StudyPane/TopicsPane.tsx` | Passes `onShowFamilyTree` (flag on): opens the family tree focused on the person and switches the right pane to Study |
| `src/stores/studyStore.ts` | `familyTreeOpen`, `familyTreeFocus` (`{ personId, name?, token }`), `openFamilyTree()`, `closeFamilyTree()`. Not persisted |
| `src/providers/ServerDataProvider.ts` | `GenealogyDataProvider`: `GET /api/taggraph/genealogy`, cached in memory for the session |
| `src/styles/_study-pane.scss`, `src/styles/_mobile-study.scss` | Mode tabs, pane layout, mobile sheet |
| `src/locales/*/ui.json` | Strings under `genealogyPane` (checked by `scripts/check-translations.js`) |

Tests: `GenealogyPane.test.tsx`, `StudyPane.test.tsx` (mode tabs), `TopicsBrowser.test.tsx` (action), `TopicsPane.test.tsx` (wiring), all in `src/components/StudyPane/`.

## Behaviour

1. **Open.** Desktop: Study tab, then Family tree. Phone: Study tab, then the Family tree section. Back (hardware) closes the sheet first.
2. **Focus.** `familyTreeFocus.token` changes on every request, so asking again for the same person re-centres a pane that is already mounted. `GenealogyPane` calls `focusPerson(store, id)` (Family view, card open). An unresolvable person leaves the view where it was.
3. **Verses.** The card's Read button and verse links call `bibleStore.navigateToPreview`, the path Topics uses. On a phone the sheet then closes and the app switches to the Bible view.
4. **Labels.** The explorer's top-level labels (tabs, toggles) are translated; the nested card, search and view labels use the `@bible/ui` English defaults for now.
