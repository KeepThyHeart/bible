/**
 * A turn, what each viewer is given of it, and what it is worth.
 *
 * The promises pinned here are the ones a leak would break in front of a
 * room: the big screen never carries the card in play or a passed card, the
 * describer's teammates never carry any card, a passed card never reaches the
 * reveal, a retried or doubled tap moves on only one card, and only the
 * describing team scores.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Round, RoundBuildContext, ScoredAnswer, Seat, Table } from '../../../../../src/modules/games/shared/games.js';
import type { AnswerValue, PhaseName, PlayerId, RoomSettings, TeamId } from '../../../../../src/modules/games/shared/protocol.js';
import { DEFAULT_THEME } from '../../../../../src/modules/games/shared/theme.js';
import {
  ContentDatabase,
  ContentLibrary,
  ModuleCatalog,
  importContent,
  useContent,
} from '../../content/index.js';
import {
  DEFAULT_TURN_MS,
  GAME_ID,
  GET_READY_MS,
  MAX_TURN_SECONDS,
  MIN_TURN_SECONDS,
  POINTS_PER_CARD,
  TURN_SECONDS_OPTION,
  deckSpent,
  describeIt,
  turnChrome,
  turnLabel,
  turnMsFor,
} from './index.js';
import type {
  DescribeItCard,
  DescribeItReveal,
  DescribeItSecret,
  DescriberView,
  HostTurnView,
  WatcherView,
} from './index.js';

const DECK: DescribeItCard[] = [
  { id: 'c0', concept: 'Walls of Jericho', category: 'event', forbidden: ['trumpets', 'shout', 'Joshua', 'march'] },
  { id: 'c1', concept: 'Manna from heaven', category: 'object', forbidden: ['bread', 'desert', 'quail', 'morning'] },
  { id: 'c2', concept: 'David and Goliath', category: 'event', forbidden: ['sling', 'giant', 'stone', 'Philistine'] },
  { id: 'c3', concept: 'Tower of Babel', category: 'place', forbidden: ['languages', 'bricks', 'scattered', 'confusion'] },
];

function seat(playerId: PlayerId, teamId: TeamId | null): Seat {
  return { playerId, teamId };
}

/** Red: ann and cy. Blue: bo. Turn 0 is red's, described by ann. */
const TEAMS: Seat[] = [seat('ann', 'red'), seat('bo', 'blue'), seat('cy', 'red')];

const NO_TEAMS: Seat[] = [seat('ann', null), seat('bo', null), seat('cy', null)];

function turn(index = 0, deck: DescribeItCard[] = DECK, turns = 4): Round<DescribeItSecret> {
  return { index, secret: { deck, turns }, hostView: null, playerView: null };
}

function tap(playerId: PlayerId, action: 'got' | 'pass' | 'slip', card: number, at = 1_000): ScoredAnswer {
  return { playerId, value: { type: 'card', action, card }, at, openedAt: 0 };
}

function table(log: ScoredAnswer[] = [], seats: Seat[] = TEAMS): Table {
  return { seats, log };
}

function viewOf(
  round: Round<DescribeItSecret>,
  at: Table,
  viewer: PlayerId | null,
  phase: PhaseName = 'answering'
): unknown {
  return describeIt.viewFor?.(round, at, viewer, phase);
}

function accepts(at: Table, playerId: PlayerId, value: AnswerValue, round = turn()): boolean {
  return describeIt.accepts?.(round, at, playerId, value) ?? true;
}

const card = (action: 'got' | 'pass' | 'slip', index: number): AnswerValue => ({
  type: 'card',
  action,
  card: index,
});

describe('what each phone is given', () => {
  it('gives the describer the card in play, its forbidden words and the index a tap must carry', () => {
    expect(viewOf(turn(), table(), 'ann')).toEqual({
      role: 'describer',
      teamId: 'red',
      card: { concept: 'Walls of Jericho', category: 'event', forbidden: ['trumpets', 'shout', 'Joshua', 'march'] },
      cardIndex: 0,
      deckOut: false,
      called: false,
    });
  });

  it("gives the describer's teammates someone to listen to and no card at all", () => {
    const log = [tap('ann', 'got', 0), tap('ann', 'pass', 1)];
    const view = viewOf(turn(), table(log), 'cy');
    expect(view).toEqual({ role: 'guesser', teamId: 'red', describer: 'ann', gotCount: 1 });
    const wire = JSON.stringify(view);
    for (const dealt of DECK) {
      expect(wire).not.toContain(dealt.concept);
      for (const word of dealt.forbidden) expect(wire).not.toContain(word);
    }
  });

  it('gives the other team the card, so they can hear a forbidden word when it comes', () => {
    const view = viewOf(turn(), table([tap('ann', 'pass', 0)]), 'bo') as WatcherView;
    expect(view.role).toBe('watcher');
    expect(view.card?.concept).toBe('Manna from heaven');
    expect(view.cardIndex).toBe(1);
  });

  it('tells the describer, and only the describer, that the last card was called', () => {
    const log = [tap('ann', 'got', 0), tap('bo', 'slip', 1)];
    expect((viewOf(turn(), table(log), 'ann') as DescriberView).called).toBe(true);
    expect(JSON.stringify(viewOf(turn(), table(log), null))).not.toContain('called');
  });

  it('tells someone without a seat that they are in from the next turn', () => {
    expect(viewOf(turn(), table(), 'late')).toEqual({ role: 'waiting' });
  });
});

