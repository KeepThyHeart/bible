import type { PanelContentType } from '../stores/useLayoutStore';

export type PresetAcceptValue = PanelContentType | 'unknown' | '*';

export interface PresetGroup {
  /**
   * Content types this group claims. A group listing only `unknown`/`*` is
   * treated as the catch-all for panes no specific group wanted.
   */
  accepts: PresetAcceptValue[];
  /** Relative share of the axis; ignored when `collapsed` is set. */
  sizeWeight: number;
  /**
   * Tab order inside this group, by content type.
   *
   * `accepts` says which panes land here; it says nothing about the order they
   * land in, which was whatever order they happened to be open in. A preset
   * that names an arrangement should be able to name the reading order too -
   * Study Mode's right-hand column is meant to run Study -> Commentary ->
   * Topics -> Dictionary -> Notes, and arriving at it in session order made the
   * same preset look different on every profile.
   *
   * Types listed here sort first, in this order. Anything not listed keeps its
   * relative order and follows. Applies when a preset is built fresh; a
   * *remembered* arrangement is left alone, because a tab order the user set
   * by hand while they were in that layout is theirs (see
   * `reconcileRememberedLayout`, and property 2 in `LayoutPresetService`).
   */
  order?: PanelContentType[];
  row?: number;
  col?: number;
  margined?: boolean;
  /**
   * Collapse this group to nothing rather than sizing it.
   *
   * The value names the edge it collapses against, which decides the axis:
   * `left`/`right` collapse the width, `top`/`bottom` the height. Its panels
   * are kept - the group is simply zero-sized until the user expands it again
   * (see `useLayoutStore.expandCollapsedGroups`).
   */
  collapsed?: 'left' | 'right' | 'top' | 'bottom';
}

export interface LayoutPreset {
  id: string;
  name: { key: string };
  description?: { key: string };
  groups: PresetGroup[];
  /**
   * Pane types to open - if nothing of that type is open already - before the
   * preset is applied.
   *
   * A narrow carve-out from "presets rearrange, they never create" (see the
   * Layout Presets rules in docs/features/sidebar-layout.md). The rule exists
   * because a preset that materialises a group with nothing in it produces a
   * pane whose only affordance is a "+"; it is not there to stop a *shape*
   * preset from being the shape it promises. Study Mode (Quad) is called Quad:
   * applying it on the default session, where only Bible and Study/Commentary
   * are open, silently degraded to two panes.
   *
   * Only presets that name a specific arrangement in their title should set
   * this, and only for the cells that arrangement requires. The panes are
   * opened through the same `useLayoutStore.addPanel` path as the "+" menu, so
   * they are ordinary panes the user can close again; if opening one fails the
   * preset degrades to whatever it does have (empty groups are still pruned).
   */
  autoOpen?: PanelContentType[];
  /**
   * Pane type to bring to the front of its group once the preset is applied.
   *
   * Opening a pane is not the same as showing it. `autoOpen` adds the panel,
   * but bucketing can file it into a group behind existing tabs - so Writer
   * Mode could open a notes pane the user never saw, sitting behind the
   * commentary tab it shares a group with, and the preset looked like it had
   * done nothing.
   *
   * Only meaningful for presets whose name promises a particular pane. If no
   * panel of this type exists after the layout is applied, nothing happens.
   */
  activate?: PanelContentType;
}
