import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useOverlayDismissal } from '../hooks/useOverlayDismissal';
import { useDockviewTabA11y, focusActiveTabOfGroup, focusPanelTab } from '../hooks/useDockviewTabA11y';
import { createPortal } from 'react-dom';
import type { IDockviewPanelHeaderProps } from 'dockview-react';
import type { PanelContentType } from '../stores/useLayoutStore';
import { useLayoutStore } from '../stores/useLayoutStore';
import { useBibleStore } from '../stores/useBibleStore';
import { useBookStore } from '../stores/useBookStore';
import { useDictionaryStore } from '../stores/useDictionaryStore';
import { useCommentaryStore } from '../stores/useCommentaryStore';
import { useStudyStore } from '../stores/useStudyStore';
import { useTopicsStore } from '../stores/useTopicsStore';
import { getNotesPanelNavState } from '../stores/useFileNotesStore';
import { formatVerseReference } from '../utils/verseReference';
import type { PaneType } from '../../../electron/config/paneConfig';
import { useI18n } from '../contexts/useI18n';
import { localizePaneLabel, PANE_NAME_KEYS, type NamedPaneType } from '../utils/paneNames';
import { anchorAtPointer } from '@bible/core/browser';
import { useDirection, Bdi } from '@bible/ui';
import { popOutModuleToWindow } from '../utils/popOutModule';
import { cleanModuleName } from '../utils/verseFormatting';
import { useExtensionUiStore } from '../extensions/extensionUiStore';
import { declaredPanelWindowSize } from '../extensions/panelWindowSize';
// Icon map for panel content types. Lives in its own module so the Books pane's
// internal tab strip marks a book and a dictionary with the same glyphs this
// header does, instead of inventing its own badge - and so the "+" page's
// category tiles (NewTabPage) resolve their icons from the same rule this tab
// does rather than a second, drifting list.
import { tabIconFor } from './paneIcons';
import { useSearchStore, selectSessionView, sessionTitleQuery } from '../stores/useSearchStore';

export { SEARCH_TAB_TITLE_LENGTH, searchTabTitle } from './searchTabTitle';
import { searchTabTitle } from './searchTabTitle';

/**
 * A literal chrome size in rem (B-045). The UI size setting scales the rem
 * root (`--ui-scale` on <html>), so each literal px value is expressed as rem
 * and follows it with no further multiplication. The sizes are inline styles,
 * which outrank any stylesheet, so they have to be rem here. Keeping each
 * literal separate preserves the hierarchy (a 10px subtitle stays smaller than
 * its 14px title at every scale).
 */
function controlScaled(px: number): string {
  return `${px / 16}rem`;
}

/**
 * Thickness of the rule under the tab strip, defined in
 * `styles/dockview-overrides.css`. The tab's own bottom padding has to clear
 * it, or a descender (or the second line of a two-line tab) sits on top of the
 * border - which is exactly what happened at the larger "UI Control Font Size"
 * settings, where the translation name under a Bible tab's passage was sliced
 * off by the baseline.
 */
const TAB_STRIP_BORDER_WIDTH = 'var(--app-tab-strip-border-width, 4px)';

/**
 * Which detached-window type each dockview pane pops out as - the renderer half
 * of `PaneType` in `electron/config/paneConfig.ts`.
 *
 * A content type that is absent cannot be popped out, and the context menu
 * leaves the item off rather than offering a gesture that does nothing.
 *
 * `search` and `newtab` have no window of their own on purpose: search results
 * live in a store the new window does not share (it would open empty), and the
 * "+" page is a way to create a pane, not a pane worth keeping.
 */
const POP_OUT_PANE_TYPE: Partial<Record<PanelContentType, PaneType>> = {
  bible: 'bible',
  commentary: 'commentary',
  book: 'book',
  // Dictionaries ride in the Books window - see the `PaneType` note in
  // `paneConfig.ts`; `paneKind` in the payload is what makes it a dictionary.
  dictionary: 'book',
  notes: 'verse-notes',
  prayer: 'prayer',
  study: 'study',
  topics: 'topics',
};

