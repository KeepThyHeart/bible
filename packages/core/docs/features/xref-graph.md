# Cross-reference graph

A network and arc view of how a verse, chapter or book connects across Scripture. The logic and data live in core; both apps wrap the same three views from `@bible/ui`. Reach for this when you change how links are weighted, how ego graphs are budgeted, or what the whole-canon index holds.

## Files

| File | Purpose |
|---|---|
| `src/Services/XrefGraph/types.ts` | `XrefGraph`, `XrefNode`, `XrefEdge`, `EgoOptions`, `ChapterArcs`, `BookMatrix`, `VerseDegrees`, `XrefGraphIndex`, and the `IXrefGraphProvider` seam the views talk to. Browser-safe. |
| `src/Services/XrefGraph/canon.ts` | Verse id to chapter index (0..1188), `canonPosition` (0..1), section index per book. Browser-safe. |
| `src/Services/XrefGraph/edgeWeight.ts` | `edgeWeight()`: one 0..1 weight per link (rank decay, votes, user links, reciprocity and agreement boosts). Browser-safe. |
| `src/Services/XrefGraph/chapterPairs.ts` | Packed chapter-pair `Uint32Array` (`[a, b, weightx1000, count]`), little-endian byte encoding, weight filter. Browser-safe. |
| `src/Services/XrefGraph/egoGraph.ts` | `buildEgoGraph()`: budgeted breadth-first walk over any neighbour function. Browser-safe. |
| `src/Services/XrefGraph/XrefGraphService.ts` | Node-side: neighbours and ego graphs from the installed cross-reference modules plus the user's own links. |
| `src/Services/XrefGraph/XrefGraphIndexBuilder.ts` | Node-side: one pass over every link into chapter pairs, the 66x66 book matrix and per-verse degrees, fingerprinted. |
| `ICrossReferenceRepository.forEachLink / getLinkCount` | The link stream the builder reads (windows of groups, never the whole module in memory). |

## Weighting

`weight = clamp01(sum trust[s] * base_s) * reciprocity * agreement`. TSK links rank by position in their phrase group (`1 / (1 + 0.15 * rank)`); a reverse-only link has no known rank and counts as rank 2. Range targets are represented by their first verse, with `toEnd` / `endVerseId` keeping the range. Views show weight as 1..5 steps (`weightStep`).

## Ego graph budget

A popular verse has 50-150 TSK links, so depth 3 reaches thousands of verses. `buildEgoGraph` goes hop by hop, takes the strongest candidates first, and lets each inner hop use at most 60% of what is left. Default depth 2, 60 nodes; the ceiling is depth 3 and 200 nodes. `truncated` reports that links were left out.

## Whole-canon index

Built once per set of installed modules (fingerprint = module abbreviations, versions and link counts). The web server builds it lazily on first request and keeps it in memory; the desktop main process does the same. Verse-level whole-Bible arcs are not offered; arcs are chapter level and the ring (later) is book level.

## Where things run

| Where | What |
|---|---|
| core (`@bible/core`) | Service, index builder, repository stream. |
| core browser (`@bible/core/browser`) | Types, weight, canon, packing, ego walk. |
| `@bible/ui` | `XrefHopper`, `XrefWebView` (d3-force, zoom and pan), `XrefCompassView` (SVG, pure layout in `compass.ts`), `XrefArcView` (canvas), shared hop/strength controls (`controls.tsx`), `useXrefFullscreen`, section colours `--kth-section-0..9`. |
| web | `/api/xref-graph/*` routes, `XrefGraphProvider` (fetch), dialog opened from the verse context menu and the study pane. |
| desktop | `xrefGraph:*` IPC, `XrefGraphIpcProvider`, dialog opened from the verse context menu, the study pane and the command palette (`xrefGraph.open`, for the selected verse). |

Data source in v1 is TSK (public domain) plus the user's own cross-references (desktop). OpenBible votes, a book ring and an extension read namespace are later.

Escape: in the arc and web views the first press clears a selection; when nothing is selected the key is left alone, so the surrounding dialog closes on the next press.


## Hops and minimum strength

The 1/2/3 buttons are the hop count (`EgoOptions.depth`): 1 = the verses the centre verse cites directly, 2 adds the verses those cite, 3 goes one step further. The strength slider (1 to 5) sets `EgoOptions.minWeight` through `minWeightForStep()`: links whose display step (`weightStep`) is below the chosen value are dropped, and verses reachable only through them vanish. Today the weight comes from TSK rank position (closest parallels first), with a boost when the link runs both ways or two sources agree; there are no vote counts yet (OpenBible votes would enter through `baseWeight`). In the canon arcs the same slider is a floor on the summed weight of all links between two chapters.

## Compass, zoom and full screen

The compass puts each star at the angle of its `canonPosition` (Genesis at the top, clockwise); hop rings are radial, stars sharing an angle are staggered along the radius, and a wide stage stretches the circle into an ellipse. The verse web's camera focuses on the anchor by default (zoomed in, never below 1), pans by dragging the background, zooms by wheel, pinch, buttons or `+`/`-`, and "Fit all" zooms out to everything. Full screen: `useXrefFullscreen(ref)` (in `@bible/ui`) gives `{ full, toggle }`; each app stretches its dialog when `full` is set and the element also requests the browser's Fullscreen API.
