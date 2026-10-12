/** The "Memorize" verse action (lazy): add the selection as a passage, then show the Memory app. */
import type { VerseActionHandler } from '@bible/core/browser';
import { openApp } from '../../host/appHost';
import { getWebMemoryApi } from './webMemoryApi';

export const memorizeHandler: VerseActionHandler = {
  async run(ctx) {
    await getWebMemoryApi().api.addVerses({ verseIds: ctx.verseIds, module: ctx.module });
    await openApp('memory');
  },
};

export default memorizeHandler;
