// @vitest-environment jsdom
/**
 * What the two screens actually put in front of people.
 *
 * The assertions worth having are not about markup. They are that a tap builds
 * the order the player meant and a mistake is cheap to undo, that one order is
 * sent for the round the phone believes it is in, that the big screen praises
 * with counts and names nobody, and that a round with nothing in it says so.
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
} from '../../../shared/protocol.js';
import { DEFAULT_THEME } from '../../../shared/theme.js';
import type { ClockPort } from '../../shell/clockPort.js';
import { clearGameViews, getGameViews } from '../../shell/gameViews.js';
import { GAME_ID, putInOrderViews } from './index.js';

afterAll(() => {
  clearGameViews();
});

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
  title: 'The days of creation, set 1',
  instructions: 'Put these in the order God made them.',
  items: [
    { key: 'A', label: 'Fish and birds' },
    { key: 'B', label: 'Light' },
    { key: 'C', label: 'God rested' },
    { key: 'D', label: 'Dry land and plants' },
  ],
};

const NOTHING = { title: '', instructions: '', items: [] };

const REVEAL: RevealPayload = {
  round: 2,
  correctLabel: 'Light → Dry land and plants → Fish and birds → God rested',
  aggregates: [
    { label: 'All in order', count: 3 },
    { label: 'One swap away', count: 2 },
    { label: 'Further off', count: 4 },
  ],
  detail: {
    title: 'The days of creation, set 1',
    instructions: 'Put these in the order God made them.',
    items: [
      { key: 'B', label: 'Light', reference: 'Genesis 1:3', note: 'The first day.' },
      { key: 'D', label: 'Dry land and plants', reference: 'Genesis 1:12', note: null },
      { key: 'A', label: 'Fish and birds', reference: 'Genesis 1:21', note: null },
      { key: 'C', label: 'God rested', reference: 'Genesis 2:2', note: null },
    ],
    pairs: 6,
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

function hostSnapshot(view: unknown): ScreenSnapshot {
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
    view,
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
  const View = putInOrderViews.host[phase];
  act(() => {
    render(
      <View
        snapshot={hostSnapshot(view)}
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
  const View = putInOrderViews.player[phase];
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

function click(element: Element | null | undefined): void {
  expect(element).toBeTruthy();
  act(() => {
    (element as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** The button in the pool for an item not yet placed. */
function poolButton(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>('.pio-tap')].find((button) =>
    button.textContent?.includes(label)
  );
}

/** The button for an item already in the player's order. */
function placedButton(label: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>('.pio-placed')].find((button) =>
    button.textContent?.includes(label)
  );
}

function sendButton(): HTMLButtonElement {
  return host.querySelector('.pio-send') as HTMLButtonElement;
}

function slots(): string[] {
  return [...host.querySelectorAll('.pio-slots .pio-slot')].map(
    (slot) => slot.querySelector('.pio-slot-label')?.textContent ?? ''
  );
}

describe('the big screen', () => {
  it('puts up the title, the instruction and every item under a letter', () => {
    drawHost('answering');

    expect(host.textContent).toContain('The days of creation, set 1');
    expect(host.textContent).toContain('Put these in the order God made them.');
    const items = [...host.querySelectorAll('.pio-item')].map((item) => item.textContent);
    expect(items).toEqual(['AFish and birds', 'BLight', 'CGod rested', 'DDry land and plants']);
    expect(host.textContent).toContain('phone');
  });

  it('shows the same list before ordering opens', () => {
    drawHost('question');

    expect(host.querySelectorAll('.pio-item')).toHaveLength(4);
  });

  it('reveals the right order with each reference and note', () => {
    drawHost('reveal', QUESTION, REVEAL);

    const rows = [...host.querySelectorAll('.pio-answer-row')];
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toContain('Light');
    expect(rows[0]?.textContent).toContain('Genesis 1:3');
    expect(rows[0]?.textContent).toContain('The first day.');
    expect(rows[3]?.textContent).toContain('Genesis 2:2');
  });

  it('praises with two counts, never mentions who was further off, and names nobody', () => {
    drawHost('reveal', QUESTION, REVEAL);

    const tally = host.querySelector('.pio-tally')?.textContent ?? '';
    expect(tally).toContain('3had it all in order');
    expect(tally).toContain('2were one swap away');
    expect(host.textContent).not.toContain('Further off');
    expect(host.textContent).toContain('9 answers');
    expect(host.textContent).not.toContain('Miriam');
  });

  it('says plainly when there is nothing to put in order', () => {
    drawHost('answering', NOTHING);

    expect(host.textContent).toContain('Nothing to put in order this round.');
    expect(host.textContent).toContain('no lists');
  });

  it('draws a line of text for a payload it cannot read', () => {
    drawHost('question', { nothing: 'useful' });
    expect(host.textContent).toContain('Nothing to show');

    drawHost('reveal', QUESTION, null);
    expect(host.textContent).toContain('Waiting');
  });
});

