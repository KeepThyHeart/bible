/**
 * Put in order, on both screens.
 *
 * Registering is a side effect of importing this file, which keeps the shell
 * free of a list of games: the client entry imports the games it ships with,
 * and nothing else names one. The stylesheet comes with it, so a build without
 * the game does not ship its rules either.
 *
 * The views are exported as well as registered so a test can render one
 * without taking the registry with it.
 */

import './putInOrder.css';
import { registerGameViews } from '../../shell/gameViews.js';
import type { GameViews } from '../../shell/gameViews.js';
import { HostAnswering, HostQuestion, HostReveal } from './HostViews.js';
import { PhoneAnswering, PhoneQuestion, PhoneReveal } from './PhoneViews.js';
import { GAME_ID } from './payload.js';

export const putInOrderViews: GameViews = {
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
};

registerGameViews(putInOrderViews);

export { GAME_ID } from './payload.js';
export { HostAnswering, HostQuestion, HostReveal } from './HostViews.js';
export { PhoneAnswering, PhoneQuestion, PhoneReveal } from './PhoneViews.js';
export type { OrderQuestion, OrderReveal } from './payload.js';
