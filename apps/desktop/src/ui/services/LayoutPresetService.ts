import type { DockviewApi, SerializedDockview } from 'dockview-react';
import type { ApplyPresetOptions, ILayoutPresetService } from './ILayoutPresetService';
import type { LayoutPreset } from '../types/LayoutPreset';
import { BUILT_IN_PRESETS } from '../presets';
import {
  applyPresetLayout,
  buildPresetLayout,
  collectTabsFromLayout,
  reconcileRememberedLayout,
  zeroSizedGroupIds,
  type CollapsedGroup,
} from './PresetApplier';
import { useLayoutStore, type PanelContentType } from '../stores/useLayoutStore';
import { genericEnglishTitle } from '../utils/paneNames';
import { useBibleStore, encodeBibleContentKey } from '../stores/useBibleStore';

/**
 * Applies the built-in layout presets.
 *
 * Two properties drive the design:
 *
 * 1. **Rearrange, don't recreate.** Applying a preset moves the panes that are
 *    already open; it never disposes and re-creates them. Pane state lives in
 *    per-panel store slices that are torn down on unmount, so re-creating a
 *    pane loses whatever the user had in it. The one carve-out is a preset's
 *    `autoOpen` list, which opens panes the session is *missing* (never touching
 *    the ones it has) so a preset named after a shape can deliver that shape -
 *    see `openDeclaredPanes` and `LayoutPreset.autoOpen`.
 * 2. **Round-trippable.** The arrangement in force when a preset is left is
 *    remembered against that preset id, so returning to it restores what the
 *    user had - including any manual tweaks they made while they were in it -
 *    rather than re-deriving a generic arrangement.
 *
 * Re-applying the preset that is already current deliberately skips the
 * remembered arrangement: that is the "reset this layout" gesture.
 */
/**
 * B-027: applying a preset rebuilds the grid with `fromJSON`, which unmounts
 * every Bible pane; on remount a pane re-seeds from its dockview `contentKey`,
 * which still names the passage it was *created* with. Re-encode each Bible
 * panel's live passage into that key first, so the pane comes back where the
 * reader was (chapter and selected verse), not at its original seed.
 */
export function freshenBibleSeeds(snapshot: SerializedDockview): void {
  const panels = (snapshot as unknown as { panels?: Record<string, { params?: Record<string, unknown> }> }).panels;
  if (!panels) return;
  const live = useBibleStore.getState().panels; // allow-getstate: service - imperative store access outside render
  for (const [id, entry] of Object.entries(panels)) {
    if (entry.params?.contentType !== 'bible') continue;
    const ps = live.get(id);
    const tab = ps?.openTabs[ps.activeTabIndex] ?? ps?.openTabs[0];
    if (!ps || !tab || !ps.currentBook || !ps.currentChapter) continue;
    entry.params = {
      ...entry.params,
      contentKey: encodeBibleContentKey({
        abbreviation: tab.abbreviation,
        book: ps.currentBook,
        chapter: ps.currentChapter,
        selectedVerseId: ps.selectedVerseId,
        displayMode: tab.displayMode,
      }),
    };
  }
}

/**
 * B-027: dockview moves each pane's DOM when the grid is rebuilt, and moving a
 * scrolled element resets its scrollTop to 0 - the pane keeps its selected verse
 * but is scrolled to the top. The Bible pane's scroll effect only reruns when
 * its scroll trigger changes, so bump it for every pane that has a selected
 * verse; the effect then centers the verse once the pane has been laid out.
 */
export function recenterBiblePanes(): void {
  const store = useBibleStore.getState(); // allow-getstate: service - imperative store access outside render
  const next = new Map(store.panels);
  let changed = false;
  for (const [id, ps] of next) {
    if (!ps.selectedVerseId || ps.openTabs.length === 0) continue;
    next.set(id, { ...ps, scrollMode: 'center', scrollTrigger: ps.scrollTrigger + 1 });
    changed = true;
  }
  if (changed) useBibleStore.setState({ panels: next });
}

/** Let dockview finish moving panes, then re-center. */
function recenterBiblePanesSoon(): void {
  if (typeof requestAnimationFrame !== 'function') return;
  requestAnimationFrame(() => requestAnimationFrame(() => recenterBiblePanes()));
}

export class LayoutPresetService implements ILayoutPresetService {
  private _currentPresetId: string | null = null;
  private _undoSnapshot: SerializedDockview | null = null;
  private readonly _rememberedLayouts = new Map<string, SerializedDockview>();

