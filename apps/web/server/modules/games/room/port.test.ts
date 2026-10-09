/**
 * The room layer and the delivery layer, joined.
 *
 * Everything else about these two is tested in isolation — the reducer against
 * intents, the transport against a stub. This file exists for the properties
 * that only appear once they are wired together: that a buzz is corrected
 * exactly once and the flag saying so survives all the way to a socket, that a
 * reveal reaches each phone with only its own result, and that a room can be
 * created, joined and rendered without a game module existing.
 */

import { describe, expect, it } from 'vitest';
import { createRoomPort } from './port.js';
import { createTransport } from '../transport/routes.js';
import type { Transport, TransportRequest, TransportResponse } from '../transport/routes.js';
import type { Timers } from '../clock/index.js';
import type { GameModule, Round, RoundOutcome, ScoredAnswer } from '../../../../src/modules/games/shared/games.js';
import type {
  CreateRoomResponse,
  JoinResponse,
  PersonalResult,
  PlayerId,
  PlayerSnapshot,
  ScreenSnapshot,
  ServerEvent,
  ServerTime,
} from '../../../../src/modules/games/shared/protocol.js';

// ---------------------------------------------------------------------------
// Fake HTTP
// ---------------------------------------------------------------------------

interface FakeResponse extends TransportResponse {
  statusCode: number | null;
  body: unknown;
  chunks: string[];
  events(): ServerEvent[];
}

function fakeResponse(): FakeResponse {
  const response: FakeResponse = {
    statusCode: null,
    body: undefined,
    chunks: [],
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(body: unknown) {
      response.body = body;
    },
    setHeader() {
      /* headers are not what this file is about */
    },
    write(chunk: string) {
      response.chunks.push(chunk);
      return true;
    },
    end() {
      /* nothing to tear down */
    },
    flushHeaders() {
      /* nothing to flush into an array */
    },
    events() {
      return response.chunks
        .filter((chunk) => chunk.startsWith('data: '))
        .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as ServerEvent);
    },
  };
  return response;
}

/**
 * A stream's request, with its 'close' listener captured rather than
 * discarded, so a test can simulate the connection actually dropping —
 * a screen going to sleep, a phone losing signal — without waiting on
 * anything real.
 */
function fakeStreamRequest(options: {
  code?: string;
  query?: Record<string, unknown>;
}): { req: TransportRequest; disconnect(): void } {
  let onClose: (() => void) | null = null;
  const req: TransportRequest = {
    params: options.code === undefined ? {} : { code: options.code },
    query: options.query ?? {},
    body: undefined,
    headers: {},
    on(event, listener) {
      if (event === 'close') onClose = listener;
    },
  };
  return { req, disconnect: () => onClose?.() };
}

function fakeRequest(options: {
  code?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, unknown>;
}): TransportRequest {
  return {
    params: options.code === undefined ? {} : { code: options.code },
    query: options.query ?? {},
    body: options.body,
    headers: options.headers ?? {},
    on() {
      /* nothing here ever drops a connection */
    },
  };
}

/** Deadlines are held rather than run: no test in this project may sleep. */
function manualTimers(): Timers {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    set(run: () => void) {
      const handle = next;
      next += 1;
      pending.set(handle, run);
      return handle;
    },
    clear(handle: unknown) {
      pending.delete(handle as number);
    },
  };
}

// ---------------------------------------------------------------------------
// A stand-in game
// ---------------------------------------------------------------------------

interface EchoSecret {
  answer: string;
  judge: { question: string; canonicalAnswer: string; accept: string[]; contextNote: null };
}

const QUESTION = 'Who was the mother-in-law of Ruth?';