describe('what the big screen is given', () => {
  it('shows the team, the describer and what has been got, and never the card in play', () => {
    const log = [tap('ann', 'got', 0), tap('ann', 'pass', 1), tap('bo', 'slip', 2)];
    const view = viewOf(turn(), table(log), null);
    expect(view).toEqual({
      role: 'host',
      teamId: 'red',
      describer: 'ann',
      got: ['Walls of Jericho'],
      deckOut: false,
      deckSize: 4,
    } satisfies HostTurnView);
    const wire = JSON.stringify(view);
    // Passed, called and in play: none of the three may reach the wall.
    for (const hidden of DECK.slice(1)) {
      expect(wire).not.toContain(hidden.concept);
      for (const word of hidden.forbidden) expect(wire).not.toContain(word);
    }
    // Nor who called the slip.
    expect(wire).not.toContain('bo');
  });

  it('carries no card at all before anything is got', () => {
    const wire = JSON.stringify(viewOf(turn(), table(), null));
    for (const dealt of DECK) expect(wire).not.toContain(dealt.concept);
  });
});

describe('which taps are taken', () => {
  it('takes Got it and Pass from the describer, naming the card in play', () => {
    expect(accepts(table(), 'ann', card('got', 0))).toBe(true);
    expect(accepts(table([tap('ann', 'got', 0)]), 'ann', card('pass', 1))).toBe(true);
  });

  it('ignores a retried tap that names a card already moved on from', () => {
    expect(accepts(table([tap('ann', 'got', 0)]), 'ann', card('got', 0))).toBe(false);
  });

  it('takes the first of two slips on the same card and ignores the second', () => {
    const seats = [...TEAMS, seat('di', 'blue')];
    expect(accepts(table([], seats), 'bo', card('slip', 0))).toBe(true);
    expect(accepts(table([tap('bo', 'slip', 0)], seats), 'di', card('slip', 0))).toBe(false);
  });

  it('ignores a tap that names a card not yet reached', () => {
    expect(accepts(table(), 'ann', card('got', 1))).toBe(false);
  });

  it('takes Got it and Pass from nobody but the describer', () => {
    expect(accepts(table(), 'cy', card('got', 0))).toBe(false);
    expect(accepts(table(), 'bo', card('pass', 0))).toBe(false);
  });

  it('takes a slip only from the other team', () => {
    expect(accepts(table(), 'cy', card('slip', 0))).toBe(false);
    expect(accepts(table(), 'ann', card('slip', 0))).toBe(false);
    expect(accepts(table(), 'bo', card('slip', 0))).toBe(true);
  });

  it('takes a slip from nobody when teams are off, because there is no other side', () => {
    for (const playerId of ['ann', 'bo', 'cy']) {
      expect(accepts(table([], NO_TEAMS), playerId, card('slip', 0))).toBe(false);
    }
  });

  it('ignores anyone without a seat, and anything that is not a card', () => {
    expect(accepts(table(), 'late', card('slip', 0))).toBe(false);
    expect(accepts(table(), 'ann', { type: 'text', text: 'Jericho' })).toBe(false);
  });

  it('takes nothing once the deck is out', () => {
    const log = DECK.map((_, index) => tap('ann', 'pass', index));
    expect(accepts(table(log), 'ann', card('got', DECK.length))).toBe(false);
  });
});

