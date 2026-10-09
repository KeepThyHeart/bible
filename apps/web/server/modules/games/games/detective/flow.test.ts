/**
 * The detective game played through the room as it stands.
 *
 * The module deals clues and scores one answer at a time; the room freezes the
 * seats, collects votes that may change, applies the majority and projects
 * each screen. So these drive the real reducer with the real module and an
 * isolated content library, and check what a group would notice: that each
 * phone holds its own clue and nobody else's, that a vote can change until
 * time runs out, that a right majority pays everyone in the group, that a tie
 * pays nobody, that teams decide on their own, and that the room is told how
 * it split without being told who voted for what.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { Actor, Intent, PlayerId, RoomSettings, TeamId } from '../../../../../src/modules/games/shared/protocol.js';
import { toVerseId } from '../../../../../src/modules/games/shared/verseId.js';
import { ContentLibrary, importContent, useContent } from '../../content/index.js';
import { makeTempDir, removeTempDir } from '../../content/fixtures.js';
import { reduce } from '../../room/reducer.js';
import { projectForPlayer, projectForScreen, projectPersonalResult, projectReveal } from '../../room/projection.js';
import { createRoom } from '../../room/state.js';
import type { RoomState } from '../../room/state.js';
import { MIN_DISCUSSION_MS, POINTS, QUESTION, QUESTION_TAG, detective } from './index.js';
import type { DetectivePhoneView, DetectiveReveal, DetectiveSecret } from './index.js';

const T0 = 1_700_000_000_000;
const HOST: Actor = { role: 'owner' };
const SYSTEM: Actor = { role: 'system' };

const PEOPLE = ['Moses', 'Ruth', 'Gideon'];

function caseRow(person: string, position: number) {
  return {
    id: `detective-${person.toLowerCase()}`,
    prompt: `${QUESTION} Opening line ${position}`,
    promptVerseId: toVerseId(2, 3, position + 1),
    answer: person,
    difficulty: 1,
    tags: [QUESTION_TAG],
    distractors: ['Aaron', 'Balaam', 'Joshua', 'Caleb'].filter((name) => name !== person),
    clues: [1, 2, 3, 4].map((clue) => ({
      text: `Dealt evidence ${position}-${clue}`,
      ref: `Exodus ${position + 1}:${clue}`,
    })),
  };
}

let directory: string;
let library: ContentLibrary;
let previous: ContentLibrary | null;
let state: RoomState;

function step(actor: Actor, intent: Intent, at: number): void {
  state = reduce(state, { actor, intent, receivedAt: at }, detective).state;
}

function player(playerId: PlayerId): Actor {
  return { role: 'player', playerId };
}

function vote(playerId: PlayerId, index: number, at: number): void {
  step(player(playerId), { kind: 'answer', round: state.roundIndex, value: { type: 'choice', index } }, at);
}

function host(command: Extract<Intent, { kind: 'host' }>['command'], at: number): void {
  step(HOST, { kind: 'host', command }, at);
}

function timeRunsOut(): void {
  step(SYSTEM, { kind: 'timer', round: state.roundIndex, tag: 'answerEnd' }, state.phaseEndsAt ?? 0);
}

/** A room of these players, in this order, whose first case has just gone up. */
function started(players: [PlayerId, TeamId?][], settings: Partial<RoomSettings> = {}): void {
  state = createRoom({
    code: 'KDXR',
    now: T0 - 10_000,
    seed: 17,
    settings: { gameId: 'detective', familiarity: 'core', rounds: 3, ...settings },
  });
  for (const [index, [playerId, teamId]] of players.entries()) {
    const intent: Intent =
      teamId === undefined ? { kind: 'join', name: playerId } : { kind: 'join', name: playerId, teamId };
    step(player(playerId), intent, T0 - 5_000 + index);
  }
  host({ cmd: 'start' }, T0);
}

function secret(): DetectiveSecret {
  const round = state.rounds[state.roundIndex];
  if (!round || round.secret === null) throw new Error('expected a case on the table');
  return round.secret as DetectiveSecret;
}

function right(): number {
  return secret().correctIndex;
}

/** A name that is not the answer, counting on from it. */
function wrong(step = 1): number {
  return (right() + step) % secret().options.length;
}

function scoreOf(playerId: PlayerId): number {
  return state.players.find((candidate) => candidate.id === playerId)?.score ?? 0;
}

function phoneView(playerId: PlayerId): DetectivePhoneView {
  return projectForPlayer(state, playerId, detective).view as DetectivePhoneView;
}

