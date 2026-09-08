/**
 * Factory for the *tab strip* slice shared by the module-tab panel stores.
 *
 * `createPanelSlice` covers a panel's lifecycle (init / detach / destroy / read).
 * This is the layer above it: the actions that manage a pane's row of module
 * tabs, and the per-tab `Map` bookkeeping every one of those actions has to do.
 *
 * ## Why it exists
 *
 * `useBookStore` and `useDictionaryStore` model genuinely different content -
 * a book is a hierarchy of sections with a reading position, a dictionary is a
 * flat key->record lookup - but they present that content through the *same*
 * component, each as its own strip of tabs. Everything about the strip was
 * therefore written twice: `setActiveTab` and `clearError` were identical
 * character for character, `reorderTabs` differed only by a comment, and
 * `closeBook`/`closeDictionary` were the same fifty-odd lines with a different
 * list of maps to delete from. Two copies of index arithmetic that has to agree
 * about what "the active tab" is after a close is a drift bug waiting to
 * happen, not a design.
 *
 * What is *not* shared stays unshared: opening a tab, loading content, and
 * session restore all differ per content type and live in their own stores.
 *
 * ## Composition with the other helpers
 *
 * A store spreads both slices:
 *
 * ```typescript
 * const panelSlice = createPanelSlice(createDefaultFooPanelState, { retainOnDetach });
 * const tabsSlice  = createPanelTabsSlice(createDefaultFooPanelState);
 *
 * export const useFooStore = create<FooState>((set, get) => {
 *   const tabs = tabsSlice(set as any, get as any);
 *   return {
 *     panels: new Map(),
 *     ...panelSlice(set as any, get as any),
 *     setActiveTab: tabs.setActiveTab,
 *     closeFoo: tabs.closeTab,       // named for the domain
 *     // domain-specific actions...
 *   };
 * });
 * ```
 *
 * The two are independent: this slice only ever reads and writes through
 * `panelStateHelpers`, so `detachPanel`'s `retainOnDetach` contract and
 * `destroyPanelState` are unaffected by anything here.
 */

import { getPanelState as getPanelStateFn, updatePanelState } from './panelStateHelpers';
import { markSessionDirty } from './sessionNotifier';

/** One module tab in a pane's strip. Both stores use exactly this shape. */
export interface PanelTab {
  abbreviation: string;
  name: string;
}

/**
 * The part of a panel's state the tab-strip actions need to see.
 *
 * `errorByTab` is in here rather than left to the per-store map discovery below
 * because `clearError` names it directly; every other per-tab map is handled
 * generically.
 */
export interface TabbedPanelState {
  openTabs: PanelTab[];
  activeTabIndex: number;
  errorByTab: Map<string, string | null>;
}

/** Keys of `T` whose value is a per-tab `Map` keyed by module abbreviation. */
export type TabMapKey<T> = {
  [K in keyof T]-?: T[K] extends Map<string, unknown> ? K : never;
}[keyof T];

type TabMapValue<M> = M extends Map<string, infer V> ? V : never;

/** A patch naming one new value per per-tab map, all under the same tab key. */
export type TabMapValues<T> = { [K in TabMapKey<T>]?: TabMapValue<T[K]> };

/**
 * Immutably set one tab's entry in each of the named per-tab maps.
 *
 * This is the "write-back preamble" both stores repeated around every fetch -
 * clone the loading map, set true, clone the error map, set null, merge both
 * into the panel - collapsed to one call:
 *
 * ```typescript
 * withTabValues(ps, abbreviation, { loadingByTab: true, errorByTab: null })
 * ```
 *
 * Typed against the panel state, so naming a field that is not a per-tab map,
 * or writing a value of the wrong type into one, is a compile error.
 */
export function withTabValues<T extends object>(
  state: T,
  abbreviation: string,
  values: TabMapValues<T>,
): Partial<T> {
  const patch: Record<string, Map<string, unknown>> = {};
  for (const [field, value] of Object.entries(values)) {
    const next = new Map(state[field as keyof T] as unknown as Map<string, unknown>);
    next.set(abbreviation, value);
    patch[field] = next;
  }
  return patch as Partial<T>;
}

/** Immutably drop one tab's entry from each of the named per-tab maps. */
export function withoutTabValues<T extends object>(
  state: T,
  abbreviation: string,
  fields: readonly (keyof T)[],
): Partial<T> {
  const patch: Record<string, Map<string, unknown>> = {};
  for (const field of fields) {
    const next = new Map(state[field] as unknown as Map<string, unknown>);
    next.delete(abbreviation);
    patch[field as string] = next;
  }
  return patch as Partial<T>;
}

/**
 * Every per-tab map on a store's default panel state.
 *
 * Discovered from the default rather than declared as a list, because the list
 * would be a second place to remember: closing a tab has to clear *all* of that
 * tab's caches, and a map added later without a matching edit to a hand-written
 * list leaks the closed tab's content into the next module opened under the
 * same abbreviation.
 */
