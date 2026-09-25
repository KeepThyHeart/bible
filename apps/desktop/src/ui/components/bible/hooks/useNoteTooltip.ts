import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { NoteTooltipState } from '../../BiblePaneContext';
import { useAmbientPopupStore } from '../../../stores/useAmbientPopupStore';

/**
 * Manages the verse-note tooltip state, including hover open/close timers
 * (so the tooltip stays visible when the user moves the cursor onto it).
 *
 * Participates in the shared ambient-popup coordinator (task 0036, P0.1c;
 * design amendment A6): claims the slot when it opens, releases it when it
 * closes, and closes itself if another ambient popup (an extension hover, a
 * Strong's tooltip) claims the slot instead.
 */
export function useNoteTooltip() {
  const [noteTooltip, setNoteTooltip] = useState<NoteTooltipState>({
    visible: false,
    verseId: 0,
    position: { x: 0, y: 0 },
  });
  const noteTooltipTimeoutRef = useRef<number | null>(null);
  const ownerId = useId();

  const handleNoteIndicatorHover = useCallback((e: React.MouseEvent, verseId: number) => {
    if (noteTooltipTimeoutRef.current) {
      clearTimeout(noteTooltipTimeoutRef.current);
    }
    noteTooltipTimeoutRef.current = window.setTimeout(() => {
      useAmbientPopupStore.getState().claim(ownerId);
      setNoteTooltip({ visible: true, verseId, position: { x: e.clientX, y: e.clientY } });
    }, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  const handleNoteIndicatorLeave = useCallback(() => {
    if (noteTooltipTimeoutRef.current) {
      clearTimeout(noteTooltipTimeoutRef.current);
    }
    noteTooltipTimeoutRef.current = window.setTimeout(() => {
      useAmbientPopupStore.getState().release(ownerId);
      setNoteTooltip({ visible: false, verseId: 0, position: { x: 0, y: 0 } });
    }, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  const handleNoteTooltipEnter = useCallback(() => {
    if (noteTooltipTimeoutRef.current) {
      clearTimeout(noteTooltipTimeoutRef.current);
    }
  }, []);

  const handleNoteTooltipClose = useCallback(() => {
    useAmbientPopupStore.getState().release(ownerId);
    setNoteTooltip({ visible: false, verseId: 0, position: { x: 0, y: 0 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  const hide = useCallback(() => {
    useAmbientPopupStore.getState().release(ownerId);
    setNoteTooltip({ visible: false, verseId: 0, position: { x: 0, y: 0 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  useEffect(() => {
    return useAmbientPopupStore.subscribe((s) => {
      if (s.owner !== ownerId) {
        setNoteTooltip((t) => (t.visible ? { visible: false, verseId: 0, position: { x: 0, y: 0 } } : t));
      }
    });
  }, [ownerId]);

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
