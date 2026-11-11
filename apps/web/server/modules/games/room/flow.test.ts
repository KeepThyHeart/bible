/**
 * The how-to-play screen, auto-advance from the reveal, and the organizer's
 * control over names and teams, through the real reducer.
 */
import { describe, expect, it } from 'vitest';
import type {
  Actor,
  AddressedIntent,
  Effect,
  Intent,
  PlayerId,
  RoomSettings,
} from '../../../../src/modules/games/shared/protocol.js';
import type { GameModule, Round, RoundOutcome } from '../../../../src/modules/games/shared/games.js';
import { INTRO_MS } from './phases.js';
import { reduce } from './reducer.js';
import { createRoom, type RoomState } from './state.js';

function plainGame(): GameModule {
  return {
    id: 'echo',
    name: 'Echo',
    supportsSolo: true,
    usesBuzz: false,
    buildRound(_context, index): Round<{ answer: string }> {
      return {
        index,
        secret: { answer: `answer-${index}` },
        hostView: { prompt: `prompt-${index}` },
        playerView: { prompt: `prompt-${index}` },
      };
    },
    scoreRound(): RoundOutcome {
      return { perPlayer: new Map(), aggregates: [], correctLabel: 'x', detail: null };
    },
  };
}

const HOST: Actor = { role: 'owner' };
const SYSTEM: Actor = { role: 'system' };
const asPlayer = (playerId: PlayerId): Actor => ({ role: 'player', playerId });
const game = plainGame();

type Command = Extract<Intent, { kind: 'host' }>['command'];

function send(state: RoomState, actor: Actor, intent: Intent, at: number) {
  const addressed: AddressedIntent = { actor, intent, receivedAt: at };
  return reduce(state, addressed, game);
}
const host = (state: RoomState, command: Command, at: number) =>
  send(state, HOST, { kind: 'host', command }, at);
const fire = (state: RoomState, round: number, tag: string, at: number) =>
  send(state, SYSTEM, { kind: 'timer', round, tag }, at);
const join = (state: RoomState, id: PlayerId, at: number, name = id) =>
  send(state, asPlayer(id), { kind: 'join', name }, at).state;

/** A refused intent changes nothing but the activity stamp every intent leaves. */
function expectUnchanged(actual: RoomState, before: RoomState): void {
  expect(actual).toEqual({ ...before, lastActivity: actual.lastActivity });
}

function lobby(settings: Partial<RoomSettings> = {}, ids: PlayerId[] = ['alice', 'bob']): RoomState {
  let state = createRoom({ code: 'ABCD', now: 1_000, seed: 7, settings: { rounds: 3, ...settings } });
  ids.forEach((id, i) => {
    state = join(state, id, 1_100 + i);
  });
  return state;
}

/** Past the how-to-play screen and into round 0, answering. */
function inRoundZero(settings: Partial<RoomSettings> = {}): RoomState {
  const started = host(lobby(settings), { cmd: 'start' }, 2_000).state;
  return fire(started, -1, 'introEnd', 2_000 + INTRO_MS).state;
}

/** Round 0 revealed at 5_000. */
function revealed(settings: Partial<RoomSettings> = {}): { state: RoomState; effects: Effect[] } {
  return host(inRoundZero(settings), { cmd: 'revealNow' }, 5_000);
}

