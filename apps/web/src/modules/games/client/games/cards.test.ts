/**
 * What every game tells the picker and the big screen before its first round.
 * One table over all nine, so a tenth game cannot be added without its words.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { clearGameViews, listGameViews } from '../shell/gameViews.js';
import './category-board/index.js';
import './describe-it/index.js';
import './detective/index.js';
import './fill-in-the-blank/index.js';
import './name-that-reference/index.js';
import './put-in-order/index.js';
import './sword-drill/index.js';
import './who-am-i/index.js';
import './who-said-it/index.js';

afterAll(() => {
  clearGameViews();
});

const TAGS = ['everyone', 'teams', 'outLoud', 'bibles', 'fourPlus'];

/** The app never speaks as "we" or "I", and never says "AI". */
const FORBIDDEN_VOICE = /\b(we|i|our|us|ai)\b/i;

describe('every registered game', () => {
  const games = listGameViews();

  it('is all nine', () => {
    expect(games).toHaveLength(9);
  });

  it.each(games.map((game) => [game.id, game] as const))('%s has a card and rules in plain words', (id, game) => {
    const card = game.card;
    const rules = game.howToPlay;
    if (!card || !rules) throw new Error(`${id} registers no card or rules`);

    expect(card.descriptionKey).toMatch(/^games\.[a-zA-Z]+\.card\.description$/);
    expect(card.descriptionFallback.length).toBeGreaterThan(0);
    expect(card.tags.length).toBeGreaterThan(0);
    for (const tag of card.tags) expect(TAGS).toContain(tag);
    expect(card.minutes).toBeGreaterThanOrEqual(5);

    expect(rules.summaryKey).toMatch(/^games\.[a-zA-Z]+\.howToPlay\.summary$/);
    expect(rules.steps.length).toBeGreaterThanOrEqual(2);
    expect(rules.steps.length).toBeLessThanOrEqual(3);

    const words = [card.descriptionFallback, rules.summaryFallback, ...rules.steps.map((step) => step.fallback)];
    for (const line of words) expect(line, line).not.toMatch(FORBIDDEN_VOICE);
  });

  it('keeps each key under its own game', () => {
    for (const game of games) {
      const base = game.card?.descriptionKey.split('.')[1];
      for (const step of game.howToPlay?.steps ?? []) {
        expect(step.key.startsWith(`games.${base}.howToPlay.`)).toBe(true);
      }
    }
  });
});
