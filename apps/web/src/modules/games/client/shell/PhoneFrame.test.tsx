// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlayerSnapshot } from '../../shared/protocol.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import { PhoneFrame, rankToShow } from './PhoneFrame.js';
import type { ThemeControl } from './theme.js';

function snapshotWithRank(yourRank: number | null): PlayerSnapshot {
  return {
    viewer: 'player',
    code: 'QK7P',
    phase: 'reveal',
    paused: false,
    round: 3,
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
    yourScore: 270,
    youAnswered: true,
    yourAnswer: null,
    canChangeAnswer: false,
    yourRank,
    view: null,
    buzz: null,
    youAreSpent: false,
    yourControlRequest: null,
  };
}

let host: HTMLDivElement;

function draw(yourRank: number | null): void {
  act(() => {
    render(
      <PhoneFrame snapshot={snapshotWithRank(yourRank)} yourResult={null} status="open" onReconnectNow={() => undefined}>
        <p>a question</p>
      </PhoneFrame>,
      host
    );
  });
}

describe('what a phone is told about its place', () => {
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

  it('tells a player they are third', () => {
    draw(3);

    expect(host.textContent).toContain('3rd');
  });

  it('tells a fourth-placed player their total and not their place', () => {
    draw(4);

    expect(host.textContent).not.toContain('4th');
    expect(host.textContent).toContain('270');
  });

  it('says nothing about a place the server withheld', () => {
    draw(null);

    expect(host.querySelector('.score-rank')).toBeNull();
  });

  it('shows a place only through the top three', () => {
    expect(rankToShow(1)).toBe(1);
    expect(rankToShow(3)).toBe(3);
    expect(rankToShow(4)).toBeNull();
    expect(rankToShow(12)).toBeNull();
    expect(rankToShow(null)).toBeNull();
  });
});

describe('the round counter’s word', () => {
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

  it('says "Q" by default, the same as the projector', () => {
    act(() => {
      render(
        <PhoneFrame snapshot={snapshotWithRank(null)} yourResult={null} status="open" onReconnectNow={() => undefined}>
          <p>a question</p>
        </PhoneFrame>,
        host
      );
    });
    expect(host.querySelector('.chrome-round')?.textContent).toBe('Q 4 / 10');
  });

  it('uses the game’s own word once the room says one, not only on the projector', () => {
    act(() => {
      render(
        <PhoneFrame
          snapshot={{ ...snapshotWithRank(null), chrome: { roundWord: 'Turn' } }}
          yourResult={null}
          status="open"
          onReconnectNow={() => undefined}
        >
          <p>a turn</p>
        </PhoneFrame>,
        host
      );
    });
    expect(host.querySelector('.chrome-round')?.textContent).toBe('Turn 4 / 10');
  });
});

describe('the theme/settings/leave icons during play', () => {
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

  const themeControl: ThemeControl = {
    theme: DEFAULT_THEME,
    isOverridden: false,
    setOverride: () => undefined,
  };

  it('shows nothing extra when no room actions were given — solo’s own case', () => {
    act(() => {
      render(
        <PhoneFrame snapshot={snapshotWithRank(null)} yourResult={null} status="open" onReconnectNow={() => undefined}>
          <p>a question</p>
        </PhoneFrame>,
        host
      );
    });
    expect(host.querySelector('.lobby-actions')).toBeNull();
  });

  it('offers theme, settings and leave once a game has started, not only in the lobby', () => {
    act(() => {
      render(
        <PhoneFrame
          snapshot={snapshotWithRank(null)}
          yourResult={null}
          status="open"
          onReconnectNow={() => undefined}
          actions={{ joinUrl: 'https://example.org/play?room=QK7P', themeControl, onLeave: () => undefined }}
        >
          <p>a question</p>
        </PhoneFrame>,
        host
      );
    });
    const actions = host.querySelector('.lobby-actions');
    expect(actions).not.toBeNull();
    expect(actions?.textContent).toContain('Theme');
    expect(actions?.textContent).toContain('Settings');
    expect(actions?.textContent).toContain('Leave');
  });
});

describe('the compact-layout hook', () => {
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

  it('carries questionOnScreen through as a data attribute, for a game that reads it', () => {
    act(() => {
      render(
        <PhoneFrame
          snapshot={{ ...snapshotWithRank(null), questionOnScreen: true }}
          yourResult={null}
          status="open"
          onReconnectNow={() => undefined}
        >
          <p>a question</p>
        </PhoneFrame>,
        host
      );
    });
    expect(host.querySelector('.phone')?.getAttribute('data-question-on-screen')).toBe('true');
  });
});
