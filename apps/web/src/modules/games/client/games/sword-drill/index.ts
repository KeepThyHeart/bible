/**
 * Sword drill, on both screens.
 *
 * Registering is a side effect of importing this file, which is what keeps the
 * shell free of a list of games. The phone uses one view for the search and
 * the reading, because to a player with a Bible open they are one moment.
 *
 * The views are exported as well as registered so that a test can render one
 * without taking the registry with it.
 */

import './swordDrill.css';
import { registerGameViews } from '../../shell/gameViews.js';
import type { GameViews } from '../../shell/gameViews.js';
import { HostAnswering, HostQuestion, HostReveal } from './HostViews.js';
import { PhoneReveal, PhoneSearch } from './PhoneViews.js';
import { GAME_ID } from './payload.js';

export const swordDrillViews: GameViews = {
  id: GAME_ID,
  host: {
    question: HostQuestion,
    answering: HostAnswering,
    reveal: HostReveal,
  },
  player: {
    question: PhoneSearch,
    answering: PhoneSearch,
    reveal: PhoneReveal,
  },
};

registerGameViews(swordDrillViews);

export { GAME_ID } from './payload.js';
export { HostAnswering, HostQuestion, HostReveal } from './HostViews.js';
export { PhoneReveal, PhoneSearch } from './PhoneViews.js';
export type { Drill, DrillReveal, Place } from './payload.js';
