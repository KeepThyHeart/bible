import React, { useRef } from 'react';
import { IUserTextMarkupRepository } from '@bible/core';

interface SelectionState {
  startVerseId: number;
  startWordIndex: number;
  endVerseId?: number;
  endWordIndex?: number;
}

interface HighlightSelectorProps {
  children: React.ReactNode;
  moduleId: number;
  repository: IUserTextMarkupRepository;
  /**
   * @deprecated Never called. See the note on the component - right-click is
   * handled per verse row, not here. Retained only because BibleVerseList
   * still passes it.
   */
  onShowMenu: (position: { x: number; y: number }, selection: SelectionState) => void;
}

/**
 * Wrapper around the verse list.
 *
 * This must not carry its own `onContextMenu` handler that builds a word
 * selection and opens a highlight menu: each verse row's own `onContextMenu`
 * (useVerseInteractionHandlers) calls `stopPropagation()`, so the event never
 * reaches this ancestor. Such a handler would be a second, silently-diverging
 * copy of the selection-to-word-index mapping - exactly the kind of
 * duplication that makes highlight bugs hard to pin down.
 *
 * The row handler already opens VerseContextMenu, whose "Highlight/
 * Underline..." item opens the highlight menu with the selection captured at
 * menu-open time (see capturedSelection.ts). Wiring a handler back in here
 * would give the app two competing right-click menus.
 *
 * The component itself stays because BibleVerseList renders it as the verse
 * container, and the props stay because BibleVerseList still passes them.
 */
export const HighlightSelector: React.FC<HighlightSelectorProps> = ({
  children,
  moduleId: _moduleId,
  repository: _repository,
  onShowMenu: _onShowMenu,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  return <div ref={containerRef}>{children}</div>;
};
