# Genealogy Explorer (desktop pane)

**Last verified:** 2026-09-29

The Family Tree pane (`contentType: 'genealogy'`) shows the shared genealogy explorer - line to Christ, a family view centred on one person, and the tribes - over the installed genealogy dataset. The graph, layout and components are shared with the web app; the desktop side is the pane, the IPC read and the registration of a new pane type.

## Shared code

- `packages/core/src/Genealogy/index.ts` - `GenealogyGraph`, `createGenealogyStore`, `focusPerson`, `computeGenealogyLayout` (pure, exported from `@bible/core/browser`)
- `packages/ui/src/components/Genealogy/GenealogyExplorer.tsx` - `<GenealogyExplorer>` (tabs, toggles, search, SVG view, person card); layout comes from the `computeLayout` prop

## Data

- `apps/desktop/electron/ipc/tagGraphHandlers.ts` - `tagGraph:getGenealogyDataset`
- `apps/desktop/src/api/dataProviderAdapter.ts` - `DesktopGenealogyDataProvider` (whole dataset in one IPC read, cached in memory; failures are not cached), exposed as `genealogy` on `createDesktopDataProviders()`

## Pane

- `apps/desktop/src/ui/components/GenealogyPane.tsx` - loads the dataset once, then builds a `GenealogyGraph` and an in-memory `GenealogyStore` (explorer state is not persisted across pane remounts). States: loading, empty (no dataset or no people: "no genealogy data installed"), error with a retry button. Verse links and the card's Read button call `navigateToVerseInPrimary`
- `apps/desktop/src/ui/components/GenealogyPane.test.tsx` - renders with a mocked provider and a small dataset
- Strings: `genealogyPane.*`, `paneName.genealogy`, `newTabPage.type.genealogy`, `entityDetailView.showFamilyTree` in `apps/desktop/locales/*/ui.json`. The card's inner labels use the shared component's English defaults

## Opening the pane on a person

- `apps/desktop/src/ui/utils/openFamilyTree.ts` - finds or creates the Genealogy pane, posts a focus request and activates it
- `apps/desktop/src/ui/stores/useGenealogyFocusStore.ts` - per-panel focus requests (person id plus a nonce); the pane applies one with `focusPerson` once the graph is ready, which switches to the Family view
- `apps/desktop/src/ui/components/TopicsPane/EntityDetailView.tsx` - "Show family tree" button for `people` entities (tag-graph person ids are the same slugs as genealogy person ids; an unknown id is ignored)

## Pane-type registration

- `apps/desktop/src/ui/stores/useLayoutStore.ts` - `PanelContentType` includes `'genealogy'`
- `apps/desktop/src/ui/components/PanelContentRenderer.tsx` - lazy component map
- `apps/desktop/src/ui/services/LayoutStateSanitizer.ts` - known built-in content types
- `apps/desktop/src/ui/utils/paneNames.ts` - localized pane name and the generic English titles
- `apps/desktop/src/ui/components/paneIcons.ts` - tab / chooser glyph
- `apps/desktop/src/ui/components/NewTabPage.tsx` - the "+" chooser tile and keywords (`genealogy`, `family`)

The pane has no pop-out window and is not part of the layout presets.
