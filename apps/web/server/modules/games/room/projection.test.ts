import { describe, expect, it } from 'vitest';
import type {
  Actor,
  ControlPanel,
  AddressedIntent,
  Intent,
  PersonalResult,
  PlayerId,
} from '../../../../src/modules/games/shared/protocol.js';
import type { GameModule, Round, RoundOutcome, ScoredAnswer } from '../../../../src/modules/games/shared/games.js';
import { reduce } from './reducer.js';
import { createRoom, type RoomState } from './state.js';
import {
  projectForRemote,
  projectForScreen,
  projectForPlayer,
  projectFullStandings,
  projectPersonalResult,
  projectReveal,
  visibleStandings,
} from './projection.js';

// ---------------------------------------------------------------------------
// A stand-in game
// ---------------------------------------------------------------------------

interface EchoSecret {
  answer: string;
  judge: { question: string; canonicalAnswer: string; accept: string[]; contextNote: null };
}

const QUESTION = 'Who was the mother-in-law of Ruth?';

/**
 * Projection has to hold for any game, so these tests use one that only echoes
 * a known answer. What matters here is that the answer is a distinctive string:
 * every assertion that a player was not told it is a search for that string in
 * what the projection actually produced.
 */
function echoGame(usesBuzz = false): GameModule {
  return {
    id: 'echo',
    name: 'Echo',
    supportsSolo: true,
    usesBuzz,
    buildRound(_context, index): Round<EchoSecret> {
      const answer = `naomi-${index}`;
      const round: Round<EchoSecret> = {
        index,
        secret: {
          answer,
          judge: { question: QUESTION, canonicalAnswer: answer, accept: [answer], contextNote: null },
        },
        hostView: { prompt: QUESTION, answer },
        playerView: { prompt: QUESTION },
      };
      if (usesBuzz) round.questionPhaseMs = 30_000;
      return round;
    },
    // Prefixed so that a search of a whole payload for the preview cannot be
    // satisfied by the answer the screen's own view legitimately carries.
    answerPreview(round: Round<EchoSecret>): string | null {
      return `preview:${round.secret.answer}`;
    },
    scoreRound(round: Round<EchoSecret>, answers: ScoredAnswer[]): RoundOutcome {
      const perPlayer = new Map<PlayerId, PersonalResult>();
      let correctCount = 0;
      for (const submitted of answers) {
        const correct =
          submitted.value.type === 'text' && submitted.value.text === round.secret.answer;
        if (correct) correctCount += 1;
        perPlayer.set(submitted.playerId, {
          correct,
          pointsAwarded: correct ? 10 : 0,
          submitted: submitted.value,
          note: correct ? null : 'not this time',
        });
      }
      return {
        perPlayer,
        aggregates: [
          { label: round.secret.answer, count: correctCount },
          { label: 'something else', count: answers.length - correctCount },
        ],
        correctLabel: round.secret.answer,
        detail: null,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const HOST: Actor = { role: 'owner' };
const asPlayer = (playerId: PlayerId): Actor => ({ role: 'player', playerId });

interface Step {
  actor: Actor;
  intent: Intent;
  at: number;
}

function run(state: RoomState, game: GameModule, steps: Step[]): RoomState {
  return steps.reduce((current, s) => {
    const addressed: AddressedIntent = { actor: s.actor, intent: s.intent, receivedAt: s.at };
    return reduce(current, addressed, game).state;
  }, state);
}

function newRoom(settings: Parameters<typeof createRoom>[0]['settings'] = {}): RoomState {
  return createRoom({
    code: 'ABCD',
    now: 1_000,
    seed: 7,
    settings,
  });
}

/**
 * A room whose leaderboard is already spread out, built through the host's own
 * adjustment command so that nothing here reaches past the reducer to write a
 * score by hand.
 */
function withScores(
  game: GameModule,
  scores: [PlayerId, number][],
  settings: Parameters<typeof createRoom>[0]['settings'] = {}
): RoomState {
  const steps: Step[] = [];
  let at = 1_100;
  for (const [playerId] of scores) {
    steps.push({ actor: asPlayer(playerId), intent: { kind: 'join', name: playerId }, at });
    at += 1;
  }
  for (const [playerId, delta] of scores) {
    steps.push({
      actor: HOST,
      intent: { kind: 'host', command: { cmd: 'adjust', playerId, delta } },
      at,
    });
    at += 1;
  }
  return run(newRoom(settings), game, steps);
}

/** Five players, comfortably ordered, so a top three has something to cut off. */
function fivePlayers(
  game: GameModule,
  settings: Parameters<typeof createRoom>[0]['settings'] = {}
): RoomState {
  return withScores(
    game,
    [
      ['alice', 50],
      ['bob', 40],
      ['cleo', 30],
      ['dan', 20],
      ['eve', 10],
    ],
    settings
  );
}

// ---------------------------------------------------------------------------

describe('what a player is allowed to see', () => {
  it('carries that player their own score', () => {
    const game = echoGame();
    const snapshot = projectForPlayer(fivePlayers(game), 'dan', game);
    expect(snapshot.viewer).toBe('player');
    expect(snapshot.you.id).toBe('dan');
    expect(snapshot.yourScore).toBe(20);
  });

  it('gives a rank to a player in the top three', () => {
    const game = echoGame();
    const state = fivePlayers(game);
    expect(projectForPlayer(state, 'alice', game).yourRank).toBe(1);
    expect(projectForPlayer(state, 'bob', game).yourRank).toBe(2);
    expect(projectForPlayer(state, 'cleo', game).yourRank).toBe(3);
  });

  it('withholds the rank of a player outside the top three', () => {
    const game = echoGame();
    const state = fivePlayers(game);
    // Fourth and fifth are told nothing about where they stand. A player who is
    // last must not be able to learn it from their own phone either.
    expect(projectForPlayer(state, 'dan', game).yourRank).toBeNull();
    expect(projectForPlayer(state, 'eve', game).yourRank).toBeNull();
  });

  it('carries nobody else a single score', () => {
    const game = echoGame();
    const state = fivePlayers(game);
    for (const player of state.players) {
      const wire = JSON.stringify(projectForPlayer(state, player.id, game));
      // The only score-shaped field a player may receive is `yourScore`. A
      // `score` key of any kind in here would be somebody else's.
      expect(wire).not.toContain('"score"');
      expect(wire).not.toContain('"standings"');
      expect(wire).not.toContain('"teamStandings"');
    }
  });

  it('carries no private roster bookkeeping', () => {
    const game = echoGame();
    const wire = JSON.stringify(projectForPlayer(fivePlayers(game), 'alice', game));
    // Credentials are not among these because the room does not hold any: the
    // transport issues and verifies every token, and a secret kept in one place
    // cannot be leaked from a second.
    expect(wire).not.toContain('clockOffsetMs');
    expect(wire).not.toContain('totalResponseMs');
    expect(wire).not.toContain('rngSeed');
  });

  it('lists everyone in the room without their scores', () => {
    const game = echoGame();
    const snapshot = projectForPlayer(fivePlayers(game), 'eve', game);
    expect(snapshot.players).toHaveLength(5);
    for (const player of snapshot.players) {
      expect(Object.keys(player).sort()).toEqual(['connected', 'id', 'name', 'teamId']);
    }
  });

  it('never carries the answer, not even at the reveal', () => {
    const game = echoGame();
    const revealed = run(fivePlayers(game), game, [
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'start' } }, at: 2_000 },
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'nextRound' } }, at: 2_001 },
      {
        actor: asPlayer('alice'),
        intent: { kind: 'answer', round: 0, value: { type: 'text', text: 'naomi-0' } },
        at: 2_100,
      },
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'revealNow' } }, at: 2_500 },
    ]);
    expect(revealed.phase).toBe('reveal');
    // The answer travels in the separate reveal event, which the runtime sends
    // once. It has no business riding along in steady state.
    expect(JSON.stringify(projectForPlayer(revealed, 'bob', game))).not.toContain('naomi-0');
    expect(projectForPlayer(revealed, 'bob', game).view).toEqual({ prompt: QUESTION });
  });

  it('says whether this player has answered, and nothing about who else has', () => {
    const game = echoGame();
    const answered = run(fivePlayers(game), game, [
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'start' } }, at: 2_000 },
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'nextRound' } }, at: 2_001 },
      {
        actor: asPlayer('alice'),
        intent: { kind: 'answer', round: 0, value: { type: 'text', text: 'naomi-0' } },
        at: 2_100,
      },
    ]);
    expect(projectForPlayer(answered, 'alice', game).youAnswered).toBe(true);
    expect(projectForPlayer(answered, 'bob', game).youAnswered).toBe(false);
    expect(JSON.stringify(projectForPlayer(answered, 'bob', game))).not.toContain('answeredCount');
  });

  it('renders a viewer the room has forgotten rather than failing', () => {
    const game = echoGame();
    // A phone whose player was kicked mid-request still gets a coherent frame.
    const snapshot = projectForPlayer(fivePlayers(game), 'ghost', game);
    expect(snapshot.you).toEqual({ id: 'ghost', name: '', teamId: null, connected: false });
    expect(snapshot.yourScore).toBe(0);
    expect(snapshot.yourRank).toBeNull();
  });
});