beforeEach(() => {
  directory = makeTempDir('detective-flow-');
  library = ContentLibrary.open({
    moduleDir: join(directory, 'modules'),
    contentPath: ':memory:',
    defaultTranslation: 'FIX',
  });
  const report = importContent(library.db, { questions: PEOPLE.map(caseRow) });
  expect(report.rejected).toEqual([]);
  previous = useContent(library);
});

afterEach(() => {
  useContent(previous);
  library.close();
  removeTempDir(directory);
});

describe('a case on the table', () => {
  beforeEach(() => started([['ann'], ['bo'], ['cy'], ['di']]));

  it('opens straight to the vote, with time to talk it over', () => {
    expect(state.phase).toBe('answering');
    expect(state.phaseEndsAt).toBe(T0 + MIN_DISCUSSION_MS);
  });

  it('gives every phone its own clue and nobody else’s, and the big screen none of them', () => {
    const clues = ['ann', 'bo', 'cy', 'di'].map((playerId) => phoneView(playerId).clue);
    expect(new Set(clues).size).toBe(4);

    for (const playerId of ['ann', 'bo', 'cy', 'di']) {
      const wire = JSON.stringify(projectForPlayer(state, playerId, detective));
      const mine = phoneView(playerId).clue;
      for (const other of clues.filter((clue) => clue !== mine)) expect(wire).not.toContain(other);
    }

    const big = JSON.stringify(projectForScreen(state, detective, true));
    for (const clue of clues) expect(big).not.toContain(clue);
    expect(big).toContain(secret().opening.text);
  });

  it('lets a vote change until time runs out, and counts only the last one', () => {
    vote('ann', wrong(), T0 + 1_000);
    vote('bo', wrong(), T0 + 1_100);
    vote('cy', right(), T0 + 1_200);
    vote('di', right(), T0 + 1_300);
    vote('ann', right(), T0 + 2_000);
    // Everyone is in, but a vote that can still change is not a decision.
    expect(state.phase).toBe('answering');
    expect(projectForPlayer(state, 'ann', detective).yourAnswer).toEqual({ type: 'choice', index: right() });
    expect(projectForPlayer(state, 'ann', detective).canChangeAnswer).toBe(true);

    timeRunsOut();
    expect(state.phase).toBe('reveal');
    expect(projectReveal(state)?.groups?.[0]).toMatchObject({ decided: secret().person, correct: true });
  });

  it('pays everyone when the majority is right, the dissenter and the one who never voted too', () => {
    vote('ann', right(), T0 + 1_000);
    vote('bo', right(), T0 + 1_100);
    vote('cy', wrong(), T0 + 1_200);
    host({ cmd: 'revealNow' }, T0 + 5_000);

    for (const playerId of ['ann', 'bo', 'cy', 'di']) expect(scoreOf(playerId)).toBe(POINTS);
    // Only the dissenter's own phone learns how they voted.
    expect(projectPersonalResult(state, 'cy')).toEqual({
      correct: true,
      pointsAwarded: POINTS,
      submitted: { type: 'choice', index: wrong() },
      note: `The room chose ${secret().person}`,
    });
    expect(projectPersonalResult(state, 'di')?.submitted).toBeNull();
  });

  it('pays nobody when the room is split, and still shows the answer', () => {
    vote('ann', right(), T0 + 1_000);
    vote('bo', wrong(), T0 + 1_100);
    host({ cmd: 'revealNow' }, T0 + 5_000);

    for (const playerId of ['ann', 'bo', 'cy', 'di']) expect(scoreOf(playerId)).toBe(0);
    const reveal = projectReveal(state);
    expect(reveal?.correctLabel).toBe(secret().person);
    expect(reveal?.groups?.[0]).toMatchObject({ decided: null, correct: null });
    expect(projectPersonalResult(state, 'ann')?.note).toBe('The room was split');
  });

  it('tells the room how it split, with every clue and where it was, and names nobody', () => {
    vote('ann', right(), T0 + 1_000);
    vote('bo', right(), T0 + 1_100);
    vote('cy', wrong(), T0 + 1_200);
    host({ cmd: 'revealNow' }, T0 + 5_000);

    const reveal = projectReveal(state);
    expect(reveal?.aggregates.find((row) => row.label === secret().person)?.count).toBe(2);
    const detail = reveal?.detail as DetectiveReveal;
    expect(detail.clues.map((clue) => clue.where)).toEqual(['screen', 'phones', 'phones', 'phones', 'phones']);
    expect(detail.clues[0]?.reference).toBe(`Exodus 3:${PEOPLE.indexOf(secret().person) + 1}`);

    const wire = JSON.stringify(reveal);
    for (const playerId of ['ann', 'bo', 'cy', 'di']) expect(wire).not.toContain(`"${playerId}"`);
  });

  it('never shows the big screen or another phone how anyone voted', () => {
    vote('ann', wrong(1), T0 + 1_000);
    vote('bo', wrong(2), T0 + 1_100);
    const big = projectForScreen(state, detective, true);
    expect(big.answeredCount).toBe(2);
    expect(JSON.stringify(big.view)).toBe(JSON.stringify(projectForScreen(createdFresh(), detective, true).view));
    expect(projectForPlayer(state, 'cy', detective).yourAnswer).toBeNull();
    expect(projectForPlayer(state, 'bo', detective).yourAnswer).toEqual({ type: 'choice', index: wrong(2) });
  });

  it('refuses a vote from someone who arrived after the deal, and tells them to wait', () => {
    step(player('late'), { kind: 'join', name: 'late' }, T0 + 500);
    vote('late', right(), T0 + 1_000);
    expect(state.answers).toEqual([]);
    expect(projectForPlayer(state, 'late', detective).view).toEqual({ waiting: true });
  });

  it('brings a different person to each case, and deals the latecomer in at the next', () => {
    step(player('late'), { kind: 'join', name: 'late' }, T0 + 500);
    const first = secret().person;
    host({ cmd: 'revealNow' }, T0 + 5_000);
    host({ cmd: 'nextRound' }, T0 + 6_000);
    const second = secret().person;
    expect(second).not.toBe(first);
    expect(phoneView('late').clue).toMatch(/^Dealt evidence/);
  });
});

