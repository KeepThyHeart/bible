// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  GroupResult,
  HostCommand,
  RevealPayload,
  ScreenSnapshot,
  Standing,
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
    // This screen holds control by default, so the existing behaviour here —
    // pause, skip, the menu — exercises the extracted `ControlBar` exactly as
    // it did before the extraction. See the 'not controlling' describe block
    // below for the other state.
    control: {
      pendingJudge: null,
      requests: [],
      answeredCount: 0,
      standings: [],
      teamStandings: [],
      overallStandings: [],
      spent: [],
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

function draw(
  shown: ScreenSnapshot,
  reveal: RevealPayload | null = null,
  onCommand: (command: HostCommand) => void = () => undefined,
  fullStandings: Standing[] | null = null
): void {
  act(() => {
    render(
      <ClockContext.Provider value={stillClock}>
        <HostFrame
          snapshot={shown}
          status="open"
          reveal={reveal}
          fullStandings={fullStandings}
          isOwner={true}
          onCommand={onCommand}
          onReconnectNow={() => undefined}
        >
          <p>the game's own screen</p>
        </HostFrame>
      </ClockContext.Provider>,
      host
    );
  });
}

function drawInteractive(shown: ScreenSnapshot, reveal: RevealPayload | null = null): void {
  draw(shown, reveal, (command) => commands.push(command));
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
    expect(host.querySelector('.chrome-answered')?.textContent).toBe('Answered 0 / 0');
    expect(host.textContent).toContain('Reveal now');
    draw(snapshot({ phase: 'reveal', phaseEndsAt: null, phaseDurationMs: null }));
    expect(host.textContent).toContain('Next question');
  });

  it('words the chrome in the game’s own terms, and hides the answered count when asked', () => {
    const chrome = { roundWord: 'Turn', revealLabel: 'End turn', nextLabel: 'Start Blue’s turn', hideAnswered: true };
    draw(snapshot({ chrome }));
    expect(host.querySelector('.chrome-round')?.textContent).toBe('Turn 3 / 10');
    expect(host.querySelector('.chrome-answered')).toBeNull();
    expect(host.textContent).toContain('End turn');
    expect(host.textContent).not.toContain('Reveal now');
    draw(snapshot({ chrome, phase: 'reveal', phaseEndsAt: null, phaseDurationMs: null }));
    expect(host.textContent).toContain('Start Blue’s turn');
  });

  it('offers a retry outside the code/round/menu row while reconnecting', () => {
    let retried = 0;
    act(() => {
      render(
        <ClockContext.Provider value={stillClock}>
          <HostFrame
            snapshot={snapshot()}
            status="reconnecting"
            reveal={null}
            fullStandings={null}
            isOwner={true}
            onCommand={() => undefined}
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
    // cannot push the code or the menu button around.
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

describe('pause and next, in the main control bar', () => {
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

  it('sends pause, and shows resume once the room says it is paused', () => {
    drawInteractive(snapshot({ paused: false }));
    click(button('Pause'));
    expect(commands).toEqual([{ cmd: 'pause' }]);

    drawInteractive(snapshot({ paused: true }));
    expect(button('Resume')).not.toBeNull();
    expect(button('Pause')).toBeNull();
  });

  it('asks before skipping a question still in play, and only skips once confirmed', () => {
    drawInteractive(snapshot({ phase: 'answering' }));
    click(button('Skip'));
    expect(commands).toEqual([]);
    expect(host.textContent).toContain('Keep going');

    click(button('Skip it'));
    expect(commands).toEqual([{ cmd: 'skip' }]);
  });

  it('backing out of the skip confirmation sends nothing', () => {
    drawInteractive(snapshot({ phase: 'answering' }));
    click(button('Skip'));
    click(button('Keep going'));
    expect(commands).toEqual([]);
    expect(button('Skip')).not.toBeNull();
  });

  it('moves straight on from a reveal, with no confirmation', () => {
    drawInteractive(snapshot({ phase: 'reveal', phaseEndsAt: null, phaseDurationMs: null }));
    click(button('Next question'));
    expect(commands).toEqual([{ cmd: 'nextRound' }]);
  });

  it('drops Pause and Next once the game has reached its summary — only Back is left to press', () => {
    drawInteractive(snapshot({ phase: 'summary', phaseEndsAt: null, phaseDurationMs: null }));
    expect(button('Pause')).toBeNull();
    expect(button('Resume')).toBeNull();
    expect(button('Skip')).toBeNull();
    expect(button('Next question')).toBeNull();
    expect(button('Back')).not.toBeNull();
  });
});

describe('the room menu', () => {
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

  function openMenu(): void {
    click(host.querySelector('.host-menu-toggle'));
  }

  it('keeps New game, Close room and the scores switch out of the main control bar', () => {
    drawInteractive(snapshot());
    expect(button('New game')).toBeNull();
    expect(button('Close room')).toBeNull();
    expect(host.textContent).not.toContain('Scores:');
  });

  it('opens on the hamburger, and offers them there instead', () => {
    drawInteractive(snapshot());
    openMenu();
    expect(button('New game')).not.toBeNull();
    expect(button('Close room')).not.toBeNull();
    expect(host.textContent).toContain('Scores: top three');
  });

  it('sends the scores toggle and closes nothing else by doing it', () => {
    drawInteractive(snapshot());
    openMenu();
    click(button('Scores:'));
    expect(commands).toEqual([{ cmd: 'setSettings', settings: { showIndividualScores: true } }]);
  });

  it('warns before starting a new game while this one is not finished, and still asks to confirm', () => {
    drawInteractive(snapshot({ phase: 'answering' }));
    openMenu();
    click(button('New game'));
    expect(host.textContent).toContain('not finished yet');
    expect(commands).toEqual([]);

    click(button('Start a new game'));
    expect(commands).toEqual([{ cmd: 'newGame' }]);
  });

  it('does not warn once the game has reached its summary', () => {
    drawInteractive(snapshot({ phase: 'summary', phaseEndsAt: null, phaseDurationMs: null }));
    openMenu();
    click(button('New game'));
    expect(host.textContent).not.toContain('not finished yet');
  });

  it('closes room only after a second confirming tap', () => {
    drawInteractive(snapshot());
    openMenu();
    click(button('Close room'));
    expect(commands).toEqual([]);
    click(button('End it'));
    expect(commands).toEqual([{ cmd: 'end' }]);
  });

  it('opens Overall winners from the menu, showing the whole session’s top three', () => {
    const withOverall = snapshot({
      control: {
        pendingJudge: null,
        requests: [],
        answeredCount: 0,
        standings: [],
        teamStandings: [],
        overallStandings: [
          { playerId: 'p-1', name: 'Miriam', teamId: null, score: 140 },
          { playerId: 'p-2', name: 'Jonah', teamId: null, score: 90 },
        ],
        spent: [],
      },
    });
    drawInteractive(withOverall);
    openMenu();
    click(button('Overall winners'));
    expect(host.textContent).toContain('Overall winners');
    expect(host.textContent).toContain('Miriam');
    expect(host.textContent).toContain('140');
    expect(host.textContent).toContain('Jonah');
  });

  it('says so plainly when nobody has an overall score yet', () => {
    drawInteractive(snapshot());
    openMenu();
    click(button('Overall winners'));
    expect(host.textContent).toContain('Nobody has scored yet.');
  });

  it('opens Manage players from the menu, listing the roster', () => {
    const withPlayers = snapshot({
      players: [
        { id: 'p-1', name: 'Miriam', teamId: null, connected: true },
        { id: 'p-2', name: 'Jonah', teamId: null, connected: false },
      ],
    });
    drawInteractive(withPlayers);
    openMenu();
    click(button('Manage players'));
    expect(host.textContent).toContain('Manage players');
    expect(host.textContent).toContain('Miriam');
    expect(host.textContent).toContain('Jonah');
    expect(host.textContent).toContain('(away)');
  });

  it('adjusts a player’s score by the tapped increment', () => {
    const withPlayers = snapshot({
      players: [{ id: 'p-1', name: 'Miriam', teamId: null, connected: true }],
    });
    drawInteractive(withPlayers);
    openMenu();
    click(button('Manage players'));
    click(button('+10'));
    expect(commands).toEqual([{ cmd: 'adjust', playerId: 'p-1', delta: 10 }]);
  });

  it('kicks a player only after a second confirming tap', () => {
    const withPlayers = snapshot({
      players: [{ id: 'p-1', name: 'Miriam', teamId: null, connected: true }],
    });
    drawInteractive(withPlayers);
    openMenu();
    click(button('Manage players'));
    click(button('Kick'));
    expect(commands).toEqual([]);
    click(button('Remove'));
    expect(commands).toEqual([{ cmd: 'kick', playerId: 'p-1' }]);
  });

  it('asks the room for full standings the moment the menu item is tapped, and shows them once they arrive', () => {
    draw(snapshot(), null, (command) => commands.push(command));
    openMenu();
    click(button('Full standings'));
    expect(commands).toEqual([{ cmd: 'requestFullStandings' }]);
    expect(host.textContent).toContain('Asking the room…');

    draw(
      snapshot(),
      null,
      (command) => commands.push(command),
      [
        { playerId: 'p-1', name: 'Miriam', teamId: null, score: 90 },
        { playerId: 'p-2', name: 'Jonah', teamId: null, score: 10 },
      ]
    );
    expect(host.textContent).toContain('Miriam');
    expect(host.textContent).toContain('Jonah');
    expect(host.textContent).not.toContain('Asking the room…');
  });
});

describe('looking Back at the previous question', () => {
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

  const LAST_REVEAL: RevealPayload = {
    round: 1,
    correctLabel: 'Genesis 1:1',
    aggregates: [{ label: 'Correct', count: 3 }],
    detail: null,
  };

  it('has nothing to show, and no button worth pressing, before any round has been revealed', () => {
    draw(snapshot({ round: 0, phase: 'question' }));
    expect(button('Back')?.hasAttribute('disabled')).toBe(true);
  });

  it('remembers the last reveal seen, even once the room has moved past it and cleared its own copy', () => {
    // The reveal arrives for round 1...
    draw(snapshot({ round: 1, phase: 'reveal', phaseEndsAt: null, phaseDurationMs: null }), LAST_REVEAL);
    // ...and by the time round 2 opens, the room's own `reveal` prop has gone
    // back to null (a reveal belongs to one round) — exactly the moment Back
    // has to still work.
    draw(snapshot({ round: 2, phase: 'question' }), null);

    expect(button('Back')?.hasAttribute('disabled')).toBe(false);
    click(button('Back'));
    expect(host.textContent).toContain('Genesis 1:1');
    expect(host.textContent).toContain('nothing here changes the room');
  });

  it('sends no command at all — it only ever reads what already happened', () => {
    draw(snapshot({ round: 1, phase: 'reveal', phaseEndsAt: null, phaseDurationMs: null }), LAST_REVEAL, (command) =>
      commands.push(command)
    );
    draw(snapshot({ round: 2, phase: 'question' }), null, (command) => commands.push(command));
    click(button('Back'));
    expect(commands).toEqual([]);
  });

  it('is disabled again while the round on screen is itself the reveal', () => {
    draw(snapshot({ round: 1, phase: 'reveal', phaseEndsAt: null, phaseDurationMs: null }), LAST_REVEAL);
    expect(button('Back')?.hasAttribute('disabled')).toBe(true);
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
            fullStandings={null}
            isOwner={isOwner}
            onCommand={(command) => commands.push(command)}
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

  it('renders no control bar, and names whoever is running the room instead', () => {
    drawAs(
      withoutControl(
        snapshot({
          controller: { kind: 'player', playerId: 'p-1' },
          players: [{ id: 'p-1', name: 'Ellen', teamId: null, connected: true }],
        })
      ),
      true
    );
    expect(host.querySelector('.host-controls')).toBeNull();
    expect(host.querySelector('.host-menu')).toBeNull();
    expect(host.textContent).toContain('Ellen is running the room.');
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

describe('a phone asking to run the room', () => {
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

  it('shows a waiting request and lets the controller approve or decline it', () => {
    drawInteractive(
      snapshot({
        control: {
          pendingJudge: null,
          requests: [{ playerId: 'p-2', askedAt: 1_000, decidesAt: 46_000 }],
          answeredCount: 0,
          standings: [],
          teamStandings: [],
          overallStandings: [],
          spent: [],
        },
      })
    );
    expect(button('Let them')).not.toBeNull();

    click(button('Let them'));
    expect(commands).toEqual([{ cmd: 'grantControl', playerId: 'p-2' }]);
  });

  it('declines with denyControl', () => {
    drawInteractive(
      snapshot({
        control: {
          pendingJudge: null,
          requests: [{ playerId: 'p-2', askedAt: 1_000, decidesAt: 46_000 }],
          answeredCount: 0,
          standings: [],
          teamStandings: [],
          overallStandings: [],
          spent: [],
        },
      })
    );
    click(button('No'));
    expect(commands).toEqual([{ cmd: 'denyControl', playerId: 'p-2' }]);
  });
});
