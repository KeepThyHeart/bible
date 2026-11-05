import { useTranslation } from 'react-i18next';
import { anchorAtPointer } from '@bible/core/browser';
import { useDirection } from '@bible/ui';
import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

const ESTIMATED_MENU_WIDTH = 200;
/** Matches the old LTR clamp in useViewportPosition. */
const EDGE_PADDING = 16;

interface ContextMenuPopupProps {
  x: number;
  y: number;
  menuRef: RefObject<HTMLDivElement>;
  onAction: (action: string) => void;
  /** Registry actions (labels already resolved), listed after the built-ins. */
  actions?: { id: string; label: string; iconClass?: string; group?: string }[];
  onVerseAction?: (id: string) => void;
  /** The verse the menu was opened for: when the menu goes away, focus returns to it if it can take focus. */
  verseId?: number;
}

/**
 * The verse right-click menu.
 *
 * It used to list one entry per study target — Cross-references, Topics,
 * Commentary, Dictionary — and each of those opened a pane that was still
 * showing the previously selected verse. They are now a single "Study" entry:
 * it selects the right-clicked verse and opens the Study pane, which carries
 * cross-references, topics and the rest as sections. Only actions that act on
 * the clicked verse directly (Copy) sit alongside it.
 */
export function ContextMenuPopup({ x, y, menuRef, onAction, actions, onVerseAction, verseId }: ContextMenuPopupProps) {
  const { t } = useTranslation();
  const dir = useDirection();
  // The hook that owns menuRef re-anchors with the measured width; this is the first-paint estimate.
  const { insetInlineStart } = anchorAtPointer(x, ESTIMATED_MENU_WIDTH, window.innerWidth, dir, EDGE_PADDING);
  // W-038: move focus to the first item on open, and arrow-key between items (Escape/Tab are the owning hook's job).
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, []);
  // Whoever closes the menu hands focus back to the origin or <main>; a verse that can itself take focus
  // is the better place to land, so the reader stays at the verse the menu was for. Verses that are not
  // focusable (the usual case) are left alone.
  const verseIdRef = useRef(verseId);
  verseIdRef.current = verseId;
  useEffect(() => () => {
    const id = verseIdRef.current;
    if (id === undefined) return;
    const active = document.activeElement;
    const main = document.getElementById('main-content');
    if (active && active !== document.body && active !== main) return; // focus is somewhere deliberate
    const verse = document.querySelector<HTMLElement>(`.bible-content [data-verse-id="${id}"]`);
    if (verse && verse.hasAttribute('tabindex') && verse.tabIndex >= -1) verse.focus({ preventScroll: true });
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    const root = menuRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = i <= 0 ? items.length - 1 : i - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else return;
    e.preventDefault();
    items[next].focus();
  };
  return (
    <div ref={menuRef} role="menu" aria-label={t('contextMenu.label', 'Verse actions')} onKeyDown={onKeyDown} class="verse-context-menu" style={{ top: `${y}px`, insetInlineStart: `${insetInlineStart}px` }}>
      <button role="menuitem" class="verse-context-menu__item" onClick={() => onAction('copy')}>
        <i class="fa-solid fa-copy" /> {t('contextMenu.copyPassage')}
      </button>
      <div class="verse-context-menu__divider" role="separator" />
      <button role="menuitem" class="verse-context-menu__item" onClick={() => onAction('study')}>
        <i class="fa-solid fa-microscope" /> {t('contextMenu.study')}
      </button>
      {/* Contributed `study` group actions sit right after the built-in Study entry (before the divider block). */}
      {actions?.filter((a) => a.group === 'study').map((a) => (
        <button key={a.id} role="menuitem" class="verse-context-menu__item" data-action-id={a.id} onClick={() => onVerseAction?.(a.id)}>
          {a.iconClass && <i class={a.iconClass} aria-hidden="true" />} {a.label}
        </button>
      ))}
      {actions && actions.some((a) => a.group !== 'study') && (
        <>
          <div class="verse-context-menu__divider" role="separator" />
          {actions.filter((a) => a.group !== 'study').map((a) => (
            <button key={a.id} role="menuitem" class="verse-context-menu__item" data-action-id={a.id} onClick={() => onVerseAction?.(a.id)}>
              {a.iconClass && <i class={a.iconClass} aria-hidden="true" />} {a.label}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
