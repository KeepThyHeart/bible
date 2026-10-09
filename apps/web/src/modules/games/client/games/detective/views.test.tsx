// @vitest-environment jsdom
/**
 * What the two screens actually put in front of people.
 *
 * The assertions worth having are not about markup. They are that the big
 * screen never carries a name beside a count, that a phone's vote can move
 * from one name to another and says which it stands on, that only the phone
 * itself says how its player voted, and that a payload the client cannot read
 * draws a line of text rather than an exception.
 */

import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  GroupResult,
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
import { GAME_ID, detectiveViews } from './index.js';
import { ownLine } from './PhoneViews.js';

const SETTINGS: RoomSettings = {
  gameId: GAME_ID,
  setId: null,
  translation: 'KJV',
  teamsEnabled: false,
  rounds: 8,
  answerWindowMs: 90_000,
  showIndividualScores: false,
  solo: false,
  groupVote: false,
  familiarity: 'broad',
  gameOptions: {},
  theme: DEFAULT_THEME,
};

const OPTIONS = [
  { index: 0, label: 'Aaron' },
  { index: 1, label: 'Moses' },
  { index: 2, label: 'Balaam' },
  { index: 3, label: 'Joshua' },
];

const HOST_CASE = {
  question: 'Who is the mystery person?',
  opening: 'I kept the flock of my father-in-law Jethro.',
  options: OPTIONS,
};

const PHONE_CASE = {
  clue: 'I struck the rock in Horeb, and water came out of it.',
  shared: false,
  options: OPTIONS,
};

function groupRoom(overrides: Partial<GroupResult> = {}): GroupResult {
  return {
    teamId: null,
    split: [
      { label: 'Moses', count: 7 },
      { label: 'Aaron', count: 3 },
    ],
    decided: 'Moses',
    correct: true,
    ...overrides,
  };
}

function revealWith(groups: GroupResult[]): RevealPayload {
  return {
    round: 2,
    correctLabel: 'Moses',
    aggregates: [
      { label: 'Aaron', count: 3 },
      { label: 'Moses', count: 7 },
      { label: 'Balaam', count: 0 },
      { label: 'Joshua', count: 2 },
    ],
    detail: {
      person: 'Moses',
      options: ['Aaron', 'Moses', 'Balaam', 'Joshua'],
      correctIndex: 1,
      clues: [
        { text: 'I kept the flock of my father-in-law Jethro', reference: 'Exodus 3:1', where: 'screen' },
        { text: 'I killed an Egyptian and hid him in the sand', reference: 'Exodus 2:12', where: 'phones' },
        { text: PHONE_CASE.clue, reference: 'Exodus 17:6', where: 'phones' },
        { text: 'I was given tables of stone', reference: 'Exodus 31:18', where: 'undealt' },
      ],
    },
    groups,
  };
}

const REVEAL = revealWith([groupRoom()]);

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

function hostSnapshot(settings: RoomSettings = SETTINGS): ScreenSnapshot {
  return {
    viewer: 'screen',
    code: 'KDXR',
    phase: 'answering',
    paused: false,
    round: 2,
    totalRounds: 8,
    settings,
    players: [],
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
    view: HOST_CASE,
    buzz: null,
  };
}

function playerSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    viewer: 'player',
    code: 'KDXR',
    phase: 'answering',
    paused: false,
    round: 2,
    totalRounds: 8,
    settings: SETTINGS,
    players: [],
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: null,
    phaseDurationMs: null,
    revealAt: null,
    serverTime: 1_700_000_000_000,
    you: { id: 'p-1', name: 'Miriam', teamId: null, connected: true },
    yourScore: 300,
    youAnswered: false,
    yourAnswer: null,
    canChangeAnswer: true,
    yourRank: null,
    view: PHONE_CASE,
    buzz: null,
    youAreSpent: false,
    yourControlRequest: null,
    ...overrides,
  };
}