/**
 * Map a panel's content type to the window kind it detaches into.
 *
 * A plain record lookup cannot serve extension panels: their content type is
 * `` `ext:${extensionId}.${panelTypeId}` ``, so there is one per contributed
 * panel and they are not known until an extension registers. That is why
 * extension panes could not be popped out at all - `handlePopOut` returned
 * early on the lookup miss and the menu simply left the item off.
 *
 * Every extension panel maps to the single `'extension'` window kind; what
 * distinguishes one from another travels in the detach payload.
 *
 * Exported for unit testing - the mapping is the whole of P2's logic, and the
 * rest is Electron plumbing that a unit test cannot reach.
 */
export function popOutPaneTypeFor(contentType: PanelContentType): PaneType | undefined {
  if (typeof contentType === 'string' && contentType.startsWith('ext:')) return 'extension';
  return POP_OUT_PANE_TYPE[contentType];
}

/**
 * Split `ext:<extensionId>.<panelTypeId>` back into its two halves.
 *
 * Extension ids contain dots (`ext.bible-app.memory`), so the split is on the
 * *last* dot, which is where the panel type id begins. Splitting on the first
 * would hand back `ext` as the extension id for every panel in existence.
 */
export function parseExtensionContentType(
  contentType: string,
): { extensionId: string; panelTypeId: string } | null {
  if (!contentType.startsWith('ext:')) return null;
  const rest = contentType.slice('ext:'.length);
  const lastDot = rest.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === rest.length - 1) return null;
  return {
    extensionId: rest.slice(0, lastDot),
    panelTypeId: rest.slice(lastDot + 1),
  };
}

interface ContextMenuState {
  x: number;
  y: number;
}

/**
 * Custom tab renderer for dockview panels.
 * Preserves the visual style of the existing pane tabs.
 * Includes right-click context menu with split/pop-out/close actions.
 */
