/** The "Show connections" verse action: open the graph dialog on the first verse of the selection. */
import type { VerseActionHandler } from '@bible/core/browser';
import { useXrefGraphStore } from './useXrefGraphStore';

export const showConnectionsHandler: VerseActionHandler = {
  run(ctx) {
    useXrefGraphStore.getState().openGraph(ctx.verseId); // allow-getstate: verse action handler is imperative
  },
};