describe('the how-to-play screen', () => {
  it('follows a start from the lobby, ahead of round 0', () => {
    const result = host(lobby(), { cmd: 'start' }, 2_000);
    expect(result.state.phase).toBe('intro');
    expect(result.state.roundIndex).toBe(-1);
    expect(result.state.rounds).toHaveLength(3);
    expect(result.state.phaseEndsAt).toBe(2_000 + INTRO_MS);
    expect(result.effects).toContainEqual({
      type: 'timer',
      at: 2_000 + INTRO_MS,
      round: -1,
      tag: 'introEnd',
    });
  });

  it('opens round 0 when its timer fires', () => {
    const intro = host(lobby(), { cmd: 'start' }, 2_000).state;
    const result = fire(intro, -1, 'introEnd', 2_000 + INTRO_MS);
    expect(result.state.phase).toBe('answering');
    expect(result.state.roundIndex).toBe(0);
  });

  it('opens round 0 early when the controller moves on', () => {
    const intro = host(lobby(), { cmd: 'start' }, 2_000).state;
    const result = host(intro, { cmd: 'nextRound' }, 3_000);
    expect(result.state.phase).toBe('answering');
    expect(result.state.roundIndex).toBe(0);
  });

  it('ignores its own timer once the controller has already moved on', () => {
    const intro = host(lobby(), { cmd: 'start' }, 2_000).state;
    const early = host(intro, { cmd: 'nextRound' }, 3_000).state;
    const late = fire(early, -1, 'introEnd', 2_000 + INTRO_MS);
    expectUnchanged(late.state, early);
  });

  it('ignores a nextRound from someone who is not the controller', () => {
    const intro = host(lobby(), { cmd: 'start' }, 2_000).state;
    const result = send(intro, asPlayer('alice'), { kind: 'host', command: { cmd: 'nextRound' } }, 3_000);
    expect(result.state.phase).toBe('intro');
  });

  it('does nothing on skip or revealNow', () => {
    const intro = host(lobby(), { cmd: 'start' }, 2_000).state;
    expect(host(intro, { cmd: 'skip' }, 3_000).state.phase).toBe('intro');
    expect(host(intro, { cmd: 'revealNow' }, 3_000).state.phase).toBe('intro');
  });

  it('cannot be paused', () => {
    const intro = host(lobby(), { cmd: 'start' }, 2_000).state;
    expect(host(intro, { cmd: 'pause' }, 3_000).state.paused).toBe(false);
  });

  it('lets a player join while it shows', () => {
    const intro = host(lobby(), { cmd: 'start' }, 2_000).state;
    const joined = join(intro, 'cleo', 3_000);
    expect(joined.players.map((player) => player.id)).toEqual(['alice', 'bob', 'cleo']);
    expect(joined.phase).toBe('intro');
  });

  it('is skipped for a solo player', () => {
    const result = host(lobby({ solo: true }, ['alice']), { cmd: 'start' }, 2_000);
    expect(result.state.phase).toBe('answering');
    expect(result.state.roundIndex).toBe(0);
  });

  it('is left behind by a new game, with its timer cancelled', () => {
    const intro = host(lobby(), { cmd: 'start' }, 2_000).state;
    const result = host(intro, { cmd: 'newGame' }, 3_000);
    expect(result.state.phase).toBe('lobby');
    expect(result.effects).toContainEqual({ type: 'cancelTimers', round: -1 });
  });
});

