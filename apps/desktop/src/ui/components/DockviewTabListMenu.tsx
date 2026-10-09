import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DockviewGroupPanel } from 'dockview-react';
import type { PanelContentType } from '../stores/useLayoutStore';
import { useLayoutStore } from '../stores/useLayoutStore';
import { useI18n } from '../contexts/useI18n';
import { useOverlayDismissal } from '../hooks/useOverlayDismissal';
import { localizePaneLabel } from '../utils/paneNames';
import { isDocumentRtl } from '../utils/overlayPosition';
import { tabIconFor } from './paneIcons';

/**
 * "All tabs" button for a pane whose tabs overflow the strip, and the menu it
 * opens: every tab in the group, the active one marked, click to switch.
 *
 * dockview has an overflow dropdown of its own (hidden in
 * dockview-overrides.css), but it lists only the tabs scrolled out of view and
 * renders each with the full tab component, close button included. A list of
 * every tab is easier to scan and does not change as the strip scrolls.
 */
const DockviewTabListMenu: React.FC<{ group: DockviewGroupPanel }> = ({ group }) => {
  const { t } = useI18n();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  useOverlayDismissal(!!anchor, close);

  // Put focus on the active tab's row, so arrow keys start from there.
  useEffect(() => {
    if (!anchor) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    const active = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (active ?? items?.[0])?.focus();
  }, [anchor]);

  const toggle = (): void => {
    setAnchor(prev => (prev ? null : buttonRef.current?.getBoundingClientRect() ?? null));
  };

  const onMenuKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? index + 1 : index - 1;
    items[(next + items.length) % items.length]?.focus();
  };

  const label = t('ui.dockviewHeaderActions.tabList');

  return (
    <>
      <button
        ref={buttonRef}
        onClick={toggle}
        data-testid="tab-list-button"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '30px',
          alignSelf: 'stretch',
          border: 'none',
          borderInlineEnd: '1px solid var(--theme-border, #ccc)',
          background: anchor ? 'var(--theme-tab-bg-hover)' : 'transparent',
          cursor: 'pointer',
          color: 'var(--theme-text-secondary)',
          lineHeight: 1,
          flexShrink: 0,
          padding: 0,
        }}
        onMouseDown={(e) => {
          // Keep the document-level dismissal from closing the menu just
          // before this click toggles it open again.
          if (anchor) e.stopPropagation();
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {anchor && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          data-testid="tab-list-menu"
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={onMenuKeyDown}
          style={{
            position: 'fixed',
            top: anchor.bottom + 2,
            // Opens toward the middle of the window from the button's outer edge.
            ...(isDocumentRtl()
              ? { left: anchor.left } // rtl-physical: fixed position from a physical rect, chosen per direction
              : { right: window.innerWidth - anchor.right }), // rtl-physical: as above
            zIndex: 10000,
            minWidth: '200px',
            maxWidth: '360px',
            maxHeight: `calc(100vh - ${anchor.bottom + 16}px)`,
            overflowY: 'auto',
            backgroundColor: 'var(--theme-bg-primary)',
            border: '1px solid var(--theme-border-primary)',
            borderRadius: '6px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            padding: '4px 0',
          }}
        >
          {group.panels.map(panel => (
            <TabListItem
              key={panel.id}
              panelId={panel.id}
              title={panel.title}
              contentType={panel.params?.contentType as PanelContentType | undefined}
              staticSubtitle={panel.params?.subtitle as string | undefined}
              active={group.activePanel?.id === panel.id}
              onSelect={() => {
                close();
                panel.api.setActive();
              }}
            />
          ))}
        </div>,
        document.body,
      )}
    </>
  );
};

/** One row: the same icon, title and subtitle the tab itself shows. */
const TabListItem: React.FC<{
  panelId: string;
  title: string | undefined;
  contentType: PanelContentType | undefined;
  staticSubtitle: string | undefined;
  active: boolean;
  onSelect: () => void;
}> = ({ panelId, title, contentType, staticSubtitle, active, onSelect }) => {
  const { t } = useI18n();
  const dynamicSubtitle = useLayoutStore(s => s.dynamicSubtitles.get(panelId));
  const subtitle = localizePaneLabel(t, contentType, dynamicSubtitle || staticSubtitle);
  const name = localizePaneLabel(t, contentType, title) ?? title ?? '';
  const icon = tabIconFor(contentType);

  return (
    <button
      role="menuitemradio"
      aria-checked={active}
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '5px 12px',
        border: 'none',
        borderInlineStart: `3px solid ${active ? 'var(--theme-accent-primary)' : 'transparent'}`,
        background: 'transparent',
        cursor: 'pointer',
        color: 'var(--theme-text-primary)',
        textAlign: 'start',
        fontSize: '13px',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--theme-tab-bg-hover)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
      }}
    >
      {icon && <span style={{ fontSize: '12px', flexShrink: 0 }}>{icon}</span>}
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.25 }}>
        <span style={{ fontWeight: active ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        {subtitle && (
          <span style={{ fontSize: '11px', color: 'var(--theme-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</span>
        )}
      </span>
    </button>
  );
};

export default DockviewTabListMenu;
