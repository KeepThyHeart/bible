// @vitest-environment jsdom
/**
 * What the two screens actually put in front of people.
 *
 * The assertions worth having are not about markup. They are that the big
 * screen never carries a name beside a count and never shows the reference
 * before the reveal, that a tap sends exactly one answer for the round the
 * phone believes it is in, and that a payload the client cannot read draws a
 * line of text rather than an exception.
 */

import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
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
import { GAME_ID, whoSaidItViews } from './index.js';

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

const QUESTION = {
  quote: 'where is the lamb for a burnt offering?',
  options: [
    { index: 0, label: 'Jacob' },
    { index: 1, label: 'Isaac' },
    { index: 2, label: 'Ishmael' },
    { index: 3, label: 'Esau' },
  ],
};

const VERSE =
  'And Isaac spake unto Abraham his father, and said, My father: and he said, Here am I, my son.';

const REVEAL: RevealPayload = {
  round: 2,
  correctLabel: 'Isaac',
  aggregates: [
    { label: 'Jacob', count: 1 },
    { label: 'Isaac', count: 4 },
    { label: 'Ishmael', count: 0 },
    { label: 'Esau', count: 2 },
  ],
  detail: {
    speaker: 'Isaac',
    quote: QUESTION.quote,
    reference: 'Genesis 22:7',
    listener: 'his father',
    text: VERSE,
    translation: 'KJV',
    options: [
      { label: 'Jacob', correct: false },
      { label: 'Isaac', correct: true },
      { label: 'Ishmael', correct: false },
      { label: 'Esau', correct: false },
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

function hostSnapshot(): ScreenSnapshot {
  return {
    viewer: 'screen',
    code: 'QK7P',
    phase: 'answering',
    paused: false,
    round: 2,
    totalRounds: 8,
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
    view: QUESTION,
    buzz: null,
  };
}

function playerSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
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

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  sent = [];
});

afterEach(() => {
  act(() => {
    render(null, host);
  });
  host.remove();
});

function drawHost(
  phase: 'question' | 'answering' | 'reveal',
  view: unknown = QUESTION,
  reveal: RevealPayload | null = null
): void {
  const View = whoSaidItViews.host[phase];
  act(() => {
    render(
      <View
        snapshot={{ ...hostSnapshot(), view }}
        view={view}
        reveal={reveal}
        clock={stoppedClock}
        send={() => undefined}
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
  const View = whoSaidItViews.player[phase];
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

describe('the big screen', () => {
  it('puts the quotation up on its own before the names', () => {
    drawHost('question');

    expect(host.textContent).toContain(QUESTION.quote);
    expect(host.textContent).not.toContain('Ishmael');
  });

  it('shows every name with a letter to say aloud', () => {
    drawHost('answering');

    expect(host.querySelectorAll('.wsi-option')).toHaveLength(4);
    expect(host.textContent).toContain('A');
    expect(host.textContent).toContain('Isaac');
  });

  it('keeps the reference off the screen until the reveal', () => {
    drawHost('question');
    expect(host.textContent).not.toContain('Genesis');

    drawHost('answering');
    expect(host.textContent).not.toContain('Genesis');
  });

  it('reveals the speaker, the verse with its reference, and who was listening', () => {
    drawHost('reveal', QUESTION, REVEAL);

    expect(host.querySelector('.wsi-answer')?.textContent).toBe('Isaac');
    expect(host.textContent).toContain(VERSE);
    expect(host.textContent).toContain('Genesis 22:7 · KJV');
    expect(host.textContent).toContain('to his father');
  });

  it('shows the split as counts and names nobody', () => {
    drawHost('reveal', QUESTION, REVEAL);

    expect(host.querySelectorAll('.wsi-split-row')).toHaveLength(4);
    expect(host.querySelector('.wsi-split-row[data-correct="true"]')?.textContent).toContain('Isaac');
    expect(host.textContent).toContain('7 answers');
    expect(host.textContent).not.toContain('Miriam');
  });

  it('falls back to the quotation when the module had no verse to show', () => {
    const bare = { ...REVEAL, detail: { ...(REVEAL.detail as object), text: '', translation: '' } };
    drawHost('reveal', QUESTION, bare);

    expect(host.textContent).toContain(`“${QUESTION.quote}”`);
    expect(host.textContent).toContain('Genesis 22:7');
  });

  it('draws a line of text for a payload it cannot read', () => {
    drawHost('question', null);
    expect(host.textContent).toContain('Nothing to show');

    drawHost('answering', { quote: 'no names' });
    expect(host.textContent).toContain('Nothing to show');

    drawHost('reveal', QUESTION, null);
    expect(host.textContent).toContain('Waiting');
  });
});

describe('the phone, choosing', () => {
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
    expect(host.textContent).toContain('Sent: Isaac');
    expect(buttons().every((button) => button.disabled)).toBe(true);
  });

  it('is closed for a player the server says has already answered', () => {
    drawPhone('answering', { snapshot: { youAnswered: true } });
    click(buttons()[2]);

    expect(sent).toEqual([]);
    expect(host.textContent).toContain('Answer sent.');
  });

  it('offers a tap target for every name, and nothing to type', () => {
    drawPhone('answering');

    expect(buttons()).toHaveLength(4);
    expect(buttons()[3]?.textContent).toContain('Esau');
    expect(host.querySelector('input')).toBeNull();
  });

  it('draws a line of text for a round with nothing in it', () => {
    drawPhone('question', { view: null });
    expect(host.textContent).toContain('Getting the question ready');

    drawPhone('answering', { view: null });
    expect(buttons()).toHaveLength(0);
    expect(host.textContent).toContain('Getting the question ready');
  });
});

describe('the compact phone layout, once a screen is present', () => {
  it('repeats the quote during the reading phase when there is no screen', () => {
    drawPhone('question');
    expect(host.textContent).toContain(QUESTION.quote);
  });

  it('points at the screen instead of repeating the quote once one is present', () => {
    drawPhone('question', { snapshot: { questionOnScreen: true } });
    expect(host.textContent).not.toContain(QUESTION.quote);
    expect(host.textContent).toContain('Look at the screen.');
  });

  it('repeats the quote while choosing when there is no screen', () => {
    drawPhone('answering');
    expect(host.textContent).toContain(QUESTION.quote);
  });

  it('renders the taps without repeating the quote once a screen has it', () => {
    drawPhone('answering', { snapshot: { questionOnScreen: true } });
    expect(host.textContent).not.toContain(QUESTION.quote);
    expect(buttons()).toHaveLength(4);
  });
});

describe('the phone, choosing from the keyboard', () => {
  function press(key: string, options: KeyboardEventInit = {}): void {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
    });
  }

  it('selects the name a letter names, the same as tapping it', () => {
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
  it('shows the speaker and says the player was right', () => {
    drawPhone('reveal', {
      reveal: REVEAL,
      yourResult: { correct: true, pointsAwarded: 100, submitted: { type: 'choice', index: 1 }, note: null },
    });

    expect(host.textContent).toContain('Isaac');
    expect(host.textContent).toContain('Right.');
    expect(host.textContent).toContain('Genesis 22:7');
  });

  it('tells this phone, and only this phone, what it said', () => {
    drawPhone('reveal', {
      reveal: REVEAL,
      yourResult: { correct: false, pointsAwarded: 0, submitted: { type: 'choice', index: 3 }, note: null },
    });

    expect(host.textContent).toContain('Not this time.');
    expect(host.textContent).toContain('You said Esau.');
  });

  it('says nothing at all about a phone that did not answer', () => {
    drawPhone('reveal', { reveal: REVEAL, yourResult: null });

    expect(host.textContent).toContain('No answer from this phone');
  });

  it('waits rather than failing when the reveal has not arrived', () => {
    drawPhone('reveal', { reveal: null });

    expect(host.textContent).toContain('Waiting');
  });
});

describe('the phone, voting with a team', () => {
  const VOTING: Partial<PlayerSnapshot> = { canChangeAnswer: true };

  it('invites a vote and says it can change', () => {
    drawPhone('answering', { snapshot: VOTING });

    expect(host.textContent).toContain('Tap a name to vote. You can change it until time runs out.');
  });

  it('sends a changed vote, and keeps every name open until time runs out', () => {
    drawPhone('answering', { snapshot: VOTING });
    click(buttons()[1]);
    click(buttons()[3]);

    expect(sent).toEqual([
      { kind: 'answer', round: 2, value: { type: 'choice', index: 1 } },
      { kind: 'answer', round: 2, value: { type: 'choice', index: 3 } },
    ]);
    expect(buttons().some((button) => button.disabled)).toBe(false);
    expect(buttons()[3]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons()[1]?.getAttribute('aria-pressed')).toBe('false');
    expect(host.textContent).toContain('Your vote: Esau.');
  });

  it('does not send the vote that stands a second time', () => {
    drawPhone('answering', { snapshot: VOTING });
    click(buttons()[1]);
    click(buttons()[1]);

    expect(sent).toHaveLength(1);
  });

  it('highlights the vote the room holds, for a phone that has just reloaded', () => {
    drawPhone('answering', {
      snapshot: { ...VOTING, youAnswered: true, yourAnswer: { type: 'choice', index: 2 } },
    });

    expect(buttons()[2]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons().every((button) => !button.disabled)).toBe(true);
    expect(host.textContent).toContain('Your vote: Ishmael.');
  });
});

describe('a reveal decided by team vote', () => {
  const TEAM_REVEAL: RevealPayload = {
    ...REVEAL,
    groups: [
      {
        teamId: 'red',
        split: [
          { label: 'Isaac', count: 2 },
          { label: 'Esau', count: 1 },
        ],
        decided: 'Isaac',
        correct: true,
      },
    ],
  };

  it('leaves the split to the teams’ own, drawn under this view by the shell', () => {
    drawHost('reveal', QUESTION, TEAM_REVEAL);

    expect(host.querySelector('.wsi-answer')?.textContent).toBe('Isaac');
    expect(host.textContent).toContain(VERSE);
    expect(host.querySelectorAll('.wsi-split-row')).toHaveLength(0);
    expect(host.textContent).not.toContain('answers — nobody is named');
  });

  it('tells a dissenter on a right team what the team chose and what they voted', () => {
    drawPhone('reveal', {
      reveal: TEAM_REVEAL,
      yourResult: {
        correct: true,
        pointsAwarded: 100,
        submitted: { type: 'choice', index: 3 },
        note: 'Your team chose Isaac',
      },
    });

    expect(host.textContent).toContain('Your team chose Isaac. Right.');
    expect(host.textContent).toContain('You voted Esau.');
  });

  it('says no more than that to a player who voted with a right team', () => {
    drawPhone('reveal', {
      reveal: TEAM_REVEAL,
      yourResult: {
        correct: true,
        pointsAwarded: 100,
        submitted: { type: 'choice', index: 1 },
        note: 'Your team chose Isaac',
      },
    });

    expect(host.textContent).toContain('Your team chose Isaac. Right.');
    expect(host.textContent).not.toContain('You voted');
  });

  it('tells a split team it scored nothing, and what this phone voted', () => {
    drawPhone('reveal', {
      reveal: TEAM_REVEAL,
      yourResult: {
        correct: false,
        pointsAwarded: 0,
        submitted: { type: 'choice', index: 1 },
        note: 'Your team was split',
      },
    });

    expect(host.textContent).toContain('Your team was split. Not this time.');
    expect(host.textContent).toContain('You voted Isaac.');
  });
});

describe('registration', () => {
  it('puts six views under the game id, and only there', () => {
    const registered = getGameViews(GAME_ID);

    expect(registered).toBe(whoSaidItViews);
    expect(Object.keys(registered?.host ?? {}).sort()).toEqual(['answering', 'question', 'reveal']);
    expect(Object.keys(registered?.player ?? {}).sort()).toEqual(['answering', 'question', 'reveal']);
  });
});
