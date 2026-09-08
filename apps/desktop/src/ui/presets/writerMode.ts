import type { LayoutPreset } from '../types/LayoutPreset';

/**
 * A deliberately simple two-pane layout: Scripture beside a place to write.
 * Good for sermon prep or journaling where commentaries and dictionaries would
 * only be a distraction. Panes that aren't Bible/notes fall into the second
 * group so nothing is lost when the preset is applied.
 *
 * **The id is `bible-notes`, not `writer-mode`.** The id is what the
 * remembered-layout map and the dropdown's checkmark key off, so changing it
 * would silently orphan any arrangement a user had left in this preset. The
 * display name lives in the locale catalogs; only that is translated.
 *
 * **`autoOpen` is load-bearing here**, for the same reason it is in Study Mode
 * (Quad). A preset only rearranges panes that are already open, and a group
 * with nothing to hold is pruned entirely - so without it, on a session with
 * no notes pane (the default one, Bible + Study/Commentary), choosing "Writer
 * Mode" would move the study panes around and produce no writing surface at
 * all. Picking a preset by that name is a request for somewhere to write.
 */
export const WRITER_MODE: LayoutPreset = {
  id: 'bible-notes',
  name: { key: 'layout.writerMode.name' },
  description: { key: 'layout.writerMode.description' },
  autoOpen: ['notes'],
  activate: 'notes',
  groups: [
    { accepts: ['bible'], sizeWeight: 60 },
    { accepts: ['notes', 'prayer', 'study', 'commentary', 'book', 'dictionary', 'topics', 'search', 'unknown'], sizeWeight: 40 },
  ],
};