describe('auto-advance from the reveal', () => {
  it('waits for the organizer when it is off', () => {
    const { state, effects } = revealed();
    expect(state.phase).toBe('reveal');
    expect(state.phaseEndsAt).toBeNull();
    expect(effects.some((effect) => effect.type === 'timer')).toBe(false);
  });

  it('arms a timer on reaching the reveal when it is on', () => {
    const { state, effects } = revealed({ autoAdvanceMs: 6_000 });
    expect(state.phaseEndsAt).toBe(11_000);
    expect(effects).toContainEqual({ type: 'timer', at: 11_000, round: 0, tag: 'autoAdvance' });
  });

  it('opens the next round when its timer fires', () => {
    const { state } = revealed({ autoAdvanceMs: 6_000 });
    const result = fire(state, 0, 'autoAdvance', 11_000);
    expect(result.state.phase).toBe('answering');
    expect(result.state.roundIndex).toBe(1);
  });

  it('keeps the countdown through a pause and gives back the time on resume', () => {
    const { state } = revealed({ autoAdvanceMs: 6_000 });
    const paused = host(state, { cmd: 'pause' }, 7_000);
    expect(paused.state.paused).toBe(true);
    expect(paused.effects).toContainEqual({ type: 'cancelTimers', round: 0 });
    expect(fire(paused.state, 0, 'autoAdvance', 11_000).state.roundIndex).toBe(0);

    const resumed = host(paused.state, { cmd: 'resume' }, 20_000);
    expect(resumed.state.phaseEndsAt).toBe(24_000);
    expect(resumed.effects).toContainEqual({ type: 'timer', at: 24_000, round: 0, tag: 'autoAdvance' });
    expect(fire(resumed.state, 0, 'autoAdvance', 24_000).state.roundIndex).toBe(1);
  });

  it('cannot pause a reveal that is waiting for the organizer', () => {
    const { state } = revealed();
    expect(host(state, { cmd: 'pause' }, 6_000).state.paused).toBe(false);
  });

  it('is made harmless by the organizer moving on first', () => {
    const { state } = revealed({ autoAdvanceMs: 6_000 });
    const manual = host(state, { cmd: 'nextRound' }, 8_000).state;
    expect(manual.roundIndex).toBe(1);
    const stale = fire(manual, 0, 'autoAdvance', 11_000);
    expectUnchanged(stale.state, manual);
  });

  it('is made harmless by a skip', () => {
    const { state } = revealed({ autoAdvanceMs: 6_000 });
    const skipped = host(state, { cmd: 'skip' }, 8_000).state;
    expectUnchanged(fire(skipped, 0, 'autoAdvance', 11_000).state, skipped);
  });

  it('is made harmless by a tile choice', () => {
    const choosing: GameModule = { ...plainGame(), openChoices: () => ['a'] };
    const started = reduce(
      lobby({ autoAdvanceMs: 6_000 }),
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'start' } }, receivedAt: 2_000 },
      choosing
    ).state;
    const asChoosing = (state: RoomState, intent: Intent, actor: Actor, at: number) =>
      reduce(state, { actor, intent, receivedAt: at }, choosing);
    const live = asChoosing(started, { kind: 'host', command: { cmd: 'nextRound' } }, HOST, 2_100).state;
    const shown = asChoosing(live, { kind: 'host', command: { cmd: 'revealNow' } }, HOST, 5_000).state;
    const chosen = asChoosing(shown, { kind: 'host', command: { cmd: 'choose', choice: 'a' } }, HOST, 6_000).state;
    expect(chosen.roundIndex).toBe(1);
    const stale = asChoosing(chosen, { kind: 'timer', round: 0, tag: 'autoAdvance' }, SYSTEM, 11_000);
    expectUnchanged(stale.state, chosen);
  });

  it('does not run on after the last round', () => {
    let state = inRoundZero({ autoAdvanceMs: 6_000, rounds: 2 });
    state = host(state, { cmd: 'revealNow' }, 5_000).state;
    state = fire(state, 0, 'autoAdvance', 11_000).state;
    expect(state.roundIndex).toBe(1);
    const last = host(state, { cmd: 'revealNow' }, 14_000);
    expect(last.state.phase).toBe('reveal');
    expect(last.state.phaseEndsAt).toBeNull();
    expect(last.effects.some((effect) => effect.type === 'timer')).toBe(false);
    expect(host(last.state, { cmd: 'pause' }, 15_000).state.paused).toBe(false);
  });

  it('is armed by switching it on during a reveal, and disarmed by switching it off', () => {
    const { state } = revealed();
    const on = host(state, { cmd: 'setSettings', settings: { autoAdvanceMs: 8_000 } }, 6_000);
    expect(on.state.phaseEndsAt).toBe(14_000);
    expect(on.effects).toContainEqual({ type: 'timer', at: 14_000, round: 0, tag: 'autoAdvance' });

    const off = host(on.state, { cmd: 'setSettings', settings: { autoAdvanceMs: null } }, 7_000);
    expect(off.state.phaseEndsAt).toBeNull();
    expect(off.effects).toContainEqual({ type: 'cancelTimers', round: 0 });
    expectUnchanged(fire(off.state, 0, 'autoAdvance', 14_000).state, off.state);
  });
});

