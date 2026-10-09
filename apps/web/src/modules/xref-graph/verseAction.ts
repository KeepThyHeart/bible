/**
 * The "Show connections" verse action: select the clicked verse in Study, then open the graph dialog on it.
 * The Study pane's own button (surface `study`) already shows that verse, so it only opens the graph.
 */
import type { VerseActionHandler } from '@bible/core/browser';
import { bibleStore } from '../../stores/bibleStore';
import { xrefGraphStore } from './xrefGraphStore';

export const showConnectionsHandler: VerseActionHandler = {
  run(ctx) {
    if (ctx.surface !== 'study') bibleStore.adoptPreviewAsStudy(ctx.verseId);
    xrefGraphStore.open(ctx.verseId);
  },
};
