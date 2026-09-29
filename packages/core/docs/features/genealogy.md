# Genealogy explorer

Interactive family trees built from the tag graph: the line from Adam to Christ, an hourglass family view around any person, and the tribes of Israel. All logic is in core; the web and desktop apps only supply data and a pane around the shared `@bible/ui` components.

Ground rule for the data: the KJV text is taken as literally and exactly accurate. Genealogies follow what the text says, every link cites its verse, and where readings differ (Luke 3:23 "the son of Heli") the alternatives are stored side by side, never merged.

## Files

| File | Purpose |
|---|---|
| `sql/schemas/initial/TagGraph.sql` (0.2.0) | `person.sex`/`kind`; `person_relationship.qualifier`/`reading_group`/`reading`/`sort_order`/`source`; `lineage`, `lineage_step`, `person_external_id`, `interpretive_case`; shared `data_source`. |
| `sql/schemas/shared/data_source.sql` | Licence and attribution per source dataset (shared with the timeline module). |
| `src/Data/Repositories/TagGraphRepository.ts` | `getGenealogyDataset(moduleId)` (one bulk read) and `getLineage(id)`. Also the v2 table-name fix. |
| `src/Genealogy/types.ts` | DTOs (`GenealogyDatasetDto`, `GenealogyEdgeDto`, `LineageDto`, ...) and the layout output (`GraphLayout`). Node `(x, y)` is the node centre. |
| `src/Genealogy/GenealogyGraph.ts` | Indexes, derived siblings, reading filter, namesakes, search. |
| `src/Genealogy/queries.ts`, `kinship.ts` | `ancestors`, `descendants`, `pathBetween`, `lineToChrist`, `kinshipLabel`. |
| `src/Genealogy/layoutLineage.ts`, `layoutFamily.ts`, `layoutTribes.ts` | Pure, deterministic layouts. |
| `src/Genealogy/computeLayout.ts` | `computeGenealogyLayout(graph, state)`: the one state-to-layout mapping both apps use. |
| `src/Genealogy/PanZoom.ts`, `store.ts` | 2D viewport maths and the view-state store. |
| `packages/ui/src/components/Genealogy/` | `GenealogyExplorer`, `GenealogyView` (SVG), `PersonCard`, `PersonSearch`, `TribeLegend`, `LineageCompare`. |

Everything under `src/Genealogy/` is re-exported from `@bible/core/browser` and is platform-free.

## Data model in one paragraph

Canonical edges are `father_of`/`mother_of` (parent to child) and `husband_of`/`wife_of`; siblings, ancestors and descendants are derived. `qualifier` marks `legal`, `levirate`, `adoptive` or `ancestor` (skipped generations). Rows sharing a `reading_group` are alternative readings of one link; `GenealogyGraph.from(ds, { readings })` picks one and `readingsOf(group)` lists all. A `lineage` is a genealogy as the text gives it (ordered `lineage_step` rows with an optional `gap_before` list of skipped people). Same-named people are distinct persons with different ids, linked by `possibly_same_as` where identity is disputed.

## Data

The dataset is not in this repository. It is built from STEPBible TIPNR and BibleData (both CC BY 4.0) plus lineages transcribed from the KJV, by a builder that lives in the `bible-scripts` repository, and shipped as the `tag_graph` module. Until that module is installed the feature is dark: desktop returns `null` from `tagGraph:getGenealogyDataset` and the web flag `features.genealogy` (which requires `features.tagGraph`) is off by default.

## Consumers

- Desktop: `tagGraph:getGenealogyDataset` IPC, `genealogy` data provider, a dockview pane.
- Web: `GET /api/taggraph/genealogy` (cacheable JSON), `genealogy` provider, Study pane mode.
