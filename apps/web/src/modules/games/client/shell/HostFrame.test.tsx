// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  GroupResult,
  HostCommand,
  RevealPayload,
  ScreenSnapshot,
} from '../../shared/protocol.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import { ClockContext, type ClockPort } from './clockPort.js';
import { clearGameViews, registerGameViews, type GameViews } from './gameViews.js';
import { HostFrame } from './HostFrame.js';

/** Ten seconds left on every deadline, and a clock that never moves. */
const stillClock: ClockPort = {
  serverNow: () => 40_000,
  msUntil: () => 10_000,
  showAt: () => () => undefined,
  report: () => null,
  onChange: () => () => undefined,
};

function snapshot(overrides: Partial<ScreenSnapshot> = {}): ScreenSnapshot {
  return {
    viewer: 'screen',
    code: 'QK7P',
    phase: 'answering',
    paused: false,
    round: 2,
    totalRounds: 10,
    settings: {
      gameId: 'case',
      setId: null,
      translation: 'KJV',
      teamsEnabled: true,
      rounds: 10,
      answerWindowMs: 20_000,
      teamCount: 2,
      openEnded: false,
      autoAdvanceMs: null,
      scoresAfterEachAnswer: true,
      showIndividualScores: false,
      solo: false,
      groupVote: true,
      familiarity: 'broad',
      gameOptions: {},
      theme: DEFAULT_THEME,
    },
    players: [],
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: 50_000,
    phaseDurationMs: 40_000,
    revealAt: null,
    serverTime: 40_000,
    standings: [],
    teamStandings: [],
    overallStandings: [],
    answeredCount: 0,
    view: null,
    buzz: null,
    // This screen holds control by default; the screen still draws no
    // controls of its own either way.
    control: {
      pendingJudge: null,
      requests: [],
      answeredCount: 0,
      standings: [],
      teamStandings: [],
      overallStandings: [],
      spent: [],
      answer: null,
    },
    ...overrides,
  };
}

const REVEAL: RevealPayload = {
  round: 2,
  correctLabel: 'Moses',
  aggregates: [],
  detail: null,
  groups: [{ teamId: 'red', split: [{ label: 'Moses', count: 2 }], decided: 'Moses', correct: true }],
};

let host: HTMLDivElement;
let commands: HostCommand[];

function draw(shown: ScreenSnapshot, reveal: RevealPayload | null = null): void {
  act(() => {
    render(
      <ClockContext.Provider value={stillClock}>
        <HostFrame
          snapshot={shown}
          status="open"
          reveal={reveal}
          isOwner={true}
          onReclaim={() => undefined}
          onReconnectNow={() => undefined}
        >
          <p>the game's own screen</p>
        </HostFrame>
      </ClockContext.Provider>,
      host
    );
  });
}

function fill(): string | null | undefined {
  return host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow');
}

function button(label: string): HTMLButtonElement | null {
  return (
    [...host.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(label)) ??
    null
  );
}

function click(target: HTMLButtonElement | null): void {
  act(() => {
    target?.click();
  });
}

describe('the host frame', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    commands = [];
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
  });

  it('sizes the timer bar from the phase, not from the room’s default window', () => {
    // Ten seconds left of a forty-second phase; the room's twenty-second
    // default would have drawn it half full.
    draw(snapshot());
    expect(fill()).toBe('25');
  });

  it('fills the bar from what is left when the server gives no length', () => {
    draw(snapshot({ phaseDurationMs: null }));
    expect(fill()).toBe('100');
  });

  it('shows how each team voted under the reveal of the round on screen', () => {
    draw(snapshot({ phase: 'reveal', phaseEndsAt: null, phaseDurationMs: null }), REVEAL);
    expect(host.querySelector('.group-reveal')?.textContent).toContain('Moses — right');
  });

  it('shows no vote for a reveal that belongs to another round', () => {
    draw(snapshot({ phase: 'reveal', round: 3, phaseEndsAt: null, phaseDurationMs: null }), REVEAL);
    expect(host.querySelector('.group-reveal')).toBeNull();
  });

  it('shows no vote for a round that was not voted on', () => {
    const plain: RevealPayload = { round: 2, correctLabel: 'Moses', aggregates: [], detail: null };
    draw(snapshot({ phase: 'reveal', phaseEndsAt: null, phaseDurationMs: null }), plain);
    expect(host.querySelector('.group-reveal')).toBeNull();
  });

  it('words the chrome as the shell does when the game says nothing', () => {
    draw(snapshot());
    expect(host.querySelector('.chrome-round')?.textContent).toBe('Q 3 / 10');
    const base = snapshot();
    draw(snapshot({ settings: { ...base.settings, openEnded: true } }));
    expect(host.querySelector('.chrome-round')?.textContent).toBe('Q 3');
    expect(host.querySelector('.chrome-answered')?.textContent).toBe('Answered 0 / 0');
  });

  it('words the chrome in the game’s own terms, and hides the answered count when asked', () => {
    const chrome = { roundWord: 'Turn', revealLabel: 'End turn', nextLabel: 'Start Blue’s turn', hideAnswered: true };
    draw(snapshot({ chrome }));
    expect(host.querySelector('.chrome-round')?.textContent).toBe('Turn 3 / 10');
    expect(host.querySelector('.chrome-answered')).toBeNull();
  });

  it('offers a retry outside the code and round row while reconnecting', () => {
    let retried = 0;
    act(() => {
      render(
        <ClockContext.Provider value={stillClock}>
          <HostFrame
            snapshot={snapshot()}
            status="reconnecting"
            reveal={null}
            isOwner={true}
            onReclaim={() => undefined}
            onReconnectNow={() => {
              retried += 1;
            }}
          >
            <p>the game's own screen</p>
          </HostFrame>
        </ClockContext.Provider>,
        host
      );
    });
    // Not a child of the row that carries the room code, so a long banner
    // cannot push the code or the round counter around.
    expect(host.querySelector('.chrome-row .banner')).toBeNull();
    const banner = host.querySelector('.banner-row');
    expect(banner?.textContent).toContain('Reconnecting…');
    const retry = banner?.querySelector('button');
    expect(retry?.textContent).toBe('Retry now');
    act(() => {
      retry?.dispatchEvent(new Event('click', { bubbles: true }));
    });
    expect(retried).toBe(1);
  });
});

