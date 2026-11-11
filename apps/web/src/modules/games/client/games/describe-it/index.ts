/**
 * Describe It, on both screens.
 *
 * Registering is a side effect of importing this file, which is what keeps the
 * shell free of a list of games. The phone uses one view for the get-ready and
 * the turn, because what changes between them is only whether the clock is
 * running; which phone it is — describer, guesser or the other team — the
 * server has already decided.
 *
 * The views are exported as well as registered so that a test can render one
 * without taking the registry with it.
 */

import './describeIt.css';
import { registerGameViews } from '../../shell/gameViews.js';
import type { GameViews } from '../../shell/gameViews.js';
import { HostAnswering, HostQuestion, HostReveal } from './HostViews.js';
import { PhoneReveal, PhoneTurnView } from './PhoneViews.js';
import { GAME_ID } from './payload.js';

export const describeItViews: GameViews = {
  id: GAME_ID,
  host: {
    question: HostQuestion,
    answering: HostAnswering,
    reveal: HostReveal,
  },
  player: {
    question: PhoneTurnView,
    answering: PhoneTurnView,
    reveal: PhoneReveal,
  },
  card: {
    descriptionKey: 'games.describeIt.card.description',
    descriptionFallback: 'Describe the word without saying the forbidden words.',
    tags: ['teams', 'outLoud'],
    minutes: 15,
  },
  howToPlay: {
    summaryKey: 'games.describeIt.howToPlay.summary',
    summaryFallback: 'One player describes a word to their team without saying the forbidden words.',
    steps: [
      {
        key: 'games.describeIt.howToPlay.stepDescribe',
        fallback: 'The describer taps Got it for each word the team guesses, or Pass to skip.',
      },
      {
        key: 'games.describeIt.howToPlay.stepListen',
        fallback: 'The other team listens for forbidden words and taps They said one.',
      },
      {
        key: 'games.describeIt.howToPlay.stepPoints',
        fallback: '50 points to the describing team for each word.',
      },
    ],
  },
};

registerGameViews(describeItViews);

export { GAME_ID } from './payload.js';
export { HostAnswering, HostQuestion, HostReveal } from './HostViews.js';
export { PhoneReveal, PhoneTurnView } from './PhoneViews.js';
export type { CardFace, HostTurn, PhoneTurn, TurnReveal } from './payload.js';
