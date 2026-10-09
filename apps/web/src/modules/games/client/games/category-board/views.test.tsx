// @vitest-environment jsdom
/**
 * What the two screens actually put in front of people.
 *
 * The assertions worth having here are not about markup. They are that the big
 * screen never carries a name beside a count, that it marks the tiles already
 * played in words, that a tap sends exactly one answer for the round the phone
 * believes it is in, and that a payload the client cannot read draws a line of
 * text rather than an exception.
 */

import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  HostCommand,
  Intent,
  PersonalResult,
  PlayerSnapshot,
  RevealPayload,
  RoomSettings,
  ScreenSnapshot,
} from '../../../shared/protocol.js';
import { DEFAULT_THEME } from '../../../shared/theme.js';
import type { ClockPort } from '../../shell/clockPort.js';
import { getGameViews } from '../../shell/gameViews.js';
import { GAME_ID, categoryBoardViews } from './index.js';

const SETTINGS: RoomSettings = {
  gameId: GAME_ID,
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
};

const QUESTION = {
  category: 'Prophets',
  value: 200,
  prompt: 'Which prophet went up by a whirlwind into heaven?',
  options: [
    { index: 0, label: 'Elisha' },
    { index: 1, label: 'Elijah' },
    { index: 2, label: 'Enoch' },
    { index: 3, label: 'Moses' },
  ],
};

const HOST_VIEW = {
  columns: [
    {
      name: 'Prophets',
      tiles: [
        { value: 100, state: 'played' },
        { value: 200, state: 'current' },
        { value: 300, state: 'open' },
        { value: 400, state: 'open' },
        { value: 500, state: 'open' },
      ],
    },
    {
      name: 'Kings and Queens',
      tiles: [
        { value: 100, state: 'played' },
        { value: 200, state: 'open' },
        { value: 300, state: 'open' },
        { value: 400, state: 'open' },
        { value: 500, state: 'open' },
      ],
    },
  ],
  tile: QUESTION,
};

const CLEARED_VIEW = {
  columns: HOST_VIEW.columns.map((column) => ({
    ...column,
    tiles: column.tiles.map((tile) => ({ ...tile, state: 'played' })),
  })),
  tile: null,
};

const REVEAL: RevealPayload = {
  round: 2,
  correctLabel: 'Elijah',
  aggregates: [
    { label: 'Elisha', count: 2 },
    { label: 'Elijah', count: 5 },
    { label: 'Enoch', count: 0 },
    { label: 'Moses', count: 1 },
  ],
  detail: {
    category: 'Prophets',
    value: 200,
    prompt: QUESTION.prompt,
    answer: 'Elijah',
    reference: '2 Kings 2:11',
    options: [
      { label: 'Elisha', correct: false },
      { label: 'Elijah', correct: true },
      { label: 'Enoch', correct: false },
      { label: 'Moses', correct: false },
    ],
  },
};

/** Nothing in these views reads the clock; the shell owns every countdown. */
const stoppedClock: ClockPort = {
  serverNow: () => 1_700_000_000_000,
  msUntil: () => 0,
  showAt: (_at, task) => {
    task();
    return () => undefined;
  },
  report: () => null,
  onChange: () => () => undefined,
};

function hostSnapshot(view: unknown, overrides: Partial<ScreenSnapshot> = {}): ScreenSnapshot {
  return {
    viewer: 'screen',
    code: 'QK7P',
    phase: 'answering',
    paused: false,
    round: 2,
    totalRounds: 10,
    settings: SETTINGS,
    players: [{ id: 'p-1', name: 'Miriam', teamId: null, connected: true }],
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: null,
    phaseDurationMs: null,
    revealAt: null,
    serverTime: 1_700_000_000_000,
    standings: [],
    teamStandings: [],
    overallStandings: [],
    answeredCount: 0,
    view,
    buzz: null,
    ...overrides,
  };
}

function playerSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    viewer: 'player',
    code: 'QK7P',
    phase: 'answering',
    paused: false,
    round: 2,
    totalRounds: 10,
    settings: SETTINGS,
    players: [],
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
    view: QUESTION,
    buzz: null,
    youAreSpent: false,
    yourControlRequest: null,
    ...overrides,
  };
}

let host: HTMLDivElement;
let sent: Intent[];
let commands: HostCommand[];

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  sent = [];
  commands = [];
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

