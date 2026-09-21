import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useOverlayDismissal } from '../hooks/useOverlayDismissal';
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
import { localizePaneLabel } from '../utils/paneNames';
import { anchorAtPointerX } from '../utils/overlayPosition';
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

/**
 * A literal chrome size, expressed so it still resolves to exactly that
 * literal at the default setting but tracks the "UI Control Font Size" slider
 * and the global font scale.
 *
 * These sizes are inline styles, which outrank any stylesheet - so the CSS
 * rule for `.dockview-tab-content` could not scale the tab strip no matter how
 * it was written, and the slider appeared to do nothing. Scaling each literal
 * by the same ratio also keeps the hierarchy: a 10px subtitle stays visibly
 * smaller than its 14px title at every slider position, which a single
 * inherited font-size would flatten. Same approach as `uiScaled()` in
 * StudyPane.tsx.
 */
function controlScaled(px: number): string {
  const ratio = px / DEFAULT_UI_CONTROL_FONT_SIZE;
  return `calc(var(--ui-control-font-size, ${DEFAULT_UI_CONTROL_FONT_SIZE}px) * ${ratio} * var(--global-font-scale, 1))`;
}

/** The slider's default, and the size every literal below is a ratio of. */
const DEFAULT_UI_CONTROL_FONT_SIZE = 14;

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
  const subtitle = localizePaneLabel(t, contentType, dynamicSubtitle || staticSubtitle);
  const icon = tabIconFor(contentType);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
  const title = localizePaneLabel(t, contentType, storedTitle) ?? storedTitle;

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    api.close();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      api.close();
    }
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // Close context menu on outside click or Escape
  const dismissContextMenu = useCallback(() => setContextMenu(null), []);
  useOverlayDismissal(!!contextMenu, dismissContextMenu);

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
    api.close();
  };

  const panelCount = containerApi.panels.length;
  const canPopOut = !!contentType && !!POP_OUT_PANE_TYPE[contentType];

  return (
    <>
      <div
        className="dockview-tab-content"
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        style={{
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
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{ fontWeight: 600 }}>{title}</span>
            <span style={{ fontSize: controlScaled(10), color: 'var(--theme-text-secondary)', fontWeight: 400 }}>{subtitle}</span>
          </div>
        ) : (
          <span>{title}</span>
        )}
        {groupTabCount > 1 && (
          <button
            onClick={handleClose}
            data-testid="close-tab"
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
            ×
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
            ...anchorAtPointerX(contextMenu.x),
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
        >
          <ContextMenuItem label={t('ui.dockviewTab.splitRight')} onClick={handleSplitRight} />
          <ContextMenuItem label={t('ui.dockviewTab.splitDown')} onClick={handleSplitDown} />
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
const ContextMenuItem: React.FC<{
  label: string;
  onClick: () => void;
}> = ({ label, onClick }) => (
  <button
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
      padding: '5px 12px',
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      fontSize: controlScaled(13),
      color: 'var(--theme-text-primary)',
      textAlign: 'start',
    }}
    onMouseEnter={(e) => {
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
