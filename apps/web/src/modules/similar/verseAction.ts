/** The "Find similar passages" verse action (lazy): select the clicked verse, then open the Similar pane. */
import type { VerseActionHandler } from '@bible/core/browser';
import { bibleStore } from '../../stores/bibleStore';
import { eventBus } from '../../events/eventBus';

export const handler: VerseActionHandler = {
  run(ctx) {
    // Select the right-clicked verse *before* the pane opens, or it shows the previously selected one.
    bibleStore.adoptPreviewAsStudy(ctx.verseId);
    eventBus.emit('pane:show', { paneId: 'similar' });
    eventBus.emit('pane:expand');
  },
};
