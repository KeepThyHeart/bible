/**
 * Describe It played through the room as it stands.
 *
 * The module only deals, cuts views and scores; the room decides when taps are
 * open, keeps the log, seats the table and projects every snapshot. So these
 * drive the real reducer and the real projection with this module plugged in,
 * and read what the room actually sends: the big screen through a whole turn,
 * each phone, the reveal, and the standings.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Actor, Intent, PlayerId, RoomSettings, TeamId } from '../../../../../src/modules/games/shared/protocol.js';
import {
  ContentDatabase,
  ContentLibrary,
  ModuleCatalog,
  importContent,
  useContent,
} from '../../content/index.js';
import { projectForPlayer, projectForScreen, projectReveal } from '../../room/projection.js';
import { reduce } from '../../room/reducer.js';
import { createRoom } from '../../room/state.js';
import type { RoomState } from '../../room/state.js';
import { GET_READY_MS, POINTS_PER_CARD, TURN_SECONDS_OPTION, describeIt } from './index.js';
import type { DescribeItReveal, DescriberView, HostTurnView } from './index.js';

const T0 = 1_700_000_000_000;
const HOST: Actor = { role: 'owner' };
const SYSTEM: Actor = { role: 'system' };

const CARDS = [
  { concept: 'Walls of Jericho', category: 'event', forbidden: ['trumpets', 'shout', 'Joshua', 'march'] },
  { concept: 'Manna from heaven', category: 'object', forbidden: ['bread', 'desert', 'quail', 'morning'] },
  { concept: 'David and Goliath', category: 'event', forbidden: ['sling', 'giant', 'stone', 'Philistine'] },
  { concept: 'Tower of Babel', category: 'place', forbidden: ['languages', 'bricks', 'scattered', 'confusion'] },
  { concept: 'Burning bush', category: 'event', forbidden: ['Moses', 'flames', 'sandals', 'holy'] },
  { concept: 'Jonah and the great fish', category: 'event', forbidden: ['whale', 'belly', 'Nineveh', 'swallowed'] },
];

/** Every string on a card, none of which may reach the wall unless it was got. */
function cardText(concept: string): string[] {
  const found = CARDS.find((candidate) => candidate.concept === concept);
  return found === undefined ? [] : [found.concept, ...found.forbidden];
}

let library: ContentLibrary;
let previous: ContentLibrary | null;
let state: RoomState;

function player(playerId: PlayerId): Actor {
  return { role: 'player', playerId };
}

function step(actor: Actor, intent: Intent, at: number): void {
  state = reduce(state, { actor, intent, receivedAt: at }, describeIt).state;
}

function tap(playerId: PlayerId, action: 'got' | 'pass' | 'slip', card: number, at: number): void {
  step(player(playerId), { kind: 'answer', round: state.roundIndex, value: { type: 'card', action, card } }, at);
}

function host(command: Extract<Intent, { kind: 'host' }>['command'], at: number): void {
  step(HOST, { kind: 'host', command }, at);
}

function timer(tag: string, at: number): void {
  step(SYSTEM, { kind: 'timer', round: state.roundIndex, tag }, at);
}

function describerCard(playerId: PlayerId): DescriberView {
  return projectForPlayer(state, playerId, describeIt).view as DescriberView;
}

function hostView(): HostTurnView {
  return projectForScreen(state, describeIt, true).view as HostTurnView;
}

function scoreOf(playerId: PlayerId): number {
  return state.players.find((candidate) => candidate.id === playerId)?.score ?? 0;
}

/** The describer's own phone, read for who is holding the card this turn. */
function describerNow(ids: readonly PlayerId[]): PlayerId | undefined {
  return ids.find((id) => (projectForPlayer(state, id, describeIt).view as { role: string }).role === 'describer');
}

function open(settings: Partial<RoomSettings>, seats: readonly [PlayerId, TeamId | undefined][]): void {
  state = createRoom({
    code: 'QK7P',
    now: T0 - 10_000,
    seed: 5,
    settings: { gameId: 'describe-it', familiarity: 'any', rounds: 6, ...settings },
  });
  seats.forEach(([id, teamId], index) => {
    const intent: Intent = teamId === undefined ? { kind: 'join', name: id } : { kind: 'join', name: id, teamId };
    step(player(id), intent, T0 - 5_000 + index);
  });
  host({ cmd: 'start' }, T0);
}

