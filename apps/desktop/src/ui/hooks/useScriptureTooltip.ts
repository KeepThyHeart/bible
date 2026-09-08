import { useState, useEffect, useCallback } from 'react';
import { previewVerseInPrimary } from '../stores/crossStoreBridge';
import { useHoverIntent } from './useHoverIntent';

export interface TooltipState {
  visible: boolean;
  verseId: number;
  endVerseId?: number;
  position: { x: number; y: number };
}

const INITIAL_TOOLTIP_STATE: TooltipState = {
  visible: false,
  verseId: 0,
  position: { x: 0, y: 0 },
};

interface PendingVerseTooltip {
  verseId: number;
  endVerseId?: number;
  position: { x: number; y: number };
}

/**
 * Reusable hook that attaches click/hover handlers on `<a href="#verse-...">` elements
 * within a container ref, providing verse navigation and tooltip state.
 *
 * - Click: previews the verse in the Bible pane (see `previewSlice`), hides tooltip
 * - Hover on `.scripture-link`: parses verseId (+ endVerseId for ranges), shows tooltip
 *   after a 300ms show delay (matching web and the Strong's preview tooltip) so the
 *   tooltip doesn't fire the instant the pointer crosses a reference - that instant-fire
 *   was itself part of why placement felt bad, since a fast-moving pointer would trigger
 *   (and then immediately have to reposition/close) a tooltip it never meant to open.
 *
 * @param containerRef - RefObject to the HTML element containing scripture links
 * @param deps - Dependency array that triggers re-attachment of event listeners
 */
export function useScriptureTooltip(
  containerRef: React.RefObject<HTMLElement | null>,
  deps: React.DependencyList = []
) {
  const [tooltipState, setTooltipState] = useState<TooltipState>(INITIAL_TOOLTIP_STATE);

  const { scheduleShow, scheduleHide, cancelHide, hideNow } = useHoverIntent<PendingVerseTooltip>({
    showDelay: 300,
    hideDelay: 100,
    onShow: (pending) => {
      setTooltipState({
        visible: true,
        verseId: pending.verseId,
        endVerseId: pending.endVerseId,
        position: pending.position,
      });
    },
    onHide: () => {
      setTooltipState(prev => ({ ...prev, visible: false }));
    },
  });

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'A') {
        e.preventDefault();
        hideNow();
        const href = target.getAttribute('href');
        if (href && href.startsWith('#verse-')) {
          const verseIdStr = href.replace('#verse-', '');
          const verseId = parseInt(verseIdStr, 10);
          if (!isNaN(verseId)) {
            // A scripture link is a glance, not a change of subject - the
            // commentary, notes and study panes stay on the verse the reader
            // chose. See `stores/bible/slices/previewSlice.ts`.
            previewVerseInPrimary(verseId);
          }
        }
      }
    };

    const handleMouseEnter = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'A' && target.classList.contains('scripture-link')) {
        const href = target.getAttribute('href');
        if (href && href.startsWith('#verse-')) {
          const verseIdPart = href.replace('#verse-', '');
          const rangeParts = verseIdPart.split('-');
          const verseId = parseInt(rangeParts[0], 10);
          const endVerseId = rangeParts.length > 1 ? parseInt(rangeParts[1], 10) : undefined;
          if (!isNaN(verseId)) {
            scheduleShow({ verseId, endVerseId, position: { x: e.clientX, y: e.clientY } });
          }
        }
      }
    };

    const handleMouseLeave = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'A' && target.classList.contains('scripture-link')) {
        scheduleHide();
      }
    };

    const element = containerRef.current;
    if (element) {
      element.addEventListener('click', handleClick);
      element.addEventListener('mouseover', handleMouseEnter);
      element.addEventListener('mouseout', handleMouseLeave);
      return () => {
        element.removeEventListener('click', handleClick);
        element.removeEventListener('mouseover', handleMouseEnter);
        element.removeEventListener('mouseout', handleMouseLeave);
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const closeTooltip = useCallback(() => {
    hideNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideNow]);

  const tooltipMouseEnter = useCallback(() => {
    cancelHide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelHide]);

  return { tooltipState, closeTooltip, tooltipMouseEnter };
}
