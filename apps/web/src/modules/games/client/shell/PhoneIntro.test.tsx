// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlayerSnapshot } from '../../shared/protocol.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import type { GameViews } from './gameViews.js';
import { clearGameViews, registerGameViews } from './gameViews.js';
import { PhoneIntro } from './PhoneIntro.js';

function snapshot(questionOnScreen: boolean): PlayerSnapshot {
  return {
    viewer: 'player',
    code: 'QK7P',
    phase: 'intro',
    paused: false,
    round: -1,
    totalRounds: 10,
    settings: {
      gameId: 'fill-in-the-blank',
      setId: null,
      translation: 'KJV',
      teamsEnabled: false,
      rounds: 10,
      answerWindowMs: 20_000,
      teamCount: 2,
      openEnded: false,
      autoAdvanceMs: null,
      scoresAfterEachAnswer: true,
      showIndividualScores: false,
      solo: false,
      groupVote: false,
      familiarity: 'broad',
      gameOptions: {},
      theme: DEFAULT_THEME,
    },
    players: [{ id: 'p-1', name: 'Miriam', teamId: null, connected: true }],
    controller: { kind: 'owner' },
    questionOnScreen,
    phaseEndsAt: null,
    phaseDurationMs: null,
    revealAt: null,
    serverTime: 1_000,
    you: { id: 'p-1', name: 'Miriam', teamId: null, connected: true },
    yourScore: 0,
    youAnswered: false,
    yourAnswer: null,
    canChangeAnswer: false,
    yourRank: null,
    view: null,
    buzz: null,
    youAreSpent: false,
    yourControlRequest: null,
  };
}

let host: HTMLDivElement;

function draw(questionOnScreen: boolean): void {
  act(() => {
    render(<PhoneIntro snapshot={snapshot(questionOnScreen)} />, host);
  });
}

function registerRules(): void {
  registerGameViews({
    id: 'fill-in-the-blank',
    host: {} as GameViews['host'],
    player: {} as GameViews['player'],
    howToPlay: {
      summaryKey: 'games.fillInTheBlank.howToPlay.summary',
      summaryFallback: 'A verse appears with one word missing.',
      steps: [{ key: 'games.fillInTheBlank.howToPlay.step1', fallback: 'Type the word before the timer ends.' }],
    },
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  clearGameViews();
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
  clearGameViews();
});

describe('the phone during the how-to-play pause', () => {
  it('names the game and points at the screen when there is one', () => {
    registerRules();
    draw(true);

    expect(host.querySelector('h2')?.textContent).toBe('Fill in the blank');
    expect(host.textContent).toContain('Starting soon. Watch the screen.');
    expect(host.textContent).not.toContain('Type the word');
  });

  it('shows the rules instead when there is no screen', () => {
    registerRules();
    draw(false);

    expect(host.textContent).toContain('A verse appears with one word missing.');
    expect(host.textContent).toContain('Type the word before the timer ends.');
    expect(host.textContent).not.toContain('Watch the screen');
  });

  it('shows only the game name when there is no screen and no rules are registered', () => {
    draw(false);

    expect(host.querySelector('h2')?.textContent).toBe('Fill in the blank');
    expect(host.querySelector('ol')).toBeNull();
    expect(host.textContent).not.toContain('Watch the screen');
  });
});
