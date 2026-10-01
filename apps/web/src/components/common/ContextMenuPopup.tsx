import { useTranslation } from 'react-i18next';
import { anchorAtPointer } from '@bible/core/browser';
import { useDirection } from '@bible/ui';
import type { Ref } from 'preact';

const ESTIMATED_MENU_WIDTH = 200;
/** Matches the old LTR clamp in useViewportPosition. */
const EDGE_PADDING = 16;

interface ContextMenuPopupProps {
  x: number;
  y: number;
  menuRef: Ref<HTMLDivElement>;
  onAction: (action: string) => void;
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
export function ContextMenuPopup({ x, y, menuRef, onAction }: ContextMenuPopupProps) {
  const { t } = useTranslation();
  const dir = useDirection();
  // The hook that owns menuRef re-anchors with the measured width; this is the first-paint estimate.
  const { insetInlineStart } = anchorAtPointer(x, ESTIMATED_MENU_WIDTH, window.innerWidth, dir, EDGE_PADDING);
  return (
    <div ref={menuRef} class="verse-context-menu" style={{ top: `${y}px`, insetInlineStart: `${insetInlineStart}px` }}>
      <button class="verse-context-menu__item" onClick={() => onAction('copy')}>
        <i class="fa-solid fa-copy" /> {t('contextMenu.copyPassage')}
      </button>
      <div class="verse-context-menu__divider" />
      <button class="verse-context-menu__item" onClick={() => onAction('study')}>
        <i class="fa-solid fa-microscope" /> {t('contextMenu.study')}
      </button>
      <button class="verse-context-menu__item" onClick={() => onAction('connections')}>
        <i class="fa-solid fa-diagram-project" /> {t('xrefGraph.showConnections', { defaultValue: 'Show connections' })}
      </button>
    </div>
  );
}