function drawHost(
  phase: 'question' | 'answering' | 'reveal',
  view: unknown = HOST_VIEW,
  reveal: RevealPayload | null = null,
  overrides: Partial<ScreenSnapshot> = {}
): void {
  const View = categoryBoardViews.host[phase];
  act(() => {
    render(
      <View
        snapshot={hostSnapshot(view, overrides)}
        view={view}
        reveal={reveal}
        clock={stoppedClock}
        send={(command) => commands.push(command)}
      />,
      host
    );
  });
}

function drawPhone(
  phase: 'question' | 'answering' | 'reveal',
  options: {
    view?: unknown;
    reveal?: RevealPayload | null;
    yourResult?: PersonalResult | null;
    snapshot?: Partial<PlayerSnapshot>;
  } = {}
): void {
  const View = categoryBoardViews.player[phase];
  const view = 'view' in options ? options.view : QUESTION;
  act(() => {
    render(
      <View
        snapshot={playerSnapshot({ view, ...options.snapshot })}
        view={view}
        reveal={options.reveal ?? null}
        yourResult={options.yourResult ?? null}
        clock={stoppedClock}
        send={(intent) => sent.push(intent)}
      />,
      host
    );
  });
}

function buttons(): HTMLButtonElement[] {
  return [...host.querySelectorAll('button')];
}

