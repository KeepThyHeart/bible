// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlPanel, PlayerSnapshot } from '../../shared/protocol.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import { PlayApp } from './PlayApp.js';
import { saveSession } from './session.js';

let host: HTMLDivElement;

function codeField(): HTMLInputElement {
  const field = host.querySelector<HTMLInputElement>('input[name="room-code"]');
  if (!field) throw new Error('the join form has no code field');
  return field;
}

/**
 * jsdom has no `EventSource`, and `PlayApp` opens its stream through the
 * real factory rather than an injectable one (only `useRoomStream` itself
 * takes that in tests) — so this stands in for the browser's own global,
 * captured per instance so a test can drive it by hand.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }
}

function latestSource(): FakeEventSource {
  const source = FakeEventSource.instances[FakeEventSource.instances.length - 1];
  if (!source) throw new Error('no stream was opened');
  return source;
}

function sendSnapshot(snapshot: PlayerSnapshot): void {
  act(() => {
    latestSource().onmessage?.({ data: JSON.stringify({ type: 'snapshot', snapshot }) });
  });
}

const CONTROL_PANEL: ControlPanel = {
  pendingJudge: null,
  requests: [],
  answeredCount: 0,
  standings: [],
  teamStandings: [],
  overallStandings: [],
  spent: [],
  answer: null,
};

function playerSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    viewer: 'player',
    code: 'QK7P',
    phase: 'lobby',
    paused: false,
    round: -1,
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
    players: [{ id: 'p-1', name: 'Miriam', teamId: null, connected: true }],
    controller: { kind: 'owner' },
    questionOnScreen: false,
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
    ...overrides,
  };
}

describe('arriving on a phone', () => {
  beforeEach(() => {
    localStorage.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
  });

  it('asks for a code when this device is not in a room', () => {
    act(() => {
      render(<PlayApp code={null} onNavigate={() => undefined} />, host);
    });

    expect(codeField().value).toBe('');
    expect(host.textContent).toContain('Game code');
  });

  it('fills in the code a scanned link carried', () => {
    act(() => {
      render(<PlayApp code="K7C48" onNavigate={() => undefined} />, host);
    });

    expect(codeField().value).toBe('K7C48');
  });

  it('offers the name this device used last time', () => {
    localStorage.setItem('bible-games:name', 'Miriam');

    act(() => {
      render(<PlayApp code={null} onNavigate={() => undefined} />, host);
    });

    const name = host.querySelector<HTMLInputElement>('input[name="display-name"]');
    expect(name?.value).toBe('Miriam');
  });

  it('hands off to playing alone', () => {
    const navigate = vi.fn();

    act(() => {
      render(<PlayApp code={null} onNavigate={navigate} />, host);
    });
    const solo = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Play on my own'
    );
    act(() => {
      solo?.click();
    });

    expect(navigate).toHaveBeenCalledWith('/games/solo');
  });
});

describe('control on a phone', () => {
  let posted: Record<string, unknown>[];

  beforeEach(() => {
    localStorage.clear();
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    posted = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.body) posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return { ok: true, json: async () => ({}) } as Response;
      })
    );
    host = document.createElement('div');
    document.body.appendChild(host);
    // Already joined, so the stream opens straight away — no join screen.
    saveSession({ code: 'QK7P', playerId: 'p-1', token: 'tok-1', name: 'Miriam' });
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
    vi.unstubAllGlobals();
  });

  it('shows the bar when this phone holds control, and not otherwise', () => {
    act(() => {
      render(<PlayApp code="QK7P" onNavigate={() => undefined} />, host);
    });
    act(() => latestSource().onopen?.());

    sendSnapshot(playerSnapshot({ phase: 'answering' }));
    expect(host.querySelector('.organizer')).toBeNull();

    sendSnapshot(playerSnapshot({ phase: 'answering', control: CONTROL_PANEL }));
    expect(host.querySelector('.organizer')).not.toBeNull();
  });

  it('shows the main button and the secondary row above the player view, with no answer card', async () => {
    act(() => {
      render(<PlayApp code="QK7P" onNavigate={() => undefined} />, host);
    });
    act(() => latestSource().onopen?.());
    sendSnapshot(playerSnapshot({ phase: 'answering', control: CONTROL_PANEL }));

    const labels = [...host.querySelectorAll('.organizer button')].map((b) => b.textContent?.trim());
    expect(labels).toContain('Show the answer');
    expect(labels).toContain('Pause');
    expect(labels).toContain('Skip');
    expect(host.textContent).not.toContain('Only you see this');

    const main = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Show the answer');
    await act(async () => main?.click());
    const sent = posted.filter((body) => {
      const intent = body['intent'] as { kind?: string } | undefined;
      return intent?.kind === 'host';
    });
    expect(sent).toHaveLength(1);
    expect((sent[0]?.['intent'] as { command: { cmd: string } }).command.cmd).toBe('revealNow');
  });

  it('the request button posts requestControl once and then shows its status', () => {
    act(() => {
      render(<PlayApp code="QK7P" onNavigate={() => undefined} />, host);
    });
    act(() => latestSource().onopen?.());
    sendSnapshot(playerSnapshot());

    const runButton = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Ask to be the organizer'
    );
    act(() => runButton?.click());
    act(() => runButton?.click());

    const requested = posted.filter((body) => {
      const intent = body['intent'] as Record<string, unknown> | undefined;
      return intent?.['kind'] === 'requestControl';
    });
    expect(requested).toHaveLength(1);

    sendSnapshot(playerSnapshot({ yourControlRequest: 'pending' }));
    expect(host.textContent).toContain('Waiting for the organizer to say yes');
    expect(host.querySelector('button')?.textContent).not.toBe('Ask to be the organizer');
  });
});