  /**
   * Re-entrancy guard around `apply()`/`undo()`'s own calls into dockview
   * (`api.fromJSON`, which `applyPresetLayout` wraps).
   *
   * `api.fromJSON` fires `onDidLayoutChange` - the same event that fires for
   * manual drag/split/resize - so DockviewLayout's subscription calls
   * `notifyManualLayoutChange()` on *every* layout change, preset-triggered or
   * not. Without this flag, applying a preset would immediately clear the
   * checkmark it just set.
   *
   * dockview's `onDidLayoutChange` is itself buffered via `queueMicrotask`
   * (see dockview-core's `AsapEvent`) rather than firing synchronously inside
   * `fromJSON`, so resetting this flag synchronously right after `fromJSON`
   * returns is too early - the buffered event fires in a *later* microtask,
   * by which point the flag would already be back to `false`. The reset is
   * therefore itself deferred with `queueMicrotask`, which - because it's
   * queued after `fromJSON` has already queued dockview's own microtask -
   * runs strictly after dockview's buffered dispatch, keeping the guard up
   * for exactly as long as it needs to be.
   */
  private _applyingPreset = false;

  get currentPresetId(): string | null {
    return this._currentPresetId;
  }

  list(): LayoutPreset[] {
    return [...BUILT_IN_PRESETS];
  }

  async apply(presetId: string, options?: ApplyPresetOptions): Promise<void> {
    const preset = BUILT_IN_PRESETS.find(p => p.id === presetId);
    if (!preset) throw new Error(`Unknown preset: ${presetId}`);

    const api = useLayoutStore.getState().dockviewApi; // allow-getstate: service - imperative dockview access outside render
    if (!api) throw new Error('Dockview API not ready');

    let snapshot = api.toJSON();

    // Nothing open: a preset has no panes to arrange, and handing dockview an
    // empty grid would only trade the watermark for a broken layout. Checked
    // before auto-open, so an empty workbench stays empty rather than being
    // populated by a preset the user picked to *arrange* things.
    if (collectTabsFromLayout(snapshot).length === 0) {
      this._currentPresetId = presetId;
      return;
    }

    // Open the panes this preset's shape needs but the session doesn't have.
    // Only presets that declare `autoOpen` are affected (today just Study Mode
    // Quad) - every other preset still purely rearranges. The new panes have to
    // be in the snapshot to be bucketed, hence the re-read.
    if (this.openDeclaredPanes(api, preset.autoOpen) > 0) {
      snapshot = api.toJSON();
    }

    freshenBibleSeeds(snapshot);
    this.rememberCurrent(snapshot);

    const reuseRemembered = !options?.forceRebuild && presetId !== this._currentPresetId;
    const remembered = reuseRemembered ? this._rememberedLayouts.get(presetId) : undefined;

    const result = remembered
      ? reconcileRememberedLayout(preset, remembered, snapshot)
      : buildPresetLayout(preset, snapshot);

    this._applyingPreset = true;
    try {
      applyPresetLayout(api, result);
      this.syncCollapsedState(result.collapsedGroups);
      this.activateDeclaredPane(api, preset.activate);
    } finally {
      queueMicrotask(() => { this._applyingPreset = false; });
    }

    if (options?.forceRebuild) {
      this._rememberedLayouts.delete(presetId);
    }

    this._undoSnapshot = snapshot;
    this._currentPresetId = presetId;
    recenterBiblePanesSoon();
  }

  /**
   * Run a layout operation that is not a user change (for example re-laying
   * the grid out when Study is revealed). Layout events it fires are ignored
   * by `notifyManualLayoutChange`, so the "current preset" checkmark stays.
   */
  runInternal<T>(fn: () => T): T {
    this._applyingPreset = true;
    try {
      return fn();
    } finally {
      queueMicrotask(() => { this._applyingPreset = false; });
    }
  }

  /**
   * Record `presetId` as the arrangement on screen without rearranging anything.
   * Used for the fresh default layout, which is built by hand to match the
   * default preset's shape, so the layout menu can show it as current. The
   * layout events its construction queued are ignored, as for `apply()`.
   */
  markCurrent(presetId: string): void {
    this._applyingPreset = true;
    queueMicrotask(() => { this._applyingPreset = false; });
    this._currentPresetId = presetId;
  }

