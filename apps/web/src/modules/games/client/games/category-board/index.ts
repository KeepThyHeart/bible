/**
 * The category board, on both screens.
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
import { ControlTilePick } from './ControlViews.js';
import { HostAnswering, HostQuestion, HostReveal } from './HostViews.js';
import { PhoneAnswering, PhoneQuestion, PhoneReveal } from './PhoneViews.js';
import './categoryBoard.css';

export const GAME_ID = 'category-board';

export const categoryBoardViews: GameViews = {
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
  control: ControlTilePick,
  card: {
    descriptionKey: 'games.categoryBoard.card.description',
    descriptionFallback: 'A board of categories. Harder tiles are worth more.',
    tags: ['everyone'],
    minutes: 10,
  },
  howToPlay: {
    summaryKey: 'games.categoryBoard.howToPlay.summary',
    summaryFallback: 'A board of categories, each with tiles of rising value.',
    steps: [
      {
        key: 'games.categoryBoard.howToPlay.stepPick',
        fallback: 'The organizer picks a tile. Choose the answer on your phone.',
      },
      {
        key: 'games.categoryBoard.howToPlay.stepPoints',
        fallback: 'Each right answer earns the number on the tile.',
      },
    ],
  },
};

registerGameViews(categoryBoardViews);

export { HostAnswering, HostQuestion, HostReveal } from './HostViews.js';
export { PhoneAnswering, PhoneQuestion, PhoneReveal } from './PhoneViews.js';
export type { HostBoardView, RevealDetail, TileQuestion } from './payload.js';