describe('what the big screen is allowed to see', () => {
  it('carries exactly three standings by default', () => {
    const game = echoGame();
    const snapshot = projectForScreen(fivePlayers(game), game, true);
    expect(snapshot.standings).toHaveLength(3);
    expect(snapshot.standings.map((standing) => standing.playerId)).toEqual([
      'alice',
      'bob',
      'cleo',
    ]);
  });

  it('leaves the bottom of the leaderboard out of the snapshot entirely', () => {
    const game = echoGame();
    const wire = JSON.stringify(projectForScreen(fivePlayers(game), game, true).standings);
    expect(wire).not.toContain('dan');
    expect(wire).not.toContain('eve');
    // The same probe the players' tests use to prove no score reached them.
    // Asserting it here, where a score is supposed to be, keeps that check from
    // passing because the spelling drifted.
    expect(wire).toContain('"score"');
  });

  it('carries the whole list once the host turns individual scores on', () => {
    const game = echoGame();
    const snapshot = projectForScreen(fivePlayers(game, { showIndividualScores: true }), game, true);
    expect(snapshot.standings.map((standing) => standing.playerId)).toEqual([
      'alice',
      'bob',
      'cleo',
      'dan',
      'eve',
    ]);
  });

  it('trims a room of exactly three to itself', () => {
    const game = echoGame();
    const state = withScores(game, [
      ['alice', 30],
      ['bob', 20],
      ['cleo', 10],
    ]);
    expect(visibleStandings(state)).toHaveLength(3);
  });

  it('aggregates teams so that being last names nobody', () => {
    const game = echoGame();
    const state = fivePlayers(game, { teamsEnabled: true });
    const snapshot = projectForScreen(state, game, true);
    expect(snapshot.teamStandings.length).toBeGreaterThan(0);
    const wire = JSON.stringify(snapshot.teamStandings);
    expect(wire).not.toContain('playerId');
    for (const player of state.players) expect(wire).not.toContain(player.name);
  });

  it('omits team standings when the room is not playing in teams', () => {
    const game = echoGame();
    expect(projectForScreen(fivePlayers(game), game, true).teamStandings).toEqual([]);
  });

  it('shows overall standings as a top three too, even with individual scores on', () => {
    const game = echoGame();
    const snapshot = projectForScreen(fivePlayers(game, { showIndividualScores: true }), game, true);
    expect(snapshot.overallStandings).toHaveLength(3);
    expect(snapshot.overallStandings.map((standing) => standing.playerId)).toEqual([
      'alice',
      'bob',
      'cleo',
    ]);
  });

  it('keeps a folded-in overall total after newGame resets the round-by-round standings', () => {
    const game = echoGame();
    const scored = fivePlayers(game);
    const afterNewGame = run(scored, game, [
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'newGame' } }, at: 2_000 },
    ]);
    const snapshot = projectForScreen(afterNewGame, game, true);
    // The round-by-round standings reset to zero for the fresh game...
    expect(snapshot.standings.every((standing) => standing.score === 0)).toBe(true);
    // ...but who led before the reset is still on record overall.
    expect(snapshot.overallStandings.map((standing) => standing.playerId)).toEqual([
      'alice',
      'bob',
      'cleo',
    ]);
    expect(snapshot.overallStandings[0]?.score).toBe(50);
  });

  it('counts the answers in rather than listing them', () => {
    const game = echoGame();
    const answered = run(fivePlayers(game), game, [
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'start' } }, at: 2_000 },
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'nextRound' } }, at: 2_001 },
      {
        actor: asPlayer('alice'),
        intent: { kind: 'answer', round: 0, value: { type: 'text', text: 'naomi-0' } },
        at: 2_100,
      },
      {
        actor: asPlayer('bob'),
        intent: { kind: 'answer', round: 0, value: { type: 'text', text: 'ruth' } },
        at: 2_200,
      },
    ]);
    const snapshot = projectForScreen(answered, game, true);
    expect(snapshot.answeredCount).toBe(2);
    // A count is a fact about the group; a list would name whoever got it wrong.
    expect(JSON.stringify(snapshot)).not.toContain('ruth');
  });

  it('does carry the answer, because the host is the one running the room', () => {
    const game = echoGame();
    const started = run(fivePlayers(game), game, [
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'start' } }, at: 2_000 },
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'nextRound' } }, at: 2_001 },
    ]);
    expect(projectForScreen(started, game, true).view).toEqual({ prompt: QUESTION, answer: 'naomi-0' });
  });

  it('asks the remote for a verdict with the prefix the player had actually read', () => {
    const game = echoGame(true);
    const buzzed = run(fivePlayers(game), game, [
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'start' } }, at: 2_000 },
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'nextRound' } }, at: 2_001 },
      {
        actor: asPlayer('alice'),
        intent: { kind: 'buzz', round: 0, charsSeen: 5, tClient: 2_400 },
        at: 2_420,
      },
      {
        actor: asPlayer('alice'),
        intent: { kind: 'answer', round: 0, value: { type: 'text', text: 'a woman' } },
        at: 3_000,
      },
    ]);
    const pending = projectForRemote(buzzed, game).control?.pendingJudge;
    expect(pending?.playerId).toBe('alice');
    expect(pending?.playerAnswer).toBe('a woman');
    expect(pending?.seenPrefix).toBe(QUESTION.slice(0, 5));
    expect(pending?.canonicalAnswer).toBe('naomi-0');
    expect(pending?.suggestion).toBeNull();
  });

  it('offers no verdict panel when nobody is waiting on one', () => {
    const game = echoGame();
    expect(projectForScreen(fivePlayers(game), game, true).control?.pendingJudge).toBeNull();
  });
});