describe('a deck that runs out', () => {
  const log = DECK.map((_, index) => tap('ann', index % 2 === 0 ? 'got' : 'pass', index));

  it('says so on every screen rather than showing a blank card', () => {
    const describer = viewOf(turn(), table(log), 'ann') as DescriberView;
    expect(describer.card).toBeNull();
    expect(describer.deckOut).toBe(true);
    expect((viewOf(turn(), table(log), 'bo') as WatcherView).deckOut).toBe(true);
    expect((viewOf(turn(), table(log), null) as HostTurnView).deckOut).toBe(true);
  });

  it('says so in the reveal', () => {
    const outcome = describeIt.scoreRound(turn(), log, table(log));
    expect((outcome.detail as DescribeItReveal).deckOut).toBe(true);
  });

  it('is out from the start when no cards were installed, and says how many there were', () => {
    const view = viewOf(turn(0, []), table(), null) as HostTurnView;
    expect(view.deckOut).toBe(true);
    expect(view.deckSize).toBe(0);
  });

  it('ends the turn once every card has been played, and not before', () => {
    expect(deckSpent(turn(), table(log.slice(0, -1)))).toBe(false);
    expect(deckSpent(turn(), table(log))).toBe(true);
  });
});

describe('the get-ready', () => {
  it('keeps the card off the describer’s phone and the other team’s until the clock starts', () => {
    const describer = viewOf(turn(), table(), 'ann', 'question') as DescriberView;
    expect(describer).toMatchObject({ role: 'describer', card: null, cardIndex: 0, deckOut: false });
    const watcher = viewOf(turn(), table(), 'bo', 'question') as WatcherView;
    expect(watcher).toMatchObject({ role: 'watcher', card: null, deckOut: false });
    for (const viewer of ['ann', 'bo', 'cy', null]) {
      const wire = JSON.stringify(viewOf(turn(), table(), viewer, 'question'));
      for (const dealt of DECK) expect(wire).not.toContain(dealt.concept);
    }
  });
});

describe('the host chrome', () => {
  it('speaks of turns, ends one with End turn and hides the answered count', () => {
    expect(turnChrome(turn(), table())).toEqual({
      roundWord: 'Turn',
      revealLabel: 'End turn',
      nextLabel: 'Start Blue’s turn',
      hideAnswered: true,
    });
  });

  it('names no team when there are none, and offers the totals after the last turn', () => {
    expect(turnChrome(turn(), table([], NO_TEAMS)).nextLabel).toBe('Start the next turn');
    expect(turnChrome(turn(3), table()).nextLabel).toBe('Show the totals');
  });
});

describe('scoring a turn', () => {
  const log = [tap('ann', 'got', 0), tap('ann', 'pass', 1), tap('bo', 'slip', 2), tap('ann', 'got', 3)];

  it('pays everyone on the describing team the same, per card got', () => {
    const outcome = describeIt.scoreRound(turn(), log, table(log));
    const expected = { correct: true, pointsAwarded: 2 * POINTS_PER_CARD, submitted: null, note: null };
    expect(outcome.perPlayer.get('ann')).toEqual(expected);
    expect(outcome.perPlayer.get('cy')).toEqual(expected);
  });

  it('gives the other team no result, rather than a zero', () => {
    const outcome = describeIt.scoreRound(turn(), log, table(log));
    expect(outcome.perPlayer.has('bo')).toBe(false);
  });

  it('counts a slip as nothing for the team that called it', () => {
    const slips = [tap('bo', 'slip', 0), tap('bo', 'slip', 1)];
    const outcome = describeIt.scoreRound(turn(), slips, table(slips));
    expect(outcome.perPlayer.get('ann')?.pointsAwarded).toBe(0);
    expect(outcome.perPlayer.has('bo')).toBe(false);
  });

  it('pays the whole room with teams off, since the room is one team', () => {
    const got = [tap('ann', 'got', 0)];
    const outcome = describeIt.scoreRound(turn(), got, table(got, NO_TEAMS));
    expect([...outcome.perPlayer.keys()]).toEqual(['ann', 'bo', 'cy']);
  });

  it('lists only the cards got in the reveal, in the order they were got', () => {
    const outcome = describeIt.scoreRound(turn(), log, table(log));
    const detail = outcome.detail as DescribeItReveal;
    expect(detail.got).toEqual(['Walls of Jericho', 'Tower of Babel']);
    const wire = JSON.stringify({ ...outcome, perPlayer: [...outcome.perPlayer] });
    expect(wire).not.toContain('Manna from heaven');
    expect(wire).not.toContain('David and Goliath');
  });

  it('heads the reveal with the team and its count, and names who is up next', () => {
    const outcome = describeIt.scoreRound(turn(), log, table(log));
    expect(outcome.correctLabel).toBe('Red team got 2');
    expect(outcome.aggregates).toEqual([{ label: 'Got', count: 2 }]);
    expect((outcome.detail as DescribeItReveal).next).toEqual({ teamId: 'blue', describer: 'bo' });
  });

  it('names nobody as next after the last turn', () => {
    const outcome = describeIt.scoreRound(turn(3, DECK, 4), [], table());
    expect((outcome.detail as DescribeItReveal).next).toBeNull();
  });

  it('never names who called a slip', () => {
    const seats = [...TEAMS, seat('di', 'blue')];
    const slipped = [tap('di', 'slip', 0)];
    const outcome = describeIt.scoreRound(turn(), slipped, table(slipped, seats));
    const published = JSON.stringify({ label: outcome.correctLabel, detail: outcome.detail });
    expect(published).not.toContain('di');
  });
});

