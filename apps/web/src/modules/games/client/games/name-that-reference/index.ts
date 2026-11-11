/**
 * Name that reference, on both screens.
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
import './nameThatReference.css';

export const GAME_ID = 'name-that-reference';

export const nameThatReferenceViews: GameViews = {
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
    descriptionKey: 'games.nameThatReference.card.description',
    descriptionFallback: 'A verse goes up. Pick where it is from.',
    tags: ['everyone'],
    minutes: 10,
  },
  howToPlay: {
    summaryKey: 'games.nameThatReference.howToPlay.summary',
    summaryFallback: 'A verse appears on the screen. Work out where it is from.',
    steps: [
      {
        key: 'games.nameThatReference.howToPlay.stepPick',
        fallback: 'Choose the reference on your phone before the timer ends.',
      },
      {
        key: 'games.nameThatReference.howToPlay.stepPoints',
        fallback: '100 points for each right answer.',
      },
      {
        key: 'games.nameThatReference.howToPlay.stepTyped',
        fallback: 'When answers are typed, the right book earns 40 and the right book and chapter earns 70.',
      },
    ],
  },
};

registerGameViews(nameThatReferenceViews);

export { HostAnswering, HostQuestion, HostReveal } from './HostViews.js';
export { PhoneAnswering, PhoneQuestion, PhoneReveal } from './PhoneViews.js';
export type { Question, RevealDetail } from './payload.js';
