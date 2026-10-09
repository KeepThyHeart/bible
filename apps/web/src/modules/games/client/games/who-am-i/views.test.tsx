// @vitest-environment jsdom
/**
 * What the two screens actually put in front of people.
 *
 * The assertions worth having are about promises, not markup: the big screen
 * never carries a name beside a count and never counts a wrong guess; a tap
 * only chooses, and committing is a separate, explained act; one guess is sent
 * for the round the phone is in, carrying the clue it was showing; a lockout
 * is visible only on the phone that locked in; and a payload the client cannot
 * read draws a line of text rather than an exception.
 */

import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  Intent,
  PersonalResult,
  PlayerSnapshot,
  RevealPayload,
  RoomSettings,
  ScreenSnapshot,
  ServerTime,
} from '../../../shared/protocol.js';
import { DEFAULT_THEME } from '../../../shared/theme.js';
import type { ClockPort } from '../../shell/clockPort.js';
import { clearGameViews, getGameViews, hostViewFor, playerViewFor } from '../../shell/gameViews.js';
import { encodeChoice } from './answerCode.js';
import { GAME_ID, whoAmIViews } from './index.js';
import { ONE_GUESS_RULE, TEAM_VOTE_RULE } from './PhoneViews.js';

const OPENED = 1_700_000_000_000;
const INTERVAL = 7_000;
const WINDOW = 4 * INTERVAL + 10_000;

const SETTINGS: RoomSettings = {
  gameId: GAME_ID,
  setId: null,
  translation: 'KJV',
  teamsEnabled: false,
  rounds: 8,
  answerWindowMs: 20_000,
  showIndividualScores: false,
  solo: false,
  groupVote: false,
  familiarity: 'broad',
  gameOptions: {},
  theme: DEFAULT_THEME,
};

const ROUND = {
  pacing: 'server',
  clues: [
    'I lived nine hundred and thirty years',
    'I gave names to the cattle',
    'I was formed from the dust of the ground',
    'My wife was made from one of my ribs',
    'I was the first man',
  ],
  options: [
    { index: 0, label: 'Cain' },
    { index: 1, label: 'Adam' },
    { index: 2, label: 'Noah' },
    { index: 3, label: 'Seth' },
  ],
  clueIntervalMs: INTERVAL,
  answerWindowMs: WINDOW,
};

const SOLO_ROUND = { ...ROUND, pacing: 'player' };

const REVEAL: RevealPayload = {
  round: 2,
  correctLabel: 'Adam',
  aggregates: [
    { label: 'Clue 1', count: 2 },
    { label: 'Clue 2', count: 0 },
    { label: 'Clue 3', count: 1 },
    { label: 'Clue 4', count: 0 },
    { label: 'Clue 5', count: 0 },
  ],
  detail: {
    person: 'Adam',
    clues: [
      { text: 'I lived nine hundred and thirty years', reference: 'Genesis 5:5', gotIt: 2, points: 100 },
      { text: 'I gave names to the cattle', reference: 'Genesis 2:20', gotIt: 0, points: 80 },
      { text: 'I was formed from the dust of the ground', reference: 'Genesis 2:7', gotIt: 1, points: 60 },
      { text: 'My wife was made from one of my ribs', reference: 'Genesis 2:22', gotIt: 0, points: 40 },
      { text: 'I was the first man', reference: null, gotIt: 0, points: 20 },
    ],
    options: ['Cain', 'Adam', 'Noah', 'Seth'],
    correctIndex: 1,
    gotIt: 3,
  },
};

/** A clock the test moves by hand; nothing in this file waits. */
function manualClock(start: ServerTime) {
  let now = start;
  const tasks: { at: ServerTime; task: () => void; live: boolean }[] = [];
  const port: ClockPort = {
    serverNow: () => now,
    msUntil: (at) => Math.max(0, at - now),
    showAt: (at, task) => {
      if (at <= now) {
        task();
        return () => undefined;
      }
      const entry = { at, task, live: true };
      tasks.push(entry);
      return () => {
        entry.live = false;
      };
    },
    report: () => null,
    onChange: () => () => undefined,
  };
  return {
    port,
    advance(ms: number) {
      now += ms;
      for (;;) {
        const due = tasks.filter((entry) => entry.live && entry.at <= now).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        due.live = false;
        due.task();
      }
    },
  };
}