let root: HTMLDivElement;
let sent: Intent[];

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  sent = [];
});

afterEach(() => {
  act(() => {
    render(null, root);
  });
  root.remove();
});

function drawHost(
  phase: 'question' | 'answering' | 'reveal',
  options: { view?: unknown; reveal?: RevealPayload | null; settings?: RoomSettings } = {}
): void {
  const View = detectiveViews.host[phase];
  const view = 'view' in options ? options.view : HOST_CASE;
  act(() => {
    render(
      <View
        snapshot={{ ...hostSnapshot(options.settings), view }}
        view={view}
        reveal={options.reveal ?? null}
        clock={stoppedClock}
        send={() => undefined}
      />,
      root
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
  const View = detectiveViews.player[phase];
  const view = 'view' in options ? options.view : PHONE_CASE;
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
      root
    );
  });
}

function buttons(): HTMLButtonElement[] {
  return [...root.querySelectorAll('button')];
}

function click(element: Element | undefined): void {
  act(() => {
    (element as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function voteFor(index: number): Intent {
  return { kind: 'answer', round: 2, value: { type: 'choice', index } };
}

describe('the big screen during play', () => {
  it('shows the public clue and four lettered names', () => {
    drawHost('answering');

    expect(root.textContent).toContain('Who is the mystery person?');
    expect(root.textContent).toContain('I kept the flock of my father-in-law Jethro.');
    expect(root.querySelectorAll('.det-option')).toHaveLength(4);
    expect(root.querySelector('.det-letter')?.textContent).toBe('A');
    expect(root.textContent).toContain('the room’s majority is the answer');
  });

  it('tells a room playing in teams that each team decides for itself', () => {
    drawHost('answering', { settings: { ...SETTINGS, teamsEnabled: true } });

    expect(root.textContent).toContain('each team’s majority is its answer');
  });

  it('draws a line of text for a round with nothing in it', () => {
    drawHost('answering', { view: null });
    expect(root.textContent).toContain('Nothing to show');

    drawHost('question', { view: { opening: 7 } });
    expect(root.textContent).toContain('Nothing to show');
  });
});

describe('the big screen at the reveal', () => {
  it('shows the answer, the verdict and the split, and names nobody', () => {
    drawHost('reveal', { reveal: REVEAL });

    expect(root.querySelector('.det-answer')?.textContent).toBe('Moses');
    expect(root.textContent).toContain('Case solved — every detective scores');
    expect(root.querySelectorAll('.det-split-row')).toHaveLength(4);
    expect(root.querySelector('[data-correct="true"]')?.textContent).toContain('Moses');
    expect(root.textContent).toContain('12 votes — nobody is named.');
    expect(root.textContent).not.toContain('Miriam');
  });

  it('shows every clue with its reference and where it was', () => {
    drawHost('reveal', { reveal: REVEAL });

    const clues = [...root.querySelectorAll('.det-clue')].map((clue) => clue.textContent);
    expect(clues).toHaveLength(4);
    expect(clues[0]).toContain('Exodus 3:1 · on the big screen');
    expect(clues[2]).toContain('Exodus 17:6 · dealt to phones');
    expect(clues[3]).toContain('not dealt this time');
  });

  it('says so when the room was split, and still shows the answer', () => {
    drawHost('reveal', { reveal: revealWith([groupRoom({ decided: null, correct: null })]) });

    expect(root.textContent).toContain('The room was split — nobody scores');
    expect(root.querySelector('.det-answer')?.textContent).toBe('Moses');
  });

  it('says what a wrong room chose, and when nobody voted', () => {
    drawHost('reveal', { reveal: revealWith([groupRoom({ decided: 'Aaron', correct: false })]) });
    expect(root.textContent).toContain('The room chose Aaron — not this time');

    drawHost('reveal', { reveal: revealWith([groupRoom({ split: [], decided: null, correct: null })]) });
    expect(root.textContent).toContain('Nobody voted');
  });

  it('leaves each team’s verdict to the panel below when teams are on', () => {
    drawHost('reveal', {
      settings: { ...SETTINGS, teamsEnabled: true },
      reveal: revealWith([groupRoom({ teamId: 'red' }), groupRoom({ teamId: 'blue', correct: false })]),
    });

    expect(root.textContent).not.toContain('Case solved');
    expect(root.textContent).toContain('Each team’s verdict is below.');
  });

  it('gives the verdict itself when teams are on but only one team played', () => {
    drawHost('reveal', {
      settings: { ...SETTINGS, teamsEnabled: true },
      reveal: revealWith([groupRoom({ teamId: 'red' })]),
    });

    expect(root.textContent).toContain('Case solved — every detective scores');
  });

  it('waits for a reveal it can read', () => {
    drawHost('reveal', { reveal: null });
    expect(root.textContent).toContain('Waiting');
  });
});

describe('the phone during play', () => {
  it('shows this phone’s clue, and says only this phone has it', () => {
    drawPhone('answering');

    expect(root.querySelector('.det-clue-text')?.textContent).toBe(PHONE_CASE.clue);
    expect(root.textContent).toContain('Only this phone has it.');
    expect(root.textContent).toContain('the room needs every clue');
  });

  it('says so when another phone holds the same clue, and speaks of the team with teams on', () => {
    drawPhone('answering', {
      view: { ...PHONE_CASE, shared: true },
      snapshot: { settings: { ...SETTINGS, teamsEnabled: true } },
    });

    expect(root.textContent).toContain('Another phone has this one too.');
    expect(root.textContent).toContain('your team needs every clue');
  });

  it('sends a vote, and moves it when another name is tapped', () => {
    drawPhone('answering');
    click(buttons()[0]);
    click(buttons()[1]);

    expect(sent).toEqual([voteFor(0), voteFor(1)]);
    expect(root.textContent).toContain('Voted: Moses. You can change it until time runs out.');
    expect(buttons()[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons()[0]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('does not send the same vote twice for a second tap on the same name', () => {
    drawPhone('answering');
    click(buttons()[2]);
    click(buttons()[2]);

    expect(sent).toEqual([voteFor(2)]);
  });

  it('shows the vote the server holds, after a reload', () => {
    drawPhone('answering', { snapshot: { yourAnswer: { type: 'choice', index: 3 }, youAnswered: true } });

    expect(buttons()[3]?.getAttribute('aria-pressed')).toBe('true');
    expect(root.textContent).toContain('Voted: Joshua.');
    click(buttons()[3]);
    expect(sent).toEqual([]);
  });

  it('sends nothing while the room is paused', () => {
    drawPhone('answering', { snapshot: { paused: true } });
    click(buttons()[0]);

    expect(sent).toEqual([]);
    expect(buttons().every((button) => button.disabled)).toBe(true);
  });

  it('tells a phone that joined after the deal to wait for the next case', () => {
    drawPhone('answering', { view: { waiting: true } });

    expect(buttons()).toHaveLength(0);
    expect(root.textContent).toContain('in from the next case');
  });

  it('draws a line of text for a round with nothing in it', () => {
    drawPhone('answering', { view: null });
    expect(root.textContent).toContain('Getting the question ready');
  });

  it('shows the clue before voting opens', () => {
    drawPhone('question');
    expect(root.textContent).toContain(PHONE_CASE.clue);
    expect(buttons()).toHaveLength(0);
  });
});

describe('the phone during play, voting from the keyboard', () => {
  function press(key: string, options: KeyboardEventInit = {}): void {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
    });
  }

  it('votes for the name a letter names, the same as tapping it', () => {
    drawPhone('answering');
    press('b');

    expect(sent).toEqual([voteFor(1)]);
  });

  it('reads the letter case-insensitively', () => {
    drawPhone('answering');
    press('D');

    expect(sent).toEqual([voteFor(3)]);
  });

  it('ignores a letter held with a modifier, a browser shortcut rather than an answer', () => {
    drawPhone('answering');
    press('b', { ctrlKey: true });

    expect(sent).toEqual([]);
  });

  it('sends nothing while the room is paused', () => {
    drawPhone('answering', { snapshot: { paused: true } });
    press('a');

    expect(sent).toEqual([]);
  });
});

describe('the phone at the reveal', () => {
  const dissent: PersonalResult = {
    correct: true,
    pointsAwarded: 100,
    submitted: { type: 'choice', index: 0 },
    note: 'The room chose Moses',
  };

  it('shows the answer, that the room got it, and this phone’s clue with its reference', () => {
    drawPhone('reveal', { reveal: REVEAL, yourResult: dissent });

    expect(root.querySelector('.det-answer')?.textContent).toBe('Moses');
    expect(root.textContent).toContain('The room got it');
    expect(root.textContent).toContain(PHONE_CASE.clue);
    expect(root.textContent).toContain('Exodus 17:6');
  });

  it('tells a dissenter, and only them, that they voted otherwise and still score', () => {
    drawPhone('reveal', { reveal: REVEAL, yourResult: dissent });

    expect(root.querySelector('.det-own')?.textContent).toBe(
      'You voted Aaron — the room carried it, and you score with them.'
    );
  });

  it('speaks of the phone’s own team when teams are on', () => {
    drawPhone('reveal', {
      reveal: revealWith([groupRoom({ teamId: 'red', correct: false, decided: 'Aaron' }), groupRoom({ teamId: 'blue' })]),
      yourResult: { ...dissent, correct: false, pointsAwarded: 0, submitted: { type: 'choice', index: 0 } },
      snapshot: {
        settings: { ...SETTINGS, teamsEnabled: true },
        you: { id: 'p-1', name: 'Miriam', teamId: 'red', connected: true },
      },
    });

    expect(root.textContent).toContain('Your team chose Aaron');
    expect(root.querySelector('.det-own')?.textContent).toBe('You voted Aaron.');
  });

  it('says so when the group was split', () => {
    drawPhone('reveal', {
      reveal: revealWith([groupRoom({ decided: null, correct: null })]),
      yourResult: { ...dissent, correct: false, pointsAwarded: 0 },
    });

    expect(root.textContent).toContain('The room was split — no answer');
  });

  it('waits for a reveal it can read', () => {
    drawPhone('reveal', { reveal: null });
    expect(root.textContent).toContain('Waiting');
  });
});

describe('the line about a player’s own vote', () => {
  const options = ['Aaron', 'Moses', 'Balaam', 'Joshua'];
  const result = (index: number | null): PersonalResult => ({
    correct: true,
    pointsAwarded: 100,
    submitted: index === null ? null : { type: 'choice', index },
    note: null,
  });

  it('agrees with a player who voted with the group', () => {
    expect(ownLine(result(1), options, 'Moses', true, 'the room')).toBe('You voted Moses with the room.');
  });

  it('pays a player who never voted, and says why', () => {
    expect(ownLine(result(null), options, 'Moses', true, 'your team')).toBe(
      'You didn’t vote — your team carried it, and you score with them.'
    );
    expect(ownLine(result(null), options, 'Moses', false, 'the room')).toBe('No vote from this phone.');
  });

  it('speaks to a phone that was never dealt in', () => {
    expect(ownLine(null, options, 'Moses', true, 'the room')).toBe('This phone was not dealt in to this case.');
  });
});

describe('registration', () => {
  it('puts six views under the game id, and only there', () => {
    const registered = getGameViews(GAME_ID);

    expect(registered).toBe(detectiveViews);
    expect(Object.keys(registered?.host ?? {}).sort()).toEqual(['answering', 'question', 'reveal']);
    expect(Object.keys(registered?.player ?? {}).sort()).toEqual(['answering', 'question', 'reveal']);
  });
});
