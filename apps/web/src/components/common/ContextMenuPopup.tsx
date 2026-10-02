import { useTranslation } from 'react-i18next';
import type { Ref } from 'preact';

interface ContextMenuPopupProps {
  x: number;
  y: number;
  menuRef: Ref<HTMLDivElement>;
  onAction: (action: string) => void;
  /** Hide "Find similar passages" (mobile: its target pane has no Similar section). Default true. */
  showSimilar?: boolean;
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
export function ContextMenuPopup({ x, y, menuRef, onAction, showSimilar = true }: ContextMenuPopupProps) {
  const { t } = useTranslation();
  return (
    <div ref={menuRef} class="verse-context-menu" style={{ top: `${y}px`, left: `${x}px` }}>
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
      {showSimilar && (
        <button class="verse-context-menu__item" onClick={() => onAction('similar')}>
          <i class="fa-solid fa-clone" /> {t('contextMenu.similar')}
        </button>
      )}
    </div>
  );
}