function hostSnapshot(view: unknown): ScreenSnapshot {
  return {
    viewer: 'screen',
    code: 'QK7P',
    phase: 'answering',
    paused: false,
    round: 2,
    totalRounds: 8,
    settings: SETTINGS,
    players: [
      { id: 'p-1', name: 'Miriam', teamId: null, connected: true },
      { id: 'p-2', name: 'Barnabas', teamId: null, connected: true },
    ],
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: OPENED + WINDOW,
    phaseDurationMs: null,
    revealAt: OPENED,
    serverTime: OPENED,
    standings: [],
    teamStandings: [],
    overallStandings: [],
    answeredCount: 1,
    view,
    buzz: null,
  };
}

function playerSnapshot(view: unknown, overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    viewer: 'player',
    code: 'QK7P',
    phase: 'answering',
    paused: false,
    round: 2,
    totalRounds: 8,
    settings: SETTINGS,
    players: [],
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: OPENED + WINDOW,
    phaseDurationMs: null,
    revealAt: OPENED,
    serverTime: OPENED,
    you: { id: 'p-1', name: 'Miriam', teamId: null, connected: true },
    yourScore: 0,
    youAnswered: false,
    yourAnswer: null,
    canChangeAnswer: false,
    yourRank: null,
    view,
    buzz: null,
    youAreSpent: false,
    yourControlRequest: null,
    ...overrides,
  };
}

let host: HTMLDivElement;
let sent: Intent[];
let clock: ReturnType<typeof manualClock>;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  sent = [];
  clock = manualClock(OPENED);
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

afterAll(() => {
  clearGameViews();
});

