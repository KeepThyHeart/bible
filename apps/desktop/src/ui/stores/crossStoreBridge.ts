// Cross-store bridge: a small registry of nullable callbacks that allow one
// store to invoke another without importing it directly. All bridges are
// wired at app startup by `storeSync.ts`, which imports every store and
// installs the concrete implementations.
//
// Rationale (store coupling): stores that reach into other stores
// create hidden couplings and circular-import traps. Instead of doing
// `import { useFooStore } from './useFooStore'` inside store code, the store
// imports this module and calls a bridge function. If the bridge hasn't been
// wired yet (e.g. in unit tests), the call is a safe no-op.
//
// Only tiny, well-scoped *imperative* bridges belong here. Reactive
// subscriptions belong in `storeSync.ts` directly.

/** Navigate the primary Bible panel to a verse. Implemented by useBibleStore. */
export type NavigateToVerseInPrimary = (verseId: number) => void;

/**
 * Show a verse in the primary Bible panel *without* choosing it - the gesture
 * behind every scripture link in the app (a cross-reference, a topic's passage
 * list, a citation in a commentary entry).
 *
 * Deliberately separate from `navigateToVerseInPrimary`: that one moves the
 * selection every study pane follows, which is right for a search result the
 * reader picked and wrong for a link they are glancing at. See
 * `bible/slices/previewSlice.ts`.
 */
export type PreviewVerseInPrimary = (verseId: number, endVerseId?: number) => void;

/**
 * Resolve a fallback "current verse" for the commentary pane by reading the
 * Bible pane's primary-panel active tab. Returns null if no verse is
 * available (e.g. Bible store not yet initialized).
 */
export type ResolvePrimaryBibleVerseId = () => number | null;

/**
 * Resolve the list of module abbreviations that are currently open across all
 * Bible and Commentary panels. Used by the search store when the search scope
 * is `allOpenModules`.
 */
export type ResolveOpenModuleAbbreviations = () => string[];

/**
 * Open - or, if it already exists anywhere in the workbench, focus - the
 * dockview panel that shows search results. Implemented by useLayoutStore.
 *
 * The search store calls this whenever a search produces a result set. It is
 * deliberately a bridge and not an import: the search store must keep working
 * (as a no-op) in tests and in the detached-window renderer, neither of which
 * has a dockview instance.
 */
export type ShowSearchResultsPanel = () => void;

/** What changed in the installed-module library. */
export interface LibraryChange {
  /**
   * The module types whose installed set changed (install, uninstall, update or
   * hide/unhide). Consumers only care about the types they render.
   */
  moduleTypes: string[];
}

/**
 * Tell the rest of the app that the set of installed modules changed. Raised by
 * the module store once an install/uninstall/update has *finished* and the
 * installed list has been reloaded. Implemented by `storeSync.ts`, which
 * refreshes the Bible store (available translations, first-Bible seeding).
 */
export type NotifyLibraryChanged = (change: LibraryChange) => void | Promise<void>;

interface CrossStoreBridges {
  notifyLibraryChanged: NotifyLibraryChanged | null;
  navigateToVerseInPrimary: NavigateToVerseInPrimary | null;
  previewVerseInPrimary: PreviewVerseInPrimary | null;
  resolvePrimaryBibleVerseId: ResolvePrimaryBibleVerseId | null;
  resolveOpenModuleAbbreviations: ResolveOpenModuleAbbreviations | null;
  showSearchResultsPanel: ShowSearchResultsPanel | null;
}

const bridges: CrossStoreBridges = {
  notifyLibraryChanged: null,
  navigateToVerseInPrimary: null,
  previewVerseInPrimary: null,
  resolvePrimaryBibleVerseId: null,
  resolveOpenModuleAbbreviations: null,
  showSearchResultsPanel: null,
};

export function setNavigateToVerseInPrimary(fn: NavigateToVerseInPrimary | null): void {
  bridges.navigateToVerseInPrimary = fn;
}

export function setResolvePrimaryBibleVerseId(fn: ResolvePrimaryBibleVerseId | null): void {
  bridges.resolvePrimaryBibleVerseId = fn;
}

export function setResolveOpenModuleAbbreviations(fn: ResolveOpenModuleAbbreviations | null): void {
  bridges.resolveOpenModuleAbbreviations = fn;
}

export function setPreviewVerseInPrimary(fn: PreviewVerseInPrimary | null): void {
  bridges.previewVerseInPrimary = fn;
}

export function navigateToVerseInPrimary(verseId: number): void {
  bridges.navigateToVerseInPrimary?.(verseId);
}

/**
 * Preview a verse, falling back to a real navigation when the bridge has not
 * been wired (unit tests, the detached-window renderer). Showing the verse is
 * always better than doing nothing; the fallback merely loses the softness.
 */
export function previewVerseInPrimary(verseId: number, endVerseId?: number): void {
  if (bridges.previewVerseInPrimary) {
    bridges.previewVerseInPrimary(verseId, endVerseId);
    return;
  }
  bridges.navigateToVerseInPrimary?.(verseId);
}

export function resolvePrimaryBibleVerseId(): number | null {
  return bridges.resolvePrimaryBibleVerseId?.() ?? null;
}

export function resolveOpenModuleAbbreviations(): string[] {
  return bridges.resolveOpenModuleAbbreviations?.() ?? [];
}

export function setNotifyLibraryChanged(fn: NotifyLibraryChanged | null): void {
  bridges.notifyLibraryChanged = fn;
}

/**
 * Announce that installed modules of `change.moduleTypes` changed. Resolves once
 * the listener has finished reacting; a no-op when nothing is wired, and a
 * listener failure is logged rather than thrown - a finished install must not
 * report as failed because a pane could not refresh.
 */
export async function notifyLibraryChanged(change: LibraryChange): Promise<void> {
  try {
    await bridges.notifyLibraryChanged?.(change);
  } catch (error) {
    console.error('[crossStoreBridge] notifyLibraryChanged listener failed:', error);
  }
}

export function setShowSearchResultsPanel(fn: ShowSearchResultsPanel | null): void {
  bridges.showSearchResultsPanel = fn;
}

export function showSearchResultsPanel(): void {
  bridges.showSearchResultsPanel?.();
}
