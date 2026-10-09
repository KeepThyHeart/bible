// @vitest-environment jsdom
/**
 * What the two screens actually put in front of people.
 *
 * The assertions worth having are not about markup. They are that each phone
 * draws the seat the server gave it — the card and two buttons, nothing to
 * tap, or the card and "They said one" — that a tap names its card and is sent
 * once, that the card stays hidden during the get-ready, and that the end of a
 * turn shows what was got and who is next, with no totals.
 */

import { render } from 'preact';
import type { ComponentType } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  Intent,
  PersonalResult,
  PlayerSnapshot,
  PublicPlayer,
  RevealPayload,
  RoomSettings,
  ScreenSnapshot,
} from '../../../shared/protocol.js';
import { DEFAULT_THEME } from '../../../shared/theme.js';
import type { ClockPort } from '../../shell/clockPort.js';
import type { HostViewProps, PlayerViewProps } from '../../shell/gameViews.js';
import { getGameViews } from '../../shell/gameViews.js';
import { GAME_ID, describeItViews } from './index.js';

const NOW = 1_700_000_000_000;

const SETTINGS: RoomSettings = {
  gameId: GAME_ID,
  setId: null,
  translation: 'KJV',
  teamsEnabled: true,
  rounds: 8,
  answerWindowMs: 20_000,
  showIndividualScores: false,
  solo: false,
  groupVote: false,
  familiarity: 'broad',
  gameOptions: {},
  theme: DEFAULT_THEME,
};

const PLAYERS: PublicPlayer[] = [
  { id: 'p-anna', name: 'Anna', teamId: 'blue', connected: true },
  { id: 'p-sam', name: 'Sam', teamId: 'gold', connected: true },
  { id: 'p-luke', name: 'Luke', teamId: 'blue', connected: true },
];

const CARD = {
  concept: 'Jonah and the great fish',
  category: 'event',
  forbidden: ['whale', 'belly', 'Nineveh', 'swallowed'],
};

const stoppedClock: ClockPort = {
  serverNow: () => NOW,
  msUntil: () => 0,
  showAt: (_at, task) => {
    task();
    return () => undefined;
  },
  report: () => null,
  onChange: () => () => undefined,
};

function hostSnapshot(overrides: Partial<ScreenSnapshot> = {}): ScreenSnapshot {
  return {
    viewer: 'screen',
    code: 'KDXR',
    phase: 'answering',
    paused: false,
    round: 2,
    totalRounds: 8,
    settings: SETTINGS,
    players: PLAYERS,
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: null,
    phaseDurationMs: null,
    revealAt: null,
    serverTime: NOW,
    standings: [],
    teamStandings: [],
    overallStandings: [],
    answeredCount: 0,
    view: {
      role: 'host',
      teamId: 'blue',
      describer: 'p-anna',
      got: ['Noah’s ark', 'The burning bush', 'David and Goliath'],
      deckOut: false,
      deckSize: 40,
    },
    buzz: null,
    ...overrides,
  };
}

function playerSnapshot(view: unknown, overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
  return {
    viewer: 'player',
    code: 'KDXR',
    phase: 'answering',
    paused: false,
    round: 2,
    totalRounds: 8,
    settings: SETTINGS,
    players: PLAYERS,
    controller: { kind: 'owner' },
    questionOnScreen: false,
    phaseEndsAt: null,
    phaseDurationMs: null,
    revealAt: null,
    serverTime: NOW,
    you: PLAYERS[0] as PublicPlayer,
    yourScore: 200,
    youAnswered: false,
    yourAnswer: null,
    canChangeAnswer: true,
    yourRank: null,
    view,
    buzz: null,
    youAreSpent: false,
    yourControlRequest: null,
    ...overrides,
  };
}

const describer = (cardIndex = 3, extra: Record<string, unknown> = {}) => ({
  role: 'describer',
  teamId: 'blue',
  card: CARD,
  cardIndex,
  deckOut: false,
  called: false,
  ...extra,
});

const watcher = (cardIndex = 3) => ({
  role: 'watcher',
  teamId: 'blue',
  describer: 'p-anna',
  card: CARD,
  cardIndex,
  deckOut: false,
});

const REVEAL: RevealPayload = {
  round: 2,
  correctLabel: 'Blue team got 5',
  aggregates: [{ label: 'Got', count: 5 }],
  detail: {
    teamId: 'blue',
    describer: 'p-anna',
    got: ['Noah’s ark', 'The burning bush', 'David and Goliath', 'Jonah and the great fish', 'The Last Supper'],
    deckOut: false,
    next: { teamId: 'gold', describer: 'p-sam' },
  },
};

let screen: HTMLDivElement;
let sent: Intent[];
let sendIntent: (intent: Intent) => void;

