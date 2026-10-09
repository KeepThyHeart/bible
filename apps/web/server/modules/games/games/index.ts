/**
 * The games this server can run.
 *
 * A game is reached through this registry and never named anywhere else, so
 * adding one is a single line here and a side-effect import on the client for
 * its views.
 *
 * The list may legitimately be short, or empty in a stripped build. That is not
 * a failure: a host can still open a room, read the code off the projector and
 * watch phones arrive. Everything the shell owns — the roster, teams, the
 * clock, reconnection — is exercised by a lobby with nothing to play in it.
 */

import type { GameModule, GameRegistry, Round, RoundOutcome } from '../../../../src/modules/games/shared/games.js';
import { categoryBoard } from './category-board/index.js';
import { describeIt } from './describe-it/index.js';
import { detective } from './detective/index.js';
import { fillInTheBlank } from './fill-in-the-blank/index.js';
import { nameThatReference } from './name-that-reference/index.js';
import { putInOrder } from './put-in-order/index.js';
import { swordDrill } from './sword-drill/index.js';
import { whoAmI } from './who-am-i/index.js';
import { whoSaidIt } from './who-said-it/index.js';

const modules: GameModule[] = [
  fillInTheBlank,
  nameThatReference,
  swordDrill,
  whoSaidIt,
  whoAmI,
  putInOrder,
  categoryBoard,
  detective,
  describeIt,
];

export const games: GameRegistry = {
  get: (id: string): GameModule | undefined => modules.find((module) => module.id === id),
  list: (): GameModule[] => [...modules],
};

/**
 * What a room plays when it names a game this build does not carry.
 *
 * Its rounds carry nothing, which is the honest rendering of that situation:
 * the lobby works and the screens are blank rather than crashing in the middle
 * of a group. Substituting a different real game would be worse — a room would
 * play something nobody chose and no one on the host screen could tell why.
 */
export const emptyGame: GameModule = {
  id: 'none',
  name: 'Nothing installed yet',
  supportsSolo: false,
  buildRound(_context, index: number): Round {
    return { index, secret: null, hostView: null, playerView: null };
  },
  scoreRound(): RoundOutcome {
    return { perPlayer: new Map(), aggregates: [], correctLabel: '', detail: null };
  },
};
