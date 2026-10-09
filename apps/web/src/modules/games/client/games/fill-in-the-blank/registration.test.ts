import { afterAll, describe, expect, it } from 'vitest';
import { clearGameViews, getGameViews, hostViewFor, playerViewFor } from '../../shell/gameViews.js';
import { GAME_ID, fillInTheBlankViews } from './index.js';

// The registry is process-wide, and one left populated is a puzzle for the
// next file rather than a failure in this one.
afterAll(() => {
  clearGameViews();
});

describe('putting the game on the client', () => {
  it('registers itself as a side effect of being imported', () => {
    expect(getGameViews(GAME_ID)).toBe(fillInTheBlankViews);
  });

  it('covers all three phases on both screens', () => {
    for (const phase of ['question', 'answering', 'reveal'] as const) {
      expect(hostViewFor(GAME_ID, phase)).toBe(fillInTheBlankViews.host[phase]);
      expect(playerViewFor(GAME_ID, phase)).toBe(fillInTheBlankViews.player[phase]);
    }
  });

  it('is named descriptively, never by a number', () => {
    expect(GAME_ID).toBe('fill-in-the-blank');
  });
});
