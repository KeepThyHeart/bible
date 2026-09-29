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
| `@bible/ui` | `XrefHopper`, `XrefWebView` (d3-force), `XrefArcView` (canvas), section colours `--kth-section-0..9`. |
| web | `/api/xref-graph/*` routes, `XrefGraphProvider` (fetch), dialog opened from the verse context menu and the study pane. |
| desktop | `xrefGraph:*` IPC, `XrefGraphIpcProvider`, dialog opened from the verse context menu and the study pane. |

Data source in v1 is TSK (public domain) plus the user's own cross-references (desktop). OpenBible votes, a book ring, a constellation view and an extension read namespace are later.
