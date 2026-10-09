/** The "Memorize" verse action's handler. The core answers with a `notice` push, which the host toasts. */
import type { VerseActionContext, VerseActionHandler } from '@bible/core/browser';
import { memoryClient } from './memoryClient';

export const run: VerseActionHandler['run'] = async (ctx: VerseActionContext) => {
  await memoryClient.addVerses({ verseIds: ctx.verseIds, module: ctx.module });
};

export default { run } satisfies VerseActionHandler;