describe('the phone, building an order', () => {
  it('moves each tapped item into the next numbered place', () => {
    drawPhone('answering');
    click(poolButton('Light'));
    click(poolButton('Dry land'));

    expect(slots().slice(0, 2)).toEqual(['Light', 'Dry land and plants']);
    expect(poolButton('Light')).toBeUndefined();
    expect(host.querySelectorAll('.pio-tap')).toHaveLength(2);
  });

  it('places the last item by itself, since it has only one place left', () => {
    drawPhone('answering');
    click(poolButton('Light'));
    click(poolButton('Dry land'));
    click(poolButton('Fish'));

    expect(slots()).toEqual(['Light', 'Dry land and plants', 'Fish and birds', 'God rested']);
    expect(host.querySelectorAll('.pio-tap')).toHaveLength(0);
    expect(sendButton().disabled).toBe(false);
  });

  it('sends the order once it is complete, keyed by letter', () => {
    drawPhone('answering');
    click(poolButton('Light'));
    click(poolButton('Dry land'));
    click(poolButton('Fish'));
    click(sendButton());

    expect(sent).toEqual([
      { kind: 'answer', round: 2, value: { type: 'order', order: ['B', 'D', 'A', 'C'] } },
    ]);
  });

  it('will not send an order with gaps in it', () => {
    drawPhone('answering');
    click(poolButton('Light'));

    expect(sendButton().disabled).toBe(true);
    click(sendButton());
    expect(sent).toEqual([]);
  });

  it('takes a placed item back out when it is tapped', () => {
    drawPhone('answering');
    click(poolButton('Light'));
    click(poolButton('Fish'));
    click(placedButton('Light'));

    expect(slots()[0]).toBe('Fish and birds');
    expect(poolButton('Light')).toBeDefined();
  });

  it('puts the item it placed by itself back in the pool when an earlier one is taken back', () => {
    drawPhone('answering');
    click(poolButton('Light'));
    click(poolButton('Dry land'));
    click(poolButton('Fish'));
    click(placedButton('Dry land'));

    expect(slots().filter((label) => label !== '')).toEqual(['Light', 'Fish and birds']);
    expect(poolButton('God rested')).toBeDefined();
    expect(sendButton().disabled).toBe(true);
  });

  it('starts over from nothing', () => {
    drawPhone('answering');
    click(poolButton('Light'));
    click(poolButton('Fish'));
    click(host.querySelector('.pio-clear'));

    expect(host.querySelectorAll('.pio-placed')).toHaveLength(0);
    expect(host.querySelectorAll('.pio-tap')).toHaveLength(4);
  });

  it('will not send a second order, and shows the one it sent', () => {
    drawPhone('answering');
    click(poolButton('Light'));
    click(poolButton('Dry land'));
    click(poolButton('Fish'));
    click(sendButton());

    expect(host.textContent).toContain('Order sent');
    expect(host.querySelectorAll('button')).toHaveLength(0);
    expect(host.textContent).toContain('Dry land and plants');
    expect(sent).toHaveLength(1);
  });

  it('is closed for a player the server says has already answered', () => {
    drawPhone('answering', { snapshot: { youAnswered: true } });

    expect(host.querySelectorAll('button')).toHaveLength(0);
    expect(host.textContent).toContain('Answer sent');
  });

  it('starts the next round clean', () => {
    drawPhone('answering');
    click(poolButton('Light'));
    drawPhone('answering', { snapshot: { round: 3 } });

    expect(host.querySelectorAll('.pio-placed')).toHaveLength(0);
    expect(host.querySelectorAll('.pio-tap')).toHaveLength(4);
  });

  it('says plainly when there is nothing to put in order', () => {
    drawPhone('answering', { view: NOTHING });

    expect(host.textContent).toContain('Nothing to put in order this round.');
    expect(host.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('the phone, at the reveal', () => {
  it('shows the right order and says the player had it', () => {
    drawPhone('reveal', {
      reveal: REVEAL,
      yourResult: {
        correct: true,
        pointsAwarded: 100,
        submitted: { type: 'order', order: ['B', 'D', 'A', 'C'] },
        note: null,
      },
    });

    expect(host.querySelectorAll('.pio-answer-row')).toHaveLength(4);
    expect(host.textContent).toContain('All in order.');
    expect(host.textContent).not.toContain('Your order');
  });

  it('shows a nearly right player how close they were, and their own order, privately', () => {
    drawPhone('reveal', {
      reveal: REVEAL,
      yourResult: {
        correct: false,
        pointsAwarded: 67,
        submitted: { type: 'order', order: ['D', 'B', 'A', 'C'] },
        note: 'One swap from perfect',
      },
    });

    expect(host.textContent).toContain('One swap from perfect');
    const yours = [...host.querySelectorAll('.pio-your-list li')].map((row) => row.textContent);
    expect(yours).toEqual(['Dry land and plants', 'Light', 'Fish and birds', 'God rested']);
  });

  it('says nothing more than that about a phone that did not answer', () => {
    drawPhone('reveal', { reveal: REVEAL, yourResult: null });

    expect(host.textContent).toContain('No answer from this phone');
  });

  it('waits rather than failing when the reveal has not arrived', () => {
    drawPhone('reveal', { reveal: null });

    expect(host.textContent).toContain('Waiting');
  });
});

describe('registration', () => {
  it('puts six views under the game id, and only there', () => {
    const registered = getGameViews(GAME_ID);

    expect(GAME_ID).toBe('put-in-order');
    expect(registered).toBe(putInOrderViews);
    expect(Object.keys(registered?.host ?? {}).sort()).toEqual(['answering', 'question', 'reveal']);
    expect(Object.keys(registered?.player ?? {}).sort()).toEqual(['answering', 'question', 'reveal']);
  });
});
