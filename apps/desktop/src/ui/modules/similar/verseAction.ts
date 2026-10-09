/** The "Find similar passages" verse action (lazy): open the Similar panel on the selected passage. */
import type { VerseActionHandler } from '@bible/core/browser';
import { useSimilarStore } from './useSimilarStore';

export const handler: VerseActionHandler = {
  run(ctx) {
    const first = ctx.verseIds[0] ?? ctx.verseId;
    const last = ctx.verseIds[ctx.verseIds.length - 1] ?? first;
    useSimilarStore.getState().openFor({ // allow-getstate: verse action handler
      startVerseId: Math.min(first, last),
      endVerseId: Math.max(first, last),
    });
  },
};
