/**
 * Registering fill in the blank with the shell.
 *
 * Importing this module is what puts the game on the client; there is no list
 * of games anywhere in the shell to add a line to. The stylesheet comes with
 * it, so a build that does not include the game does not ship its rules either.
 */

import './views.css';
import { registerGameViews } from '../../shell/gameViews.js';
import type { GameViews } from '../../shell/gameViews.js';
import { hostViews } from './HostViews.js';
import { playerViews } from './PlayerViews.js';
import { GAME_ID } from './payload.js';

export const fillInTheBlankViews: GameViews = {
  id: GAME_ID,
  host: hostViews,
  player: playerViews,
};

registerGameViews(fillInTheBlankViews);

export { GAME_ID } from './payload.js';
export type { BlankPrompt, BlankReveal } from './payload.js';