function echoGame(usesBuzz: boolean): GameModule {
  return {
    id: 'echo',
    name: 'Echo',
    supportsSolo: true,
    usesBuzz,
    buildRound(_context, index: number): Round<EchoSecret> {
      const answer = `answer-${index}`;
      return {
        index,
        secret: {
          answer,
          judge: { question: QUESTION, canonicalAnswer: answer, accept: [answer], contextNote: null },
        },
        hostView: { prompt: QUESTION, answer },
        playerView: { prompt: QUESTION },
        questionPhaseMs: 30_000,
      };
    },
    scoreRound(round: Round<EchoSecret>, answers: ScoredAnswer[]): RoundOutcome {
      const perPlayer = new Map<PlayerId, PersonalResult>();
      let correct = 0;
      for (const submitted of answers) {
        const right =
          submitted.value.type === 'text' && submitted.value.text === round.secret.answer;
        if (right) correct += 1;
        perPlayer.set(submitted.playerId, {
          correct: right,
          pointsAwarded: right ? 10 : 0,
          submitted: submitted.value,
          note: null,
        });
      }
      return {
        perPlayer,
        aggregates: [{ label: round.secret.answer, count: correct }],
        correctLabel: round.secret.answer,
        detail: null,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  transport: Transport;
  code: string;
  hostToken: string;
  displayToken: string;
  at(time: ServerTime): void;
  post(body: unknown, token?: string): FakeResponse;
  join(name: string, token?: string): JoinResponse;
  stream(token: string): FakeResponse & { disconnect(): void };
}

function harness(game: GameModule = echoGame(false)): Harness {
  let clock = 1_000;
  const transport = createTransport({
    port: createRoomPort(() => game),
    now: () => clock,
    // A heartbeat is the one thing here that would need real time to observe.
    heartbeatMs: 0,
    timers: manualTimers(),
  });

  const created = fakeResponse();
  transport.createRoom(fakeRequest({ body: { settings: { rounds: 2 } } }), created);
  const room = created.body as CreateRoomResponse;

  function post(body: unknown, token?: string): FakeResponse {
    const res = fakeResponse();
    transport.intent(
      fakeRequest({
        code: room.code,
        body,
        ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
      }),
      res
    );
    return res;
  }

  return {
    transport,
    code: room.code,
    hostToken: room.ownerToken,
    displayToken: room.displayToken,
    at: (time) => {
      clock = time;
    },
    post,
    join(name: string, token?: string): JoinResponse {
      return post({ kind: 'join', name }, token).body as JoinResponse;
    },
    stream(token: string): FakeResponse & { disconnect(): void } {
      const res = fakeResponse();
      const { req, disconnect } = fakeStreamRequest({ code: room.code, query: { token } });
      transport.stream(req, res);
      return Object.assign(res, { disconnect });
    },
  };
}

function snapshots(res: FakeResponse): PlayerSnapshot[] {
  const found: PlayerSnapshot[] = [];
  for (const event of res.events()) {
    if (event.type === 'snapshot' && event.snapshot.viewer === 'player') found.push(event.snapshot);
  }
  return found;
}

function lastSnapshot(res: FakeResponse): PlayerSnapshot {
  const all = snapshots(res);
  const last = all[all.length - 1];
  if (last === undefined) throw new Error('no player snapshot arrived');
  return last;
}

function screenSnapshots(res: FakeResponse): ScreenSnapshot[] {
  const found: ScreenSnapshot[] = [];
  for (const event of res.events()) {
    if (event.type === 'snapshot' && event.snapshot.viewer === 'screen') found.push(event.snapshot);
  }
  return found;
}

function lastScreenSnapshot(res: FakeResponse): ScreenSnapshot {
  const all = screenSnapshots(res);
  const last = all[all.length - 1];
  if (last === undefined) throw new Error('no screen snapshot arrived');
  return last;
}

function reveals(res: FakeResponse): Extract<ServerEvent, { type: 'reveal' }>[] {
  return res
    .events()
    .filter((event): event is Extract<ServerEvent, { type: 'reveal' }> => event.type === 'reveal');
}

// ---------------------------------------------------------------------------

describe('a lobby, end to end', () => {
  it('opens a stream with a full snapshot of the room', () => {
    const test = harness();
    const ann = test.join('Ann');
    const stream = test.stream(ann.sessionToken);

    const snapshot = lastSnapshot(stream);
    expect(snapshot.code).toBe(test.code);
    expect(snapshot.phase).toBe('lobby');
    expect(snapshot.you.name).toBe('Ann');
    expect(snapshot.players.map((player) => player.name)).toEqual(['Ann']);
  });

  it('shows an arriving player to everyone already watching', () => {
    const test = harness();
    const ann = test.join('Ann');
    const stream = test.stream(ann.sessionToken);

    test.join('Ben');

    expect(lastSnapshot(stream).players.map((player) => player.name)).toEqual(['Ann', 'Ben']);
  });

  /**
   * The projection the room offers synthesises an empty viewer for a player it
   * does not have. That is right for a projection and wrong for a socket, so
   * the port turns it into null and the transport closes the stream.
   */
  it('closes the stream of a player the room no longer has', () => {
    const test = harness();
    const ann = test.join('Ann');
    const stream = test.stream(ann.sessionToken);

    test.post({ kind: 'host', command: { cmd: 'kick', playerId: ann.playerId } }, test.hostToken);

    expect(stream.events().at(-1)).toEqual({
      type: 'kicked',
      reason: 'You are no longer in this room.',
    });
  });
});

/**
 * Once a `HostCommand` can be refused by the reducer for failing the
 * controller check, a dispatched `kick` is not necessarily an applied one —
 * this is what `Effect.removeSession` (row 4 of the design) exists to get
 * right: the transport removes a session exactly when, and only when, the
 * reducer actually removed the player, rather than inferring it from the
 * command it forwarded.
 */
describe('control and session removal', () => {
  it('refuses a kick from a non-controller and leaves the session intact', () => {
    const test = harness();
    const ann = test.join('Ann');
    const bob = test.join('Bob');
    // Hand control to Bob — the owner token is no longer the controller.
    test.post({ kind: 'host', command: { cmd: 'grantControl', playerId: bob.playerId } }, test.hostToken);

    // The HTTP layer still accepts the owner token for a host command; the
    // reducer is what refuses it, silently, the same as any other refusal.
    const res = test.post(
      { kind: 'host', command: { cmd: 'kick', playerId: ann.playerId } },
      test.hostToken
    );
    expect(res.statusCode).toBe(200);

    // Ann's session still works: nobody applied the kick.
    const still = test.post({ kind: 'rejoin' }, ann.sessionToken);
    expect(still.statusCode).toBe(200);
  });

  it('destroys the session of a player kicked by the controller', () => {
    const test = harness();
    const ann = test.join('Ann');
    // The owner is the controller by default here — nobody has been granted
    // control away from it.
    test.post({ kind: 'host', command: { cmd: 'kick', playerId: ann.playerId } }, test.hostToken);

    const after = test.post({ kind: 'rejoin' }, ann.sessionToken);
    expect(after.statusCode).toBe(401);
  });

  it('destroys the session of a player who leaves on their own', () => {
    const test = harness();
    const ann = test.join('Ann');
    test.post({ kind: 'leave' }, ann.sessionToken);

    const after = test.post({ kind: 'rejoin' }, ann.sessionToken);
    expect(after.statusCode).toBe(401);
  });
});

describe('screen credentials and presence', () => {
  it('a display token opens a stream and gets no control', () => {
    const test = harness();
    test.join('Ann');

    const display = test.stream(test.displayToken);
    expect(lastScreenSnapshot(display).viewer).toBe('screen');
    expect(lastScreenSnapshot(display).control).toBeUndefined();

    // The owner still holds control throughout; a display screen never gets
    // it, whatever else is true of the room.
    const owner = test.stream(test.hostToken);
    expect(lastScreenSnapshot(owner).control).not.toBeUndefined();
    expect(lastScreenSnapshot(display).control).toBeUndefined();
  });

  it("a session token's grantControl is refused unless that session controls", () => {
    const test = harness();
    const ann = test.join('Ann');
    const bob = test.join('Bob');

    // Ann does not control the room (the owner does, by default), so her
    // own session's grantControl does nothing.
    test.post(
      { kind: 'host', command: { cmd: 'grantControl', playerId: bob.playerId } },
      ann.sessionToken
    );
    expect(lastSnapshot(test.stream(bob.sessionToken)).control).toBeUndefined();

    // Hand control to Ann for real, with the owner token; now her session's
    // own grant works.
    test.post(
      { kind: 'host', command: { cmd: 'grantControl', playerId: ann.playerId } },
      test.hostToken
    );
    test.post(
      { kind: 'host', command: { cmd: 'grantControl', playerId: bob.playerId } },
      ann.sessionToken
    );
    expect(lastSnapshot(test.stream(bob.sessionToken)).control).not.toBeUndefined();
  });

  it('questionOnScreen flips as a screen connects and disconnects', () => {
    const test = harness();
    const ann = test.join('Ann');
    const player = test.stream(ann.sessionToken);
    expect(lastSnapshot(player).questionOnScreen).toBe(false);

    const screen = test.stream(test.hostToken);
    expect(lastSnapshot(player).questionOnScreen).toBe(true);

    screen.disconnect();
    expect(lastSnapshot(player).questionOnScreen).toBe(false);
  });

  it('stays true while any screen remains, even after one of several disconnects', () => {
    const test = harness();
    const ann = test.join('Ann');
    const player = test.stream(ann.sessionToken);

    const owner = test.stream(test.hostToken);
    const display = test.stream(test.displayToken);
    expect(lastSnapshot(player).questionOnScreen).toBe(true);

    owner.disconnect();
    expect(lastSnapshot(player).questionOnScreen).toBe(true);

    display.disconnect();
    expect(lastSnapshot(player).questionOnScreen).toBe(false);
  });
});

describe('a buzz that had to be clamped', () => {
  /**
   * The one property that the split between these layers can quietly destroy.
   * Correct in both places and the room only ever sees a value already inside
   * its own bounds, so nothing is ever flagged and a phone with a broken clock
   * decides rounds in silence.
   */
  it('is flagged all the way to the player who buzzed', () => {
    const test = harness(echoGame(true));
    const ann = test.join('Ann');
    const stream = test.stream(ann.sessionToken);
    test.at(2_000);
    test.post({ kind: 'host', command: { cmd: 'start' } }, test.hostToken);

    test.at(2_500);
    // A timestamp from before the question existed. It cannot honestly have
    // happened, so it is pulled to the reveal instant and marked.
    test.post({ kind: 'buzz', round: 0, charsSeen: 4, tClient: 1 }, ann.sessionToken);

    const buzz = lastSnapshot(stream).buzz;
    expect(buzz?.queue).toHaveLength(1);
    expect(buzz?.queue[0]?.correctedAt).toBe(2_000);
    expect(buzz?.queue[0]?.clamped).toBe(true);
  });

  it('is not flagged when the measured offset lands it inside the window', () => {
    const test = harness(echoGame(true));
    const ann = test.join('Ann');
    const stream = test.stream(ann.sessionToken);
    test.at(2_000);
    test.post({ kind: 'host', command: { cmd: 'start' } }, test.hostToken);

    test.at(2_500);
    // Ann's phone is a second behind. Her buzz reads as 1_200 to her and as
    // 2_200 to the room, which is where it really happened.
    test.post(
      {
        kind: 'buzz',
        round: 0,
        charsSeen: 4,
        tClient: 1_200,
        clock: { offsetMs: 1_000, rttMs: 30, spreadMs: 5 },
      },
      ann.sessionToken
    );

    const buzz = lastSnapshot(stream).buzz;
    expect(buzz?.queue[0]?.correctedAt).toBe(2_200);
    expect(buzz?.queue[0]?.clamped).toBe(false);
  });
});

describe('a reveal', () => {
  function playedRound(): { test: Harness; ann: FakeResponse; ben: FakeResponse } {
    const test = harness(echoGame(true));
    const ann = test.join('Ann');
    const ben = test.join('Ben');
    const annStream = test.stream(ann.sessionToken);
    const benStream = test.stream(ben.sessionToken);

    test.at(2_000);
    test.post({ kind: 'host', command: { cmd: 'start' } }, test.hostToken);
    test.at(2_500);
    test.post({ kind: 'buzz', round: 0, charsSeen: 4, tClient: 2_400 }, ann.sessionToken);
    test.at(2_600);
    test.post(
      { kind: 'answer', round: 0, value: { type: 'text', text: 'answer-0' } },
      ann.sessionToken
    );
    test.at(2_700);
    test.post({ kind: 'host', command: { cmd: 'judge', verdict: 'correct' } }, test.hostToken);

    return { test, ann: annStream, ben: benStream };
  }

  it('carries the answer to the whole room', () => {
    const { ann, ben } = playedRound();
    expect(reveals(ann)[0]?.reveal.correctLabel).toBe('answer-0');
    expect(reveals(ben)[0]?.reveal.correctLabel).toBe('answer-0');
  });

  it('carries a personal result only to the phone it belongs to', () => {
    const { ann, ben } = playedRound();
    expect(reveals(ann)[0]?.yourResult).toEqual({
      correct: true,
      pointsAwarded: 10,
      submitted: { type: 'text', text: 'answer-0' },
      note: null,
    });
    // Ben never answered, so there is nothing about him to send — and nothing
    // about Ann reaches him either.
    expect(reveals(ben)[0]?.yourResult).toBeNull();
    expect(JSON.stringify(reveals(ben)[0])).not.toContain('pointsAwarded');
  });

  it('reaches a phone after the snapshot that says the round is over', () => {
    const { ann } = playedRound();
    const types = ann.events().map((event) => event.type);
    expect(types.indexOf('reveal')).toBeGreaterThan(types.lastIndexOf('snapshot'));
    expect(lastSnapshot(ann).phase).toBe('reveal');
  });
});

describe('a view computed for each phone', () => {
  /** Names the viewer it was computed for, so a leak is a string search. */
  const mirror: GameModule = {
    id: 'mirror',
    name: 'Mirror',
    supportsSolo: false,
    buildRound: (_context, index: number): Round => ({
      index,
      secret: null,
      hostView: null,
      playerView: null,
    }),
    viewFor: (_round, table, viewer) => ({
      mine: `view-of-${viewer ?? 'the-host'}`,
      seated: table.seats.length,
    }),
    scoreRound: () => ({ perPlayer: new Map(), aggregates: [], correctLabel: '', detail: null }),
  };

  it('travels to its own phone and nowhere else, all the way through the transport', () => {
    const test = harness(mirror);
    const ann = test.join('Ann');
    const ben = test.join('Ben');
    const annStream = test.stream(ann.sessionToken);
    const benStream = test.stream(ben.sessionToken);
    const hostStream = test.stream(test.hostToken);
    test.post({ kind: 'host', command: { cmd: 'start' } }, test.hostToken);

    expect(lastSnapshot(annStream).view).toEqual({ mine: `view-of-${ann.playerId}`, seated: 2 });
    expect(lastSnapshot(benStream).view).toEqual({ mine: `view-of-${ben.playerId}`, seated: 2 });
    expect(JSON.stringify(annStream.events())).not.toContain(`view-of-${ben.playerId}`);
    expect(JSON.stringify(benStream.events())).not.toContain(`view-of-${ann.playerId}`);

    const big = JSON.stringify(hostStream.events());
    expect(big).toContain('view-of-the-host');
    expect(big).not.toContain(`view-of-${ann.playerId}`);
    expect(big).not.toContain(`view-of-${ben.playerId}`);
  });
});
