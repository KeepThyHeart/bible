import { eventBus } from '../events/eventBus';
import { wordStudyStore } from '../stores/wordStudyStore';
import type { WordGroup } from '@bible/core/browser';

/**
 * Show the Word study pane, optionally starting a study.
 *
 * Desktop: switches the right pane to 'wordStudy' and expands it (via the pane
 * events commentaryStore listens to). Mobile: `MobileApp` listens for
 * 'wordstudy:open' and raises the full-screen sheet. Works from any entry point
 * (Strong's popup, dictionary entry, header) without them knowing which layout
 * is showing.
 */
export function openWordStudy(target?: { strongs?: string; group?: WordGroup }): void {
  if (target?.strongs) void wordStudyStore.openStrongs(target.strongs);
  else if (target?.group) void wordStudyStore.openGroup(target.group);
  eventBus.emit('pane:show', { paneId: 'wordStudy' });
  eventBus.emit('pane:expand');
  eventBus.emit('wordstudy:open');
}