beforeEach(() => {
  screen = document.createElement('div');
  document.body.appendChild(screen);
  sent = [];
  sendIntent = (intent) => sent.push(intent);
});

afterEach(() => {
  act(() => {
    render(null, screen);
  });
  screen.remove();
});

function drawHost(View: ComponentType<HostViewProps>, snapshot: ScreenSnapshot, reveal: RevealPayload | null = null): void {
  act(() => {
    render(
      <View snapshot={snapshot} view={snapshot.view} reveal={reveal} clock={stoppedClock} send={() => undefined} />,
      screen
    );
  });
}

function drawPhone(
  View: ComponentType<PlayerViewProps>,
  snapshot: PlayerSnapshot,
  reveal: RevealPayload | null = null,
  yourResult: PersonalResult | null = null
): void {
  act(() => {
    render(
      <View
        snapshot={snapshot}
        view={snapshot.view}
        reveal={reveal}
        yourResult={yourResult}
        clock={stoppedClock}
        send={sendIntent}
      />,
      screen
    );
  });
}

function button(label: string): HTMLButtonElement | null {
  return [...screen.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes(label)) ?? null;
}

function click(target: HTMLButtonElement | null): void {
  act(() => {
    target?.click();
  });
}

const phone = describeItViews.player.answering;

describe('registration', () => {
  it('registers every phase on both screens under the game’s id', () => {
    expect(getGameViews(GAME_ID)).toBe(describeItViews);
  });
});

describe('the describer’s phone', () => {
  it('shows the card, its forbidden words, Got it and Pass', () => {
    drawPhone(phone, playerSnapshot(describer()));
    expect(screen.textContent).toContain('You’re describing');
    expect(screen.textContent).toContain('Jonah and the great fish');
    for (const word of CARD.forbidden) expect(screen.textContent).toContain(word);
    expect(button('Got it')).not.toBeNull();
    expect(button('Pass')).not.toBeNull();
    expect(button('They said one')).toBeNull();
  });

  it('sends Got it once for the card in play, naming it', () => {
    drawPhone(phone, playerSnapshot(describer(3)));
    click(button('Got it'));
    click(button('Got it'));
    expect(sent).toEqual([{ kind: 'answer', round: 2, value: { type: 'card', action: 'got', card: 3 } }]);
    expect(button('Got it')?.disabled).toBe(true);
  });

  it('is free to tap again once the room shows the next card', () => {
    drawPhone(phone, playerSnapshot(describer(3)));
    click(button('Pass'));
    drawPhone(phone, playerSnapshot(describer(4)));
    click(button('Got it'));
    expect(sent.map((intent) => (intent.kind === 'answer' ? intent.value : null))).toEqual([
      { type: 'card', action: 'pass', card: 3 },
      { type: 'card', action: 'got', card: 4 },
    ]);
  });

  it('keeps the card hidden during the get-ready', () => {
    drawPhone(describeItViews.player.question, playerSnapshot(describer(0), { phase: 'question' }));
    expect(screen.textContent).toContain('Get ready');
    expect(screen.textContent).not.toContain('Jonah');
    expect(screen.querySelectorAll('button')).toHaveLength(0);
  });

  it('says so when the other team called the last card', () => {
    drawPhone(phone, playerSnapshot(describer(4, { called: true })));
    expect(screen.textContent).toContain('The other team called that one');
  });

  it('says honestly when the deck is out, with nothing left to tap', () => {
    drawPhone(phone, playerSnapshot(describer(40, { card: null, deckOut: true })));
    expect(screen.textContent).toContain('every card in the deck');
    expect(button('Got it')?.disabled).toBe(true);
    click(button('Got it'));
    expect(sent).toEqual([]);
  });

  it('sends nothing while the room is paused', () => {
    drawPhone(phone, playerSnapshot(describer(), { paused: true }));
    click(button('Got it'));
    expect(sent).toEqual([]);
  });
});

describe('a teammate’s phone', () => {
  it('says who is describing and to guess out loud, with nothing to tap', () => {
    const view = { role: 'guesser', teamId: 'blue', describer: 'p-anna', gotCount: 3 };
    drawPhone(phone, playerSnapshot(view, { you: PLAYERS[2] as PublicPlayer }));
    expect(screen.textContent).toContain('Anna is describing');
    expect(screen.textContent).toContain('Guess out loud');
    expect(screen.textContent).toContain('Blue team has 3 so far');
    expect(screen.querySelectorAll('button')).toHaveLength(0);
  });

  it('counts for the room when there are no teams', () => {
    const view = { role: 'guesser', teamId: null, describer: 'p-anna', gotCount: 2 };
    drawPhone(phone, playerSnapshot(view, { settings: { ...SETTINGS, teamsEnabled: false } }));
    expect(screen.textContent).toContain('2 so far');
    expect(screen.textContent).not.toContain('team has');
  });
});

