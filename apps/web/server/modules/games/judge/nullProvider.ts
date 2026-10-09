/**
 * The provider a room gets when nobody configured one, and the one every game
 * is designed around.
 *
 * A host reading an answer aloud has already decided; the tap is instant and
 * costs nothing. Offering no suggestion is therefore a complete, correct
 * implementation rather than a stub — the host screen simply shows the two
 * buttons it would have shown anyway. Keeping this as the default is also what
 * stops a model from quietly becoming load-bearing: if the game only plays well
 * with an API key, the accepted-answer lists are not good enough yet.
 */

import type { JudgeProvider } from '../../../../src/modules/games/shared/protocol.js';

export const nullJudge: JudgeProvider = {
  id: 'none',
  // Not `async`: there is nothing to wait for, and a resolved promise keeps the
  // caller's shape identical to a provider that really did go out to a network.
  suggest: () => Promise.resolve(null),
};