function click(element: Element | undefined): void {
  act(() => {
    (element as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function tileStates(): (string | null)[] {
  return [...host.querySelectorAll('.cb-tile')].map((tile) => tile.getAttribute('data-state'));
}

describe('the big screen', () => {
  it('puts up the board with the tile in play, and the question, before the options', () => {
    drawHost('question');

    expect(host.querySelectorAll('.cb-column')).toHaveLength(2);
    expect(host.textContent).toContain('Prophets for 200');
    expect(host.textContent).toContain(QUESTION.prompt);
    expect(host.textContent).not.toContain('Elisha');
  });

  it('marks the tiles already played in words, not colour alone', () => {
    drawHost('question');
    const played = [...host.querySelectorAll('.cb-tile[data-state="played"]')];

    expect(played).toHaveLength(2);
    for (const tile of played) {
      expect(tile.textContent).toContain('played');
    }
    expect(host.querySelector('[aria-current="true"]')?.textContent).toContain('now');
  });

  it('shows every option with a letter to say aloud', () => {
    drawHost('answering');

    expect(host.querySelectorAll('.cb-option')).toHaveLength(4);
    expect(host.textContent).toContain('A');
    expect(host.textContent).toContain('Elijah');
  });

  it('reveals the answer, the verse it comes from and the split, and names nobody', () => {
    drawHost('reveal', HOST_VIEW, REVEAL);

    expect(host.querySelector('.cb-answer')?.textContent).toBe('Elijah');
    expect(host.textContent).toContain('2 Kings 2:11');
    expect(host.querySelectorAll('.cb-split-row')).toHaveLength(4);
    expect(host.querySelector('.cb-split-row[data-correct="true"]')?.textContent).toContain('Elijah');
    expect(host.textContent).toContain('8 answers');
    expect(host.textContent).not.toContain('Miriam');
  });

  it('shows the tile just played as played once the answer is out', () => {
    drawHost('reveal', HOST_VIEW, REVEAL);

    expect(tileStates().filter((state) => state === 'played')).toHaveLength(3);
    expect(tileStates()).not.toContain('current');
  });

  it('says the board is cleared, and shows it, once every tile is played', () => {
    for (const phase of ['question', 'answering', 'reveal'] as const) {
      drawHost(phase, CLEARED_VIEW, null);

      expect(host.textContent, phase).toContain('The board is cleared.');
      expect(tileStates().every((state) => state === 'played'), phase).toBe(true);
    }
  });

  it('draws a line of text for a round with nothing in it', () => {
    drawHost('question', null);
    expect(host.textContent).toContain('Nothing to show');

    drawHost('reveal', HOST_VIEW, null);
    expect(host.textContent).toContain('Waiting');
  });
});

describe('the big screen, picking the next tile', () => {
  /** The same board, with each tile carrying the choice that picks it. */
  const PICKABLE = {
    ...HOST_VIEW,
    columns: HOST_VIEW.columns.map((column, c) => ({
      ...column,
      tiles: column.tiles.map((tile, r) => ({ ...tile, choice: `${c}:${r}` })),
    })),
  };

  function picks(): HTMLButtonElement[] {
    return [...host.querySelectorAll<HTMLButtonElement>('.cb-tile-pick')];
  }

  it('lets the host pick any open tile at the reveal, and sends that choice', () => {
    drawHost('reveal', PICKABLE, REVEAL);

    // Ten tiles: two played before this round and one just played.
    expect(picks()).toHaveLength(7);
    click(picks().find((pick) => pick.getAttribute('aria-label') === 'Kings and Queens for 300'));
    expect(commands).toEqual([{ cmd: 'choose', choice: '1:2' }]);
  });

  it('offers no tile that has been played, including the one just played', () => {
    drawHost('reveal', PICKABLE, REVEAL);

    for (const tile of host.querySelectorAll('.cb-tile[data-state="played"]')) {
      expect(tile.querySelector('button')).toBeNull();
    }
  });

  it('offers nothing to pick after the last question', () => {
    drawHost('reveal', PICKABLE, REVEAL, { round: 9, totalRounds: 10 });

    expect(picks()).toHaveLength(0);
  });

  it('offers nothing to pick while a question is up', () => {
    drawHost('question', PICKABLE);

    expect(picks()).toHaveLength(0);
  });
});

describe('the phone, choosing', () => {
  it('shows the category and value but not the board', () => {
    drawPhone('question');

    expect(host.textContent).toContain('Prophets for 200');
    expect(host.querySelector('.cb-board')).toBeNull();
  });

  it('offers a tap target for every option', () => {
    drawPhone('answering');

    expect(buttons()).toHaveLength(4);
    expect(buttons()[1]?.textContent).toContain('Elijah');
  });

  it('sends one answer for the round it is in', () => {
    drawPhone('answering');
    click(buttons()[1]);

    expect(sent).toEqual([{ kind: 'answer', round: 2, value: { type: 'choice', index: 1 } }]);
  });

  it('will not send a second answer, however many times it is tapped', () => {
    drawPhone('answering');
    click(buttons()[1]);
    click(buttons()[0]);
    click(buttons()[1]);

    expect(sent).toHaveLength(1);
    expect(host.textContent).toContain('Sent: Elijah');
    expect(buttons().every((button) => button.disabled)).toBe(true);
  });

  it('is closed for a player the server says has already answered', () => {
    drawPhone('answering', { snapshot: { youAnswered: true } });
    click(buttons()[2]);

    expect(sent).toEqual([]);
  });

  it('draws a line of text rather than buttons for a round with nothing in it', () => {
    drawPhone('answering', { view: null });

    expect(buttons()).toHaveLength(0);
    expect(host.textContent).toContain('Getting the question ready');
  });
});

describe('the phone, choosing from the keyboard', () => {
  function press(key: string, options: KeyboardEventInit = {}): void {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
    });
  }

  it('selects the option a letter names, the same as tapping it', () => {
    drawPhone('answering');
    press('b');

    expect(sent).toEqual([{ kind: 'answer', round: 2, value: { type: 'choice', index: 1 } }]);
  });

  it('reads the letter case-insensitively', () => {
    drawPhone('answering');
    press('D');

    expect(sent).toEqual([{ kind: 'answer', round: 2, value: { type: 'choice', index: 3 } }]);
  });

  it('ignores a letter held with a modifier, a browser shortcut rather than an answer', () => {
    drawPhone('answering');
    press('b', { ctrlKey: true });

    expect(sent).toEqual([]);
  });

  it('stops answering to the keyboard once the phone is done, the same as the buttons', () => {
    drawPhone('answering', { snapshot: { youAnswered: true } });
    press('b');

    expect(sent).toEqual([]);
  });
});

describe('the phone, at the reveal', () => {
  it('says the player was right and what the tile was worth', () => {
    drawPhone('reveal', {
      reveal: REVEAL,
      yourResult: { correct: true, pointsAwarded: 200, submitted: { type: 'choice', index: 1 }, note: null },
    });

    expect(host.textContent).toContain('Elijah');
    expect(host.textContent).toContain('Right.');
  });

  it('tells a player who missed what they said, on their own phone only', () => {
    drawPhone('reveal', {
      reveal: REVEAL,
      yourResult: { correct: false, pointsAwarded: 0, submitted: { type: 'choice', index: 0 }, note: null },
    });

    expect(host.textContent).toContain('Not this time.');
    expect(host.textContent).toContain('You said Elisha.');
  });

  it('says nothing at all about a phone that did not answer', () => {
    drawPhone('reveal', { reveal: REVEAL, yourResult: null });

    expect(host.textContent).toContain('No answer from this phone');
  });

  it('says plainly when nothing was asked', () => {
    drawPhone('reveal', {
      view: null,
      reveal: { round: 2, correctLabel: '', aggregates: [], detail: null },
    });

    expect(host.textContent).toContain('Nothing was asked this round.');
  });
});

describe('the phone, voting with a team', () => {
  const VOTING: Partial<PlayerSnapshot> = { canChangeAnswer: true };

  it('invites a vote and says it can change', () => {
    drawPhone('answering', { snapshot: VOTING });

    expect(host.textContent).toContain('Tap an answer to vote. You can change it until time runs out.');
  });

  it('sends a changed vote, and keeps every option open until time runs out', () => {
    drawPhone('answering', { snapshot: VOTING });
    click(buttons()[0]);
    click(buttons()[1]);

    expect(sent).toEqual([
      { kind: 'answer', round: 2, value: { type: 'choice', index: 0 } },
      { kind: 'answer', round: 2, value: { type: 'choice', index: 1 } },
    ]);
    expect(buttons().some((button) => button.disabled)).toBe(false);
    expect(buttons()[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons()[0]?.getAttribute('aria-pressed')).toBe('false');
    expect(host.textContent).toContain('Your vote: Elijah.');
  });

  it('does not send the vote that stands a second time', () => {
    drawPhone('answering', { snapshot: VOTING });
    click(buttons()[2]);
    click(buttons()[2]);

    expect(sent).toHaveLength(1);
  });

  it('highlights the vote the room holds, for a phone that has just reloaded', () => {
    drawPhone('answering', {
      snapshot: { ...VOTING, youAnswered: true, yourAnswer: { type: 'choice', index: 3 } },
    });

    expect(buttons()[3]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons().every((button) => !button.disabled)).toBe(true);
    expect(host.textContent).toContain('Your vote: Moses.');
  });
});

describe('a reveal decided by team vote', () => {
  const TEAM_REVEAL: RevealPayload = {
    ...REVEAL,
    groups: [
      {
        teamId: 'blue',
        split: [
          { label: 'Elisha', count: 2 },
          { label: 'Elijah', count: 1 },
        ],
        decided: 'Elisha',
        correct: false,
      },
    ],
  };

  it('leaves the split to the teams’ own, and still offers the next tile', () => {
    drawHost('reveal', HOST_VIEW, TEAM_REVEAL);

    expect(host.querySelector('.cb-answer')?.textContent).toBe('Elijah');
    expect(host.querySelectorAll('.cb-split-row')).toHaveLength(0);
    expect(host.textContent).not.toContain('answers — nobody is named');
    expect(host.querySelectorAll('.cb-column')).toHaveLength(2);
  });

  it('tells a player who was right on a wrong team what the team chose and what they voted', () => {
    drawPhone('reveal', {
      reveal: TEAM_REVEAL,
      yourResult: {
        correct: false,
        pointsAwarded: 0,
        submitted: { type: 'choice', index: 1 },
        note: 'Your team chose Elisha',
      },
    });

    expect(host.textContent).toContain('Your team chose Elisha. Not this time.');
    expect(host.textContent).toContain('You voted Elijah.');
  });

  it('says what a right team earned, and no more to a player who voted with it', () => {
    drawPhone('reveal', {
      reveal: TEAM_REVEAL,
      yourResult: {
        correct: true,
        pointsAwarded: 200,
        submitted: { type: 'choice', index: 1 },
        note: 'The room chose Elijah',
      },
    });

    expect(host.textContent).toContain('The room chose Elijah. Right.');
    expect(host.textContent).not.toContain('You voted');
  });
});

describe('registration', () => {
  it('puts six views under the game id, and only there', () => {
    const registered = getGameViews(GAME_ID);

    expect(registered).toBe(categoryBoardViews);
    expect(Object.keys(registered?.host ?? {}).sort()).toEqual(['answering', 'question', 'reveal']);
    expect(Object.keys(registered?.player ?? {}).sort()).toEqual(['answering', 'question', 'reveal']);
  });
});