/** Red: anna, caleb, eve. Blue: dinah. Uneven on purpose. */
const TEAMS: [PlayerId, TeamId][] = [
  ['anna', 'red'],
  ['dinah', 'blue'],
  ['caleb', 'red'],
  ['eve', 'red'],
];

beforeEach(() => {
  library = ContentLibrary.of(ModuleCatalog.of([]), ContentDatabase.openInMemory(), 'FIX');
  importContent(library.db, { promptCards: CARDS.map((card) => ({ ...card, difficulty: 1 })) });
  previous = useContent(library);
});

afterEach(() => {
  useContent(previous);
  library.close();
});

describe('a turn', () => {
  beforeEach(() => {
    open({ teamsEnabled: true, gameOptions: { [TURN_SECONDS_OPTION]: '45' } }, TEAMS);
  });

  it('opens with a get-ready, then runs for the length the host set', () => {
    expect(state.phase).toBe('question');
    expect(state.phaseEndsAt).toBe(T0 + GET_READY_MS);
    timer('questionEnd', T0 + GET_READY_MS);
    expect(state.phase).toBe('answering');
    expect(projectForScreen(state, describeIt, true).phaseDurationMs).toBe(45_000);
  });

  it('takes no taps during the get-ready', () => {
    tap('anna', 'got', 0, T0 + 1_000);
    expect(state.answers).toEqual([]);
  });

  it('never puts the card in play or a passed card on the big screen, from start to reveal', () => {
    const seen: string[] = [];
    const got = new Set<string>();
    const check = (): void => {
      const wire = JSON.stringify(projectForScreen(state, describeIt, true));
      for (const concept of seen) {
        if (got.has(concept)) continue;
        for (const text of cardText(concept)) expect(wire).not.toContain(text);
      }
    };
    const play = (playerId: PlayerId, action: 'got' | 'pass' | 'slip', at: number): void => {
      const card = describerCard('anna');
      if (card.card !== null) seen.push(card.card.concept);
      check();
      tap(playerId, action, card.cardIndex, at);
      if (action === 'got' && card.card !== null) got.add(card.card.concept);
      check();
    };

    timer('questionEnd', T0 + GET_READY_MS);
    play('anna', 'got', T0 + 6_000);
    play('anna', 'pass', T0 + 7_000);
    play('dinah', 'slip', T0 + 8_000);
    play('anna', 'got', T0 + 9_000);
    seen.push(describerCard('anna').card?.concept ?? '');
    check();
    timer('answerEnd', state.phaseEndsAt ?? 0);

    expect(state.phase).toBe('reveal');
    check();
    expect(hostView().got).toEqual([...got]);
    const reveal = JSON.stringify(projectReveal(state));
    for (const concept of seen.filter((candidate) => !got.has(candidate))) {
      expect(reveal).not.toContain(concept);
    }
    // Nor who called the slip, on the wall or in the reveal.
    expect(JSON.stringify(hostView())).not.toContain('dinah');
    expect((projectReveal(state)?.detail as DescribeItReveal).got).toEqual([...got]);
  });

  it("gives the describer's teammates no card at any point", () => {
    timer('questionEnd', T0 + GET_READY_MS);
    tap('anna', 'pass', 0, T0 + 6_000);
    for (const teammate of ['caleb', 'eve']) {
      const wire = JSON.stringify(projectForPlayer(state, teammate, describeIt).view);
      for (const { concept } of CARDS) expect(wire).not.toContain(concept);
    }
    expect(describerCard('anna').card).not.toBeNull();
  });

  it('moves on one card for a retried tap and for two slips on the same card', () => {
    open({ teamsEnabled: true }, [...TEAMS, ['boaz', 'blue']]);
    timer('questionEnd', T0 + GET_READY_MS);
    tap('anna', 'got', 0, T0 + 6_000);
    tap('anna', 'got', 0, T0 + 6_001);
    tap('dinah', 'slip', 1, T0 + 7_000);
    tap('boaz', 'slip', 1, T0 + 7_001);

    expect(state.answers.map((entry) => [entry.playerId, entry.value])).toEqual([
      ['anna', { type: 'card', action: 'got', card: 0 }],
      ['dinah', { type: 'card', action: 'slip', card: 1 }],
    ]);
    expect(describerCard('anna').cardIndex).toBe(2);
  });

  it('pays only the describing team, the same to each of them', () => {
    timer('questionEnd', T0 + GET_READY_MS);
    tap('anna', 'got', 0, T0 + 6_000);
    tap('anna', 'got', 1, T0 + 7_000);
    tap('dinah', 'slip', 2, T0 + 8_000);
    tap('anna', 'got', 3, T0 + 9_000);
    timer('answerEnd', state.phaseEndsAt ?? 0);

    expect(['anna', 'caleb', 'eve'].map(scoreOf)).toEqual(Array(3).fill(3 * POINTS_PER_CARD));
    expect(scoreOf('dinah')).toBe(0);
    expect(projectReveal(state)?.correctLabel).toBe('Red team got 3');
  });

  it('keeps the standings off the big screen until the game is over', () => {
    timer('questionEnd', T0 + GET_READY_MS);
    tap('anna', 'got', 0, T0 + 6_000);
    host({ cmd: 'revealNow' }, T0 + 7_000);
    expect(projectForScreen(state, describeIt, true).standings).toEqual([]);
    expect(projectForScreen(state, describeIt, true).teamStandings).toEqual([]);
    host({ cmd: 'end' }, T0 + 8_000);
    expect(projectForScreen(state, describeIt, true).teamStandings.length).toBeGreaterThan(0);
  });

  it('ends the turn on the last card of the deck, says so, and takes no more taps', () => {
    timer('questionEnd', T0 + GET_READY_MS);
    CARDS.forEach((_, index) => tap('anna', 'pass', index, T0 + 6_000 + index));
    expect(state.phase).toBe('reveal');
    tap('anna', 'got', CARDS.length, T0 + 7_000);

    expect(state.answers).toHaveLength(CARDS.length);
    expect(describerCard('anna')).toMatchObject({ card: null, deckOut: true });
    expect(hostView().deckOut).toBe(true);
    expect((projectReveal(state)?.detail as DescribeItReveal).deckOut).toBe(true);
  });

  it('keeps the card off every phone during the get-ready, and deals it when the clock starts', () => {
    for (const playerId of ['anna', 'dinah']) {
      const wire = JSON.stringify(projectForPlayer(state, playerId, describeIt).view);
      for (const { concept } of CARDS) expect(wire).not.toContain(concept);
    }
    timer('questionEnd', T0 + GET_READY_MS);
    expect(describerCard('anna').card).not.toBeNull();
  });

  it('words the host chrome as turns, with no answered count', () => {
    expect(projectForScreen(state, describeIt, true).chrome).toEqual({
      roundWord: 'Turn',
      revealLabel: 'End turn',
      nextLabel: 'Start Blue’s turn',
      hideAnswered: true,
    });
  });
});