describe('the other team’s phone', () => {
  it('shows the card and one button that calls a slip on it', () => {
    drawPhone(phone, playerSnapshot(watcher(3), { you: PLAYERS[1] as PublicPlayer }));
    expect(screen.textContent).toContain('Blue’s card — keep it quiet');
    expect(screen.textContent).toContain('Jonah and the great fish');
    expect(button('Got it')).toBeNull();
    click(button('They said one'));
    click(button('They said one'));
    expect(sent).toEqual([{ kind: 'answer', round: 2, value: { type: 'card', action: 'slip', card: 3 } }]);
  });

  it('shows no card until the turn starts', () => {
    drawPhone(describeItViews.player.question, playerSnapshot(watcher(0), { phase: 'question' }));
    expect(screen.textContent).not.toContain('Jonah');
    expect(screen.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('a phone that joined mid-turn', () => {
  it('is told it is in from the next turn', () => {
    drawPhone(phone, playerSnapshot({ role: 'waiting' }));
    expect(screen.textContent).toContain('in from the next turn');
  });

  it('draws a plain line for a payload it cannot read', () => {
    drawPhone(phone, playerSnapshot({ nonsense: true }));
    expect(screen.textContent).toContain('Getting the question ready');
  });
});

describe('the big screen during a turn', () => {
  it('shows the team, who is describing and what has been got', () => {
    drawHost(describeItViews.host.answering, hostSnapshot());
    expect(screen.textContent).toContain('Blue team');
    expect(screen.textContent).toContain('Anna is describing');
    expect(screen.textContent).toContain('Blue team, guess out loud.');
    expect(screen.textContent).toContain('Got so far · 3');
    expect(screen.textContent).toContain('David and Goliath');
  });

  it('calls on everyone when there are no teams, and shows no team', () => {
    const view = { role: 'host', teamId: null, describer: 'p-anna', got: [], deckOut: false, deckSize: 40 };
    drawHost(describeItViews.host.answering, hostSnapshot({ view }));
    expect(screen.textContent).toContain('Everyone, guess out loud.');
    expect(screen.querySelector('.di-team')).toBeNull();
  });

  it('says when the deck has run out', () => {
    const view = { role: 'host', teamId: 'blue', describer: 'p-anna', got: [], deckOut: true, deckSize: 40 };
    drawHost(describeItViews.host.answering, hostSnapshot({ view }));
    expect(screen.textContent).toContain('every card in the deck');
  });

  it('says there is nothing to describe when no cards are installed', () => {
    const view = { role: 'host', teamId: 'blue', describer: 'p-anna', got: [], deckOut: true, deckSize: 0 };
    drawHost(describeItViews.host.answering, hostSnapshot({ view }));
    expect(screen.textContent).toContain('no cards to describe');
  });

  it('shows who is describing during the get-ready', () => {
    drawHost(describeItViews.host.question, hostSnapshot({ phase: 'question' }));
    expect(screen.textContent).toContain('Anna is describing');
    expect(screen.textContent).toContain('get ready');
  });
});

describe('the end of a turn', () => {
  it('shows what the team got and who is up next, and no totals', () => {
    drawHost(describeItViews.host.reveal, hostSnapshot({ phase: 'reveal' }), REVEAL);
    expect(screen.textContent).toContain('Blue team got 5');
    expect(screen.textContent).toContain('The Last Supper');
    expect(screen.textContent).toContain('Well described, Anna.');
    expect(screen.textContent).toContain('Gold team — Sam describes');
    expect(screen.textContent).not.toMatch(/\d{3}/u);
  });

  it('names nobody as next after the last turn', () => {
    drawHost(describeItViews.host.reveal, hostSnapshot({ phase: 'reveal', round: 7 }), REVEAL);
    expect(screen.textContent).toContain('last turn');
    expect(screen.textContent).not.toContain('Sam describes');
  });

  it('tells the describing team it was theirs', () => {
    const result: PersonalResult = { correct: true, pointsAwarded: 250, submitted: null, note: null };
    drawPhone(describeItViews.player.reveal, playerSnapshot(null, { phase: 'reveal' }), REVEAL, result);
    expect(screen.textContent).toContain('Your team got 5');
  });

  it('tells the next describer to get ready, and the other team what happened', () => {
    drawPhone(
      describeItViews.player.reveal,
      playerSnapshot(null, { phase: 'reveal', you: PLAYERS[1] as PublicPlayer }),
      REVEAL
    );
    expect(screen.textContent).toContain('Blue team got 5');
    expect(screen.textContent).toContain('You’re describing next');
  });
});