describe('a vote under a game whose reveal draws the room’s own split', () => {
  const nothing = () => null;
  const views: GameViews = {
    id: 'case',
    host: { question: nothing, answering: nothing, reveal: nothing },
    player: { question: nothing, answering: nothing, reveal: nothing },
    revealDrawsRoomVote: true,
  };
  const blue: GroupResult = { teamId: 'blue', split: [{ label: 'Aaron', count: 1 }], decided: 'Aaron', correct: false };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    registerGameViews(views);
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
    clearGameViews();
  });

  it('leaves a room of one group to the game, so the split is drawn once', () => {
    draw(snapshot({ phase: 'reveal', phaseEndsAt: null, phaseDurationMs: null }), REVEAL);
    expect(host.querySelector('.group-reveal')).toBeNull();
  });

  it('still compares teams when there is more than one', () => {
    const teams: RevealPayload = { ...REVEAL, groups: [...(REVEAL.groups ?? []), blue] };
    draw(snapshot({ phase: 'reveal', phaseEndsAt: null, phaseDurationMs: null }), teams);
    expect(host.querySelectorAll('.group-card')).toHaveLength(2);
  });
});

describe('not holding control', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    commands = [];
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    host.remove();
  });

  function drawAs(shown: ScreenSnapshot, isOwner: boolean): void {
    act(() => {
      render(
        <ClockContext.Provider value={stillClock}>
          <HostFrame
            snapshot={shown}
            status="open"
            reveal={null}
            isOwner={isOwner}
            onReclaim={() => commands.push({ cmd: 'reclaimControl' })}
            onReconnectNow={() => undefined}
          >
            <p>the game's own screen</p>
          </HostFrame>
        </ClockContext.Provider>,
        host
      );
    });
  }

  /** `exactOptionalPropertyTypes` refuses `control: undefined` in an override; this actually omits the key. */
  function withoutControl(shown: ScreenSnapshot): ScreenSnapshot {
    const rest = { ...shown };
    delete rest.control;
    return rest;
  }

  it('names whoever is running the room instead', () => {
    drawAs(
      withoutControl(
        snapshot({
          controller: { kind: 'player', playerId: 'p-1' },
          players: [{ id: 'p-1', name: 'Ellen', teamId: null, connected: true }],
        })
      ),
      true
    );
    expect(host.textContent).toContain('Ellen is the organizer.');
  });

  it('offers Take back control on the owner credential only', () => {
    const notOwned = withoutControl(snapshot({ controller: { kind: 'player', playerId: 'p-1' } }));
    drawAs(notOwned, true);
    expect(button('Take back control')).not.toBeNull();

    act(() => {
      render(null, host);
    });
    drawAs(notOwned, false);
    expect(button('Take back control')).toBeNull();
  });

  it('sends reclaimControl and nothing else', () => {
    drawAs(withoutControl(snapshot({ controller: { kind: 'player', playerId: 'p-1' } })), true);
    click(button('Take back control'));
    expect(commands).toEqual([{ cmd: 'reclaimControl' }]);
  });
});


describe('a screen that holds control', () => {
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

  it('still draws nothing to press: no menu, skip, reveal button or judge card', () => {
    draw(snapshot({ phase: 'answering' }));
    expect(host.querySelectorAll('button')).toHaveLength(0);
    expect(host.querySelector('.host-controls')).toBeNull();
    expect(host.querySelector('.judge-card')).toBeNull();
  });

  it('draws the top three under a reveal', () => {
    draw(
      snapshot({
        phase: 'reveal',
        phaseEndsAt: null,
        phaseDurationMs: null,
        standings: [
          { playerId: 'p-1', name: 'Miriam', teamId: null, score: 300 },
          { playerId: 'p-2', name: 'Jonah', teamId: null, score: 200 },
        ],
      })
    );
    expect(host.querySelector('.score-strip')?.textContent).toContain('Miriam');
  });

  it('draws no score strip while a question is open', () => {
    draw(snapshot({ standings: [{ playerId: 'p-1', name: 'Miriam', teamId: null, score: 300 }] }));
    expect(host.querySelector('.score-strip')).toBeNull();
  });

  it('shows neither a question number nor a timer bar during the rules', () => {
    draw(snapshot({ phase: 'intro', round: 0 }));
    expect(host.querySelector('.chrome-round')).toBeNull();
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
  });
});
