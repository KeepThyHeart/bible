import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { IDockviewHeaderActionsProps } from 'dockview-react';
import { isLeftRightTwoPaneLayout, useLayoutStore } from '../stores/useLayoutStore';
import { useI18n } from '../contexts/useI18n';

/**
 * Chevron button for scrolling tabs. Flush with the tab row, with a
 * disabled/faded look when there is no more content in that direction.
 *
 * Note on `alignSelf: 'stretch'` (used by every control in this file): the tab
 * strip no longer has a fixed height - `dockview-overrides.css` gives
 * `.dv-tabs-and-actions-container` `height: auto` so a large "UI Control Font
 * Size" cannot clip a two-line tab. `height: '100%'` against a parent whose
 * height is `auto` is a percentage with nothing to resolve against, so these
 * controls stretch to the row explicitly instead.
 */
const ChevronButton: React.FC<{
  direction: 'left' | 'right';
  enabled: boolean;
  onClick: () => void;
}> = ({ direction, enabled, onClick }) => (
  <button
    onClick={enabled ? onClick : undefined}
    title={enabled ? `Scroll tabs ${direction}` : undefined}
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '30px',
      alignSelf: 'stretch',
      margin: 0,
      border: 'none',
      borderInlineStart: '1px solid var(--theme-border, #ccc)',
      borderInlineEnd: '1px solid var(--theme-border, #ccc)',
      borderRadius: 0,
      background: enabled ? 'var(--theme-bg-primary, #fff)' : 'transparent',
      cursor: enabled ? 'pointer' : 'default',
      color: enabled ? 'var(--theme-text-secondary)' : 'var(--theme-text-secondary)',
      opacity: enabled ? 1 : 0.55,
      fontSize: '18px',
      fontWeight: 300,
      lineHeight: 1,
      flexShrink: 0,
      padding: 0,
      transition: 'color 0.15s, opacity 0.15s, background-color 0.15s',
    }}
    onMouseEnter={(e) => {
      if (enabled) {
        (e.currentTarget as HTMLElement).style.color = 'var(--theme-text-primary)';
        (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-tab-bg-hover, #e8e8e8)';
      }
    }}
    onMouseLeave={(e) => {
      (e.currentTarget as HTMLElement).style.color = enabled
        ? 'var(--theme-text-secondary)' : 'var(--theme-border, #ccc)';
      (e.currentTarget as HTMLElement).style.backgroundColor = enabled
        ? 'var(--theme-bg-primary, #fff)' : 'transparent';
    }}
  >
    {direction === 'left' ? '\u2039' : '\u203A'}
  </button>
);

/**
 * Right-side header actions component for dockview groups.
 * Renders scroll chevrons (when tabs overflow) and a "+" button.
 */
