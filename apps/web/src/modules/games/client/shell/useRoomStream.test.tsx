// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerSnapshot } from '../../shared/protocol.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import type { StreamFactory, StreamHandlers } from './useRoomStream.js';
import { useRoomStream } from './useRoomStream.js';

function snapshotFor(name: string, round: number): PlayerSnapshot {
  return {
    viewer: 'player',
    code: 'QK7P',
    phase: 'answering',
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
    players: [{ id: 'p-1', name, teamId: null, connected: true }],
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: null,
    phaseDurationMs: null,
    revealAt: null,
    serverTime: 1_700_000_000_000,
    you: { id: 'p-1', name, teamId: null, connected: true },
    yourScore: 120,
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

interface OpenedStream {
  handlers: StreamHandlers;
  closed: boolean;
}

/**
 * A stream the test drives by hand. jsdom has no `EventSource`, and a test
 * that cannot drop a connection on purpose is not testing reconnection.
 */
function recordingFactory(): { opened: OpenedStream[]; factory: StreamFactory } {
  const opened: OpenedStream[] = [];
  const factory: StreamFactory = (_url, handlers) => {
    const stream: OpenedStream = { handlers, closed: false };
    opened.push(stream);
    return {
      close() {
        stream.closed = true;
      },
    };
  };
  return { opened, factory };
}

function latest(opened: OpenedStream[]): OpenedStream {
  const stream = opened[opened.length - 1];
  if (!stream) throw new Error('no stream was opened');
  return stream;
}

function Probe({ factory }: { factory: StreamFactory }) {
  const stream = useRoomStream({ code: 'QK7P', token: 'tok', factory });
  const name = stream.snapshot?.viewer === 'player' ? stream.snapshot.you.name : '';
  return (
    <p data-status={stream.status}>
      {name} at question {stream.snapshot?.round ?? 0}
    </p>
  );
}

let host: HTMLDivElement;

function status(): string | null {
  return host.querySelector('p')?.getAttribute('data-status') ?? null;
}

describe('the room stream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
    vi.useRealTimers();
  });

  it('renders the first snapshot it is given', () => {
    const { opened, factory } = recordingFactory();

    act(() => {
      render(<Probe factory={factory} />, host);
    });
    expect(status()).toBe('connecting');

    act(() => {
      latest(opened).handlers.onOpen();
      latest(opened).handlers.onMessage(
        JSON.stringify({ type: 'snapshot', snapshot: snapshotFor('Miriam', 3) })
      );
    });

    expect(status()).toBe('open');
    expect(host.textContent).toContain('Miriam at question 3');
  });

  it('ignores a frame it cannot read rather than losing the screen', () => {
    const { opened, factory } = recordingFactory();

    act(() => {
      render(<Probe factory={factory} />, host);
    });
    act(() => {
      latest(opened).handlers.onOpen();
      latest(opened).handlers.onMessage(
        JSON.stringify({ type: 'snapshot', snapshot: snapshotFor('Miriam', 3) })
      );
    });

    act(() => {
      latest(opened).handlers.onMessage('{"type": "snap');
    });

    expect(host.textContent).toContain('Miriam at question 3');
  });

  it('comes back after the connection drops, and keeps the screen meanwhile', () => {
    const { opened, factory } = recordingFactory();

    act(() => {
      render(<Probe factory={factory} />, host);
    });
    act(() => {
      latest(opened).handlers.onOpen();
      latest(opened).handlers.onMessage(
        JSON.stringify({ type: 'snapshot', snapshot: snapshotFor('Miriam', 3) })
      );
    });

    act(() => {
      latest(opened).handlers.onError();
    });

    expect(status()).toBe('reconnecting');
    expect(opened[0]?.closed).toBe(true);
    // The phone goes on showing the question it already has: a drop is not a
    // reason to blank the screen in the middle of a round.
    expect(host.textContent).toContain('Miriam at question 3');

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(opened).toHaveLength(2);

    act(() => {
      latest(opened).handlers.onOpen();
      latest(opened).handlers.onMessage(
        JSON.stringify({ type: 'snapshot', snapshot: snapshotFor('Miriam', 4) })
      );
    });

    expect(status()).toBe('open');
    expect(host.textContent).toContain('Miriam at question 4');
  });

  it('waits before retrying rather than hammering a server that is down', () => {
    const { opened, factory } = recordingFactory();

    act(() => {
      render(<Probe factory={factory} />, host);
    });
    act(() => {
      latest(opened).handlers.onError();
    });

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(opened).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(opened).toHaveLength(2);
  });

  it('stops for good once the room is closed', () => {
    const { opened, factory } = recordingFactory();

    act(() => {
      render(<Probe factory={factory} />, host);
    });
    act(() => {
      latest(opened).handlers.onOpen();
      latest(opened).handlers.onMessage(
        JSON.stringify({ type: 'roomClosed', reason: 'The host ended the game.' })
      );
    });

    expect(status()).toBe('ended');

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(opened).toHaveLength(1);
  });
});