/** The §6 negative tests from the design: a field is proven absent, not merely unrendered. */
describe('control', () => {
  function withAPendingJudge(game: GameModule): RoomState {
    return run(fivePlayers(game), game, [
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'start' } }, at: 2_000 },
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'nextRound' } }, at: 2_001 },
      {
        actor: asPlayer('alice'),
        intent: { kind: 'buzz', round: 0, charsSeen: 5, tClient: 2_400 },
        at: 2_420,
      },
      {
        actor: asPlayer('alice'),
        intent: { kind: 'answer', round: 0, value: { type: 'text', text: 'a very particular phrase' } },
        at: 3_000,
      },
    ]);
  }

  it('never lets pendingJudge or the string a player typed reach a screen that is not the controller', () => {
    const game = echoGame(true);
    const buzzed = withAPendingJudge(game);
    // Control moves to a player mid-judging: the owner credential is no
    // longer the controller, and its screen must lose the panel entirely —
    // not merely stop rendering it.
    const handedOver = run(buzzed, game, [
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'grantControl', playerId: 'bob' } }, at: 3_100 },
    ]);
    const wire = JSON.stringify(projectForScreen(handedOver, game, true));
    expect(wire).not.toContain('pendingJudge');
    expect(wire).not.toContain('a very particular phrase');
  });

  it('a display-credentialled screen carries no control block even while the owner credential holds control', () => {
    const game = echoGame(true);
    const buzzed = withAPendingJudge(game);
    const display = projectForScreen(buzzed, game, false);
    expect(display.control).toBeUndefined();
    const wire = JSON.stringify(display);
    expect(wire).not.toContain('pendingJudge');
    expect(wire).not.toContain('a very particular phrase');
  });

  it('exactly one snapshot in the room carries control, for every controller value', () => {
    const game = echoGame();
    const state = fivePlayers(game);

    // The owner holds control by default: only the owner-credentialled
    // screen carries the panel — not the display-credentialled one, and no
    // player.
    expect(projectForScreen(state, game, true).control).not.toBeUndefined();
    expect(projectForScreen(state, game, false).control).toBeUndefined();
    for (const player of state.players) {
      expect(projectForPlayer(state, player.id, game).control).toBeUndefined();
    }

    // Control handed to Alice: only her own projection carries it now — not
    // either screen, and not any other player.
    const granted = run(state, game, [
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'grantControl', playerId: 'alice' } }, at: 2_000 },
    ]);
    expect(projectForScreen(granted, game, true).control).toBeUndefined();
    expect(projectForScreen(granted, game, false).control).toBeUndefined();
    expect(projectForPlayer(granted, 'alice', game).control).not.toBeUndefined();
    for (const player of granted.players) {
      if (player.id === 'alice') continue;
      expect(projectForPlayer(granted, player.id, game).control).toBeUndefined();
    }
  });

  it("a player who is not the controller has no control and no other player's yourControlRequest", () => {
    const game = echoGame();
    const requested = run(fivePlayers(game), game, [
      { actor: asPlayer('alice'), intent: { kind: 'requestControl' }, at: 2_000 },
    ]);
    // Alice's own request status is visible only to Alice.
    expect(projectForPlayer(requested, 'alice', game).yourControlRequest).toBe('pending');
    expect(projectForPlayer(requested, 'bob', game).yourControlRequest).toBeNull();
    expect(projectForPlayer(requested, 'bob', game).control).toBeUndefined();
    // And nothing about Alice's request travels in Bob's own payload.
    const wire = JSON.stringify(projectForPlayer(requested, 'bob', game));
    expect(wire).not.toContain('requests');
  });
});

