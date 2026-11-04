import { useEffect } from 'react';
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
    isActive?: boolean;
    onDidActiveChange?: (cb: () => void) => { dispose(): void };
  },
  label: string,
  isRtl: boolean,
): void {
  useEffect(() => {
    const host = contentRef.current?.closest<HTMLElement>('.dv-tab');
    if (!host) return;
    const strip = host.closest<HTMLElement>('.dv-tabs-container');
    if (strip && !strip.hasAttribute('role')) strip.setAttribute('role', 'tablist');
    host.setAttribute('role', 'tab');
    if (label) host.setAttribute('aria-label', label);
    const syncSelected = (): void => host.setAttribute('aria-selected', String(!!api.isActive));
    syncSelected();
    const sub = api.onDidActiveChange?.(syncSelected);

    const onKeyDown = (e: KeyboardEvent): void => {
      // Keys aimed at the close button inside the tab keep their own meaning.
      if (e.target !== host) return;
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
      sub?.dispose();
    };
  }, [contentRef, api, label, isRtl]);
}
