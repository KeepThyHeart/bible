// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ControlPanel,
  HostCommand,
  RemoteSnapshot,
  RevealPayload,
  Standing,
} from '../../shared/protocol.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import { ClockContext, type ClockPort } from './clockPort.js';
import { clearGameViews, registerGameViews, type GameViews } from './gameViews.js';
import { OrganizerControls } from './OrganizerControls.js';

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
  answeredCount: 2,
  standings: [],
  teamStandings: [],
  overallStandings: [],
  spent: [],
  answer: 'LORD',
};

function remote(overrides: Partial<RemoteSnapshot> = {}): RemoteSnapshot {
  return {
    viewer: 'remote',
    code: 'QK7P',
    phase: 'answering',
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
    players: [
      { id: 'p-1', name: 'Sam', teamId: null, connected: true },
      { id: 'p-2', name: 'Ruth', teamId: null, connected: true },
      { id: 'p-3', name: 'Micah', teamId: null, connected: true },
    ],
    controller: { kind: 'owner' },
    questionOnScreen: true,
    phaseEndsAt: 50_000,
    phaseDurationMs: 40_000,
    revealAt: null,
    serverTime: 40_000,
    standings: [],
    teamStandings: [],
    overallStandings: [],
    answeredCount: 2,
    view: null,
    buzz: null,
    control: PANEL,
    ...overrides,
  };
}

const REVEAL = (round: number): RevealPayload => ({
  round,
  correctLabel: `Answer ${round}`,
  aggregates: [],
  detail: null,
});

let host: HTMLDivElement;
let commands: HostCommand[];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  commands = [];
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  clearGameViews();
});

function draw(
  snapshot: RemoteSnapshot,
  options: { reveal?: RevealPayload | null; panel?: ControlPanel; full?: Standing[] | null } = {}
): void {
  act(() => {
    render(
      <ClockContext.Provider value={stillClock}>
        <OrganizerControls
          snapshot={snapshot}
          panel={options.panel ?? snapshot.control ?? PANEL}
          reveal={options.reveal ?? null}
          fullStandings={options.full ?? null}
          onCommand={(command) => commands.push(command)}
        />
      </ClockContext.Provider>,
      host
    );
  });
}

function button(label: string): HTMLButtonElement | null {
  return [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) ?? null;
}

function toggle(label: string): HTMLButtonElement | null {
  return [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((b) => b.textContent?.startsWith(label)) ?? null;
}

function click(target: HTMLButtonElement | null): void {
  act(() => target?.click());
}

describe('the organizer controls in a round', () => {
  it('counts the round and shows who has answered', () => {
    draw(remote());
    expect(host.textContent).toContain('Question 3 of 10');
    expect(host.textContent).toContain('Answered 2 / 3');
  });

  it('drops "of N" when the game has no set length', () => {
    const base = remote();
    draw(remote({ settings: { ...base.settings, openEnded: true } }));
    expect(host.textContent).toContain('Question 3');
    expect(host.textContent).not.toContain('of 10');
  });

  it('finishes the game only after a confirm', () => {
    draw(remote());
    click(button('Finish'));
    expect(commands).toEqual([]);
    click(button('Finish'));
    expect(commands).toEqual([{ cmd: 'finish' }]);
  });

  it('cancels a finish with Keep playing', () => {
    draw(remote());
    click(button('Finish'));
    click(button('Keep playing'));
    expect(commands).toEqual([]);
    expect(button('Finish')).not.toBeNull();
  });

  it('uses the game’s own word for a round', () => {
    draw(remote({ chrome: { roundWord: 'Turn' } }));
    expect(host.textContent).toContain('Turn 3 of 10');
  });

  it('shows the private answer card only when an answer is set', () => {
    draw(remote());
    expect(host.textContent).toContain('Only you see this');
    expect(host.textContent).toContain('Answer: LORD');

    const quiet = { ...PANEL, answer: null };
    draw(remote({ control: quiet }), { panel: quiet });
    expect(host.textContent).not.toContain('Only you see this');
  });

  it('the main button reveals the answer', () => {
    draw(remote());
    click(button('Show the answer'));
    expect(commands).toEqual([{ cmd: 'revealNow' }]);
  });

  it('pauses, and offers resume once paused', () => {
    draw(remote());
    click(button('Pause'));
    draw(remote({ paused: true }));
    click(button('Resume'));
    expect(commands.map((c) => c.cmd)).toEqual(['pause', 'resume']);
  });

  it('skips only after a confirm', () => {
    draw(remote());
    click(button('Skip'));
    expect(commands).toEqual([]);
    click(button('Skip it'));
    expect(commands).toEqual([{ cmd: 'skip' }]);
  });

  it('hides the answered count for a game that asks for it', () => {
    draw(remote({ chrome: { hideAnswered: true } }));
    expect(host.textContent).not.toContain('Answered');
  });

  it('shows control requests and the judge card', () => {
    const panel: ControlPanel = {
      ...PANEL,
      requests: [{ playerId: 'p-2', askedAt: 1, decidesAt: 2 }],
      pendingJudge: {
        playerId: 'p-1',
        question: 'q',
        canonicalAnswer: 'Naomi',
        accept: ['Naomi'],
        contextNote: null,
        seenPrefix: '',
        playerAnswer: 'naomi',
        suggestion: null,
      },
    };
    draw(remote({ control: panel }), { panel });
    click(button('Let them'));
    click(button('Correct'));
    expect(commands).toEqual([
      { cmd: 'grantControl', playerId: 'p-2' },
      { cmd: 'judge', verdict: 'correct' },
    ]);
  });

  it('draws the game’s own control slot', () => {
    const views = {
      id: 'case',
      host: {},
      player: {},
      control: () => <p>game control slot</p>,
    } as unknown as GameViews;
    registerGameViews(views);
    draw(remote());
    expect(host.textContent).toContain('game control slot');
  });
});

describe('the organizer controls on a reveal', () => {
  it('moves on with the main button, and says so on the last round', () => {
    draw(remote({ phase: 'reveal' }));
    click(button('Next question'));
    draw(remote({ phase: 'reveal', round: 9 }));
    expect(button('See the results')).not.toBeNull();
    expect(commands).toEqual([{ cmd: 'nextRound' }]);
  });

  it('sets auto-advance and scores after each answer', () => {
    draw(remote({ phase: 'reveal' }));
    click(toggle('Move on by itself after 8 seconds'));
    click(toggle('Show scores after each question'));
    expect(commands).toEqual([
      { cmd: 'setSettings', settings: { autoAdvanceMs: 8000 } },
      { cmd: 'setSettings', settings: { scoresAfterEachAnswer: false } },
    ]);
  });

  it('turns auto-advance off again', () => {
    const base = remote({ phase: 'reveal' });
    draw({ ...base, settings: { ...base.settings, autoAdvanceMs: 8000 } });
    click(toggle('Move on by itself after 8 seconds'));
    expect(commands).toEqual([{ cmd: 'setSettings', settings: { autoAdvanceMs: null } }]);
  });

  it('looks back at the question before, not the one on screen', () => {
    draw(remote({ phase: 'reveal', round: 0 }), { reveal: REVEAL(0) });
    expect(button('Back')?.disabled).toBe(true);
    draw(remote({ phase: 'reveal', round: 1 }), { reveal: REVEAL(1) });
    expect(button('Back')?.disabled).toBe(false);
    click(button('Back'));
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Answer 0');
  });
});