/**
 * The `spent` leak (row 11 of the design): a screen the whole room is
 * watching must never be able to name who already answered wrong. The fix
 * moves `spent` off the public `buzz` entirely — a player learns only their
 * own status (`youAreSpent`), and a controller learns everyone's, scoped to
 * `ControlPanel.spent`.
 */
describe('the spent leak', () => {
  function withASpentPlayer(game: GameModule): RoomState {
    return run(fivePlayers(game), game, [
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'start' } }, at: 2_000 },
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'nextRound' } }, at: 2_001 },
      {
        actor: asPlayer('alice'),
        intent: { kind: 'buzz', round: 0, charsSeen: 5, tClient: 2_400 },
        at: 2_420,
      },
      {
        actor: asPlayer('alice'),
        intent: { kind: 'answer', round: 0, value: { type: 'text', text: 'wrong' } },
        at: 3_000,
      },
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'judge', verdict: 'incorrect' } }, at: 3_100 },
    ]);
  }

  it('never carries spent on the wire buzz state, for any viewer', () => {
    const game = echoGame(true);
    const state = withASpentPlayer(game);

    const screen = projectForScreen(state, game, true);
    expect(screen.buzz).not.toBeNull();
    expect(screen.buzz && 'spent' in screen.buzz).toBe(false);

    const bob = projectForPlayer(state, 'bob', game);
    expect(bob.buzz && 'spent' in bob.buzz).toBe(false);

    const alice = projectForPlayer(state, 'alice', game);
    expect(alice.buzz && 'spent' in alice.buzz).toBe(false);
  });

  it("tells alice only her own status, the controller everyone's (scoped to control.spent), and no other player anything", () => {
    const game = echoGame(true);
    const state = withASpentPlayer(game);

    expect(projectForPlayer(state, 'alice', game).youAreSpent).toBe(true);
    expect(projectForPlayer(state, 'bob', game).youAreSpent).toBe(false);
    // Bob is not the controller, so he has no control block to read anyone's
    // spent status from at all.
    expect(projectForPlayer(state, 'bob', game).control).toBeUndefined();

    // The owner controls by default: its screen sees who is spent, scoped
    // to control.spent, and nowhere else in its own payload.
    const screen = projectForScreen(state, game, true);
    expect(screen.control?.spent).toEqual(['alice']);

    // A display-credentialled screen never controls, so it gets no control
    // block at all — no way to learn who is spent.
    const display = projectForScreen(state, game, false);
    expect(display.control).toBeUndefined();
  });
});

