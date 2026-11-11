// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlPanel, PhaseName, RemoteSnapshot } from '../../shared/protocol.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import { ClockContext, type ClockPort } from './clockPort.js';
import { RemoteApp } from './RemoteApp.js';
import { saveOwnerSession } from './session.js';
import type { StreamFactory, StreamHandlers } from './useRoomStream.js';

vi.mock('./OrganizerLobby.js', () => ({
  OrganizerLobby: () => <p>the organizer lobby</p>,
}));
vi.mock('./OrganizerSummary.js', () => ({
  OrganizerSummary: (props: { onPickAnother(): void }) => (
    <button type="button" onClick={props.onPickAnother}>
      pick another
    </button>
  ),
}));

const stillClock: ClockPort = {
  serverNow: () => 40_000,
  msUntil: () => 10_000,
  showAt: () => () => undefined,
  report: () => null,
  onChange: () => () => undefined,
};

const PANEL: ControlPanel = {
  pendingJudge: null,
  requests: [],
  answeredCount: 1,
  standings: [],
  teamStandings: [],
  overallStandings: [],
  spent: [],
  answer: 'LORD',
};

function remote(phase: PhaseName, overrides: Partial<RemoteSnapshot> = {}): RemoteSnapshot {
  return {
    viewer: 'remote',
    code: 'QK7P',
    phase,
    paused: false,
    round: 2,
    totalRounds: 10,
    settings: {
      gameId: 'case',
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
    players: [{ id: 'p-1', name: 'Sam', teamId: null, connected: true }],
    controller: { kind: 'owner' },
    questionOnScreen: true,
    phaseEndsAt: 50_000,
    phaseDurationMs: 40_000,
    revealAt: null,
    serverTime: 40_000,
    standings: [],
    teamStandings: [],
    overallStandings: [],
    answeredCount: 1,
    view: null,
    buzz: null,
    control: PANEL,
    ...overrides,
  };
}

let host: HTMLDivElement;
let handlers: StreamHandlers | null;
let urls: string[];
let posted: Record<string, unknown>[];

const factory: StreamFactory = (url, next) => {
  urls.push(url);
  handlers = next;
  return { close: () => undefined };
};

function show(snapshot: RemoteSnapshot): void {
  act(() => handlers?.onOpen());
  act(() => handlers?.onMessage(JSON.stringify({ type: 'snapshot', snapshot })));
}

function draw(code: string | null = 'QK7P', onNavigate: (to: string) => void = () => undefined): void {
  act(() => {
    render(
      <ClockContext.Provider value={stillClock}>
        <RemoteApp code={code} onNavigate={onNavigate} streamFactory={factory} />
      </ClockContext.Provider>,
      host
    );
  });
}

function button(label: string): HTMLButtonElement | null {
  return [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) ?? null;
}

beforeEach(() => {
  localStorage.clear();
  handlers = null;
  urls = [];
  posted = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.body) posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return { ok: true, json: async () => ({ games: [], sets: [], translations: [] }) } as Response;
    })
  );
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.unstubAllGlobals();
});

describe('the organizer remote', () => {
  it('points home when this device owns no game', () => {
    const navigate = vi.fn();
    draw('QK7P', navigate);
    expect(host.textContent).toContain('This device is not running a game.');
    act(() => button('Back to the start')?.click());
    expect(navigate).toHaveBeenCalledWith('/games');
    expect(urls).toEqual([]);
  });

  describe('with an owner session', () => {
    beforeEach(() => {
      saveOwnerSession({ code: 'QK7P', ownerToken: 'owner-1', displayToken: 'display-1' });
    });

    it('opens the remote stream with the owner token', () => {
      draw();
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain('as=remote');
      expect(host.textContent).toContain('Opening the game…');
    });

    it('falls back to the last room this device owned', () => {
      draw(null);
      expect(urls).toHaveLength(1);
    });

    it('draws the lobby', () => {
      draw();
      show(remote('lobby', { round: -1 }));
      expect(host.textContent).toContain('the organizer lobby');
    });

    it.each(['intro', 'question', 'answering', 'reveal'] as const)('draws the controls in %s', (phase) => {
      draw();
      show(remote(phase));
      expect(host.querySelector('.organizer')).not.toBeNull();
    });

    it('counts the round once questions begin', () => {
      draw();
      show(remote('question'));
      expect(host.textContent).toContain('Question 3 of 10');
    });

    it('shows the private answer to the remote', () => {
      draw();
      show(remote('answering'));
      expect(host.textContent).toContain('Answer: LORD');
    });

    it('sends the main button’s command with the owner token', async () => {
      draw();
      show(remote('answering'));
      await act(async () => button('Show the answer')?.click());
      expect(posted).toEqual([{ token: 'owner-1', intent: { kind: 'host', command: { cmd: 'revealNow' } } }]);
    });

    it('draws the summary, and picks another game in the same room', async () => {
      const navigate = vi.fn();
      draw('QK7P', navigate);
      show(remote('summary'));
      await act(async () => button('pick another')?.click());
      expect(posted.map((body) => (body['intent'] as { command: { cmd: string } }).command.cmd)).toEqual(['newGame']);
      expect(navigate).not.toHaveBeenCalled();
    });

    it('offers to take control back when a player is running the game', async () => {
      draw();
      const { control: _control, ...withoutControl } = remote('answering', {
        controller: { kind: 'player', playerId: 'p-1' },
      });
      show(withoutControl);
      expect(host.textContent).toContain('Sam is the organizer.');
      await act(async () => button('Take back control')?.click());
      expect(posted).toEqual([{ token: 'owner-1', intent: { kind: 'host', command: { cmd: 'reclaimControl' } } }]);
    });
  });
});
