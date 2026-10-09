// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PhaseName, PlayerSnapshot } from '../../shared/protocol.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import { PhoneFrame } from './PhoneFrame.js';

/**
 * The counter on the chrome, which is the one number every person in the room
 * reads all game. It is projected as the round *index* so that a client can
 * echo it back to the server untranslated, and that index starts at zero — so
 * the display and the wire disagree by one on purpose. Nothing tested it, and
 * the first question read "Q 0 / 10".
 */

function snapshotAt(phase: PhaseName, round: number): PlayerSnapshot {
  return {
    viewer: 'player',
    code: 'QK7P',
    phase,
    paused: false,
    round,
    totalRounds: 10,
    settings: {
      gameId: 'fill-in-the-blank',
      setId: null,
      translation: 'KJV',
      teamsEnabled: false,
      rounds: 10,
      answerWindowMs: 20_000,
      showIndividualScores: false,
      solo: false,
      groupVote: false,
      familiarity: 'broad',
      gameOptions: {},
      theme: DEFAULT_THEME,
    },
    players: [{ id: 'p-1', name: 'Miriam', teamId: null, connected: true }],
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: null,
    phaseDurationMs: null,
    revealAt: null,
    serverTime: 1_700_000_000_000,
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

function counterText(phase: PhaseName, round: number): string | null {
  act(() => {
    render(
      <PhoneFrame snapshot={snapshotAt(phase, round)} yourResult={null} status="open" onReconnectNow={() => undefined}>
        <p>a question</p>
      </PhoneFrame>,
      host
    );
  });
  return host.querySelector('.chrome-round')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
}

describe('the round counter', () => {
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

  it('counts the first question as one, not zero', () => {
    expect(counterText('question', 0)).toBe('Q 1 / 10');
  });

  it('counts the last question as the total', () => {
    expect(counterText('answering', 9)).toBe('Q 10 / 10');
  });

  it('keeps the question number through its own reveal', () => {
    expect(counterText('reveal', 4)).toBe('Q 5 / 10');
  });

  it('shows nothing in the lobby, which is not a question yet', () => {
    expect(counterText('lobby', 0)).toBeNull();
  });

  it('shows nothing on the final summary, which is no longer one', () => {
    expect(counterText('summary', 9)).toBeNull();
  });
});