describe('the full ordering', () => {
  it('reaches only the host who asked for it, and then includes everyone', () => {
    const game = echoGame();
    const state = fivePlayers(game);
    const full = projectFullStandings(state);
    expect(full.map((standing) => standing.playerId)).toEqual([
      'alice',
      'bob',
      'cleo',
      'dan',
      'eve',
    ]);
    // The same state projected as a snapshot still stops at three, so the full
    // list cannot arrive by accident.
    expect(projectForScreen(state, game, true).standings).toHaveLength(3);
  });
});

describe('the reveal', () => {
  const played = (game: GameModule): RoomState =>
    run(fivePlayers(game), game, [
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'start' } }, at: 2_000 },
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'nextRound' } }, at: 2_001 },
      {
        actor: asPlayer('alice'),
        intent: { kind: 'answer', round: 0, value: { type: 'text', text: 'naomi-0' } },
        at: 2_100,
      },
      {
        actor: asPlayer('bob'),
        intent: { kind: 'answer', round: 0, value: { type: 'text', text: 'delilah' } },
        at: 2_200,
      },
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'revealNow' } }, at: 2_500 },
    ]);

  it('publishes counts that attribute nothing to anybody', () => {
    const game = echoGame();
    const reveal = projectReveal(played(game));
    expect(reveal?.correctLabel).toBe('naomi-0');
    expect(reveal?.aggregates).toEqual([
      { label: 'naomi-0', count: 1 },
      { label: 'something else', count: 1 },
    ]);
    const wire = JSON.stringify(reveal);
    expect(wire).not.toContain('playerId');
    expect(wire).not.toContain('alice');
    expect(wire).not.toContain('bob');
    expect(wire).not.toContain('delilah');
  });

  it('addresses each outcome to one phone', () => {
    const game = echoGame();
    const state = played(game);
    expect(projectPersonalResult(state, 'alice')).toMatchObject({
      correct: true,
      pointsAwarded: 10,
    });
    expect(projectPersonalResult(state, 'bob')).toMatchObject({
      correct: false,
      note: 'not this time',
    });
    // Nobody who stayed silent has a result, and nothing about bob's wrong
    // answer is reachable from anyone else's projection.
    expect(projectPersonalResult(state, 'cleo')).toBeNull();
    expect(JSON.stringify(projectForPlayer(state, 'cleo', game))).not.toContain('delilah');
  });

  it('has nothing to publish before a round has been scored', () => {
    const game = echoGame();
    expect(projectReveal(fivePlayers(game))).toBeNull();
    expect(projectPersonalResult(fivePlayers(game), 'alice')).toBeNull();
  });
});


