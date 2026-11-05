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
    /** Accessible name for the strip's tablist (set once, if it has none). */
    tablistLabel?: string;
  } = {},
): void {
  const { onClose, onDidLayoutChange, tablistLabel } = extras;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const host = contentRef.current?.closest<HTMLElement>('.dv-tab');
    if (!host) return;
    const strip = host.closest<HTMLElement>('.dv-tabs-container');
    if (strip && !strip.hasAttribute('role')) strip.setAttribute('role', 'tablist');
    if (strip && tablistLabel && !strip.hasAttribute('aria-label')) strip.setAttribute('aria-label', tablistLabel);
    host.setAttribute('role', 'tab');
    if (label) host.setAttribute('aria-label', label);
    // `api.isActive` means "active panel of the *focused* group", so reading it
    // un-selected the visible tab of every other group. A tablist's selected
    // tab is its group's active panel, whichever group has focus.
    const syncSelected = (): void => {
      const groupActive = api.group?.activePanel;
      const selected = groupActive && api.id !== undefined ? groupActive.id === api.id : !!api.isActive;
      host.setAttribute('aria-selected', String(selected));
    };
    syncSelected();
    const subs = [
      api.onDidActiveChange?.(syncSelected),
      api.onDidVisibilityChange?.(syncSelected),
      api.onDidGroupChange?.(syncSelected),
      onDidLayoutChange?.(syncSelected),
    ];

    const onKeyDown = (e: KeyboardEvent): void => {
      // Keys aimed at the close button inside the tab keep their own meaning.
      if (e.target !== host) return;
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
      const tabs = Array.from(
        (strip ?? host.parentElement)?.querySelectorAll<HTMLElement>('.dv-tab') ?? [],
      );
      const i = tabs.indexOf(host);
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
    host.addEventListener('keydown', onKeyDown);
    return () => {
      host.removeEventListener('keydown', onKeyDown);
      subs.forEach(sub => sub?.dispose());
    };
  }, [contentRef, api, label, isRtl, onDidLayoutChange, tablistLabel]);
}
