/**
 * Who said it, on both screens.
 *
 * Registering is a side effect of importing this file, which is what keeps the
 * shell free of a list of games: the client entry imports the games it ships
 * with, and nothing else anywhere names one.
 *
 * The views are exported as well as registered so that a test can render one
 * without taking the registry with it.
 */

import { registerGameViews } from '../../shell/gameViews.js';
import type { GameViews } from '../../shell/gameViews.js';
import { HostAnswering, HostQuestion, HostReveal } from './HostViews.js';
import { PhoneAnswering, PhoneQuestion, PhoneReveal } from './PhoneViews.js';
import './whoSaidIt.css';

export const GAME_ID = 'who-said-it';

export const whoSaidItViews: GameViews = {
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
    descriptionKey: 'games.whoSaidIt.card.description',
    descriptionFallback: 'A line of Scripture. Pick who said it.',
    tags: ['everyone'],
    minutes: 10,
  },
  howToPlay: {
    summaryKey: 'games.whoSaidIt.howToPlay.summary',
    summaryFallback: 'A line of Scripture appears. Work out who said it.',
    steps: [
      {
        key: 'games.whoSaidIt.howToPlay.stepPick',
        fallback: 'Tap the name of the speaker on your phone before the timer ends.',
      },
      {
        key: 'games.whoSaidIt.howToPlay.stepPoints',
        fallback: '100 points for each right answer.',
      },
    ],
  },
};

registerGameViews(whoSaidItViews);

export { HostAnswering, HostQuestion, HostReveal } from './HostViews.js';
export { PhoneAnswering, PhoneQuestion, PhoneReveal } from './PhoneViews.js';
export type { Question, RevealDetail } from './payload.js';
