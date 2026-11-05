import { useEffect, useRef } from 'react';
import type { DockviewPanelApi } from 'dockview-react';

/**
 * Gives a dockview tab real tab semantics and keyboard support.
 *
 * Dockview renders each tab as `div.dv-tab[tabindex=0]` around our custom
 * content, and only activates it on pointer events. Our content element can
 * reach its `.dv-tab` host and the strip (`.dv-tabs-container`), so from there
 * we add what WAI-ARIA's tabs pattern needs: role=tablist on the strip,
 * role=tab + aria-selected on each tab, Enter/Space to activate, and
 * Left/Right (logical) / Home / End to move focus between the group's tabs.
 * Roving tabindex is deliberately not used: the strip also holds the close
 * buttons, and dockview owns the tabindex.
 */
export function useDockviewTabA11y(
  contentRef: React.RefObject<HTMLElement | null>,
  api: Pick<DockviewPanelApi, 'setActive'> & {
    id?: string;
    isActive?: boolean;
    group?: { activePanel?: { id: string } };
    onDidActiveChange?: (cb: () => void) => { dispose(): void };
    onDidVisibilityChange?: (cb: () => void) => { dispose(): void };
    onDidGroupChange?: (cb: () => void) => { dispose(): void };
    onDidParametersChange?: (cb: () => void) => { dispose(): void };
  },
  label: string,
  isRtl: boolean,
  extras: {
    /**
     * Closes the tab. The close button inside a tab is taken out of the tab
     * order (it cannot be un-nested from dockview's tab element), so Delete on
     * the focused tab is its keyboard equivalent. Omitted when the tab cannot
     * be closed by the button either (a lone tab in its group).
     */
    onClose?: () => void;
    /** Layout-change subscription, to re-sync after a restore / split. */
    onDidLayoutChange?: (cb: () => void) => { dispose(): void };
    /**
     * Accessible name for the strip's tablist. A function is re-evaluated on
     * every sync, so the name follows the group (a tab moved into a new group,
     * a panel whose kind changed). Every tab of a group must return the same
     * name, since they all write the one strip.
     */
    tablistLabel?: string | (() => string | undefined);
    /**
     * Opens the tab's actions menu from the keyboard (Shift+F10 / the Menu
     * key on the focused tab), anchored to the tab's rectangle.
     */
    onOpenMenu?: (anchor: DOMRect) => void;
  } = {},
): void {
  const { onClose, onDidLayoutChange, tablistLabel, onOpenMenu } = extras;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onOpenMenuRef = useRef(onOpenMenu);
  onOpenMenuRef.current = onOpenMenu;
  useEffect(() => {
    // dockview can recreate or move the `.dv-tab` element (a split, a drag
    // into another group, a restore) without re-running this effect, so the
    // host and strip are looked up again on every sync rather than captured
    // once, and the key handler follows the host.
    let host: HTMLElement | null = null;
    let detachKeys: (() => void) | null = null;
    let disposed = false;

    const onKeyDown = (e: KeyboardEvent): void => {
      const current = host;
      if (!current) return;
      // Keys aimed at the close button inside the tab keep their own meaning.
      if (e.target !== current) return;
      if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && onOpenMenuRef.current) {
        e.preventDefault();
        onOpenMenuRef.current(current.getBoundingClientRect());
        return;
      }
      if (e.key === 'Delete' && onCloseRef.current) {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        api.setActive();
        return;
      }
      const strip = current.closest<HTMLElement>('.dv-tabs-container');
      const tabs = Array.from(
        (strip ?? current.parentElement)?.querySelectorAll<HTMLElement>('.dv-tab') ?? [],
      );
      const i = tabs.indexOf(current);
      if (i < 0) return;
      let next = -1;
      const fwd = isRtl ? 'ArrowLeft' : 'ArrowRight';
      const back = isRtl ? 'ArrowRight' : 'ArrowLeft';
      if (e.key === fwd) next = (i + 1) % tabs.length;
      else if (e.key === back) next = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = tabs.length - 1;
      if (next < 0) return;
      e.preventDefault();
      tabs[next].focus();
    };

    /** Returns false when the tab's host element is not in the DOM yet. */
    const sync = (): boolean => {
      const found = contentRef.current?.closest<HTMLElement>('.dv-tab') ?? null;
      if (!found) return false;
      if (found !== host) {
        detachKeys?.();
        host = found;
        found.addEventListener('keydown', onKeyDown);
        detachKeys = () => found.removeEventListener('keydown', onKeyDown);
      }
      const strip = found.closest<HTMLElement>('.dv-tabs-container');
      if (strip) {
        if (!strip.hasAttribute('role')) strip.setAttribute('role', 'tablist');
        const name = typeof tablistLabel === 'function' ? tablistLabel() : tablistLabel;
        if (name && strip.getAttribute('aria-label') !== name) strip.setAttribute('aria-label', name);
      }
      found.setAttribute('role', 'tab');
      if (label) found.setAttribute('aria-label', label);
      // `api.isActive` means "active panel of the *focused* group", so reading it
      // un-selected the visible tab of every other group. A tablist's selected
      // tab is its group's active panel, whichever group has focus.
      const groupActive = api.group?.activePanel;
      const selected = groupActive && api.id !== undefined ? groupActive.id === api.id : !!api.isActive;
      found.setAttribute('aria-selected', String(selected));
      return true;
    };

    // Events can fire before dockview has finished moving the element, so each
    // one syncs now and once more after the next frame.
    let raf = 0;
    const syncSoon = (): void => {
      sync();
      if (typeof requestAnimationFrame !== 'function') return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!disposed) sync();
      });
    };

    // The host may not be attached when the component first mounts (a tab
    // created by a split); retry for a few frames.
    if (!sync() && typeof requestAnimationFrame === 'function') {
      let tries = 0;
      const retry = (): void => {
        if (disposed || sync() || ++tries > 30) return;
        raf = requestAnimationFrame(retry);
      };
      raf = requestAnimationFrame(retry);
    }

    const subs = [
      api.onDidActiveChange?.(syncSoon),
      api.onDidVisibilityChange?.(syncSoon),
      api.onDidGroupChange?.(syncSoon),
      api.onDidParametersChange?.(syncSoon),
      onDidLayoutChange?.(syncSoon),
    ];

    return () => {
      disposed = true;
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      detachKeys?.();
      subs.forEach(sub => sub?.dispose());
    };
  }, [contentRef, api, label, isRtl, onDidLayoutChange, tablistLabel]);
}

