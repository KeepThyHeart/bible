/**
 * The judge used under `privacyMode=strict`: nothing leaves the server. It offers a suggestion
 * only when the answer matches an accepted form (exactly or by a near spelling), using the same
 * pure matcher the fill-in-the-blank game runs; everything else is left to the host, as with the
 * null provider.
 */

import { matchAnswer } from '../../../../src/modules/games/shared/answers/match.js';
import type { JudgeProvider } from '../../../../src/modules/games/shared/protocol.js';

export const LOCAL_JUDGE_ID = 'local';

export const localJudge: JudgeProvider = {
  id: LOCAL_JUDGE_ID,
  suggest(request) {
    const result = matchAnswer(request.playerAnswer, request.canonicalAnswer, request.accept);
    if (!result.matched) return Promise.resolve(null);
    return Promise.resolve({
      verdict: 'correct',
      reason: result.exact ? 'Matches an accepted answer.' : `Close spelling of "${result.matchedAnswer}".`,
    });
  },
};
