/**
 * The detective game, on both screens.
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
import { GAME_ID } from './payload.js';
import './detective.css';

export { GAME_ID } from './payload.js';

export const detectiveViews: GameViews = {
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
  // The reveal shows the room's split and verdict in its own layout.
  revealDrawsRoomVote: true,
};

registerGameViews(detectiveViews);

export { HostAnswering, HostQuestion, HostReveal } from './HostViews.js';
export { PhoneAnswering, PhoneQuestion, PhoneReveal } from './PhoneViews.js';
export type { CaseReveal, HostCase, PhoneCase } from './payload.js';