describe('the organizer moving players between teams', () => {
  const teamed = (teamCount: 2 | 3 | 4 = 3) =>
    lobby({ teamsEnabled: true, teamCount }, ['alice', 'bob', 'cleo', 'dan', 'eve']);
  const teamOf = (state: RoomState, id: PlayerId) => state.players.find((p) => p.id === id)?.teamId;

  it('moves a player to a team in play, or off teams', () => {
    const moved = host(teamed(), { cmd: 'moveToTeam', playerId: 'alice', teamId: 'green' }, 2_000).state;
    expect(teamOf(moved, 'alice')).toBe('green');
    const off = host(moved, { cmd: 'moveToTeam', playerId: 'alice', teamId: null }, 2_100).state;
    expect(teamOf(off, 'alice')).toBeNull();
  });

  it('refuses a team beyond the count, an unknown player, and teams being off', () => {
    const state = teamed(2);
    expectUnchanged(host(state, { cmd: 'moveToTeam', playerId: 'alice', teamId: 'green' }, 2_000).state, state);
    expectUnchanged(host(state, { cmd: 'moveToTeam', playerId: 'nobody', teamId: 'red' }, 2_000).state, state);
    const plain = lobby();
    expectUnchanged(host(plain, { cmd: 'moveToTeam', playerId: 'alice', teamId: 'red' }, 2_000).state, plain);
  });

  it('is for the controller only', () => {
    const state = teamed();
    const result = send(
      state,
      asPlayer('bob'),
      { kind: 'host', command: { cmd: 'moveToTeam', playerId: 'alice', teamId: 'blue' } },
      2_000
    );
    expectUnchanged(result.state, state);
  });

  it('leaves the seats of a round in progress as they were dealt', () => {
    const started = host(teamed(), { cmd: 'start' }, 2_000).state;
    const live = host(started, { cmd: 'nextRound' }, 2_100).state;
    const seatsBefore = live.roundSeats;
    expect(seatsBefore.find((seat) => seat.playerId === 'alice')?.teamId).toBe('red');

    const moved = host(live, { cmd: 'moveToTeam', playerId: 'alice', teamId: 'blue' }, 3_000).state;
    expect(teamOf(moved, 'alice')).toBe('blue');
    expect(moved.roundSeats).toEqual(seatsBefore);

    const shuffled = host(moved, { cmd: 'shuffleTeams' }, 3_100).state;
    expect(shuffled.roundSeats).toEqual(seatsBefore);

    const next = host(shuffled, { cmd: 'nextRound' }, 4_000).state;
    expect(next.roundSeats.map((seat) => seat.teamId)).toEqual(shuffled.players.map((p) => p.teamId));
  });
});

describe('fewer teams', () => {
  it('moves anyone on a team no longer in play onto the smallest one left', () => {
    let state = lobby({ teamsEnabled: true, teamCount: 4 }, ['alice', 'bob', 'cleo', 'dan', 'eve']);
    const before = state.players.map((p) => p.teamId);
    expect(new Set(before).size).toBe(4);
    state = host(state, { cmd: 'setSettings', settings: { teamCount: 2 } }, 2_000).state;
    const teams = state.players.map((p) => p.teamId);
    expect(teams.every((teamId) => teamId === 'red' || teamId === 'blue')).toBe(true);
    const reds = teams.filter((teamId) => teamId === 'red').length;
    expect(Math.abs(reds - (teams.length - reds))).toBeLessThanOrEqual(1);
    // Nobody already on a team still in play is moved.
    state.players.forEach((p, i) => {
      if (before[i] === 'red' || before[i] === 'blue') expect(p.teamId).toBe(before[i]);
    });
  });
});

