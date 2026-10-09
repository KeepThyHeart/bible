// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlayerSnapshot } from '../../shared/protocol.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import { SoloSummary } from './Summary.js';

function soloSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    viewer: 'player',
    code: 'QK7P',
    phase: 'summary',
    paused: false,
    round: 9,
    totalRounds: 10,
    settings: {
      gameId: 'fill-in-the-blank',
      setId: null,
      translation: 'KJV',
      teamsEnabled: false,
      rounds: 10,
      answerWindowMs: 20_000,
      showIndividualScores: false,
      solo: true,
      groupVote: false,
      familiarity: 'broad',
      gameOptions: {},
      theme: DEFAULT_THEME,
    },
    players: [{ id: 'p-1', name: 'You', teamId: null, connected: true }],
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: null,
    phaseDurationMs: null,
    revealAt: null,
    serverTime: 1_000,
    you: { id: 'p-1', name: 'You', teamId: null, connected: true },
    yourScore: 340,
    youAnswered: true,
    yourAnswer: null,
    canChangeAnswer: false,
    yourRank: 1,
    view: null,
    buzz: null,
    youAreSpent: false,
    yourControlRequest: null,
    ...overrides,
  };
}

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

describe('solo’s own ending', () => {
  it('shows the total and how many rounds were played, not a rank or a big screen it does not have', () => {
    act(() => {
      render(<SoloSummary snapshot={soloSnapshot()} />, host);
    });
    expect(host.textContent).toContain('340');
    expect(host.textContent).toContain('Played 10 rounds');
    expect(host.textContent).not.toContain('big screen');
    expect(host.textContent).not.toContain('place');
  });
});