/** The same room with nobody's vote in yet, for comparing what the big screen shows. */
function createdFresh(): RoomState {
  const saved = state;
  started([['ann'], ['bo'], ['cy'], ['di']]);
  const fresh = state;
  state = saved;
  return fresh;
}

describe('teams', () => {
  beforeEach(() =>
    started(
      [
        ['r1', 'red'],
        ['b1', 'blue'],
        ['r2', 'red'],
        ['b2', 'blue'],
        ['r3', 'red'],
      ],
      { teamsEnabled: true }
    )
  );

  it('deal each team the whole case', () => {
    const red = ['r1', 'r2', 'r3'].map((playerId) => phoneView(playerId).clue);
    const blue = ['b1', 'b2'].map((playerId) => phoneView(playerId).clue);
    expect(new Set(red).size).toBe(3);
    expect(new Set(blue).size).toBe(2);
    // Seat order counts within a team, so each team's first phone holds the same clue.
    expect(blue[0]).toBe(red[0]);
  });

  it('decide on their own, and a team scores what its own majority chose', () => {
    vote('r1', right(), T0 + 1_000);
    vote('r2', right(), T0 + 1_100);
    vote('r3', wrong(), T0 + 1_200);
    vote('b1', wrong(), T0 + 1_300);
    vote('b2', wrong(), T0 + 1_400);
    timeRunsOut();

    expect(['r1', 'r2', 'r3'].map(scoreOf)).toEqual([POINTS, POINTS, POINTS]);
    expect(['b1', 'b2'].map(scoreOf)).toEqual([0, 0]);
    expect(projectPersonalResult(state, 'b1')?.note).toBe(`Your team chose ${secret().options[wrong()]}`);
    expect(projectReveal(state)?.groups?.map((group) => [group.teamId, group.correct])).toEqual([
      ['red', true],
      ['blue', false],
    ]);
  });

  it('score nobody on a team that tied, whatever the other team did', () => {
    vote('r1', right(), T0 + 1_000);
    vote('r2', right(), T0 + 1_100);
    vote('b1', right(), T0 + 1_300);
    vote('b2', wrong(), T0 + 1_400);
    timeRunsOut();

    expect(['r1', 'r2', 'r3'].map(scoreOf)).toEqual([POINTS, POINTS, POINTS]);
    expect(['b1', 'b2'].map(scoreOf)).toEqual([0, 0]);
    expect(projectPersonalResult(state, 'b1')?.note).toBe('Your team was split');
  });
});

describe('a server with no cases', () => {
  it('plays an honest empty round rather than failing in front of the group', () => {
    useContent(null);
    const empty = ContentLibrary.open({
      moduleDir: join(directory, 'modules'),
      contentPath: ':memory:',
      defaultTranslation: 'FIX',
    });
    useContent(empty);
    started([['ann'], ['bo']]);

    expect(projectForScreen(state, detective, true).view).toBeNull();
    expect(projectForPlayer(state, 'ann', detective).view).toBeNull();
    vote('ann', 0, T0 + 1_000);
    expect(state.answers).toEqual([]);
    host({ cmd: 'revealNow' }, T0 + 5_000);
    expect(projectReveal(state)?.detail).toBeNull();
    empty.close();
  });
});