interface FocusablePanel {
  id: string;
  group?: GroupLike;
}
interface GroupLike {
  element?: HTMLElement;
  panels: Array<{ id: string }>;
  activePanel?: { id: string };
}
interface ContainerLike {
  groups?: GroupLike[];
  activeGroup?: GroupLike;
  getPanel?: (id: string) => FocusablePanel | undefined;
}

/** Focus the tab element of `panelId` inside `group`. */
function focusTabIn(group: GroupLike | undefined, panelId: string | undefined): boolean {
  if (!group?.element || !panelId) return false;
  const i = group.panels.findIndex(p => p.id === panelId);
  if (i < 0) return false;
  const tab = group.element.querySelectorAll<HTMLElement>('.dv-tab')[i];
  if (!tab) return false;
  tab.focus();
  return document.activeElement === tab;
}

/**
 * Put keyboard focus on the tab that is active in `group` (or, when that group
 * is gone, in the workbench's active group). Closing a tab or splitting it into
 * a new group removes the focused element, and focus would otherwise fall to
 * the page and be "rescued" onto the first pane's heading.
 *
 * Tries at once (so focus never rests on the page) and again after the next
 * frames, for tabs whose elements dockview creates asynchronously. Later
 * attempts only run while focus is still lost.
 */
export function focusActiveTabOfGroup(container: ContainerLike | undefined, group?: GroupLike, panelId?: string): void {
  const attempt = (): boolean => {
    const live = group && container?.groups?.includes(group) ? group : container?.activeGroup;
    if (!live) return false;
    return focusTabIn(live, panelId && live.panels.some(p => p.id === panelId) ? panelId : live.activePanel?.id);
  };
  attempt();
  if (typeof requestAnimationFrame !== 'function') return;
  const lost = (): boolean => {
    const a = document.activeElement;
    return !a || a === document.body || !a.isConnected;
  };
  requestAnimationFrame(() => {
    if (lost()) attempt();
    requestAnimationFrame(() => {
      if (lost()) attempt();
    });
  });
}

/** Focus the tab of an existing panel, wherever it now lives (after a split). */
export function focusPanelTab(container: ContainerLike | undefined, panelId: string): void {
  const panel = container?.getPanel?.(panelId);
  focusActiveTabOfGroup(container, panel?.group, panelId);
}