describe('the label on a turn', () => {
  it('names the team, or the room when there are no teams', () => {
    expect(turnLabel('gold', 5)).toBe('Gold team got 5');
    expect(turnLabel(null, 3)).toBe('The room got 3');
  });
});

describe('the turn length', () => {
  it('is a minute unless the host says otherwise', () => {
    expect(turnMsFor({})).toBe(DEFAULT_TURN_MS);
  });

  it('is what the host asked for, in seconds', () => {
    expect(turnMsFor({ [TURN_SECONDS_OPTION]: '45' })).toBe(45_000);
  });

  it('stays inside sensible bounds', () => {
    expect(turnMsFor({ [TURN_SECONDS_OPTION]: '3' })).toBe(MIN_TURN_SECONDS * 1_000);
    expect(turnMsFor({ [TURN_SECONDS_OPTION]: '9000' })).toBe(MAX_TURN_SECONDS * 1_000);
  });

  it('ignores anything that is not a whole number of seconds', () => {
    for (const odd of ['', 'fast', '45.5', '-30', '1e3']) {
      expect(turnMsFor({ [TURN_SECONDS_OPTION]: odd })).toBe(DEFAULT_TURN_MS);
    }
  });
});

describe('building a turn', () => {
  let library: ContentLibrary;
  let previous: ContentLibrary | null;

  function settings(overrides: Partial<RoomSettings> = {}): RoomSettings {
    return {
      gameId: GAME_ID,
      setId: null,
      translation: 'FIX',
      teamsEnabled: true,
      rounds: 6,
      answerWindowMs: 20_000,
      showIndividualScores: false,
      solo: false,
      groupVote: false,
      familiarity: 'any',
      gameOptions: {},
      theme: DEFAULT_THEME,
      ...overrides,
    };
  }

  function context(overrides: Partial<RoomSettings> = {}): RoundBuildContext<DescribeItSecret> {
    let seed = 0.37;
    const random = (): number => {
      seed = (seed * 9301 + 0.49297) % 1;
      return seed;
    };
    return { settings: settings(overrides), random, previous: [], choice: null };
  }

  beforeEach(() => {
    library = ContentLibrary.of(ModuleCatalog.of([]), ContentDatabase.openInMemory(), 'FIX');
    importContent(library.db, {
      promptCards: DECK.map(({ concept, category, forbidden }) => ({ concept, category, forbidden, difficulty: 1 })),
    });
    previous = useContent(library);
  });

  afterEach(() => {
    useContent(previous);
    library.close();
  });

  it('opens with a get-ready and runs the turn for the host’s length', () => {
    const round = describeIt.buildRound(context({ gameOptions: { [TURN_SECONDS_OPTION]: '90' } }), 2);
    expect(round.index).toBe(2);
    expect(round.questionPhaseMs).toBe(GET_READY_MS);
    expect(round.answerWindowMs).toBe(90_000);
  });

  it('deals from the library and remembers how many turns there are', () => {
    const round = describeIt.buildRound(context(), 0);
    expect(round.secret.deck.map((dealt) => dealt.concept).sort()).toEqual(
      DECK.map((dealt) => dealt.concept).sort()
    );
    expect(round.secret.turns).toBe(6);
  });

  it('sends nothing in place of the computed views', () => {
    const round = describeIt.buildRound(context(), 0);
    expect(round.hostView).toBeNull();
    expect(round.playerView).toBeNull();
  });
});

describe('what the module tells the catalog', () => {
  it('is Describe it, played as a log of taps with the standings kept for the end', () => {
    expect(describeIt.id).toBe('describe-it');
    expect(describeIt.name).toBe('Describe it');
    expect(describeIt.answerPolicy).toBe('log');
    expect(describeIt.standingsAtSummaryOnly).toBe(true);
  });

  it('does not offer solo play, because there is nobody to describe to', () => {
    expect(describeIt.supportsSolo).toBe(false);
  });
});
