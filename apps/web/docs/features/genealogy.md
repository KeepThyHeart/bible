# Genealogy Explorer (Family tree)

Family tree mode of the Study pane: the line from Adam to Christ, an hourglass view around any person and the tribes of Israel. The data model, queries and layouts are in core (see [Core genealogy](../../../../packages/core/docs/features/genealogy.md)); the shared components live in `@bible/ui`. The web app only supplies the dataset and a pane around them.

## Feature flag

`features.genealogy` in `site-config.json` (the `genealogy` feature flag), **off by default and only honoured together with `features.tagGraph`** (the flag declares `requires: ['tagGraph']`). The client reads it as `isEnabled('genealogy')` from `src/utils/featureFlags.ts` (wrapped as `isGenealogyEnabled()`); the server as `SiteConfig.isEnabled('genealogy')`. With it off there is no mode tab, no mobile section, no "Show family tree" action and no request to `/api/taggraph/genealogy`.

## Key Files

| File | Purpose |
|---|---|
| `src/modules/genealogy/manifest.ts`, `binding.ts` | The feature module (id `genealogy`, flag `genealogy`, namespace `genealogy`). Data only plus a lazy loader and a boot probe that activates it after first paint. Switching it off (flag, `kth.modules = '-genealogy'` in a dev build, or the server reporting it off) removes everything below |
| `src/modules/genealogy/module.tsx` | Activation: registers the Study mode (`studyModes` slot), the phone section and sheet (`mobileStudySections`) and the "Show family tree" action (`topicEntityActions`) in `src/host/slots.tsx`, all through `ctx.subscriptions` |
| `src/modules/genealogy/GenealogyPane.tsx`, `FamilyTreeView.tsx` | Loads the dataset once, builds `GenealogyGraph` and a `createGenealogyStore()` store, renders `GenealogyExplorer` with `computeGenealogyLayout`. Owns the loading / empty / error (with Retry) states. `resolvePersonId()` maps a tag-graph person to a genealogy person: id, then `externalIds`, then name. Loaded lazily, when the tab or sheet first opens |
| `src/components/StudyPane/StudyPane.tsx` | Desktop Study pane. While a module contributes a Study mode it shows a Study / mode tab strip; the open mode's lazy view replaces the sections |
| `src/components/MobileStudyPane/MobileStudyPane.tsx` | Phones: renders the sections and sheets modules put in `mobileStudySections` (the Family tree section opens a full-screen sheet with the same overlay classes as the Topics browser) |
| `src/components/StudyPane/TopicsBrowser.tsx` | Renders the `topicEntityActions` matching an entity's category: the "Show family tree" button on a **people** entity |
| `src/stores/studyStore.ts` | The generic `studyMode`, `studyModeFocus` (the module's payload, here `{ personId, name?, token }`), `openStudyMode()`, `closeStudyMode()`. Not persisted |
| `src/modules/genealogy/genealogyProvider.ts` | The shared `GenealogyDataProvider` (`ServerDataProvider.ts`): `GET /api/taggraph/genealogy`, cached in memory for the session. The route stays with the tag graph (`server/routes/tagGraphRoutes.ts`) |
| `src/modules/genealogy/genealogy.scss` | Pane layout, the Topics action, the mobile sheet. The Study mode tab strip (`.study-pane__modes`) is generic and stays in `src/styles/_study-pane.scss` |
| `src/locales/*/genealogy.json` | Strings under `genealogyPane`, loaded with the module (checked by `scripts/check-translations.js`). `studyPane.study` (the first tab) stays in `ui.json` |

Tests: `src/modules/genealogy/GenealogyPane.test.tsx`, `src/modules/timelineGenealogyModules.test.ts` (contributions, off switch, slots, the action), `StudyPane.test.tsx` (mode tabs), `TopicsBrowser.test.tsx` (action slot).

## Behaviour

1. **Open.** Desktop: Study tab, then Family tree. Phone: Study tab, then the Family tree section. Back (hardware) closes the sheet first.
2. **Focus.** `studyModeFocus.token` changes on every request, so asking again for the same person re-centres a pane that is already mounted. `GenealogyPane` calls `focusPerson(store, id)` (Family view, card open). An unresolvable person leaves the view where it was.
3. **Verses.** The card's Read button and verse links call `bibleStore.navigateToPreview`, the path Topics uses. On a phone the sheet then closes and the app switches to the Bible view.
4. **Labels.** The explorer's top-level labels (tabs, toggles) are translated; the nested card, search and view labels use the `@bible/ui` English defaults for now.
