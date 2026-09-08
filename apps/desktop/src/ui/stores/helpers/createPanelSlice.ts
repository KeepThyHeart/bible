/**
 * Factory for the panel lifecycle slice shared by all per-panel Zustand stores.
 *
 * Every content store (bible, commentary, dictionary, book, notes, study, topics)
 * manages a `panels: Map<string, TPanelState>` keyed by dockview panel ID.
 * The init/destroy/get lifecycle is identical across all of them - this factory
 * generates that boilerplate once so individual stores only define their
 * domain-specific actions.
 *
 * Usage:
 * ```typescript
 * const panelSlice = createPanelSlice(createDefaultPanelState);
 *
 * export const useMyStore = create<MyStoreState>((set, get) => ({
 *   panels: new Map(),
 *   ...panelSlice(set, get),
 *   // domain-specific actions...
 * }));
 * ```
 */

import { getPanelState as getPanelStateFn, updatePanelState, removePanelState } from './panelStateHelpers';

/** The minimal shape every panel store must include for the lifecycle slice */
export interface PanelLifecycleSlice<T> {
  panels: Map<string, T>;
  initPanel: (panelId: string) => void;
  detachPanel: (panelId: string) => void;
  destroyPanel: (panelId: string) => void;
  getPanelState: (panelId: string) => T;
}

/** Optional lifecycle callbacks for panel init/destroy */
interface PanelLifecycleCallbacks<T> {
  /** Called when a panel is destroyed (before state is removed) */
  onDestroy?: (panelId: string) => void;
  /** Called when a panel is initialized (after state is created) */
  onInit?: (panelId: string) => void;
  /**
   * Which parts of a panel's state survive `detachPanel` - see below.
   *
   * Return the fields that describe *what the pane is showing* (open tabs,
   * which one is active, the reading position within each). Everything not
   * returned is reset to the store's default, which is the point: caches and
   * in-flight flags must not survive, or a pane that unmounted mid-fetch comes
   * back stuck on a spinner that nothing will ever clear.
   *
   * A store that does not supply this opts out entirely: `detachPanel` becomes
   * a no-op for it, so adopting the call is never lossy.
   */
  retainOnDetach?: (state: T) => Partial<T>;
}

/**
 * Create the panel lifecycle methods (initPanel, destroyPanel, getPanelState).
 *
 * @param createDefault - Factory function that returns a fresh default panel state
 * @param callbacks - Optional lifecycle callbacks for init/destroy (or just onDestroy function for backwards compat)
 * @returns A function that accepts Zustand's (set, get) and returns the lifecycle methods
 */
export function createPanelSlice<T>(
  createDefault: () => T,
  callbacks?: ((panelId: string) => void) | PanelLifecycleCallbacks<T>
) {
  // Support both a plain onDestroy function and a callbacks object
  const onDestroy = typeof callbacks === 'function' ? callbacks : callbacks?.onDestroy;
  const onInit = typeof callbacks === 'function' ? undefined : callbacks?.onInit;
  const retainOnDetach = typeof callbacks === 'function' ? undefined : callbacks?.retainOnDetach;
  return (
    set: (partial: { panels: Map<string, T> }) => void,
    get: () => { panels: Map<string, T> }
  ): Pick<
    PanelLifecycleSlice<T>,
    'initPanel' | 'detachPanel' | 'destroyPanel' | 'getPanelState'
  > => ({
    initPanel: (panelId: string) => {
      const { panels } = get();
      if (!panels.has(panelId)) {
        onInit?.(panelId);
        set({ panels: updatePanelState(panels, panelId, createDefault(), createDefault) });
      }
    },

    /**
     * The pane's React component went away, but the pane itself has not.
     *
     * This is the common case and it is NOT the same as the pane being closed:
     * a component unmounts when it is conditionally rendered behind a sibling
     * (`DictionaryPane` inside `BookPane`), when React StrictMode double-invokes
     * effects in development, and when a layout preset rebuilds the grid. Wiring
     * `destroyPanel` to unmount therefore deleted the pane's open tabs on an
     * ordinary tab switch - and because the session serializers read this same
     * live map, the next autosave wrote the emptied state over the good one.
     * That turned a transient UI event into permanent data loss.
     *
     * `detachPanel` keeps what identifies the pane and drops what can be
     * recomputed. Only `destroyPanel` - driven by dockview's `onDidRemovePanel`,
     * the one event that actually means "this pane is gone" - removes the entry.
     */
    detachPanel: (panelId: string) => {
      if (!retainOnDetach) return;
      const { panels } = get();
      const current = panels.get(panelId);
      if (!current) return;
      const retained = { ...createDefault(), ...retainOnDetach(current) };
      set({ panels: updatePanelState(panels, panelId, retained, createDefault) });
    },

    destroyPanel: (panelId: string) => {
      onDestroy?.(panelId);
      set({ panels: removePanelState(get().panels, panelId) });
    },

    getPanelState: (panelId: string) => {
      return getPanelStateFn(get().panels, panelId, createDefault);
    },
  });
}
