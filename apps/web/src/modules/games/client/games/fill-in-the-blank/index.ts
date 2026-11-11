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
  card: {
    descriptionKey: 'games.fillInTheBlank.card.description',
    descriptionFallback: 'A verse with a word missing. Everyone types it.',
    tags: ['everyone'],
    minutes: 10,
  },
  howToPlay: {
    summaryKey: 'games.fillInTheBlank.howToPlay.summary',
    summaryFallback: 'A verse appears with one word missing.',
    steps: [
      {
        key: 'games.fillInTheBlank.howToPlay.stepType',
        fallback: 'Type the missing word on your phone before the timer ends.',
      },
      {
        key: 'games.fillInTheBlank.howToPlay.stepPoints',
        fallback: '100 points for each right answer.',
      },
    ],
  },
};

registerGameViews(fillInTheBlankViews);

export { GAME_ID } from './payload.js';
export type { BlankPrompt, BlankReveal } from './payload.js';