  undo(): boolean {
    if (!this._undoSnapshot) return false;
    const api = useLayoutStore.getState().dockviewApi; // allow-getstate: service - imperative dockview access outside render
    if (!api) return false;

    const snapshot = this._undoSnapshot;
    this._applyingPreset = true;
    try {
      api.fromJSON(snapshot, { reuseExistingPanels: true });
      // Restoring a snapshot restores its sizes but not the constraints that let
      // a collapsed group be zero-width, so re-apply them.
      this.syncCollapsedState(
        zeroSizedGroupIds(snapshot).map((groupId): CollapsedGroup => ({ groupId, axis: 'width' })),
      );
    } finally {
      queueMicrotask(() => { this._applyingPreset = false; });
    }

    this._undoSnapshot = null;
    this._currentPresetId = null;
    recenterBiblePanesSoon();
    return true;
  }

  /**
   * Called by DockviewLayout's `onDidLayoutChange` subscription on *every*
   * layout change. A no-op while `apply()`/`undo()` are themselves mid-flight
   * (see `_applyingPreset`); otherwise clears the "current preset" checkmark,
   * since the user just moved, split, or resized something by hand and the
   * remembered preset no longer describes what's on screen.
   */
  notifyManualLayoutChange(): void {
    if (this._applyingPreset) return;
    this._currentPresetId = null;
  }

  /**
   * Forget every remembered arrangement.
   *
   * Called when the workbench is replaced wholesale (session restore, a new
   * dockview instance): the remembered group ids refer to groups that no
   * longer exist, so keeping them would restore a layout describing a workbench
   * the user is no longer looking at.
   */
  reset(): void {
    this._rememberedLayouts.clear();
    this._undoSnapshot = null;
    this._currentPresetId = null;
  }

  /**
   * Open each declared pane type that isn't open yet, via the same
   * `useLayoutStore.addPanel` path the "+" menu and the watermark buttons use.
   *
   * Titles come from `genericEnglishTitle` rather than a translated string:
   * `addPanel` persists the title into the serialized layout, so a localized
   * one would bake the creating locale into the saved session (see
   * utils/paneNames.ts). A failure here is not fatal - `plannedGroups` prunes
   * the cell that stayed empty and the preset degrades to the panes it has.
   *
   * "Already open" is asked of dockview rather than of the store's registry:
   * the registry is a mirror maintained by its callers, while `api.panels` is
   * the same source `toJSON()` - and therefore the bucketing - reads from.
   *
   * @returns how many panes were actually opened.
   */
  private openDeclaredPanes(api: DockviewApi, autoOpen: PanelContentType[] | undefined): number {
    if (!autoOpen || autoOpen.length === 0) return 0;
    const store = useLayoutStore.getState(); // allow-getstate: service - imperative store access outside render
    let opened = 0;
    for (const contentType of autoOpen) {
      const alreadyOpen = api.panels.some(
        p => (p.params as { contentType?: string } | undefined)?.contentType === contentType,
      );
      if (alreadyOpen) continue;
      if (store.addPanel(contentType, undefined, genericEnglishTitle(contentType))) {
        opened++;
      } else {
        console.warn('[LayoutPresetService] Could not auto-open pane for preset cell:', contentType);
      }
    }
    return opened;
  }

  /**
   * Brings the preset's headline pane to the front of whichever group it landed
   * in. See `LayoutPreset.activate` for why opening one is not enough.
   *
   * The panel is looked up *after* `applyPresetLayout`, because `fromJSON` with
   * `reuseExistingPanels` can move a panel into a different group than the one
   * it was in when `autoOpen` created it.
   */
  private activateDeclaredPane(api: DockviewApi, activate: PanelContentType | undefined): void {
    if (!activate) return;
    const panel = api.panels.find(
      p => (p.params as { contentType?: string } | undefined)?.contentType === activate,
    );
    panel?.api.setActive();
  }

  private rememberCurrent(snapshot: SerializedDockview): void {
    if (!this._currentPresetId) return;
    this._rememberedLayouts.set(this._currentPresetId, snapshot);
  }

  private syncCollapsedState(collapsedGroups: CollapsedGroup[]): void {
    useLayoutStore.getState().setCollapsedGroups(collapsedGroups); // allow-getstate: service - imperative store access outside render
  }

  /** Exposed for tests: the arrangement stored against a preset id, if any. */
  rememberedLayoutFor(presetId: string): SerializedDockview | undefined {
    return this._rememberedLayouts.get(presetId);
  }
}