function drawHost(phase: 'question' | 'answering' | 'reveal', view: unknown = ROUND, reveal: RevealPayload | null = null): void {
  const View = whoAmIViews.host[phase];
  act(() => {
    render(
      <View snapshot={hostSnapshot(view)} view={view} reveal={reveal} clock={clock.port} send={() => undefined} />,
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
  const View = whoAmIViews.player[phase];
  const view = 'view' in options ? options.view : ROUND;
  act(() => {
    render(
      <View
        snapshot={playerSnapshot(view, options.snapshot)}
        view={view}
        reveal={options.reveal ?? null}
        yourResult={options.yourResult ?? null}
        clock={clock.port}
        send={(intent) => sent.push(intent)}
      />,
      host
    );
  });
}

function taps(): HTMLButtonElement[] {
  return [...host.querySelectorAll<HTMLButtonElement>('.wai-tap')];
}

function lock(): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>('.wai-lock') as HTMLButtonElement;
}

function click(element: Element | null | undefined): void {
  act(() => {
    (element as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function cluesOnScreen(): number {
  return host.querySelectorAll('.wai-clue').length;
}

describe('the big screen during a question', () => {
  it('shows the first clue and all four options from the start', () => {
    drawHost('answering');

    expect(cluesOnScreen()).toBe(1);
    expect(host.textContent).toContain('I lived nine hundred and thirty years');
    expect(host.querySelectorAll('.wai-option')).toHaveLength(4);
    expect(host.textContent).toContain('worth 100');
  });

  it('adds a clue at each server moment', () => {
    drawHost('answering');
    act(() => clock.advance(2 * INTERVAL));

    expect(cluesOnScreen()).toBe(3);
    expect(host.querySelector('.wai-clue[data-latest="true"]')?.textContent).toContain('dust of the ground');
    expect(host.textContent).toContain('Clue 3 of 5');
  });

  it('never shows where a clue comes from while it can still be answered', () => {
    drawHost('answering');
    act(() => clock.advance(4 * INTERVAL));

    expect(host.textContent).not.toContain('Genesis');
  });

  it('names nobody, even though it knows who is in the room', () => {
    drawHost('answering');

    expect(host.textContent).not.toContain('Miriam');
    expect(host.textContent).not.toContain('Barnabas');
  });
});

describe('the big screen at the reveal', () => {
  it('shows the person, every clue and where each one comes from', () => {
    drawHost('reveal', ROUND, REVEAL);

    expect(host.querySelector('.wai-answer')?.textContent).toBe('Adam');
    expect(cluesOnScreen()).toBe(5);
    expect(host.textContent).toContain('Genesis 5:5');
    expect(host.textContent).toContain('Genesis 2:22');
  });

  it('counts who got it at each clue and names nobody', () => {
    drawHost('reveal', ROUND, REVEAL);
    const counts = [...host.querySelectorAll('.wai-got-count')].map((node) => node.textContent);

    expect(counts).toEqual(['2 got it', '0 got it', '1 got it', '0 got it', '0 got it']);
    expect(host.textContent).toContain('3 people got it');
    expect(host.textContent).not.toContain('Miriam');
  });

  it('says nothing about how many guessed wrong', () => {
    drawHost('reveal', ROUND, REVEAL);

    expect(host.textContent).not.toMatch(/wrong|missed|out\b/i);
  });

  it('is kind about a question nobody got', () => {
    const empty = { ...REVEAL, detail: { ...(REVEAL.detail as object), gotIt: 0 } };
    drawHost('reveal', ROUND, empty);

    expect(host.textContent).toContain('nobody had it');
  });
});

describe('a round with nothing in it', () => {
  it('says so on the big screen rather than drawing an empty question', () => {
    drawHost('answering', null);
    expect(host.textContent).toContain('Nothing to show for this round.');

    drawHost('question', { clues: 'garbled' });
    expect(host.textContent).toContain('Nothing to show for this round.');

    drawHost('reveal', null, null);
    expect(host.textContent).toContain('Waiting for the answer.');
  });

  it('says so on the phone', () => {
    drawPhone('answering', { view: null });
    expect(host.textContent).toContain('Getting the question ready');
    expect(taps()).toHaveLength(0);
  });
});

describe('the phone, choosing', () => {
  it('states the one-guess rule before anything is committed', () => {
    drawPhone('answering');

    expect(host.textContent).toContain(ONE_GUESS_RULE);
    expect(lock().disabled).toBe(true);
    expect(lock().textContent).toBe('Tap a name first');
  });

  it('only chooses on a tap, and sends nothing', () => {
    drawPhone('answering');
    click(taps()[1]);

    expect(sent).toEqual([]);
    expect(taps()[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(lock().textContent).toBe('Lock in Adam');
  });

  it('lets a choice change before it is locked in', () => {
    drawPhone('answering');
    click(taps()[0]);
    click(taps()[2]);

    expect(lock().textContent).toBe('Lock in Noah');
    expect(taps()[0]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('sends one guess for the round it is in, carrying the clue it was showing', () => {
    drawPhone('answering');
    act(() => clock.advance(2 * INTERVAL + 100));
    click(taps()[1]);
    click(lock());

    expect(sent).toEqual([
      { kind: 'answer', round: 2, value: { type: 'choice', index: encodeChoice(1, 3) } },
    ]);
  });

  it('will not send a second guess, because there is nothing left to tap', () => {
    drawPhone('answering');
    click(taps()[1]);
    click(lock());

    // The options and the lock button are gone rather than disabled: a control
    // that can still be pressed but is ignored is the cruellest one on a phone.
    expect(sent).toHaveLength(1);
    expect(taps()).toHaveLength(0);
    expect(host.querySelector('.wai-lock')).toBeNull();
  });

  it('says privately that the player is done once their guess is in', () => {
    drawPhone('answering');
    click(taps()[3]);
    click(lock());

    expect(host.textContent).toContain('Locked in: Seth');
    expect(host.textContent).toContain('done with this one');
  });

  it('keeps showing the clues after the guess is in', () => {
    drawPhone('answering');
    click(taps()[1]);
    click(lock());
    act(() => clock.advance(INTERVAL));

    expect(cluesOnScreen()).toBe(2);
  });

  it('is closed for a player the server says has already guessed', () => {
    drawPhone('answering', { snapshot: { youAnswered: true } });

    expect(taps()).toHaveLength(0);
    expect(host.textContent).toContain('Your guess is in.');
    expect(sent).toEqual([]);
  });

  it('will not lock in while the room is paused', () => {
    drawPhone('answering', { snapshot: { paused: true } });
    click(taps()[1]);
    click(lock());

    expect(sent).toEqual([]);
    expect(lock().textContent).toBe('Paused');
  });

  it('offers no way to see the next clue early in a group', () => {
    drawPhone('answering');

    expect(host.querySelector('.wai-next')).toBeNull();
  });
});

describe('the phone, choosing from the keyboard', () => {
  function press(key: string, options: KeyboardEventInit = {}): void {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
    });
  }

  it('chooses the name a letter names, the same as tapping it, and sends nothing yet', () => {
    drawPhone('answering');
    press('b');

    expect(sent).toEqual([]);
    expect(taps()[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(lock().textContent).toBe('Lock in Adam');
  });

  it('reads the letter case-insensitively', () => {
    drawPhone('answering');
    press('D');

    expect(lock().textContent).toBe('Lock in Seth');
  });

  it('still needs Lock in to actually send, the same as a tap does', () => {
    drawPhone('answering');
    act(() => clock.advance(2 * INTERVAL + 100));
    press('b');
    click(lock());

    expect(sent).toEqual([
      { kind: 'answer', round: 2, value: { type: 'choice', index: encodeChoice(1, 3) } },
    ]);
  });

  it('ignores a letter held with a modifier, a browser shortcut rather than an answer', () => {
    drawPhone('answering');
    press('b', { ctrlKey: true });

    expect(taps()[1]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('stops answering to the keyboard once the phone is done, the same as the buttons', () => {
    drawPhone('answering', { snapshot: { youAnswered: true } });
    press('b');

    expect(sent).toEqual([]);
  });
});

describe('the phone, playing alone', () => {
  it('turns the next clue over on request and says what it will cost', () => {
    drawPhone('answering', { view: SOLO_ROUND });
    expect(host.querySelector('.wai-next')?.textContent).toContain('worth 80');

    click(host.querySelector('.wai-next'));

    expect(cluesOnScreen()).toBe(2);
    expect(host.textContent).toContain('Clue 2 of 5');
  });

  it('reports the clues it turned over with the guess', () => {
    drawPhone('answering', { view: SOLO_ROUND });
    click(host.querySelector('.wai-next'));
    click(host.querySelector('.wai-next'));
    click(taps()[1]);
    click(lock());

    expect(sent[0]).toEqual({
      kind: 'answer',
      round: 2,
      value: { type: 'choice', index: encodeChoice(1, 3) },
    });
  });

  it('never falls behind the clock for a player who reads slowly', () => {
    drawPhone('answering', { view: SOLO_ROUND });
    act(() => clock.advance(3 * INTERVAL));

    expect(cluesOnScreen()).toBe(4);
  });

  it('stops offering clues once they are all showing', () => {
    drawPhone('answering', { view: SOLO_ROUND });
    for (let turn = 0; turn < 4; turn += 1) click(host.querySelector('.wai-next'));

    expect(cluesOnScreen()).toBe(5);
    expect(host.querySelector('.wai-next')).toBeNull();
  });
});

describe('the phone, at the reveal', () => {
  it('says the player was right, and at which clue', () => {
    drawPhone('reveal', {
      reveal: REVEAL,
      yourResult: {
        correct: true,
        pointsAwarded: 80,
        submitted: { type: 'choice', index: encodeChoice(1, 2) },
        note: 'Got it at clue 2',
      },
    });

    expect(host.querySelector('.wai-answer')?.textContent).toBe('Adam');
    expect(host.textContent).toContain('Right. Got it at clue 2');
  });

  it('tells a wrong guess what it said, on this phone only', () => {
    drawPhone('reveal', {
      reveal: REVEAL,
      yourResult: {
        correct: false,
        pointsAwarded: 0,
        submitted: { type: 'choice', index: encodeChoice(2, 1) },
        note: null,
      },
    });

    expect(host.textContent).toContain('Not this time.');
    expect(host.textContent).toContain('You said Noah.');
  });

  it('shows every clue with its reference, without the room counts', () => {
    drawPhone('reveal', { reveal: REVEAL, yourResult: null });

    expect(cluesOnScreen()).toBe(5);
    expect(host.textContent).toContain('Genesis 2:7');
    expect(host.querySelector('.wai-got-count')).toBeNull();
    expect(host.textContent).toContain('No guess from this phone.');
  });

  it('waits for a reveal that has not arrived', () => {
    drawPhone('reveal', { reveal: null });

    expect(host.textContent).toContain('Waiting for the answer.');
  });
});

const VOTE_ROUND = { ...ROUND, groupVote: true };

describe('the phone, voting with a team', () => {
  const VOTING: Partial<PlayerSnapshot> = { canChangeAnswer: true };

  it('states the team rules instead of the one-guess rule, with nothing to lock in', () => {
    drawPhone('answering', { view: VOTE_ROUND, snapshot: VOTING });

    expect(host.textContent).toContain(TEAM_VOTE_RULE);
    expect(host.textContent).not.toContain(ONE_GUESS_RULE);
    expect(host.querySelector('.wai-lock')).toBeNull();
    expect(host.textContent).toContain('Tap a name to vote.');
  });

  it('sends a vote on the tap, carrying its clue, and a changed vote after it', () => {
    drawPhone('answering', { view: VOTE_ROUND, snapshot: VOTING });
    click(taps()[0]);
    act(() => clock.advance(2 * INTERVAL + 100));
    click(taps()[1]);

    expect(sent).toEqual([
      { kind: 'answer', round: 2, value: { type: 'choice', index: encodeChoice(0, 1) } },
      { kind: 'answer', round: 2, value: { type: 'choice', index: encodeChoice(1, 3) } },
    ]);
    expect(taps()).toHaveLength(4);
    expect(taps()[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(taps()[0]?.getAttribute('aria-pressed')).toBe('false');
    expect(host.textContent).toContain('Your vote: Adam.');
  });

  it('does not send the name it already backs again, even at a later clue', () => {
    drawPhone('answering', { view: VOTE_ROUND, snapshot: VOTING });
    click(taps()[1]);
    act(() => clock.advance(INTERVAL));
    click(taps()[1]);

    expect(sent).toHaveLength(1);
  });

  it('highlights the vote the room holds, for a phone that has just reloaded', () => {
    drawPhone('answering', {
      view: VOTE_ROUND,
      snapshot: { ...VOTING, youAnswered: true, yourAnswer: { type: 'choice', index: encodeChoice(3, 2) } },
    });

    expect(taps()).toHaveLength(4);
    expect(taps()[3]?.getAttribute('aria-pressed')).toBe('true');
    expect(host.textContent).toContain('Your vote: Seth.');
  });

  it('will not vote while the room is paused', () => {
    drawPhone('answering', { view: VOTE_ROUND, snapshot: { ...VOTING, paused: true } });
    click(taps()[1]);

    expect(sent).toEqual([]);
  });
});

describe('the phone, voting with a team from the keyboard', () => {
  const VOTING: Partial<PlayerSnapshot> = { canChangeAnswer: true };

  function press(key: string, options: KeyboardEventInit = {}): void {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
    });
  }

  it('votes for the name a letter names, sent at once, the same as a tap', () => {
    drawPhone('answering', { view: VOTE_ROUND, snapshot: VOTING });
    press('b');

    expect(sent).toEqual([{ kind: 'answer', round: 2, value: { type: 'choice', index: encodeChoice(1, 1) } }]);
  });

  it('reads the letter case-insensitively', () => {
    drawPhone('answering', { view: VOTE_ROUND, snapshot: VOTING });
    press('D');

    expect(sent).toEqual([{ kind: 'answer', round: 2, value: { type: 'choice', index: encodeChoice(3, 1) } }]);
  });

  it('will not vote while the room is paused', () => {
    drawPhone('answering', { view: VOTE_ROUND, snapshot: { ...VOTING, paused: true } });
    press('b');

    expect(sent).toEqual([]);
  });
});

describe('the big screen during a team vote', () => {
  it('explains the team rules rather than one guess each', () => {
    drawHost('answering', VOTE_ROUND);

    expect(host.textContent).toContain('Each team votes on its phones');
    expect(host.textContent).not.toContain('One guess each');
  });

  it('keeps the ladder at the reveal, counting votes rather than people', () => {
    drawHost('reveal', VOTE_ROUND, {
      ...REVEAL,
      groups: [{ teamId: 'red', split: [{ label: 'Adam', count: 3 }], decided: 'Adam', correct: true }],
    });

    expect(host.querySelectorAll('.wai-got-count')).toHaveLength(5);
    expect(host.textContent).toContain('3 votes named Adam.');
    expect(host.textContent).not.toMatch(/wrong|missed|out\b/i);
  });
});

describe('the phone, at a reveal decided by team vote', () => {
  const TEAM_REVEAL: RevealPayload = {
    ...REVEAL,
    groups: [{ teamId: 'red', split: [{ label: 'Noah', count: 2 }], decided: 'Noah', correct: false }],
  };

  it('tells a player who was right on a wrong team what the team chose and what they voted', () => {
    drawPhone('reveal', {
      reveal: TEAM_REVEAL,
      yourResult: {
        correct: false,
        pointsAwarded: 0,
        submitted: { type: 'choice', index: encodeChoice(1, 2) },
        note: 'Your team chose Noah',
      },
    });

    expect(host.textContent).toContain('Your team chose Noah. Not this time.');
    expect(host.textContent).toContain('You voted Adam.');
  });

  it('says no more than that to a player who voted with a right team', () => {
    drawPhone('reveal', {
      reveal: TEAM_REVEAL,
      yourResult: {
        correct: true,
        pointsAwarded: 60,
        submitted: { type: 'choice', index: encodeChoice(1, 3) },
        note: 'Your team chose Adam',
      },
    });

    expect(host.textContent).toContain('Your team chose Adam. Right.');
    expect(host.textContent).not.toContain('You voted');
  });
});

describe('registration', () => {
  it('puts six views under the game id, and only there', () => {
    expect(getGameViews(GAME_ID)).toBe(whoAmIViews);
    for (const phase of ['question', 'answering', 'reveal'] as const) {
      expect(hostViewFor(GAME_ID, phase)).toBe(whoAmIViews.host[phase]);
      expect(playerViewFor(GAME_ID, phase)).toBe(whoAmIViews.player[phase]);
    }
  });

  it('is named descriptively, never by a number', () => {
    expect(GAME_ID).toBe('who-am-i');
  });
});