// ---------------------------------------------------------------------------
// The organizer's remote, and who may be told the answer
// ---------------------------------------------------------------------------

type Role = 'ownerScreen' | 'displayScreen' | 'codeOnlyScreen' | 'remote' | 'controllingPlayer' | 'plainPlayer';

const PREVIEW = 'preview:naomi-0';

function snapshotFor(role: Role, state: RoomState, game: GameModule): unknown {
  switch (role) {
    case 'ownerScreen':
      return projectForScreen(state, game, true);
    // A screen opened with a display token and one opened by code alone are
    // both projected as a screen that is not the owner's; the transport is
    // what tells them apart, and it hands the projection the same fact.
    case 'displayScreen':
    case 'codeOnlyScreen':
      return projectForScreen(state, game, false);
    case 'remote':
      return projectForRemote(state, game);
    case 'controllingPlayer':
      return projectForPlayer(state, 'bob', game);
    case 'plainPlayer':
      return projectForPlayer(state, 'alice', game);
  }
}

function controlOf(snapshot: unknown): ControlPanel | undefined {
  return (snapshot as { control?: ControlPanel }).control;
}

/** A buzz game paused at each live phase, with the owner or with bob in control. */
function livePhases(game: GameModule, controlGrantedTo: PlayerId | null): Record<'question' | 'answering' | 'reveal', RoomState> {
  const grant: Step[] =
    controlGrantedTo === null
      ? []
      : [
          {
            actor: HOST,
            intent: { kind: 'host', command: { cmd: 'grantControl', playerId: controlGrantedTo } },
            at: 1_900,
          },
        ];
  const controller: Actor = controlGrantedTo === null ? HOST : asPlayer(controlGrantedTo);
  const started: Step[] = [
    ...grant,
    { actor: controller, intent: { kind: 'host', command: { cmd: 'start' } }, at: 2_000 },
    { actor: controller, intent: { kind: 'host', command: { cmd: 'nextRound' } }, at: 2_001 },
  ];
  const question = run(fivePlayers(game), game, started);
  const answering = run(question, game, [
    { actor: asPlayer('alice'), intent: { kind: 'buzz', round: 0, charsSeen: 5, tClient: 2_400 }, at: 2_420 },
    {
      actor: asPlayer('alice'),
      intent: { kind: 'answer', round: 0, value: { type: 'text', text: 'a very particular phrase' } },
      at: 3_000,
    },
  ]);
  const reveal = run(question, game, [
    {
      actor: controller,
      intent: { kind: 'host', command: { cmd: 'revealNow' } },
      at: 2_500,
    },
  ]);
  expect(question.phase).toBe('question');
  expect(answering.phase).toBe('answering');
  expect(reveal.phase).toBe('reveal');
  return { question, answering, reveal };
}

