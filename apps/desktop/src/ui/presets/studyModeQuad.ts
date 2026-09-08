import type { LayoutPreset } from '../types/LayoutPreset';

/**
 * A true 2x2 workbench: Scripture and its commentary across the top, reference
 * and writing tools across the bottom.
 *
 * Two things here are load-bearing:
 *
 * **Bible is row 1, col 1.** Every other preset (Study Mode, Reading Mode,
 * Bible + Notes) puts Scripture on the left; listing the study/commentary
 * cell first here would slide the Bible pane to the other side of the
 * window on switching to it, which reads as the layout being broken rather
 * than as a deliberate arrangement.
 *
 * **`autoOpen`.** A preset normally only rearranges panes that are already
 * open, and cells with nothing to hold are dropped. On the default session
 * (Bible + Study/Commentary) that pruned both bottom cells and the whole second
 * row, leaving a two-pane layout wearing the name "Quad". Choosing this preset
 * by name is a request for the four-cell shape, so the two panes the bottom row
 * needs are opened as part of applying it. If one cannot be opened the pruning
 * still applies and the layout degrades quietly - without moving Bible.
 */
export const STUDY_MODE_QUAD: LayoutPreset = {
  id: 'study-mode-quad',
  name: { key: 'layout.studyModeQuad.name' },
  description: { key: 'layout.studyModeQuad.description' },
  autoOpen: ['dictionary', 'notes'],
  groups: [
    { row: 1, col: 1, accepts: ['bible'], sizeWeight: 50 },
    { row: 1, col: 2, accepts: ['commentary', 'book', 'study', 'topics', 'unknown'], sizeWeight: 50 },
    { row: 2, col: 1, accepts: ['dictionary'], sizeWeight: 50 },
    { row: 2, col: 2, accepts: ['notes', 'prayer', 'search'], sizeWeight: 50 },
  ],
};