const DockviewHeaderActions: React.FC<IDockviewHeaderActionsProps> = ({ containerApi, group }) => {
  const { t } = useI18n();
  const collapsedGroups = useLayoutStore(s => s.collapsedGroups);
  const expandCollapsedGroups = useLayoutStore(s => s.expandCollapsedGroups);
  const actionsRef = useRef<HTMLDivElement>(null);
  const tabsContainerRef = useRef<HTMLElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [leftPortalContainer, setLeftPortalContainer] = useState<HTMLElement | null>(null);
  const [collapsePortalContainer, setCollapsePortalContainer] = useState<HTMLElement | null>(null);
  /** Host inside the scrollable tab list that the "+" button renders into. */
  const [addPortalContainer, setAddPortalContainer] = useState<HTMLElement | null>(null);
  const [groupCount, setGroupCount] = useState(0);
  const [isLeftRightSplit, setIsLeftRightSplit] = useState(false);

  // How many groups the workbench has, kept live. dockview does not re-render
  // this component when a group is added or removed elsewhere, so the collapse
  // button's "would this hide the last pane?" test cannot read
  // `containerApi.groups` at render time and be trusted.
  useEffect(() => {
    if (!containerApi) return;
    const update = (): void => {
      const groups = containerApi.groups.length;
      setGroupCount(groups);
      // `toJSON()` walks the whole layout, so only ask when the answer could
      // possibly be yes. This runs on every layout change, resizes included.
      if (groups !== 2 || typeof containerApi.toJSON !== 'function') {
        setIsLeftRightSplit(false);
        return;
      }
      try {
        setIsLeftRightSplit(isLeftRightTwoPaneLayout(containerApi.toJSON().grid));
      } catch {
        // A layout mid-mutation can fail to serialize; treat that as "not the
        // simple two-pane case" rather than showing a control that may be wrong.
        setIsLeftRightSplit(false);
      }
    };
    update();
    const disposable = containerApi.onDidLayoutChange(update);
    return () => disposable.dispose();
  }, [containerApi]);

  // Find the .dv-tabs-container sibling in the DOM and track overflow state
  useEffect(() => {
    const actionsEl = actionsRef.current;
    if (!actionsEl) return;

    // Walk up to .dv-tabs-and-actions-container, then find .dv-tabs-container
    const header = actionsEl.closest('.dv-tabs-and-actions-container');
    const tabsContainer = header?.querySelector('.dv-tabs-container') as HTMLElement | null;
    if (!tabsContainer || !header) return;
    tabsContainerRef.current = tabsContainer;

    // Host for the "+" button, parked as the LAST child of the tabs list so it
    // scrolls with the tabs instead of occupying fixed header width. Safe to
    // sit there: dockview inserts a tab with
    // `insertBefore(el, children[index])` where `index <= tabs.size`, and with
    // this host present `children.length === tabs.size + 1`, so `children[index]`
    // is always a real node and every tab lands *before* the host. The
    // MutationObserver below re-appends it if anything ever changes that.
    const addHost = document.createElement('div');
    addHost.className = 'app-add-tab-host';
    addHost.style.display = 'flex';
    addHost.style.alignItems = 'stretch';
    addHost.style.flexShrink = '0';
    tabsContainer.appendChild(addHost);
    setAddPortalContainer(addHost);

    // Create portal container for the left chevron, inserted as first child of header
    const portalDiv = document.createElement('div');
    portalDiv.style.display = 'flex';
    portalDiv.style.alignItems = 'stretch';
    portalDiv.style.flexShrink = '0';
    header.insertBefore(portalDiv, header.firstChild);
    setLeftPortalContainer(portalDiv);

    // Host for the collapse chevron at the far end of the header. It cannot
    // simply live in this component's own (right-actions) container: that
    // container is ordered back next to the last tab so the "+" button stays
    // there, and the chevron has to be pinned to the panel's outer edge the way
    // the web app pins it (`margin-left: auto` on
    // `.right-pane-tabs__collapse`). `order: 2` - set in dockview-overrides.css
    // via the class below - puts it after the void container.
    const collapseHost = document.createElement('div');
    collapseHost.className = 'app-collapse-action-host';
    collapseHost.style.display = 'flex';
    collapseHost.style.alignItems = 'stretch';
    collapseHost.style.flexShrink = '0';
    header.appendChild(collapseHost);
    setCollapsePortalContainer(collapseHost);

    const updateScrollState = () => {
      const { scrollLeft, scrollWidth, clientWidth } = tabsContainer;
      setCanScrollLeft(scrollLeft > 1);
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
    };

    // Initial check
    updateScrollState();

    // Listen for scroll events
    tabsContainer.addEventListener('scroll', updateScrollState, { passive: true });

    // Watch for size changes (tabs added/removed, window resize)
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(tabsContainer);

    // Also watch for child changes (tabs added/removed)
    const mutationObserver = new MutationObserver(() => {
      // Keep the "+" host last. Nothing dockview does should displace it (see
      // the note where it is created), but the invariant is what makes tab
      // insertion indices correct, so it is restored rather than assumed.
      if (addHost.parentNode === tabsContainer && tabsContainer.lastChild !== addHost) {
        tabsContainer.appendChild(addHost);
      }
      updateScrollState();
    });
    mutationObserver.observe(tabsContainer, { childList: true, subtree: true });

    return () => {
      tabsContainer.removeEventListener('scroll', updateScrollState);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      tabsContainerRef.current = null;
      portalDiv.remove();
      setLeftPortalContainer(null);
      collapseHost.remove();
      setCollapsePortalContainer(null);
      addHost.remove();
      setAddPortalContainer(null);
    };
  }, [group]);

  const getScrollAmount = useCallback(() => {
    const el = tabsContainerRef.current;
    if (!el) return 300;
    // Use the .dv-scrollable parent's clientWidth as the visible viewport
    const parentWidth = el.parentElement?.clientWidth ?? 0;
    // Fallback: if parent is tiny or missing, use the element's own clientWidth
    const visibleWidth = parentWidth > 50 ? parentWidth : el.clientWidth;
    return Math.max(visibleWidth * 0.8, 200);
  }, []);

  const scrollLeft = useCallback(() => {
    const el = tabsContainerRef.current;
    if (!el) return;
    const amount = getScrollAmount();
    // Direct assignment - avoids smooth-scroll being cancelled by dockview
    el.scrollLeft = Math.max(0, el.scrollLeft - amount);
  }, [getScrollAmount]);

  const scrollRight = useCallback(() => {
    const el = tabsContainerRef.current;
    if (!el) return;
    const amount = getScrollAmount();
    el.scrollLeft = el.scrollLeft + amount;
  }, [getScrollAmount]);

  const handleAddTab = useCallback(() => {
    const panelId = useLayoutStore.getState().addPanel( // allow-getstate: event handler - imperative panel creation
      'newtab',
      undefined,
      'New Tab',
      { referenceGroup: group, direction: 'within' },
    );

    if (!panelId && containerApi) {
      console.warn('[DockviewHeaderActions] Store addPanel failed, using containerApi fallback');
      const fallbackId = `newtab_${Date.now()}`;
      try {
        containerApi.addPanel({
          id: fallbackId,
          component: 'panelContent',
          title: 'New Tab',
          params: { contentType: 'newtab' },
          position: { referenceGroup: group, direction: 'within' },
        });
        useLayoutStore.getState().registerPanel({ // allow-getstate: dockview event callback - runs outside React render
          panelId: fallbackId,
          contentType: 'newtab',
          displayName: 'New Tab',
        });
        useLayoutStore.getState().setDockviewApi(containerApi); // allow-getstate: dockview event callback - runs outside React render
      } catch (err) {
        console.error('[DockviewHeaderActions] Fallback addPanel also failed:', err);
      }
    }
  }, [containerApi, group]);

  const handleCollapse = useCallback(() => {
    useLayoutStore.getState().collapseGroup(group.id); // allow-getstate: event handler - imperative layout mutation
  }, [group]);

  const hasOverflow = canScrollLeft || canScrollRight;

  const isCollapsed = collapsedGroups.some(c => c.groupId === group.id);

  // A collapsed group has zero width, so its own header cannot carry the
  // control that brings it back. The visible groups host it instead - in
  // Reading Mode, the only preset that collapses anything, there is exactly one.
  const showExpandButton = collapsedGroups.length > 0 && !isCollapsed;

  // Collapsing is available at any time, not only as a side effect of Reading
  // Mode - mirroring the web app's collapse chevron in the right-pane tab bar.
  //
  // Offered ONLY in the plain two-pane, left/right arrangement. See
  // `isLeftRightTwoPaneLayout` for the exact definition (serialized grid: a
  // HORIZONTAL root branch with exactly two leaf children). Outside that shape
  // "collapse this pane out of the way" has no obvious meaning - there is
  // nothing to collapse towards with one pane, the width axis the collapse and
  // restore paths hard-code is the wrong one for a vertical stack, and in a 2x2
  // grid the gesture is ambiguous - which is exactly the web behaviour this
  // mirrors, where the chevron belongs to the right panel of a two-panel
  // layout.
  //
  // Still also hidden when this group is the last visible one: `collapseGroup`
  // would refuse anyway (see `canCollapseGroup`), and an inert button is worse
  // than no button.
  const showCollapseButton = !isCollapsed && isLeftRightSplit && groupCount - collapsedGroups.length > 1;

  const addTabButton = (
    <button
      onClick={handleAddTab}
      // Anchor for the guided tour's "add a pane" step. Every group renders
      // one of these; the tour spotlights whichever the document finds first.
      data-tour-anchor="add-pane"
      title={t('ui.dockviewHeaderActions.newTab')}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '32px',
        alignSelf: 'stretch',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        color: 'var(--theme-text-secondary)',
        fontSize: '18px',
        lineHeight: 1,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-tab-bg-hover)';
        (e.currentTarget as HTMLElement).style.color = 'var(--theme-text-primary)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
        (e.currentTarget as HTMLElement).style.color = 'var(--theme-text-secondary)';
      }}
    >
      +
    </button>
  );

  const collapseButton = showCollapseButton ? (
    <button
      onClick={handleCollapse}
      data-testid="collapse-pane"
      title={t('layout.collapsePane.tooltip')}
      aria-label={t('layout.collapsePane.tooltip')}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '32px',
        alignSelf: 'stretch',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        color: 'var(--theme-text-secondary)',
        lineHeight: 1,
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-tab-bg-hover)';
        (e.currentTarget as HTMLElement).style.color = 'var(--theme-text-primary)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
        (e.currentTarget as HTMLElement).style.color = 'var(--theme-text-secondary)';
      }}
    >
      {/* Right-facing chevron, matching the web app's `fa-chevron-right` in
          `.right-pane-tabs__collapse`. Physical direction on purpose: the
          collapsed group is revealed again from the right edge of the
          workbench, and dockview's grid never mirrors for RTL (see the RTL
          section of styles/dockview-overrides.css). */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  ) : null;

  return (
    <div ref={actionsRef} style={{ display: 'flex', alignItems: 'stretch', alignSelf: 'stretch' }}>
      {showExpandButton && (
        <button
          onClick={expandCollapsedGroups}
          data-testid="expand-collapsed-panes"
          title={t('layout.expandCollapsed.tooltip')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            alignSelf: 'stretch',
            padding: '0 10px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--theme-text-secondary)',
            fontSize: '12px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-tab-bg-hover)';
            (e.currentTarget as HTMLElement).style.color = 'var(--theme-text-primary)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
            (e.currentTarget as HTMLElement).style.color = 'var(--theme-text-secondary)';
          }}
        >
          <span aria-hidden="true">{'«'}</span>
          <span>{t('layout.expandCollapsed.label')}</span>
        </button>
      )}

      {/* Collapse chevron - portaled to the far edge of the header so it sits
          against the panel's outer border (the "+" and scroll chevrons stay
          next to the last tab). Rendered inline when the portal host is not
          available, e.g. outside dockview's header DOM in a component test. */}
      {collapseButton && (collapsePortalContainer
        ? createPortal(collapseButton, collapsePortalContainer)
        : collapseButton)}

      {/* Left chevron - portaled to far left of tab row */}
      {hasOverflow && leftPortalContainer && createPortal(
        <ChevronButton direction="left" enabled={canScrollLeft} onClick={scrollLeft} />,
        leftPortalContainer,
      )}

      {/* Right chevron - stays in right actions area */}
      {hasOverflow && (
        <ChevronButton direction="right" enabled={canScrollRight} onClick={scrollRight} />
      )}

      {/* Add tab button - portaled into the scrollable tab list so it sits after
          the last tab and scrolls with them, rather than holding 32px of the
          header open permanently. Rendered inline when the portal host is not
          available, e.g. outside dockview's header DOM in a component test. */}
      {addPortalContainer
        ? createPortal(addTabButton, addPortalContainer)
        : addTabButton}
    </div>
  );
};

export default DockviewHeaderActions;