function tabMapFields<T extends object>(createDefault: () => T): (keyof T)[] {
  const sample = createDefault();
  return (Object.keys(sample) as (keyof T)[]).filter(key => sample[key] instanceof Map);
}

/**
 * Which tab is active after the one at `closedIndex` is removed.
 *
 * Closing the active tab falls back to its left-hand neighbour; closing
 * anything to its left shifts it down one; closing anything to its right leaves
 * it alone. An emptied strip parks at 0.
 */
export function activeIndexAfterClose(
  closedIndex: number,
  activeIndex: number,
  remaining: number,
): number {
  if (remaining === 0) return 0;
  if (closedIndex === activeIndex) return Math.max(0, closedIndex - 1);
  if (closedIndex < activeIndex) return activeIndex - 1;
  return activeIndex;
}

/**
 * Which tab is active after a drag moves `sourceIndex` to `destinationIndex`.
 *
 * The rule is "the same tab stays active": the dragged tab follows the cursor,
 * and a tab the drag stepped over shifts by one in the opposite direction.
 */
export function activeIndexAfterMove(
  sourceIndex: number,
  destinationIndex: number,
  activeIndex: number,
): number {
  if (activeIndex === sourceIndex) return destinationIndex;
  if (sourceIndex < activeIndex && destinationIndex >= activeIndex) return activeIndex - 1;
  if (sourceIndex > activeIndex && destinationIndex <= activeIndex) return activeIndex + 1;
  return activeIndex;
}

/** The tab-strip actions, all taking the dockview panel id first. */
export interface PanelTabsSlice {
  /** Select a tab by its index within *this* store's list. Ignores out-of-range. */
  setActiveTab: (panelId: string, index: number) => void;
  /** Move a tab within this store's list, keeping the same tab active. */
  reorderTabs: (panelId: string, sourceIndex: number, destinationIndex: number) => void;
  /**
   * Close a tab and drop everything cached against it.
   *
   * Re-exported by each store under its domain name (`closeBook`,
   * `closeDictionary`) so call sites keep reading in the domain's language.
   */
  closeTab: (panelId: string, abbreviation: string) => void;
  /** Dismiss the error banner for one tab. Not a session change. */
  clearError: (panelId: string, abbreviation: string) => void;
}

/**
 * Create the tab-strip actions for a store whose panel state is `T`.
 *
 * @param createDefault - the same factory the store hands `createPanelSlice`
 */
export function createPanelTabsSlice<T extends TabbedPanelState>(createDefault: () => T) {
  const perTabMaps = tabMapFields(createDefault);

  return (
    set: (partial: { panels: Map<string, T> }) => void,
    get: () => { panels: Map<string, T> },
  ): PanelTabsSlice => {
    const stateOf = (panelId: string): T =>
      getPanelStateFn(get().panels, panelId, createDefault);

    // `Partial<TabbedPanelState>` is a `Partial<T>` for every T this factory
    // accepts, but TypeScript cannot narrow an unresolved generic that far.
    const patch = (panelId: string, updates: Partial<T>): void => {
      set({ panels: updatePanelState(get().panels, panelId, updates, createDefault) });
    };

    return {
      setActiveTab: (panelId, index) => {
        const ps = stateOf(panelId);
        if (index < 0 || index >= ps.openTabs.length) return;
        patch(panelId, { activeTabIndex: index } as Partial<T>);
        markSessionDirty();
      },

      reorderTabs: (panelId, sourceIndex, destinationIndex) => {
        const ps = stateOf(panelId);
        const count = ps.openTabs.length;
        if (sourceIndex < 0 || sourceIndex >= count) return;
        if (destinationIndex < 0 || destinationIndex >= count) return;

        const openTabs = Array.from(ps.openTabs);
        const [moved] = openTabs.splice(sourceIndex, 1);
        openTabs.splice(destinationIndex, 0, moved);

        patch(panelId, {
          openTabs,
          activeTabIndex: activeIndexAfterMove(sourceIndex, destinationIndex, ps.activeTabIndex),
        } as Partial<T>);
        markSessionDirty();
      },

      closeTab: (panelId, abbreviation) => {
        const ps = stateOf(panelId);
        const closedIndex = ps.openTabs.findIndex(tab => tab.abbreviation === abbreviation);
        if (closedIndex === -1) return;

        const openTabs = ps.openTabs.filter(tab => tab.abbreviation !== abbreviation);
        patch(panelId, {
          openTabs,
          activeTabIndex: activeIndexAfterClose(closedIndex, ps.activeTabIndex, openTabs.length),
          ...withoutTabValues(ps, abbreviation, perTabMaps),
        } as Partial<T>);
        markSessionDirty();
      },

      clearError: (panelId, abbreviation) => {
        const errorByTab = new Map(stateOf(panelId).errorByTab);
        errorByTab.set(abbreviation, null);
        patch(panelId, { errorByTab } as Partial<T>);
      },
    };
  };
}