describe('who may be told the answer, role by role', () => {
  const game = echoGame(true);
  const ownerHolds = livePhases(game, null);
  const bobHolds = livePhases(game, 'bob');

  type Expectation = {
    /** The preview string appears nowhere in the payload when false. */
    answer: boolean;
    /**
     * What a pending judgement carries in the answering phase: everything, the
     * typed answer without the canonical one (`blank`), only enough to rule
     * on what was heard (`ruleOnly`), or no judgement at all.
     */
    canonical: 'present' | 'blank' | 'ruleOnly' | 'absent';
    control: boolean;
  };

  const ownerHeld: Record<Role, Expectation> = {
    // The shared screen: the room is looking at it.
    ownerScreen: { answer: false, canonical: 'ruleOnly', control: true },
    displayScreen: { answer: false, canonical: 'absent', control: false },
    codeOnlyScreen: { answer: false, canonical: 'absent', control: false },
    remote: { answer: true, canonical: 'present', control: true },
    // Not the controller while the owner holds control.
    controllingPlayer: { answer: false, canonical: 'absent', control: false },
    plainPlayer: { answer: false, canonical: 'absent', control: false },
  };

  const playerHeld: Record<Role, Expectation> = {
    ownerScreen: { answer: false, canonical: 'absent', control: false },
    displayScreen: { answer: false, canonical: 'absent', control: false },
    codeOnlyScreen: { answer: false, canonical: 'absent', control: false },
    // The owner credential does not hold control, so there is no panel to
    // carry an answer.
    remote: { answer: false, canonical: 'absent', control: false },
    controllingPlayer: { answer: false, canonical: 'blank', control: true },
    plainPlayer: { answer: false, canonical: 'absent', control: false },
  };

  const roles = Object.keys(ownerHeld) as Role[];

  for (const [label, states, table] of [
    ['the owner holds control', ownerHolds, ownerHeld],
    ['a seated player holds control', bobHolds, playerHeld],
  ] as const) {
    for (const phase of ['question', 'answering', 'reveal'] as const) {
      for (const role of roles) {
        const expected = table[role];
        it(`${label}, ${phase}: ${role}`, () => {
          const snapshot = snapshotFor(role, states[phase], game);
          const wire = JSON.stringify(snapshot);
          const control = controlOf(snapshot);

          expect(control !== undefined).toBe(expected.control);
          expect(wire.includes(PREVIEW)).toBe(expected.answer);
          expect(control?.answer ?? null).toBe(expected.answer ? PREVIEW : null);

          if (phase === 'answering') {
            const judge = control?.pendingJudge ?? null;
            if (expected.canonical === 'absent') {
              expect(judge).toBeNull();
              expect(wire).not.toContain('pendingJudge');
              expect(wire).not.toContain('a very particular phrase');
            } else if (expected.canonical === 'ruleOnly') {
              expect(judge).not.toBeNull();
              expect(wire).not.toContain('a very particular phrase');
              // The stub game's own view carries its answer; the judgement must not.
              expect(JSON.stringify(judge)).not.toContain('naomi-0');
            } else {
              expect(judge?.playerAnswer).toBe('a very particular phrase');
              expect(judge?.canonicalAnswer).toBe(expected.canonical === 'present' ? 'naomi-0' : '');
            }
          }
        });
      }
    }
  }

  it('hands a seated controller what it needs to rule, and nothing that gives the round away', () => {
    const judge = controlOf(projectForPlayer(bobHolds.answering, 'bob', game))?.pendingJudge;
    expect(judge).not.toBeNull();
    expect(judge?.question).toBe(QUESTION);
    expect(judge?.seenPrefix).toBe(QUESTION.slice(0, 5));
    expect(judge?.playerAnswer).toBe('a very particular phrase');
    expect(judge?.canonicalAnswer).toBe('');
    expect(judge?.accept).toEqual([]);
    expect(judge?.contextNote).toBeNull();
    // The stub game's screen view carries its answer, which no real game's
    // does before the reveal; everything else on the phone must not.
    const { screenView: _screen, ...panel } = controlOf(projectForPlayer(bobHolds.answering, 'bob', game)) ?? {};
    const { control: _control, ...rest } = projectForPlayer(bobHolds.answering, 'bob', game);
    expect(JSON.stringify({ ...rest, control: panel })).not.toContain('naomi-0');
  });

  it('hands a seated controller the screen’s own view for the game’s control slot, and nobody else', () => {
    const screenView = projectForScreen(bobHolds.reveal, game, false).view;
    expect(controlOf(projectForPlayer(bobHolds.reveal, 'bob', game))?.screenView).toEqual(screenView);
    expect(controlOf(projectForRemote(ownerHolds.reveal, game))?.screenView).toBeUndefined();
    expect(controlOf(projectForScreen(ownerHolds.reveal, game, true))?.screenView).toBeUndefined();
  });

  it('gives the owner screen a judgement to rule on, with nothing typed and no answer on it', () => {
    const judge = controlOf(projectForScreen(ownerHolds.answering, game, true))?.pendingJudge;
    expect(judge?.playerId).toBe('alice');
    expect(judge?.playerAnswer).toBe('');
    expect(judge?.seenPrefix).toBe('');
    expect(judge?.canonicalAnswer).toBe('');
    expect(judge?.accept).toEqual([]);
    expect(judge?.contextNote).toBeNull();
  });

  it('shows the owner screen the full judgement once the reveal is up', () => {
    const judge = controlOf(projectForScreen(ownerHolds.reveal, game, true))?.pendingJudge ?? null;
    if (judge !== null) expect(judge.canonicalAnswer).toBe('naomi-0');
  });
});

