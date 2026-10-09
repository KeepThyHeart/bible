/**
 * Sword drill played through the room as it stands.
 *
 * The game module only builds and scores; everything between — who is in the
 * queue, whose "found it" counts, what a ruling does — belongs to the room. So
 * these drive the real reducer with this module plugged in, and assert only
 * what the game depends on: that tap order sets the queue, that the reader's
 * phone stops the clock, that a wrong reading passes the turn on, that a
 * confirmation passes it on too without ending the round, and that anyone the
 * host never ruled on leaves the round without a result.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { Actor, Intent } from '../../../../../src/modules/games/shared/protocol.js';
import { ContentLibrary, importContent, useContent } from '../../content/index.js';
import { makeTempDir, removeTempDir, writeFixtureModule } from '../../content/fixtures.js';
import { reduce } from '../../room/reducer.js';
import { createRoom } from '../../room/state.js';
import type { RoomState } from '../../room/state.js';
import { CONFIRMED_LABEL, MIN_SEARCH_MS, PASSED_NOTE, POINTS, swordDrill } from './index.js';
import type { SwordDrillReveal } from './index.js';

const T0 = 1_700_000_000_000;
const HOST: Actor = { role: 'owner' };
const SYSTEM: Actor = { role: 'system' };

function player(playerId: string): Actor {
  return { role: 'player', playerId };
}

let directory: string;
let library: ContentLibrary;
let previous: ContentLibrary | null;
let state: RoomState;

function step(actor: Actor, intent: Intent, at: number): void {
  state = reduce(state, { actor, intent, receivedAt: at }, swordDrill).state;
}

function buzz(playerId: string, pressedAt: number, arrivedAt: number): void {
  step(player(playerId), { kind: 'buzz', round: 0, charsSeen: 0, tClient: pressedAt }, arrivedAt);
}

function found(playerId: string, at: number): void {
  step(player(playerId), { kind: 'answer', round: 0, value: { type: 'found' } }, at);
}

function judge(verdict: 'correct' | 'incorrect', at: number): void {
  step(HOST, { kind: 'host', command: { cmd: 'judge', verdict } }, at);
}

/** Three phones in a room whose first round has just gone up. */
function started(): void {
  state = createRoom({
    code: 'QK7P',
    now: T0 - 10_000,
    seed: 11,
    settings: { gameId: 'sword-drill', translation: 'FIX', familiarity: 'core', rounds: 2 },
  });
  for (const [index, name] of ['anna', 'boaz', 'caleb'].entries()) {
    step(player(name), { kind: 'join', name }, T0 - 5_000 + index);
  }
  step(HOST, { kind: 'host', command: { cmd: 'start' } }, T0);
}

beforeEach(() => {
  directory = makeTempDir('sword-drill-flow-');
  writeFixtureModule(join(directory, 'modules', 'fixture.db'), { abbreviation: 'FIX' });
  library = ContentLibrary.open({
    moduleDir: join(directory, 'modules'),
    contentPath: ':memory:',
    defaultTranslation: 'FIX',
  });
  importContent(library.db, {
    verses: [
      { reference: 'John 3:16', difficulty: 1 },
      { reference: 'Genesis 1:1', difficulty: 1 },
    ],
  });
  previous = useContent(library);
  started();
});

afterEach(() => {
  useContent(previous);
  library.close();
  removeTempDir(directory);
});

describe('the search', () => {
  it('opens for taps the moment the reference goes up, with the search window running', () => {
    expect(state.phase).toBe('question');
    expect(state.buzz?.queue).toEqual([]);
    expect(state.phaseEndsAt).toBe(T0 + MIN_SEARCH_MS);
  });

  it('queues phones by when they were pressed rather than when the press arrived', () => {
    buzz('boaz', T0 + 5_000, T0 + 5_100);
    // Pressed earlier on a slower connection: it still reads first.
    buzz('anna', T0 + 4_000, T0 + 5_900);

    expect(state.buzz?.queue.map((entry) => entry.playerId)).toEqual(['anna', 'boaz']);
    expect(state.phase).toBe('answering');
  });
});

describe('reading aloud', () => {
  beforeEach(() => {
    buzz('anna', T0 + 4_000, T0 + 4_050);
    buzz('boaz', T0 + 5_000, T0 + 5_050);
  });

  it('counts "found it" only from the phone whose turn it is', () => {
    found('boaz', T0 + 5_200);

    expect(state.answers).toEqual([]);
  });

  it('stops the clock once the reader has said so, so the host can listen', () => {
    found('anna', T0 + 5_300);

    expect(state.judging?.playerId).toBe('anna');
    expect(state.phaseEndsAt).toBeNull();
  });

  it('passes a wrong reading to the next in line', () => {
    found('anna', T0 + 5_300);
    step(HOST, { kind: 'host', command: { cmd: 'judge', verdict: 'incorrect' } }, T0 + 9_000);

    expect(state.buzz?.queue.map((entry) => entry.playerId)).toEqual(['boaz']);
    expect(state.buzz?.spent).toEqual(['anna']);
  });
});

