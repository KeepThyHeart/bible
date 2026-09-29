/**
 * Wires the word/verse mouse-hover events a Bible-reading surface fires into
 * `verseHoverPopupStore`'s dwell/timeout state machine (task 0036, P0.1c;
 * design doc §11.2/§11.3). One instance per surface (`BibleVerseList`,
 * `StudyModeView`) - `HighlightedVerse`/`CellEnglish` fire word-level events
 * via the props this hook returns; a verse row fires the verse-level pair
 * directly.
 */

import { useCallback } from 'react';
import { useVerseHoverPopupStore } from './verseHoverPopupStore';
import type { ResolvedHover } from '@bible/core/browser';

type Surface = 'standard' | 'study' | 'reading';
type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta';

function modifiersOf(event: React.MouseEvent): Modifier[] {
  const mods: Modifier[] = [];
  if (event.ctrlKey) mods.push('ctrl');
  if (event.altKey) mods.push('alt');
  if (event.shiftKey) mods.push('shift');
  if (event.metaKey) mods.push('meta');
  return mods;
}

export interface VerseHoverTrigger {
  onWordMouseEnter: (
    verseId: number,
    wordIndex: number,
    wordText: string,
    hovers: ResolvedHover[] | undefined,
    event: React.MouseEvent,
  ) => void;
  onWordMouseLeave: () => void;
  onVerseMouseEnter: (verseId: number, hovers: ResolvedHover[], event: React.MouseEvent) => void;
  onVerseMouseLeave: () => void;
}

export function useVerseHoverTrigger(
  moduleId: number,
  moduleAbbrev: string | undefined,
  surface: Surface,
): VerseHoverTrigger {
  const hover = useVerseHoverPopupStore((s) => s.hover);
  const scheduleClose = useVerseHoverPopupStore((s) => s.scheduleClose);

  const onWordMouseEnter = useCallback(
    (verseId: number, wordIndex: number, wordText: string, hovers: ResolvedHover[] | undefined, event: React.MouseEvent) => {
      if (!moduleAbbrev) return;
      hover({
        verseId,
        moduleId,
        moduleAbbrev,
        surface,
        word: { renderedIndex: wordIndex, text: wordText },
        modifiers: modifiersOf(event),
        position: { x: event.clientX, y: event.clientY },
        staticHovers: hovers ?? [],
      });
    },
    [moduleId, moduleAbbrev, surface, hover],
  );

  const onWordMouseLeave = useCallback(() => scheduleClose(), [scheduleClose]);

  const onVerseMouseEnter = useCallback(
    (verseId: number, hovers: ResolvedHover[], event: React.MouseEvent) => {
      if (!moduleAbbrev) return;
      hover({
        verseId,
        moduleId,
        moduleAbbrev,
        surface,
        modifiers: modifiersOf(event),
        position: { x: event.clientX, y: event.clientY },
        staticHovers: hovers,
      });
    },
    [moduleId, moduleAbbrev, surface, hover],
  );

  const onVerseMouseLeave = useCallback(() => scheduleClose(), [scheduleClose]);

  return { onWordMouseEnter, onWordMouseLeave, onVerseMouseEnter, onVerseMouseLeave };
}
