import { describe, expect, it } from 'vitest';
import type { GameModule, GroupVoteSpec } from './games.js';
import { catalogEntryFor, groupVoteApplies } from './games.js';
import type { RoomSettings } from './protocol.js';
import { DEFAULT_THEME } from './theme.js';

const SETTINGS: RoomSettings = {
  gameId: 'case',
  setId: null,
  familiarity: 'broad',
  translation: 'KJV',
  teamsEnabled: false,
  rounds: 10,
  answerWindowMs: 20_000,
  showIndividualScores: false,
  solo: false,
  groupVote: false,
  gameOptions: {},
  theme: DEFAULT_THEME,
};

function spec(mode: 'optional' | 'always', supports?: (settings: RoomSettings) => boolean): GroupVoteSpec {
  return {
    mode,
    ...(supports === undefined ? {} : { supports }),
    key: () => 'a',
    label: () => 'A',
  };
}

function game(groupVote?: GroupVoteSpec): GameModule {
  return {
    id: 'case',
    name: 'Case',
    supportsSolo: false,
    ...(groupVote === undefined ? {} : { groupVote }),
    buildRound: (_context, index) => ({ index, secret: null, hostView: null, playerView: null }),
    scoreRound: () => ({ perPlayer: new Map(), aggregates: [], correctLabel: '', detail: null }),
  };
}

describe('whether a round is a group vote', () => {
  it('never is for a game that offers no vote', () => {
    expect(groupVoteApplies(undefined, { ...SETTINGS, groupVote: true })).toBe(false);
  });

  it('is for an optional vote only when the host turned it on', () => {
    expect(groupVoteApplies(spec('optional'), SETTINGS)).toBe(false);
    expect(groupVoteApplies(spec('optional'), { ...SETTINGS, groupVote: true })).toBe(true);
  });

  it('always is for a game played only that way', () => {
    expect(groupVoteApplies(spec('always'), SETTINGS)).toBe(true);
  });

  it('is not under settings the game says it cannot vote on', () => {
    const typed = spec('optional', (settings) => settings.gameOptions.answer !== 'typed');
    const on = { ...SETTINGS, groupVote: true };
    expect(groupVoteApplies(typed, on)).toBe(true);
    expect(groupVoteApplies(typed, { ...on, gameOptions: { answer: 'typed' } })).toBe(false);
  });
});

describe('what the lobby is told about a game', () => {
  it('says whether and how the game can be voted on', () => {
    expect(catalogEntryFor(game()).groupVote).toBe('none');
    expect(catalogEntryFor(game(spec('optional'))).groupVote).toBe('optional');
    expect(catalogEntryFor(game(spec('always'))).groupVote).toBe('always');
  });

  it('carries the scope label only when the game has one', () => {
    expect('scopeLabel' in catalogEntryFor(game())).toBe(false);
    expect(catalogEntryFor({ ...game(), scopeLabel: 'Gospels' }).scopeLabel).toBe('Gospels');
  });
});