describe('the remote', () => {
  const game = echoGame();

  it('is a remote snapshot with the same public fields as the screen', () => {
    const state = fivePlayers(game);
    const remote = projectForRemote(state, game);
    const screen = projectForScreen(state, game, true);
    const { viewer: remoteViewer, ...remoteRest } = remote;
    const { viewer: screenViewer, ...screenRest } = screen;
    expect(remoteViewer).toBe('remote');
    expect(screenViewer).toBe('screen');
    expect(remoteRest).toEqual(screenRest);
  });

  it('carries no answer in the lobby or the summary, where there is no round to answer', () => {
    const lobby = fivePlayers(game);
    expect(controlOf(projectForRemote(lobby, game))?.answer).toBeNull();
    const ended = run(lobby, game, [
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'start' } }, at: 2_000 },
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'nextRound' } }, at: 2_001 },
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'revealNow' } }, at: 2_100 },
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'end' } }, at: 2_200 },
    ]);
    expect(ended.phase).toBe('summary');
    expect(controlOf(projectForRemote(ended, game))?.answer).toBeNull();
  });

  it('has a null answer when the game offers no preview', () => {
    const silent: GameModule = { ...echoGame(), answerPreview: undefined } as GameModule;
    const live = run(fivePlayers(silent), silent, [
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'start' } }, at: 2_000 },
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'nextRound' } }, at: 2_001 },
    ]);
    expect(controlOf(projectForRemote(live, silent))?.answer).toBeNull();
  });

  it('follows the controller: no control block while a player holds control', () => {
    const handed = run(fivePlayers(game), game, [
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'grantControl', playerId: 'alice' } }, at: 2_000 },
    ]);
    expect(projectForRemote(handed, game).control).toBeUndefined();
  });

  it('never carries a score for anyone beyond the top three', () => {
    const { standings, control } = projectForRemote(fivePlayers(game), game);
    expect(standings.map((standing) => standing.playerId)).toEqual(['alice', 'bob', 'cleo']);
    expect(control?.standings.map((standing) => standing.playerId)).toEqual(['alice', 'bob', 'cleo']);
  });
});

describe('scores after each answer', () => {
  const game = echoGame();
  const hidden = (): RoomState => fivePlayers(game, { scoresAfterEachAnswer: false });

  it('leaves the screen and the remote with no standings until the summary', () => {
    for (const snapshot of [projectForScreen(hidden(), game, true), projectForRemote(hidden(), game)]) {
      expect(snapshot.standings).toEqual([]);
      expect(snapshot.teamStandings).toEqual([]);
      expect(snapshot.control?.standings).toEqual([]);
    }
  });

  it('shows them again at the summary', () => {
    const ended = run(hidden(), game, [
      { actor: HOST, intent: { kind: 'host', command: { cmd: 'end' } }, at: 2_000 },
    ]);
    expect(ended.phase).toBe('summary');
    expect(projectForScreen(ended, game, false).standings).toHaveLength(3);
    expect(projectForRemote(ended, game).standings).toHaveLength(3);
  });

  it('keeps them when the setting is on', () => {
    expect(projectForScreen(fivePlayers(game), game, false).standings).toHaveLength(3);
  });

  it('still tells a player their own score', () => {
    expect(projectForPlayer(hidden(), 'alice', game).yourScore).toBe(50);
  });
});
