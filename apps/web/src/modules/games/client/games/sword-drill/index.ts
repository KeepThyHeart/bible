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
import { ControlSearch } from './ControlViews.js';
import { HostAnswering, HostQuestion, HostReveal } from './HostViews.js';
import { PhoneReveal, PhoneSearch } from './PhoneViews.js';
import { GAME_ID } from './payload.js';

export const swordDrillViews: GameViews = {
  id: GAME_ID,
  // Confirm and Next in line are the verdict here, drawn by `ControlSearch`.
  controlJudges: true,
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
  control: ControlSearch,
  card: {
    descriptionKey: 'games.swordDrill.card.description',
    descriptionFallback: 'Race to find the verse in your Bible and read it aloud.',
    tags: ['outLoud', 'bibles'],
    minutes: 10,
  },
  howToPlay: {
    summaryKey: 'games.swordDrill.howToPlay.summary',
    summaryFallback: 'A reference goes up on the screen. Find the verse in your Bible.',
    steps: [
      {
        key: 'games.swordDrill.howToPlay.stepRead',
        fallback: 'When the organizer calls on you, read the verse aloud.',
      },
      {
        key: 'games.swordDrill.howToPlay.stepConfirm',
        fallback: 'The organizer confirms each reader in turn.',
      },
      {
        key: 'games.swordDrill.howToPlay.stepPoints',
        fallback: '100 points for each reader who is confirmed.',
      },
    ],
  },
};

registerGameViews(swordDrillViews);

export { GAME_ID } from './payload.js';
export { ControlSearch } from './ControlViews.js';
export { HostAnswering, HostQuestion, HostReveal } from './HostViews.js';
export { PhoneReveal, PhoneSearch } from './PhoneViews.js';
export type { Drill, DrillReveal, Place } from './payload.js';