describe('the reveal', () => {
  it('leaves anyone the host never ruled on without a result, and names nobody', () => {
    buzz('anna', T0 + 4_000, T0 + 4_050);
    buzz('boaz', T0 + 5_000, T0 + 5_050);
    found('anna', T0 + 5_300);
    // The host reveals while the first reader is still mid-sentence.
    step(HOST, { kind: 'host', command: { cmd: 'revealNow' } }, T0 + 8_000);

    const outcome = state.lastOutcome;
    expect(state.phase).toBe('reveal');
    expect(outcome?.perPlayer.has('anna')).toBe(false);
    expect(outcome?.perPlayer.has('boaz')).toBe(false);
    expect(outcome?.perPlayer.has('caleb')).toBe(false);
    expect(outcome?.aggregates).toEqual([{ label: CONFIRMED_LABEL, count: 0 }]);
  });
});

describe('confirming down the queue', () => {
  beforeEach(() => {
    buzz('anna', T0 + 4_000, T0 + 4_050);
    buzz('boaz', T0 + 5_000, T0 + 5_050);
    found('anna', T0 + 5_300);
  });

  it('moves on to the next reader rather than ending the round', () => {
    judge('correct', T0 + 9_000);

    expect(state.phase).toBe('answering');
    expect(state.buzz?.queue.map((entry) => entry.playerId)).toEqual(['boaz']);
    expect(state.buzz?.confirmed).toEqual(['anna']);
    expect(state.answers.find((answer) => answer.playerId === 'anna')?.verdict).toBe('correct');
  });

  it('takes a second tap on Confirm as a double tap, not a ruling on a reader who has not spoken', () => {
    judge('correct', T0 + 9_000);
    judge('correct', T0 + 9_100);

    expect(state.buzz?.queue.map((entry) => entry.playerId)).toEqual(['boaz']);
    expect(state.buzz?.confirmed).toEqual(['anna']);
  });

  it('will not let a confirmed reader back into the queue', () => {
    judge('correct', T0 + 9_000);
    buzz('anna', T0 + 9_200, T0 + 9_250);

    expect(state.buzz?.queue.map((entry) => entry.playerId)).toEqual(['boaz']);
  });

  it('goes back to the search once the line is heard, with the time the host spent listening given back', () => {
    judge('correct', T0 + 9_000);
    found('boaz', T0 + 9_500);
    judge('correct', T0 + 12_000);

    expect(state.phase).toBe('question');
    expect(state.buzz?.queue).toEqual([]);
    // Frozen from the first tap's arrival until the last confirmation.
    expect(state.phaseEndsAt).toBe(T0 + MIN_SEARCH_MS + (12_000 - 4_050));

    // Someone still turning pages can find it and be heard.
    buzz('caleb', T0 + 20_000, T0 + 20_050);
    expect(state.phase).toBe('answering');
    expect(state.buzz?.queue.map((entry) => entry.playerId)).toEqual(['caleb']);
  });

  it('pays everyone confirmed when the search runs out, and names them in the order they read', () => {
    judge('correct', T0 + 9_000);
    found('boaz', T0 + 9_500);
    judge('correct', T0 + 12_000);
    step(SYSTEM, { kind: 'timer', round: 0, tag: 'questionEnd' }, state.phaseEndsAt ?? 0);

    const outcome = state.lastOutcome;
    expect(state.phase).toBe('reveal');
    expect(outcome?.perPlayer.get('anna')?.pointsAwarded).toBe(POINTS);
    expect(outcome?.perPlayer.get('boaz')?.pointsAwarded).toBe(POINTS);
    expect(outcome?.aggregates).toEqual([{ label: CONFIRMED_LABEL, count: 2 }]);
    expect((outcome?.detail as SwordDrillReveal).confirmed).toEqual(['anna', 'boaz']);
  });

  it('tells a reader the host passed on, privately, and nobody who was never reached', () => {
    judge('incorrect', T0 + 9_000);
    found('boaz', T0 + 9_500);
    judge('correct', T0 + 12_000);
    step(HOST, { kind: 'host', command: { cmd: 'revealNow' } }, T0 + 13_000);

    const outcome = state.lastOutcome;
    expect(outcome?.perPlayer.get('anna')?.note).toBe(PASSED_NOTE);
    expect(outcome?.perPlayer.get('boaz')?.correct).toBe(true);
    expect(outcome?.perPlayer.has('caleb')).toBe(false);
  });
});