describe('the rotation through the room', () => {
  function nextTurn(at: number): void {
    host({ cmd: 'revealNow' }, at);
    host({ cmd: 'nextRound' }, at + 100);
  }

  it('alternates uneven teams and works through the bigger one in join order', () => {
    open({ teamsEnabled: true }, TEAMS);
    const ids = TEAMS.map(([id]) => id);
    const order: (PlayerId | undefined)[] = [describerNow(ids)];
    for (let turn = 1; turn < 6; turn += 1) {
      nextTurn(T0 + turn * 1_000);
      order.push(describerNow(ids));
    }
    expect(order).toEqual(['anna', 'dinah', 'caleb', 'dinah', 'eve', 'dinah']);
  });

  it('names the next describer in the reveal', () => {
    open({ teamsEnabled: true }, TEAMS);
    host({ cmd: 'revealNow' }, T0 + 1_000);
    expect((projectReveal(state)?.detail as DescribeItReveal).next).toEqual({
      teamId: 'blue',
      describer: 'dinah',
    });
  });

  it('goes round everybody with teams off, and nobody can call a slip', () => {
    open({ teamsEnabled: false }, [
      ['anna', 'red'],
      ['dinah', 'blue'],
      ['caleb', undefined],
    ]);
    const ids = ['anna', 'dinah', 'caleb'];
    timer('questionEnd', T0 + GET_READY_MS);
    tap('dinah', 'slip', 0, T0 + 6_000);
    tap('caleb', 'slip', 0, T0 + 6_100);
    expect(state.answers).toEqual([]);
    expect(projectForPlayer(state, 'dinah', describeIt).view).toMatchObject({ role: 'guesser' });

    const order: (PlayerId | undefined)[] = [describerNow(ids)];
    for (let turn = 1; turn < 4; turn += 1) {
      nextTurn(T0 + 10_000 + turn * 1_000);
      order.push(describerNow(ids));
    }
    expect(order).toEqual(['anna', 'dinah', 'caleb', 'anna']);
  });
});
