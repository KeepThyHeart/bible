import { useState, useEffect, useCallback } from 'preact/hooks';
import { useViewportPosition } from './useViewportPosition';
import { bibleStore } from '../stores/bibleStore';
import { eventBus } from '../events/eventBus';
import { parseVerseId } from '../utils/verseId';

interface ContextMenuState {
  x: number;
  y: number;
  verseId: number;
}

type MobileView = 'home' | 'bible' | 'search' | 'study' | 'commentary';

interface ContextMenuTarget {
  /** Right-pane id on desktop — must be one of commentaryStore's renderable modes. */
  paneId: string;
  /** Mobile has no dedicated topics or dictionary view; both live in the study pane. */
  mobileView: MobileView;
  /** Which data the target pane needs loaded for the right-clicked verse. */
  load: 'chapter' | 'verse' | 'none';
}

/**
 * Where each context-menu action sends the reader.
 *
 * The menu used to offer one entry per study target — Cross-references,
 * Topics, Commentary, Dictionary — and each one landed the reader on a pane
 * that was still showing the *previously* selected verse: the Topics pane
 * restores its own saved navigation stack, and the cross-references entry did
 * not even reach a cross-references view. They collapse into a single "Study"
 * action, which selects the right-clicked verse first and then opens the Study
 * pane, where all of those live as sections.
 *
 * The mapping stays as data because the ordering matters — select the verse,
 * load it, then show the pane — and `useContextMenu.test.ts` asserts against it.
 */
export const CONTEXT_MENU_TARGETS: Record<string, ContextMenuTarget> = {
  study: { paneId: 'study', mobileView: 'study', load: 'verse' },
};

export function useContextMenu(
  findVerseAtPoint: (target: HTMLElement, clientX: number, clientY: number) => { el: Element; verseId: number } | null,
  setCopyOpen: (open: boolean) => void,
  setMobileView?: (view: MobileView) => void,
) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useViewportPosition<HTMLDivElement>(
    contextMenu ? { top: contextMenu.y, left: contextMenu.x } : null,
    [contextMenu?.verseId],
  );

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const result = findVerseAtPoint(e.target as HTMLElement, e.clientX, e.clientY);
      if (!result) return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, verseId: result.verseId });
    };

    const handleClickAway = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('click', handleClickAway);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('click', handleClickAway);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [findVerseAtPoint]);

  const handleContextMenuAction = useCallback((action: string) => {
    if (!contextMenu) return;
    const verseId = contextMenu.verseId;
    setContextMenu(null);

    if (action === 'copy') {
      bibleStore.adoptPreviewAsStudy(verseId);
      setCopyOpen(true);
      return;
    }

    const target = CONTEXT_MENU_TARGETS[action];
    if (!target) return;

    // Select the right-clicked verse *before* anything opens. This is the whole
    // point of the action: without it the pane opens on whatever verse was
    // selected before, which is what the reader saw as "the menu ignored the
    // verse I clicked".
    bibleStore.adoptPreviewAsStudy(verseId);
    const { bookNumber, chapter, verse } = parseVerseId(verseId);

    // The study pane follows the selected verse; a chapter-scoped pane wants
    // the chapter instead. Emitted explicitly rather than left to the
    // studyVerse effect in useAppShared, which does not fire when the
    // right-clicked verse was already the selected one.
    if (target.load === 'chapter') {
      eventBus.emit('commentary:load-chapter', { book: bookNumber, chapter });
    } else if (target.load === 'verse') {
      eventBus.emit('study:load-verse', { verseId, book: bookNumber, chapter, verse });
    }

    eventBus.emit('pane:show', { paneId: target.paneId });
    eventBus.emit('pane:expand');
    setMobileView?.(target.mobileView);
  }, [contextMenu, setCopyOpen, setMobileView]);

  return { contextMenu, contextMenuRef, handleContextMenuAction };
}