describe('a player choosing their own team', () => {
  it('is held to the teams in play', () => {
    const state = lobby({ teamsEnabled: true, teamCount: 2 });
    const pick = (teamId: 'red' | 'blue' | 'green' | 'gold') =>
      send(state, asPlayer('alice'), { kind: 'setTeam', teamId }, 2_000).state;
    expect(pick('blue').players[0]?.teamId).toBe('blue');
    expectUnchanged(pick('green'), state);
    expectUnchanged(pick('gold'), state);
  });

  it('cannot join a team beyond the count, and lands on the emptiest team in play instead', () => {
    let state = createRoom({
      code: 'ABCD',
      now: 1_000,
      seed: 7,
      settings: { teamsEnabled: true, teamCount: 2 },
    });
    state = send(state, asPlayer('a'), { kind: 'join', name: 'a', teamId: 'gold' }, 1_100).state;
    state = send(state, asPlayer('b'), { kind: 'join', name: 'b' }, 1_101).state;
    state = send(state, asPlayer('c'), { kind: 'join', name: 'c' }, 1_102).state;
    expect(state.players.map((player) => player.teamId)).toEqual(['red', 'blue', 'red']);
  });
});

describe('shuffling into teams', () => {
  const ids: PlayerId[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const counts = (state: RoomState) => {
    const tally = new Map<string | null, number>();
    for (const player of state.players) tally.set(player.teamId, (tally.get(player.teamId) ?? 0) + 1);
    return tally;
  };

  it('balances everyone over the teams in play', () => {
    const state = lobby({ teamsEnabled: true, teamCount: 3 }, ids);
    const result = host(state, { cmd: 'shuffleTeams' }, 2_000).state;
    const tally = counts(result);
    expect([...tally.keys()].sort()).toEqual(['blue', 'green', 'red']);
    expect([...tally.values()].sort()).toEqual([2, 2, 3]);
  });

  it('is repeatable from the same seed and advances the seed', () => {
    const state = lobby({ teamsEnabled: true, teamCount: 3 }, ids);
    const one = host(state, { cmd: 'shuffleTeams' }, 2_000).state;
    const two = host(state, { cmd: 'shuffleTeams' }, 2_000).state;
    expect(one.players).toEqual(two.players);
    expect(one.rngSeed).not.toBe(state.rngSeed);
    expect(host(one, { cmd: 'shuffleTeams' }, 2_100).state.rngSeed).not.toBe(one.rngSeed);
  });

  it('does nothing with teams off', () => {
    const state = lobby({}, ids);
    expectUnchanged(host(state, { cmd: 'shuffleTeams' }, 2_000).state, state);
  });
});

describe('renaming a player', () => {
  const nameOf = (state: RoomState, id: PlayerId) => state.players.find((p) => p.id === id)?.name;

  it('trims and cuts the name the way a join does', () => {
    const state = lobby();
    const renamed = host(state, { cmd: 'rename', playerId: 'alice', name: `  ${'x'.repeat(40)}  ` }, 2_000).state;
    expect(nameOf(renamed, 'alice')).toBe('x'.repeat(24));
  });

  it('rejects an empty name and an unknown player', () => {
    const state = lobby();
    expectUnchanged(host(state, { cmd: 'rename', playerId: 'alice', name: '   ' }, 2_000).state, state);
    expectUnchanged(host(state, { cmd: 'rename', playerId: 'nobody', name: 'Zed' }, 2_000).state, state);
  });

  it('keeps names distinct, and lets a player keep their own', () => {
    const state = lobby();
    const clash = host(state, { cmd: 'rename', playerId: 'alice', name: 'BOB' }, 2_000).state;
    expect(nameOf(clash, 'alice')).toBe('BOB (2)');
    const same = host(state, { cmd: 'rename', playerId: 'alice', name: 'alice' }, 2_000);
    expectUnchanged(same.state, state);
  });

  it('is for the controller only', () => {
    const state = lobby();
    const result = send(
      state,
      asPlayer('bob'),
      { kind: 'host', command: { cmd: 'rename', playerId: 'alice', name: 'Zed' } },
      2_000
    );
    expectUnchanged(result.state, state);
  });
});

describe('a game with no set length', () => {
  it('builds the next batch when it reaches the end of the last, and carries on', () => {
    let state = inRoundZero({ openEnded: true, rounds: 2 });
    expect(state.rounds).toHaveLength(2);
    state = host(state, { cmd: 'nextRound' }, 3_000).state;
    expect(state.roundIndex).toBe(1);
    state = host(state, { cmd: 'nextRound' }, 4_000).state;
    expect(state.phase).not.toBe('summary');
    expect(state.roundIndex).toBe(2);
    expect(state.rounds).toHaveLength(4);
  });

  it('draws the same questions from the same seed, however the evening went', () => {
    const run = () => {
      let state = inRoundZero({ openEnded: true, rounds: 2 });
      for (let i = 0; i < 4; i += 1) state = host(state, { cmd: 'nextRound' }, 3_000 + i).state;
      return state.rounds;
    };
    expect(run()).toEqual(run());
  });

  it('moves on by itself from what would have been the last round', () => {
    let state = inRoundZero({ openEnded: true, rounds: 1, autoAdvanceMs: 8_000 });
    state = host(state, { cmd: 'revealNow' }, 5_000).state;
    expect(state.phaseEndsAt).toBe(13_000);
  });
});

describe('finishing, and carrying on from the results', () => {
  it('shows the results now and keeps the room and everyone in it', () => {
    const live = inRoundZero();
    const finished = host(live, { cmd: 'finish' }, 3_000).state;
    expect(finished.phase).toBe('summary');
    expect(finished.closed).toBe(false);
    expect(finished.players).toEqual(live.players);
  });

  it('does nothing in the lobby or once the results are up', () => {
    const waiting = lobby();
    expectUnchanged(host(waiting, { cmd: 'finish' }, 2_000).state, waiting);
    const done = host(inRoundZero(), { cmd: 'finish' }, 3_000).state;
    expectUnchanged(host(done, { cmd: 'finish' }, 3_100).state, done);
  });

  it('is for the controller only', () => {
    const live = inRoundZero();
    expectUnchanged(send(live, asPlayer('bob'), { kind: 'host', command: { cmd: 'finish' } }, 3_000).state, live);
  });

  it('carries on after finishing early, at the round after the one in play, with the scores as they were', () => {
    const started = inRoundZero();
    const live = { ...started, players: started.players.map((p) => ({ ...p, score: 300 })) };
    const finished = host(live, { cmd: 'finish' }, 3_000).state;
    const resumed = host(finished, { cmd: 'continueGame' }, 4_000).state;
    expect(resumed.roundIndex).toBe(1);
    expect(resumed.phase).not.toBe('summary');
    expect(resumed.players.map((p) => p.score)).toEqual([300, 300]);
    expect(resumed.rounds).toHaveLength(3);
  });

  it('carries on after a game ran to its end with another batch of the same length', () => {
    let state = inRoundZero({ rounds: 2 });
    state = host(state, { cmd: 'nextRound' }, 3_000).state;
    state = host(state, { cmd: 'nextRound' }, 4_000).state;
    expect(state.phase).toBe('summary');
    const resumed = host(state, { cmd: 'continueGame' }, 5_000).state;
    expect(resumed.roundIndex).toBe(2);
    expect(resumed.rounds).toHaveLength(4);
  });

  it('only carries on from the results', () => {
    const live = inRoundZero();
    expectUnchanged(host(live, { cmd: 'continueGame' }, 3_000).state, live);
  });
});
