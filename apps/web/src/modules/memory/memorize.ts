/** The "Memorize" verse action (lazy): add the selection as a passage, then show the Memory app. */
import type { VerseActionHandler } from '@bible/core/browser';
import { openApp } from '../../host/appHost';
import { setJustAdded } from './justAdded';
import { getWebMemoryApi } from './webMemoryApi';

export const memorizeHandler: VerseActionHandler = {
  async run(ctx) {
    const r = await getWebMemoryApi().api.addVerses({ verseIds: ctx.verseIds, module: ctx.module });
    setJustAdded({ passageId: r.passageId, reference: r.reference, outcome: r.outcome });
    await openApp('memory');
  },
};

export default memorizeHandler;
