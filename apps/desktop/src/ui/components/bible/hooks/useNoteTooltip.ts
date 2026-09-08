import React, { useCallback, useRef, useState } from 'react';
import { NoteTooltipState } from '../../BiblePaneContext';

/**
 * Manages the verse-note tooltip state, including hover open/close timers
 * (so the tooltip stays visible when the user moves the cursor onto it).
 */
export function useNoteTooltip() {
  const [noteTooltip, setNoteTooltip] = useState<NoteTooltipState>({
    visible: false,
    verseId: 0,
    position: { x: 0, y: 0 },
  });
  const noteTooltipTimeoutRef = useRef<number | null>(null);

  const handleNoteIndicatorHover = useCallback((e: React.MouseEvent, verseId: number) => {
    if (noteTooltipTimeoutRef.current) {
      clearTimeout(noteTooltipTimeoutRef.current);
    }
    noteTooltipTimeoutRef.current = window.setTimeout(() => {
      setNoteTooltip({ visible: true, verseId, position: { x: e.clientX, y: e.clientY } });
    }, 300);
  }, []);

  const handleNoteIndicatorLeave = useCallback(() => {
    if (noteTooltipTimeoutRef.current) {
      clearTimeout(noteTooltipTimeoutRef.current);
    }
    noteTooltipTimeoutRef.current = window.setTimeout(() => {
      setNoteTooltip({ visible: false, verseId: 0, position: { x: 0, y: 0 } });
    }, 200);
  }, []);

  const handleNoteTooltipEnter = useCallback(() => {
    if (noteTooltipTimeoutRef.current) {
      clearTimeout(noteTooltipTimeoutRef.current);
    }
  }, []);

  const handleNoteTooltipClose = useCallback(() => {
    setNoteTooltip({ visible: false, verseId: 0, position: { x: 0, y: 0 } });
  }, []);

  const hide = useCallback(() => {
    setNoteTooltip({ visible: false, verseId: 0, position: { x: 0, y: 0 } });
  }, []);

  return {
    noteTooltip,
    setNoteTooltip,
    handleNoteIndicatorHover,
    handleNoteIndicatorLeave,
    handleNoteTooltipEnter,
    handleNoteTooltipClose,
    hide,
  };
}
