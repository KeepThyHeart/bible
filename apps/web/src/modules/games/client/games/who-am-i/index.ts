/**
 * Who am I, on both screens.
 *
 * Registering is a side effect of importing this file, which keeps the shell
 * free of a list of games: the client entry imports the games it ships with,
 * and nothing else anywhere names one. The stylesheet comes with it, so a build
 * without the game does not ship its rules either.
 *
 * The views are exported as well as registered so a test can render one
 * without the registry.
 */

import './whoAmI.css';
import { registerGameViews } from '../../shell/gameViews.js';
import type { GameViews } from '../../shell/gameViews.js';
import { HostAnswering, HostQuestion, HostReveal } from './HostViews.js';
import { PhoneAnswering, PhoneQuestion, PhoneReveal } from './PhoneViews.js';
import { GAME_ID } from './payload.js';

export const whoAmIViews: GameViews = {
  id: GAME_ID,
  host: {
    question: HostQuestion,
    answering: HostAnswering,
    reveal: HostReveal,
  },
  player: {
    question: PhoneQuestion,
    answering: PhoneAnswering,
    reveal: PhoneReveal,
  },
  card: {
    descriptionKey: 'games.whoAmI.card.description',
    descriptionFallback: 'Clues about a person, vaguest first. Name them early for more.',
    tags: ['everyone'],
    minutes: 10,
  },
  howToPlay: {
    summaryKey: 'games.whoAmI.howToPlay.summary',
    summaryFallback: 'Clues about a person from the Bible appear one at a time, vaguest first.',
    steps: [
      {
        key: 'games.whoAmI.howToPlay.stepPick',
        fallback: 'Tap who you think it is. You get one guess.',
      },
      {
        key: 'games.whoAmI.howToPlay.stepPoints',
        fallback: '100 points for a right answer at the first clue, and 20 less for each clue after that.',
      },
      {
        key: 'games.whoAmI.howToPlay.stepWrong',
        fallback: 'A wrong guess sits you out for the rest of the question.',
      },
    ],
  },
};

registerGameViews(whoAmIViews);

export { GAME_ID } from './payload.js';
export { HostAnswering, HostQuestion, HostReveal } from './HostViews.js';
export { PhoneAnswering, PhoneQuestion, PhoneReveal } from './PhoneViews.js';
export type { WhoAmIReveal, WhoAmIRound } from './payload.js';
