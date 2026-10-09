// @vitest-environment jsdom
/**
 * What the two screens actually put in front of people.
 *
 * The assertions worth having here are not about markup. They are that the big
 * screen never carries a name beside a count, that a tap sends exactly one
 * answer for the round the phone believes it is in, and that a payload the
 * client cannot read draws a line of text rather than an exception.
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
import { GAME_ID, nameThatReferenceViews } from './index.js';

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
  answerShape: 'choice',
  closeness: 'section',
  translation: 'KJV',
  text: 'For God so loved the world.',
  options: [
    { index: 0, label: 'John 3:15' },
    { index: 1, label: 'John 3:16' },
    { index: 2, label: 'John 8:12' },
    { index: 3, label: 'Romans 8:28' },
  ],
};

const TYPED_QUESTION = { ...QUESTION, answerShape: 'reference', options: [] };

const REVEAL: RevealPayload = {
  round: 2,
  correctLabel: 'John 3:16',
  aggregates: [
    { label: 'John 3:15', count: 1 },
    { label: 'John 3:16', count: 4 },
    { label: 'John 8:12', count: 0 },
    { label: 'Romans 8:28', count: 2 },
  ],
  detail: {
    answerShape: 'choice',
    reference: 'John 3:16',
    text: 'For God so loved the world.',
    translation: 'KJV',
    options: [
      { label: 'John 3:15', distance: 'chapter', correct: false },
      { label: 'John 3:16', distance: null, correct: true },
      { label: 'John 8:12', distance: 'book', correct: false },
      { label: 'Romans 8:28', distance: 'section', correct: false },
    ],
    credit: { exact: 100, bookAndChapter: 70, book: 40 },
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
  const View = nameThatReferenceViews.host[phase];
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
  const View = nameThatReferenceViews.player[phase];
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
  it('puts the verse up on its own before the options', () => {
    drawHost('question');

    expect(host.textContent).toContain('For God so loved the world.');
    expect(host.textContent).not.toContain('Romans 8:28');
  });

  it('shows every option with a letter to say aloud', () => {
    drawHost('answering');

    expect(host.querySelectorAll('.ntr-option')).toHaveLength(4);
    expect(host.textContent).toContain('A');
    expect(host.textContent).toContain('John 3:16');
  });

  it('asks for a typed reference when the round wants one', () => {
    drawHost('answering', TYPED_QUESTION);

    expect(host.querySelectorAll('.ntr-option')).toHaveLength(0);
    expect(host.textContent).toContain('phone');
  });

  it('reveals the reference, the verse and the split, and names nobody', () => {
    drawHost('reveal', QUESTION, REVEAL);

    expect(host.textContent).toContain('John 3:16');
    expect(host.textContent).toContain('For God so loved the world.');
    expect(host.querySelectorAll('.ntr-split-row')).toHaveLength(4);
    expect(host.textContent).toContain('7 answers');
    expect(host.textContent).not.toContain('Miriam');
  });

  it('says where the wrong options came from, once they no longer matter', () => {
    drawHost('reveal', QUESTION, REVEAL);

    expect(host.textContent).toContain('same chapter');
    expect(host.textContent).toContain('same book');
    expect(host.textContent).toContain('same part of the Bible');
  });

  it('draws a line of text for a payload it cannot read', () => {
    drawHost('question', { nothing: 'useful' });
    expect(host.textContent).toContain('Nothing to show');

    drawHost('reveal', QUESTION, null);
    expect(host.textContent).toContain('Waiting');
  });
});

describe('the phone, choosing', () => {
  it('sends one answer for the round it is in', () => {
    drawPhone('answering');
    click(buttons()[1]);

    expect(sent).toEqual([
      { kind: 'answer', round: 2, value: { type: 'choice', index: 1 } },
    ]);
  });

  it('will not send a second answer, however many times it is tapped', () => {
    drawPhone('answering');
    click(buttons()[1]);
    click(buttons()[0]);
    click(buttons()[1]);

    expect(sent).toHaveLength(1);
    expect(host.textContent).toContain('Sent: John 3:16');
    expect(buttons().every((button) => button.disabled)).toBe(true);
  });

  it('is closed for a player the server says has already answered', () => {
    drawPhone('answering', { snapshot: { youAnswered: true } });
    click(buttons()[2]);

    expect(sent).toEqual([]);
  });

  it('offers a tap target for every option', () => {
    drawPhone('answering');

    expect(buttons()).toHaveLength(4);
    expect(buttons()[3]?.textContent).toContain('Romans 8:28');
  });
});

describe('the phone, answering from the keyboard', () => {
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

  it('ignores a letter past the options actually on offer', () => {
    drawPhone('answering', { view: { ...QUESTION, options: QUESTION.options.slice(0, 2) } });
    press('c');

    expect(sent).toEqual([]);
  });

  it('ignores a key that names no option at all', () => {
    drawPhone('answering');
    press('q');
    press('1');
    press('Enter');

    expect(sent).toEqual([]);
  });

  it('ignores a letter held with a modifier, a browser shortcut rather than an answer', () => {
    drawPhone('answering');
    press('b', { ctrlKey: true });
    press('b', { metaKey: true });
    press('b', { altKey: true });

    expect(sent).toEqual([]);
  });

  it('stops answering to the keyboard once the phone is done, the same as the buttons', () => {
    drawPhone('answering', { snapshot: { youAnswered: true } });
    press('b');

    expect(sent).toEqual([]);
  });

  it('does nothing for a typed round, which has no lettered options', () => {
    drawPhone('answering', { view: TYPED_QUESTION });
    press('a');

    expect(sent).toEqual([]);
  });

  it('changes a standing vote, letter to letter, exactly as a second tap would', () => {
    drawPhone('answering', { snapshot: { canChangeAnswer: true } });
    press('a');
    press('b');

    expect(sent).toEqual([
      { kind: 'answer', round: 2, value: { type: 'choice', index: 0 } },
      { kind: 'answer', round: 2, value: { type: 'choice', index: 1 } },
    ]);
  });
});

describe('the phone, typing a reference', () => {
  function select(index: number): HTMLSelectElement {
    return [...host.querySelectorAll('select')][index] as HTMLSelectElement;
  }

  function choose(element: HTMLSelectElement | HTMLInputElement, value: string): void {
    act(() => {
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  it('offers every book, and only the chapters that book has', () => {
    drawPhone('answering', { view: TYPED_QUESTION });

    expect(select(0).options).toHaveLength(66);
    expect(select(1).options).toHaveLength(50);

    choose(select(0), '65');

    expect(select(1).options).toHaveLength(1);
    expect(select(1).disabled).toBe(true);
  });

  it('sends what the picker is showing', () => {
    drawPhone('answering', { view: TYPED_QUESTION });
    choose(select(0), '43');
    choose(select(1), '3');
    choose(host.querySelector('input') as HTMLInputElement, '16');
    click(buttons()[0]);

    expect(sent).toEqual([
      { kind: 'answer', round: 2, value: { type: 'reference', book: 43, chapter: 3, verse: 16 } },
    ]);
  });

  it('never sends a chapter left over from the book before', () => {
    drawPhone('answering', { view: TYPED_QUESTION });
    choose(select(0), '19');
    choose(select(1), '119');
    choose(select(0), '65');
    click(buttons()[0]);

    expect(sent[0]).toEqual({
      kind: 'answer',
      round: 2,
      value: { type: 'reference', book: 65, chapter: 1, verse: 1 },
    });
  });

  it('lets a second guess replace the first when it can still change', () => {
    drawPhone('answering', { view: TYPED_QUESTION, snapshot: { canChangeAnswer: true } });
    choose(select(0), '43');
    choose(select(1), '3');
    choose(host.querySelector('input') as HTMLInputElement, '16');
    click(buttons()[0]);
    choose(select(0), '1');
    choose(select(1), '1');
    choose(host.querySelector('input') as HTMLInputElement, '1');
    click(buttons()[0]);

    expect(sent).toEqual([
      { kind: 'answer', round: 2, value: { type: 'reference', book: 43, chapter: 3, verse: 16 } },
      { kind: 'answer', round: 2, value: { type: 'reference', book: 1, chapter: 1, verse: 1 } },
    ]);
    expect(host.textContent).toContain('You can change it until time runs out');
  });

  it('disables the picker once sent when it cannot be changed', () => {
    drawPhone('answering', { view: TYPED_QUESTION, snapshot: { youAnswered: true } });

    expect(select(0).disabled).toBe(true);
    expect(host.textContent).toContain('Answer sent');
  });
});

describe('the phone, at the reveal', () => {
  it('shows the answer and says the player was right', () => {
    drawPhone('reveal', {
      reveal: REVEAL,
      yourResult: {
        correct: true,
        pointsAwarded: 100,
        submitted: { type: 'choice', index: 1 },
        note: null,
      },
    });

    expect(host.textContent).toContain('John 3:16');
    expect(host.textContent).toContain('Right.');
  });

  it('says how far a partly right answer got, and what it was', () => {
    drawPhone('reveal', {
      reveal: REVEAL,
      yourResult: {
        correct: false,
        pointsAwarded: 40,
        submitted: { type: 'reference', book: 43, chapter: 9, verse: 1 },
        note: 'Right book',
      },
    });

    expect(host.textContent).toContain('Right book');
    expect(host.textContent).toContain('You said John 9:1');
  });

  it('says nothing at all about a phone that did not answer', () => {
    drawPhone('reveal', { reveal: REVEAL, yourResult: null });

    expect(host.textContent).toContain('No answer from this phone');
  });
});

describe('the phone, voting with a team', () => {
  const VOTING: Partial<PlayerSnapshot> = { canChangeAnswer: true };

  it('invites a vote and says it can change', () => {
    drawPhone('answering', { snapshot: VOTING });

    expect(host.textContent).toContain('Tap a reference to vote. You can change it until time runs out.');
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
    expect(host.textContent).toContain('Your vote: John 3:16.');
  });

  it('does not send the vote that stands a second time', () => {
    drawPhone('answering', { snapshot: VOTING });
    click(buttons()[3]);
    click(buttons()[3]);

    expect(sent).toHaveLength(1);
  });

  it('highlights the vote the room holds, for a phone that has just reloaded', () => {
    drawPhone('answering', {
      snapshot: { ...VOTING, youAnswered: true, yourAnswer: { type: 'choice', index: 2 } },
    });

    expect(buttons()[2]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons().every((button) => !button.disabled)).toBe(true);
    expect(host.textContent).toContain('Your vote: John 8:12.');
  });
});

describe('a reveal decided by team vote', () => {
  const TEAM_REVEAL: RevealPayload = {
    ...REVEAL,
    groups: [
      {
        teamId: null,
        split: [
          { label: 'John 3:16', count: 4 },
          { label: 'Romans 8:28', count: 2 },
        ],
        decided: 'John 3:16',
        correct: true,
      },
    ],
  };

  it('leaves the split to the teams’ own, and still says where the wrong options came from', () => {
    drawHost('reveal', QUESTION, TEAM_REVEAL);

    expect(host.querySelector('.ntr-answer')?.textContent).toBe('John 3:16');
    expect(host.querySelectorAll('.ntr-split-row')).toHaveLength(0);
    expect(host.textContent).not.toContain('answers — nobody is named');
    expect(host.textContent).toContain('same chapter');
  });

  it('tells a dissenter in a right room what the room chose and what they voted', () => {
    drawPhone('reveal', {
      reveal: TEAM_REVEAL,
      yourResult: {
        correct: true,
        pointsAwarded: 100,
        submitted: { type: 'choice', index: 3 },
        note: 'The room chose John 3:16',
      },
    });

    expect(host.textContent).toContain('The room chose John 3:16. Right.');
    expect(host.textContent).toContain('You voted Romans 8:28.');
  });

  it('says the team result to a phone that never voted', () => {
    drawPhone('reveal', {
      reveal: TEAM_REVEAL,
      yourResult: { correct: true, pointsAwarded: 100, submitted: null, note: 'The room chose John 3:16' },
    });

    expect(host.textContent).toContain('The room chose John 3:16. Right.');
    expect(host.textContent).not.toContain('You voted');
  });
});

describe('registration', () => {
  it('puts six views under the game id, and only there', () => {
    const registered = getGameViews(GAME_ID);

    expect(registered).toBe(nameThatReferenceViews);
    expect(Object.keys(registered?.host ?? {}).sort()).toEqual([
      'answering',
      'question',
      'reveal',
    ]);
    expect(Object.keys(registered?.player ?? {}).sort()).toEqual([
      'answering',
      'question',
      'reveal',
    ]);
  });
});
