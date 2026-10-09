/**
 * Audio follow-along: keeps the verse being read in view, without fighting the reader's own
 * scrolling. Moves the viewport only; never the selection. Effect-only; registered in `readerPaneEffects`.
 */
import type { ReaderPaneEffectProps } from '../../../host/slots';
import { useFollowScroll } from '../hooks/useFollowScroll';

export function FollowScrollEffect({ activeTabId, getScrollElement, getContainer }: ReaderPaneEffectProps) {
  useFollowScroll({ activeTabId, getScrollElement, getContainer });
  return null;
}
