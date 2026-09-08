import type { LayoutPreset } from '../types/LayoutPreset';

/**
 * Scripture and nothing else.
 *
 * The study side is *collapsed*, not merely shrunk. Giving it a small
 * `sizeWeight` left a 100px sliver - dockview's minimum group size - too narrow
 * to read and too wide to ignore. `collapsed` makes the applier lift that
 * minimum and take the group to zero width, keeping every tab inside it intact;
 * the header of the remaining pane carries a "Show hidden panes" control to
 * bring it back. This mirrors the web app, where Reading display mode collapses
 * the right pane behind a restore affordance.
 */
export const READING_MODE: LayoutPreset = {
  id: 'reading-mode',
  name: { key: 'layout.readingMode.name' },
  description: { key: 'layout.readingMode.description' },
  groups: [
    { accepts: ['bible'], sizeWeight: 100, margined: true },
    { accepts: ['*'], sizeWeight: 0, collapsed: 'right' },
  ],
};
