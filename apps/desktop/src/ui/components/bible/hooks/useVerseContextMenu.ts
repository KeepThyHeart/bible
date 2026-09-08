import { useState } from 'react';
import { ContextMenuState } from '../../BiblePaneContext';

/** Manages the verse right-click context menu visibility/position state. */
export function useVerseContextMenu() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  return { contextMenu, setContextMenu };
}