const DockviewTabRenderer: React.FC<IDockviewPanelHeaderProps> = (props) => {
  const { t } = useI18n();
  const { api, containerApi } = props;
  const contentType = props.params?.contentType as PanelContentType | undefined;
  // Present on single-module panels ("just Clarke", "just Easton"), which
  // render `CommentarySinglePanel` / `BookSinglePanel` / `DictionarySinglePanel`
  // rather than the full pane. Those components keep their state locally, so
  // the pop-out payload has to be built from this key - see `handlePopOut`.
  const contentKey = props.params?.contentKey as string | undefined;
  const staticSubtitle = props.params?.subtitle as string | undefined;
  const dynamicSubtitle = useLayoutStore(s => s.dynamicSubtitles.get(api.id));
  // A search tab is titled with its own session's query (task 0210); the panel
  // id is the session id.
  const isSearchTab = contentType === 'search';
  const searchQuery = useSearchStore(s => (isSearchTab ? sessionTitleQuery(selectSessionView(s, api.id)) : ''));
  // Preview-tab model: an unpinned search tab is shown in italics and reused by the next search.
  const searchPinned = useSearchStore(s => isSearchTab && !!s.sessionMeta[api.id]?.pinned);
  const searchIsPreview = isSearchTab && !searchPinned;
  const searchIsSemantic = useSearchStore(s => isSearchTab && selectSessionView(s, api.id).isSemanticMode);
  const subtitle = isSearchTab && searchQuery && searchIsSemantic
    ? t('searchTabs.meaningSubtitle')
    : localizePaneLabel(t, contentType, dynamicSubtitle || staticSubtitle);
  const icon = tabIconFor(contentType);
  // `workspace.setPanelBadge` - only ever set for an extension's own
  // `ext:`-content-type panel (the api-impl enforces that), so no
  // `paneType === 'extension'` guard is needed here.
  const badge = useExtensionUiStore(s => s.panelBadges[api.id]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const uiDir = useDirection();
  const menuRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Subscribe to title changes so the tab re-renders when setTitle() is called
  const [storedTitle, setStoredTitle] = useState(api.title);
  useEffect(() => {
    setStoredTitle(api.title);
    const disposable = api.onDidTitleChange(() => {
      setStoredTitle(api.title);
    });
    return () => disposable.dispose();
  }, [api]);

  // How many tabs this tab's own *group* holds.
  //
  // The close "x" is hidden at one, because closing the last tab in a pane
  // removes the pane itself - the split collapses and there is no obvious way
  // to get it back. (Right-click -> Close still offers it, deliberately: that
  // gesture is deliberate enough to mean it.) The count has to be the group's,
  // not `containerApi.panels.length`, which counts every tab in the whole
  // workbench and so kept offering the x on a lone Bible tab.
  //
  // dockview does not re-render tab headers when a sibling is added or closed,
  // so the count is tracked rather than read at render time.
  const [groupTabCount, setGroupTabCount] = useState(() => api.group?.panels.length ?? 1);
  useEffect(() => {
    const update = (): void => setGroupTabCount(api.group?.panels.length ?? 1);
    update();
    const disposables = [
      // Fires on add / close / drag between groups.
      containerApi.onDidLayoutChange(update),
      // Fires when *this* panel is the one that moved.
      api.onDidGroupChange(update),
    ];
    return () => disposables.forEach(d => d.dispose());
  }, [api, containerApi]);

  // Dockview persists the title it was created with into the serialized layout,
  // so a generic panel ("Study", "Commentary") carries an English label across
  // restarts. Translate it here, per render, so switching locale re-labels the
  // tabs that are already open. Content-derived titles - a passage, a module
  // name - are data and pass through untouched.
  const genericTitle = localizePaneLabel(t, contentType, storedTitle) ?? storedTitle;
  const title = isSearchTab && searchQuery ? searchTabTitle(searchQuery) : genericTitle;
  const accessibleName = isSearchTab && searchQuery
    ? t(searchIsSemantic ? 'searchTabs.accessibleNameMeaning' : 'searchTabs.accessibleName', { query: searchQuery })
    : title;

  /**
   * Close this tab and keep keyboard focus in its strip: the focused tab is
   * about to be removed, and focus would otherwise fall to the page and be
   * rescued onto the first pane's heading. The tab that becomes active in the
   * same group takes it (the workbench's active group when this one is gone).
   */
  const closeKeepingFocus = useCallback(() => {
    const group = api.group;
    api.close();
    focusActiveTabOfGroup(containerApi as never, group as never);
  }, [api, containerApi]);

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    closeKeepingFocus();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      closeKeepingFocus();
    }
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // Keyboard route to the same menu (Shift+F10 / the Menu key on the focused
  // tab); the hook reports the tab's rectangle.
  const openMenuFromKeyboard = useCallback((anchor: DOMRect) => {
    setContextMenu({ x: anchor.left, y: anchor.bottom });
  }, []);

  // Close context menu on outside click or Escape
  const dismissContextMenu = useCallback(() => setContextMenu(null), []);
  useOverlayDismissal(!!contextMenu, dismissContextMenu);

  /** The tab element this menu belongs to, where focus returns when it closes. */
  const tabHost = (): HTMLElement | null => contentRef.current?.closest<HTMLElement>('.dv-tab') ?? null;

  // The menu takes focus when it opens, on its first item.
  useEffect(() => {
    if (!contextMenu) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [contextMenu]);

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      e.stopPropagation();
      items[next].focus();
      return;
    }
    if (e.key === 'Escape' || e.key === 'Tab') {
      // Escape and Tab both dismiss; focus goes back to the tab so the
      // keyboard user is where they started (Tab then moves on from there).
      e.preventDefault();
      e.stopPropagation();
      setContextMenu(null);
      tabHost()?.focus();
    }
  };

  const handleSplitRight = () => {
    setContextMenu(null);
    if (!contentType) return;
    const panel = containerApi.getPanel(api.id);
    if (panel) {
      // Create a new group to the right and move (not duplicate) the panel into it
      const newGroup = containerApi.addGroup({
        referencePanel: panel,
        direction: 'right',
      });
      panel.api.moveTo({ group: newGroup });
      focusPanelTab(containerApi as never, api.id);
    }
  };

  const handleSplitDown = () => {
    setContextMenu(null);
    if (!contentType) return;
    const panel = containerApi.getPanel(api.id);
    if (panel) {
      // Create a new group below and move (not duplicate) the panel into it
      const newGroup = containerApi.addGroup({
        referencePanel: panel,
        direction: 'below',
      });
      panel.api.moveTo({ group: newGroup });
      focusPanelTab(containerApi as never, api.id);
    }
  };

  const handlePopOut = async () => {
    setContextMenu(null);
    if (!contentType) return;
    try {
      const paneType = popOutPaneTypeFor(contentType);
      if (!paneType) return;

      // Extension panels detach with their identity and their contributed
      // title. Nothing else can travel: the panel's state lives inside a
      // sandboxed iframe on the extension's own origin, so the host cannot
      // read it and must not try. A popped-out panel therefore reloads from
      // whatever its worker has persisted - which is the same thing that
      // happens when the user reopens it, and is why `api.panels` exists.
      if (paneType === 'extension') {
        const parsed = parseExtensionContentType(contentType);
        if (!parsed) return;
        // The panel type may have declared a preferred window size. It is
        // looked up here rather than passed down as a prop because the tab
        // header knows only its content type: the registry is the store, and
        // a panel whose extension has since been deactivated simply has no
        // entry, which correctly means "no preference".
        const registered = useExtensionUiStore // allow-getstate: event handler - read latest state without re-subscribing
          .getState()
          .panelTypes.find(
            (p) => p.extensionId === parsed.extensionId && p.panelTypeId === parsed.panelTypeId,
          );
        const detachResult = await window.electron.window.detachPane('extension', {
          extensionId: parsed.extensionId,
          panelTypeId: parsed.panelTypeId,
          panelId: api.id,
          panelTitle: api.title,
          defaultWindowSize: declaredPanelWindowSize(registered?.def),
        });
        if (!detachResult.success) {
          console.error('[DockviewTabRenderer] Failed to pop out extension panel:', detachResult.error);
          return;
        }
        containerApi.getPanel(api.id)?.api.close();
        return;
      }

      // A single-module panel keeps `entries`, `currentVerseId` and the rest in
      // local React state and writes nothing to the store. Reading the store by
      // panel id therefore returned the *default empty* panel state, and the
      // window opened with no module and no verse - "Navigate to a verse to see
      // available commentaries" on a pane that was plainly showing one. Build
      // the payload from the panel's own content key instead.
      if (contentKey && (contentType === 'commentary' || contentType === 'book' || contentType === 'dictionary')) {
        await popOutModuleToWindow({
          type: contentType,
          abbreviation: contentKey,
          name: cleanModuleName(contentKey),
        });
        return;
      }

      // Gather current pane state to preserve it in the detached window
      let initialState: Record<string, unknown> = {};
      const panelId = api.id;

      if (contentType === 'commentary') {
        const ps = useCommentaryStore.getState().getPanelState(panelId); // allow-getstate: event handler - read latest state without re-subscribing
        initialState = {
          openTabs: ps.openTabs,
          activeTabIndex: ps.activeTabIndex,
          currentVerseId: ps.currentVerseId,
          entriesByTab: Array.from(ps.entriesByTab.entries()),
          browseModeByTab: Array.from(ps.browseModeByTab.entries()),
          overviewActive: ps.openTabs.length === 0,
        };
      } else if (contentType === 'bible') {
        const ps = useBibleStore.getState().getPanelState(panelId); // allow-getstate: event handler - read latest state without re-subscribing
        initialState = {
          openTabs: ps.openTabs,
          activeTabIndex: ps.activeTabIndex,
          // `paneConfig.bible.titleFormat` reads the translation off
          // `activeTab`. Without it the popped-out window was titled
          // "Bible - Bible - John 3" instead of "Bible - KJV - John 3".
          activeTab: ps.openTabs[ps.activeTabIndex],
          currentBook: ps.currentBook,
          currentChapter: ps.currentChapter,
          currentBookName: ps.currentBookName,
          selectedVerseId: ps.selectedVerseId,
        };
      } else if (contentType === 'book') {
        // BookPane's useDetachedInit expects the per-tab Maps pre-serialized as
        // entry arrays. Without this branch the payload was `{}`, the hook bailed
        // on the missing `openTabs`, and the popped-out Books window came up empty.
        const ps = useBookStore.getState().getPanelState(panelId); // allow-getstate: event handler - read latest state without re-subscribing
        // BookPane renders book and dictionary tabs under the same panelId
        // (`BookPane` is the component behind both), so the dictionary side of the
        // pane has to travel in this payload too - without it a detached
        // Books window came up with its dictionary tabs silently gone.
        const dps = useDictionaryStore.getState().getPanelState(panelId); // allow-getstate: event handler - read latest state without re-subscribing
        initialState = {
          openTabs: ps.openTabs,
          activeTabIndex: ps.activeTabIndex,
          currentSectionByTab: Array.from(ps.currentSectionByTab.entries()),
          sectionsByTab: Array.from(ps.sectionsByTab.entries()),
          childSectionsByTab: Array.from(ps.childSectionsByTab.entries()),
          sectionSummariesByTab: Array.from(ps.sectionSummariesByTab.entries()),
          dictOpenTabs: dps.openTabs,
          dictActiveTabIndex: dps.activeTabIndex,
          dictEntriesByTab: Array.from(dps.entriesByTab.entries()),
        };
      } else if (contentType === 'dictionary') {
        // Dictionaries ride in the Books window: both content types render the
        // same component, and `POP_OUT_PANE_TYPE` sends both to 'book'. Without this
        // branch a dictionary panel popped out with an empty payload.
        const dps = useDictionaryStore.getState().getPanelState(panelId); // allow-getstate: event handler - read latest state without re-subscribing
        initialState = {
          dictOpenTabs: dps.openTabs,
          dictActiveTabIndex: dps.activeTabIndex,
          dictEntriesByTab: Array.from(dps.entriesByTab.entries()),
          // `BookPane` holds books unless told otherwise, so popping out a
          // Dictionary handed over the dictionary's state and then showed Books
          // - the reader had to find their way back to the pane they had just
          // detached. `PanelContentRenderer` passes the same prop for the
          // docked case.
          paneKind: 'dictionary',
        };
      } else if (contentType === 'notes') {
        const navState = getNotesPanelNavState(panelId);
        if (navState) {
          initialState = {
            initialView: navState.view,
            initialSideTab: navState.sideTab,
            initialCurrentPath: navState.currentPath,
            initialCurrentNotePath: navState.currentNotePath,
          };
        }
      } else if (contentType === 'study') {
        // Both of these panes seed themselves from the Bible pane's verse on
        // mount, and a detached window has no Bible pane - so the verse has to
        // travel with the pop-out or the window opens on its empty state.
        // `verseName` / `topicName` are what `paneConfig` titles the window
        // with; neither is derivable in the main process.
        const ps = useStudyStore.getState().getPanelState(panelId); // allow-getstate: event handler - read latest state without re-subscribing
        initialState = {
          initialVerseId: ps.currentVerseId,
          verseName: ps.currentVerseId ? formatVerseReference(ps.currentVerseId) : undefined,
        };
      } else if (contentType === 'topics') {
        const ps = useTopicsStore.getState().getPanelState(panelId); // allow-getstate: event handler - read latest state without re-subscribing
        const verseId = ps.currentVerseId ?? ps.liveVerseId;
        initialState = {
          initialVerseId: verseId,
          topicName: verseId ? formatVerseReference(verseId) : undefined,
        };
      }

      const result = await window.electron.window.detachPane(paneType, initialState);
      if (!result.success) {
        console.error('[DockviewTabRenderer] Failed to pop out:', result.error);
      } else if (contentType === 'notes') {
        // Signal original notes pane to exit editor mode (prevents dual-editing)
        window.dispatchEvent(new CustomEvent('notes-pane-popped-out', { detail: { panelId } }));
      }
    } catch (error) {
      console.error('[DockviewTabRenderer] Error popping out:', error);
    }
  };

  const handleCloseContext = () => {
    setContextMenu(null);
    closeKeepingFocus();
  };

  // The "x" button is taken out of the tab order (tabIndex -1) because it sits
  // inside dockview's role=tab element and cannot be un-nested; Delete on the
  // focused tab is its keyboard equivalent, offered only when the "x" is.
  const closeFromKeyboard = closeKeepingFocus;
  const onDidLayoutChange = useCallback(
    (cb: () => void) => containerApi.onDidLayoutChange(cb),
    [containerApi],
  );
  // The strip is a tablist with no other name; name it for what it holds.
  //
  // The name follows the *group*, not this tab, and is stable: it does not
  // change as the selected tab does. A group containing a Bible panel is
  // "Bible tabs"; any other group is "Study tabs" (it holds Study, Commentary,
  // Notes, Topics, Dictionary ... and a name taken from the selected tab would
  // mislead). Pane names are localized through the catalog, never taken from
  // the stored title. Two groups that would share a name are told apart by a
  // number ("Bible 2"), in the order the workbench lists its groups.
  const getTablistLabel = useCallback((): string | undefined => {
    type GroupShape = {
      panels?: Array<{ id?: string; params?: { contentType?: string } }>;
      activePanel?: { id?: string; params?: { contentType?: string } };
    };
    const baseName = (group: GroupShape | undefined, fallbackKind?: string): string | undefined => {
      const kinds = (group?.panels ?? []).map(p => p.params?.contentType).filter((k): k is string => !!k);
      if (kinds.length === 0 && fallbackKind) kinds.push(fallbackKind);
      const kind = kinds.includes('bible') ? 'bible' : 'study';
      return t(PANE_NAME_KEYS[kind as NamedPaneType]);
    };
    const name = baseName(api.group as GroupShape | undefined, contentType);
    if (!name) return undefined;
    const groups = ((containerApi as { groups?: GroupShape[] }).groups ?? []);
    const mine = api.group as GroupShape | undefined;
    const samePosition = groups
      .filter(g => g === mine || baseName(g) === name);
    const index = mine ? samePosition.indexOf(mine) : -1;
    const unique = index > 0 ? `${name} ${index + 1}` : name;
    const label = t('ui.dockviewTab.tablistLabel', { name: unique });
    // Until the catalog has the key, `t` hands the key back; fall back to English.
    return label === 'ui.dockviewTab.tablistLabel' ? `${unique} tabs` : label;
  }, [api, containerApi, contentType, t]);
  useDockviewTabA11y(contentRef, api as never, accessibleName ?? '', uiDir === 'rtl', {
    onClose: groupTabCount > 1 ? closeFromKeyboard : undefined,
    onDidLayoutChange,
    tablistLabel: getTablistLabel,
    onOpenMenu: openMenuFromKeyboard,
  });

  const handleToggleSearchPin = () => {
    setContextMenu(null);
    // allow-getstate: event handler - imperative store action
    useSearchStore.getState().pinSession(api.id);
  };

  const handleOpenInNewSearchTab = () => {
    setContextMenu(null);
    // allow-getstate: event handler - imperative store action
    void useSearchStore.getState().openSessionInNewTab(api.id);
  };

  const panelCount = containerApi.panels.length;
  const canPopOut = !!contentType && !!popOutPaneTypeFor(contentType);
  // Splitting moves this tab into a new group; from a group's only tab that would leave an
  // empty group behind, so it is offered only when the group holds another tab.
  const canSplit = groupTabCount > 1;
  const splitHint = canSplit ? undefined : translateOr(t, 'ui.dockviewTab.splitNeedsTwoTabs', 'Needs another tab in this group');

  return (
    <>
      <div
        ref={contentRef}
        className="dockview-tab-content"
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        onDoubleClick={isSearchTab ? () => { if (searchIsPreview) handleToggleSearchPin(); } : undefined}
        data-search-preview={isSearchTab ? (searchIsPreview ? 'true' : 'false') : undefined}
        style={{
          fontStyle: searchIsPreview && searchQuery ? 'italic' : undefined,
          display: 'flex',
          alignItems: 'center',
          // Every literal here is scaled by the same ratio as the font, so the
          // tab grows with the "UI Control Font Size" slider instead of being
          // squeezed against a fixed 38px strip. The extra bottom padding
          // clears the baseline rule (see TAB_STRIP_BORDER_WIDTH).
          gap: controlScaled(6),
          // The bottom is the baseline's thickness plus a 1px-at-default gap,
          // which reproduces exactly the clearance the old `3px` had over the
          // old 2px rule. The strip therefore grows only by the extra border
          // weight, not by the whole padding.
          padding: `${controlScaled(6)} ${controlScaled(12)} calc(${controlScaled(1)} + ${TAB_STRIP_BORDER_WIDTH})`,
          height: '100%',
          // `cursor` is not set here on purpose: an inline pointer on this
          // element only covered the label, so the bare part of `.dv-tab`
          // around it fell back to the default arrow. It is a stylesheet rule
          // on `.dv-tab` now (see TAB CURSOR in dockview-overrides.css) so the
          // whole tab reads as clickable from any approach direction.
          fontSize: controlScaled(14),
          whiteSpace: 'nowrap',
          color: 'var(--theme-text-primary)',
        }}
      >
        {icon && <span style={{ fontSize: controlScaled(12), alignSelf: subtitle ? 'flex-start' : undefined }}>{icon}</span>}
        {subtitle ? (
          <div className="dockview-tab-text" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span className="dockview-tab-title" style={{ fontWeight: 600 }} title={isSearchTab && searchQuery ? searchQuery : undefined}><Bdi>{title}</Bdi></span>
            <span className="dockview-tab-title" style={{ fontSize: controlScaled(10), color: 'var(--theme-text-secondary)', fontWeight: 400 }}><Bdi>{subtitle}</Bdi></span>
          </div>
        ) : (
          <span className="dockview-tab-title" title={isSearchTab && searchQuery ? searchQuery : undefined}><Bdi>{title}</Bdi></span>
        )}
        {badge !== undefined && (
          <span
            data-testid="panel-tab-badge"
            style={{
              fontSize: controlScaled(10),
              fontWeight: 600,
              lineHeight: 1,
              padding: `${controlScaled(1)} ${controlScaled(5)}`,
              borderRadius: controlScaled(8),
              background: 'var(--theme-accent-primary)',
              color: 'var(--theme-accent-text)',
            }}
          >
            {badge}
          </span>
        )}
        {groupTabCount > 1 && (
          <button
            onClick={handleClose}
            data-testid="close-tab"
            tabIndex={-1}
            aria-label={t('bookPane.closeTabLabel', { name: title ?? '' })}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: controlScaled(16),
              height: controlScaled(16),
              marginInlineStart: controlScaled(2),
              border: 'none',
              background: 'transparent',
              borderRadius: '3px',
              cursor: 'pointer',
              color: 'var(--theme-text-secondary)',
              fontSize: controlScaled(12),
              lineHeight: 1,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-tab-bg-hover)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            }}
            title={t('ui.dockviewTab.closePanel')}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>

      {/* Context Menu (rendered via portal to escape dockview's overflow/transform clipping) */}
      {contextMenu && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('ui.dockviewTab.contextMenuLabel')}
          data-testid="dockview-tab-context-menu"
          style={{
            position: 'fixed',
            ...anchorAtPointer(contextMenu.x, 180, window.innerWidth, uiDir),
            top: contextMenu.y,
            zIndex: 10000,
            minWidth: '180px',
            backgroundColor: 'var(--theme-bg-primary)',
            border: '1px solid var(--theme-border-primary)',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            padding: '4px 0',
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={handleMenuKeyDown}
        >
          {isSearchTab && searchQuery && (
            <>
              <ContextMenuItem label={searchPinned ? t('searchTabs.unpin') : t('searchTabs.pin')} onClick={handleToggleSearchPin} testId="search-tab-pin" />
              <ContextMenuItem label={t('searchTabs.openInNewTab')} onClick={handleOpenInNewSearchTab} testId="search-tab-open-in-new-tab" />
              <div style={{ height: '1px', backgroundColor: 'var(--theme-border-primary)', margin: '4px 0' }} />
            </>
          )}
          <ContextMenuItem label={t('ui.dockviewTab.splitRight')} onClick={handleSplitRight} disabled={!canSplit} hint={splitHint} />
          <ContextMenuItem label={t('ui.dockviewTab.splitDown')} onClick={handleSplitDown} disabled={!canSplit} hint={splitHint} />
          {canPopOut && (
            <>
              <div style={{ height: '1px', backgroundColor: 'var(--theme-border-primary)', margin: '4px 0' }} />
              <ContextMenuItem label={t('ui.dockviewTab.popOutToWindow')} onClick={handlePopOut} />
            </>
          )}
          {panelCount > 1 && (
            <>
              <div style={{ height: '1px', backgroundColor: 'var(--theme-border-primary)', margin: '4px 0' }} />
              <ContextMenuItem label={t('ui.dockviewTab.close')} onClick={handleCloseContext} />
            </>
          )}
        </div>,
        document.body
      )}
    </>
  );
};

/** Simple context menu item */
/** `t` hands the key back until the catalog has it: fall back to English. */
function translateOr(t: (key: string) => string, key: string, fallback: string): string {
  const v = t(key);
  return v === key ? fallback : v;
}

const ContextMenuItem: React.FC<{
  label: string;
  onClick: () => void;
  /** Stays focusable (aria-disabled) so keyboard users can reach it and read the hint. */
  disabled?: boolean;
  hint?: string;
  testId?: string;
}> = ({ label, onClick, disabled = false, hint, testId }) => (
  <button
    role="menuitem"
    data-testid={testId}
    aria-disabled={disabled || undefined}
    title={disabled ? hint : undefined}
    onClick={disabled ? (e) => e.preventDefault() : onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      padding: '5px 12px',
      border: 'none',
      background: 'transparent',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      fontSize: controlScaled(13),
      color: 'var(--theme-text-primary)',
      textAlign: 'start',
    }}
    onMouseEnter={(e) => {
      if (disabled) return;
      (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-tab-bg-hover)';
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
    }}
  >
    <span>{label}</span>
  </button>
);

export default DockviewTabRenderer;
