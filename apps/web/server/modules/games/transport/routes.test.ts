import { describe, expect, it } from 'vitest';
import { createTransport } from './routes.js';
import type { Transport, TransportRequest, TransportResponse } from './routes.js';
import { createStubRoomPort } from './stubRoomPort.js';
import type { StubState } from './stubRoomPort.js';
import type { Room } from './RoomRegistry.js';
import type {
  ClientSnapshot,
  CreateRoomResponse,
  HostCommand,
  Intent,
  JoinResponse,
  PlayerSnapshot,
  ServerEvent,
  ServerTime,
} from '../../../../src/modules/games/shared/protocol.js';
import type { Timers } from '../clock/index.js';

// ---------------------------------------------------------------------------
// Fake HTTP
// ---------------------------------------------------------------------------

interface FakeResponse extends TransportResponse {
  statusCode: number | null;
  body: unknown;
  headers: Map<string, string>;
  chunks: string[];
  ended: boolean;
  events(): ServerEvent[];
  /** True once anything specific to an event stream has gone out. */
  streaming(): boolean;
}

function fakeResponse(): FakeResponse {
  const response: FakeResponse = {
    statusCode: null,
    body: undefined,
    headers: new Map(),
    chunks: [],
    ended: false,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(body: unknown) {
      response.body = body;
    },
    setHeader(name: string, value: string) {
      response.headers.set(name, value);
    },
    write(chunk: string) {
      response.chunks.push(chunk);
      return true;
    },
    end() {
      response.ended = true;
    },
    flushHeaders() {
      /* nothing to flush into an array */
    },
    events() {
      return response.chunks
        .filter((chunk) => chunk.startsWith('data: '))
        .map((chunk) => JSON.parse(chunk.slice('data: '.length)) as ServerEvent);
    },
    streaming() {
      return response.headers.get('Content-Type') === 'text/event-stream';
    },
  };
  return response;
}

interface FakeRequest extends TransportRequest {
  /** Fires the listener the transport registered, as a dropped connection does. */
  drop(): void;
}

function fakeRequest(options: {
  code?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, unknown>;
}): FakeRequest {
  const closeListeners: (() => void)[] = [];
  return {
    params: options.code === undefined ? {} : { code: options.code },
    query: options.query ?? {},
    body: options.body,
    headers: options.headers ?? {},
    on(_event: 'close', listener: () => void) {
      closeListeners.push(listener);
    },
    drop() {
      for (const listener of [...closeListeners]) listener();
    },
  };
}

function manualTimers(): Timers {
  const pending = new Map<number, () => void>();
  let nextHandle = 1;
  return {
    set(run: () => void) {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, run);
      return handle;
    },
    clear(handle: unknown) {
      pending.delete(handle as number);
    },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  transport: Transport;
  port: ReturnType<typeof createStubRoomPort>;
  code: string;
  hostToken: string;
  room: Room;
  state(): StubState;
  setClock(at: ServerTime): void;
  post(body: unknown, token?: string): FakeResponse;
  join(name: string): JoinResponse;
  openStream(token?: string): { req: FakeRequest; res: FakeResponse };
}

function harness(): Harness {
  let clock = 1_000;
  const now = (): ServerTime => clock;
  const port = createStubRoomPort({ now });
  const transport = createTransport({
    port,
    now,
    // Heartbeats are the one thing here that would need real time to observe,
    // and every other test would then be racing them.
    heartbeatMs: 0,
    timers: manualTimers(),
  });

  const createRes = fakeResponse();
  transport.createRoom(fakeRequest({ body: {} }), createRes);
  const created = createRes.body as CreateRoomResponse;
  const room = transport.registry.get(created.code);
  if (room === undefined) throw new Error('the room was not created');

  function post(body: unknown, token?: string): FakeResponse {
    const res = fakeResponse();
    transport.intent(
      fakeRequest({
        code: created.code,
        body,
        ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
      }),
      res
    );
    return res;
  }

  return {
    transport,
    port,
    code: created.code,
    hostToken: created.ownerToken,
    room,
    state: () => port.asStub(room.state),
    setClock: (at) => {
      clock = at;
    },
    post,
    join(name: string): JoinResponse {
      const res = post({ kind: 'join', name });
      return res.body as JoinResponse;
    },
    openStream(token?: string) {
      const req = fakeRequest({
        code: created.code,
        ...(token === undefined ? {} : { query: { token } }),
      });
      const res = fakeResponse();
      transport.stream(req, res);
      return { req, res };
    },
  };
}

function firstEvent(res: FakeResponse): ServerEvent | undefined {
  return res.events()[0];
}

function snapshotFrom(event: ServerEvent | undefined): ClientSnapshot {
  if (event === undefined || event.type !== 'snapshot') throw new Error('not a snapshot');
  return event.snapshot;
}

function asPlayer(snapshot: ClientSnapshot): PlayerSnapshot {
  if (snapshot.viewer !== 'player') throw new Error('not a player snapshot');
  return snapshot;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('creating a room', () => {
  it('answers with the code to read out and the token to keep', () => {
    const { code, hostToken, transport } = harness();
    expect(transport.registry.get(code)).toBeDefined();
    expect(hostToken).not.toHaveLength(0);
    expect(code).not.toContain(hostToken);
  });

  it('takes only the settings it recognises', () => {
    const port = createStubRoomPort();
    const transport = createTransport({ port, timers: manualTimers() });
    const res = fakeResponse();

    transport.createRoom(
      fakeRequest({
        body: { settings: { rounds: 5, teamsEnabled: true, mischief: 'yes', solo: 'maybe' } },
      }),
      res
    );

    const room = transport.registry.get((res.body as CreateRoomResponse).code);
    // Read as a bag of keys on purpose: the point of the assertion is that a
    // field the settings type does not have is not there either.
    const settings = port.asStub(room?.state).settings as unknown as Record<string, unknown>;
    expect(res.statusCode).toBe(201);
    expect(settings.rounds).toBe(5);
    expect(settings.teamsEnabled).toBe(true);
    expect(settings.mischief).toBeUndefined();
    // A field of the wrong type is dropped rather than merged, so the default
    // stands.
    expect(settings.solo).toBe(false);
  });

  it('takes group voting as a room setting, and only as a yes or no', () => {
    const port = createStubRoomPort();
    const transport = createTransport({ port, timers: manualTimers() });
    const settingsFor = (groupVote: unknown): unknown => {
      const res = fakeResponse();
      transport.createRoom(fakeRequest({ body: { settings: { groupVote } } }), res);
      const room = transport.registry.get((res.body as CreateRoomResponse).code);
      return port.asStub(room?.state).settings.groupVote;
    };

    expect(settingsFor(true)).toBe(true);
    expect(settingsFor('yes')).toBe(false);
  });
});

describe('opening a stream', () => {
  it('answers an unknown room with an error instead of a stream', () => {
    const { transport } = harness();
    const res = fakeResponse();

    transport.stream(fakeRequest({ code: 'CDEFH' }), res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: 'roomNotFound',
      message: 'No room is using that code. Check the code on the big screen.',
    });
    // An `EventSource` retries a failed connection forever, so a stream opened
    // here would become a phone reconnecting to a dead code until its battery
    // ran out.
    expect(res.streaming()).toBe(false);
    expect(res.chunks).toHaveLength(0);
    expect(res.ended).toBe(false);
  });

  it('refuses a token that belongs to no session, without opening a stream', () => {
    const { transport, code } = harness();
    for (const token of [undefined, 'not-a-token', '']) {
      const res = fakeResponse();
      transport.stream(
        fakeRequest({ code, ...(token === undefined ? {} : { query: { token } }) }),
        res
      );
      expect(res.statusCode).toBe(401);
      expect(res.streaming()).toBe(false);
      expect(res.chunks).toHaveLength(0);
    }
  });

  it('opens with a snapshot for the host', () => {
    const { hostToken, openStream } = harness();
    const { res } = openStream(hostToken);

    expect(res.streaming()).toBe(true);
    const snapshot = snapshotFrom(firstEvent(res));
    expect(snapshot.viewer).toBe('screen');
  });

  it('opens with a snapshot of this player, not of the room in general', () => {
    const test = harness();
    const joined = test.join('Ann');
    const { res } = test.openStream(joined.sessionToken);

    const snapshot = asPlayer(snapshotFrom(firstEvent(res)));
    expect(snapshot.you.id).toBe(joined.playerId);
    expect(snapshot.you.name).toBe('Ann');
  });

  /**
   * The whole reconnection strategy: no replay buffer, no sequence number. A
   * phone that locked, changed towers and came back is correct from the first
   * message it receives.
   */
  it('opens with a snapshot again on a reconnect', () => {
    const test = harness();
    const joined = test.join('Ann');
    const first = test.openStream(joined.sessionToken);
    first.req.drop();

    const second = test.openStream(joined.sessionToken);

    expect(firstEvent(second.res)?.type).toBe('snapshot');
    expect(asPlayer(snapshotFrom(firstEvent(second.res))).you.id).toBe(joined.playerId);
    expect(asPlayer(snapshotFrom(firstEvent(second.res))).you.connected).toBe(true);
  });

  it('marks the player connected while the stream is up', () => {
    const test = harness();
    const joined = test.join('Ann');
    test.openStream(joined.sessionToken);

    expect(test.state().players[0]?.connected).toBe(true);
  });
});

describe('losing a stream', () => {
  it('drops the subscriber and shows the player as away', () => {
    const test = harness();
    const joined = test.join('Ann');
    const host = test.openStream(test.hostToken);
    const player = test.openStream(joined.sessionToken);

    player.req.drop();

    expect(test.room.subscribers.size).toBe(1);
    expect(player.res.ended).toBe(true);
    expect(test.state().players[0]?.connected).toBe(false);
    // A phone that locked has not left the room; the roster simply shows it as
    // away, and everyone else is told.
    const last = host.res.events().at(-1);
    expect(snapshotFrom(last).players[0]?.connected).toBe(false);
    expect(test.state().players).toHaveLength(1);
  });

  it('leaves the room usable after every stream has gone', () => {
    const test = harness();
    const joined = test.join('Ann');
    const stream = test.openStream(joined.sessionToken);
    stream.req.drop();

    const res = test.post({ kind: 'rejoin' }, joined.sessionToken);

    expect(res.statusCode).toBe(200);
    expect(test.room.subscribers.size).toBe(0);
  });
});

describe('joining', () => {
  it('issues a session on a first join', () => {
    const test = harness();
    const joined = test.join('Ann');

    expect(joined.playerId).toBeTruthy();
    expect(joined.sessionToken).toBeTruthy();
    expect(test.state().players).toHaveLength(1);
  });

  /**
   * A reload must be invisible to the rest of the group: no second copy of
   * somebody in the roster, and no lost score.
   */
  it('rejoins as the same player when a session token is presented', () => {
    const test = harness();
    const joined = test.join('Ann');

    const again = test.post({ kind: 'join', name: 'Ann' }, joined.sessionToken)
      .body as JoinResponse;
    const rejoined = test.post({ kind: 'rejoin' }, joined.sessionToken).body as JoinResponse;

    expect(again.playerId).toBe(joined.playerId);
    expect(rejoined.playerId).toBe(joined.playerId);
    expect(again.sessionToken).toBe(joined.sessionToken);
    expect(test.state().players).toHaveLength(1);
    expect(test.room.sessions).toHaveLength(1);
  });

  it('gives a second person their own player and token', () => {
    const test = harness();
    const ann = test.join('Ann');
    const ben = test.join('Ben');

    expect(ben.playerId).not.toBe(ann.playerId);
    expect(ben.sessionToken).not.toBe(ann.sessionToken);
    expect(test.state().players).toHaveLength(2);
  });

  it('tidies a name rather than rejecting it', () => {
    const test = harness();
    test.post({ kind: 'join', name: '  Grandma\n  Ellen ' });
    expect(test.state().players[0]?.name).toBe('Grandma Ellen');
  });

  it('refuses a join with no name at all', () => {
    const test = harness();
    const res = test.post({ kind: 'join', name: '   ' });
    expect(res.statusCode).toBe(400);
    expect(test.state().players).toHaveLength(0);
  });
});

describe('authenticating an intent', () => {
  it('refuses a room that does not exist', () => {
    const { transport } = harness();
    const res = fakeResponse();
    transport.intent(fakeRequest({ code: 'CDEFH', body: { kind: 'rejoin' } }), res);
    expect(res.statusCode).toBe(404);
  });

  it('refuses an intent with no token', () => {
    const test = harness();
    test.join('Ann');

    const res = test.post({ kind: 'setTeam', teamId: 'red' });

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: 'unauthorized',
      message: 'that intent requires a session token',
    });
  });

  it('refuses an intent with a token that is not a session', () => {
    const test = harness();
    const joined = test.join('Ann');

    const res = test.post({ kind: 'setTeam', teamId: 'red' }, `${joined.sessionToken}x`);

    expect(res.statusCode).toBe(401);
    expect(test.state().players[0]?.teamId).toBeNull();
  });

  it('accepts a host command from a player token, but a non-controller has no effect', () => {
    const test = harness();
    const joined = test.join('Ann');

    // A session token is a legitimate way to send a host command now — the
    // reducer decides whether that player actually controls the room (§5.1),
    // not this layer. Ann is not the controller, so `end` does nothing.
    const res = test.post(
      { kind: 'host', command: { cmd: 'end' } },
      joined.sessionToken
    );

    expect(res.statusCode).toBe(200);
    expect(test.transport.registry.get(test.code)).toBeDefined();
  });

  it('refuses a host command from a token that is neither the owner token nor a session in this room', () => {
    const test = harness();

    const res = test.post({ kind: 'host', command: { cmd: 'end' } }, 'not-a-real-token');

    expect(res.statusCode).toBe(401);
    expect(test.transport.registry.get(test.code)).toBeDefined();
  });

  it('accepts the host token as a bearer header or a body field', () => {
    const test = harness();

    const header = test.post({ kind: 'host', command: { cmd: 'pause' } }, test.hostToken);
    const field = test.post({
      intent: { kind: 'host', command: { cmd: 'resume' } },
      token: test.hostToken,
    });

    expect(header.statusCode).toBe(200);
    expect(field.statusCode).toBe(200);
    expect(test.state().paused).toBe(false);
  });

  /**
   * The one rule the whole HTTP surface exists to keep. A body that names an
   * actor is data, not a claim; the actor handed to the reducer comes from a
   * token this layer verified.
   */
  it('never takes the actor from the request body', () => {
    const test = harness();
    const ann = test.join('Ann');
    const ben = test.join('Ben');

    test.post(
      {
        kind: 'setTeam',
        teamId: 'red',
        actor: { role: 'host' },
        playerId: ben.playerId,
      },
      ann.sessionToken
    );

    const received = test.state().received;
    const last = received[received.length - 1];
    expect(last?.actor).toEqual({ role: 'player', playerId: ann.playerId });
    const annPlayer = test.state().players.find((player) => player.id === ann.playerId);
    const benPlayer = test.state().players.find((player) => player.id === ben.playerId);
    expect(annPlayer?.teamId).toBe('red');
    expect(benPlayer?.teamId).toBeNull();
  });

  it('never lets a player claim the owner role through a body field', () => {
    const test = harness();
    const ann = test.join('Ann');

    const res = test.post(
      { kind: 'host', command: { cmd: 'kick', playerId: ann.playerId }, actor: { role: 'owner' } },
      ann.sessionToken
    );

    // The body's claimed actor is data, never read (see this file's opening
    // comment); the real actor is Ann's own session, which does not control
    // the room, so the kick does nothing.
    expect(res.statusCode).toBe(200);
    expect(test.state().players).toHaveLength(1);
  });

  it('stops a kicked token working', () => {
    const test = harness();
    const ann = test.join('Ann');

    test.post({ kind: 'host', command: { cmd: 'kick', playerId: ann.playerId } }, test.hostToken);
    const after = test.post({ kind: 'rejoin' }, ann.sessionToken);

    expect(after.statusCode).toBe(401);
    expect(test.room.sessions).toHaveLength(0);
  });

  it('stops a token working once its player leaves', () => {
    const test = harness();
    const ann = test.join('Ann');

    test.post({ kind: 'leave' }, ann.sessionToken);
    const after = test.post({ kind: 'setTeam', teamId: 'red' }, ann.sessionToken);

    expect(after.statusCode).toBe(401);
    expect(test.state().players).toHaveLength(0);
  });
});

describe('validating an intent', () => {
  it('refuses anything that is not an intent', () => {
    const test = harness();
    for (const body of [undefined, 'a string', [1, 2, 3]]) {
      expect(test.post(body, test.hostToken).statusCode).toBe(400);
    }
    expect(test.post({ kind: 'mischief' }, test.hostToken).statusCode).toBe(400);
    expect(test.post({ kind: 'setTeam', teamId: 'purple' }, test.hostToken).statusCode).toBe(400);
  });

  /**
   * Both of these carry the system role and are produced inside the process.
   * Accepting either over HTTP would let anyone fire a reveal early, or hand
   * the host a verdict no provider ever suggested.
   */
  it('refuses the intents only the server may raise, host token or not', () => {
    const test = harness();

    const timer = test.post({ kind: 'timer', round: 0, tag: 'answerWindow' }, test.hostToken);
    const suggestion = test.post(
      {
        kind: 'judgeSuggestion',
        round: 0,
        playerId: 'p1',
        suggestion: { verdict: 'correct', reason: 'because' },
      },
      test.hostToken
    );

    expect(timer.statusCode).toBe(403);
    expect(suggestion.statusCode).toBe(403);
    expect(test.state().phase).toBe('lobby');
  });

  it('refuses a malformed host command', () => {
    const test = harness();
    expect(test.post({ kind: 'host', command: { cmd: 'judge' } }, test.hostToken).statusCode).toBe(
      400
    );
    expect(
      test.post({ kind: 'host', command: { cmd: 'adjust', playerId: 'p1' } }, test.hostToken)
        .statusCode
    ).toBe(400);
    expect(test.post({ kind: 'host', command: { cmd: 'kick' } }, test.hostToken).statusCode).toBe(
      400
    );
  });

  it('takes a host choice only as a short piece of text, leaving its meaning to the room', () => {
    const test = harness();
    const choose = (choice: unknown): number | null =>
      test.post({ kind: 'host', command: { cmd: 'choose', choice } }, test.hostToken).statusCode;

    expect(choose('1:2')).toBe(200);
    const received = test.state().received;
    expect(received[received.length - 1]?.intent).toEqual({
      kind: 'host',
      command: { cmd: 'choose', choice: '1:2' },
    });

    expect(choose('')).toBe(400);
    expect(choose(7)).toBe(400);
    expect(choose('x'.repeat(65))).toBe(400);
  });

  it('refuses an answer whose value it cannot read', () => {
    const test = harness();
    const ann = test.join('Ann');
    expect(
      test.post({ kind: 'answer', round: 0, value: { type: 'mischief' } }, ann.sessionToken)
        .statusCode
    ).toBe(400);
    expect(test.post({ kind: 'answer', value: { type: 'found' } }, ann.sessionToken).statusCode).toBe(
      400
    );
  });

  it('takes a card tap only with a known action and the number of the card it was about', () => {
    const test = harness();
    const ann = test.join('Ann');
    const tap = (value: unknown): number | null =>
      test.post({ kind: 'answer', round: 0, value }, ann.sessionToken).statusCode;

    expect(tap({ type: 'card', action: 'slip', card: 3 })).toBe(200);
    const received = test.state().received;
    expect(received[received.length - 1]?.intent).toEqual({
      kind: 'answer',
      round: 0,
      value: { type: 'card', action: 'slip', card: 3 },
    });

    expect(tap({ type: 'card', action: 'steal', card: 3 })).toBe(400);
    expect(tap({ type: 'card', action: 'got' })).toBe(400);
    expect(tap({ type: 'card', action: 'got', card: -1 })).toBe(400);
    expect(tap({ type: 'card', action: 'got', card: 1.5 })).toBe(400);
    expect(tap({ type: 'card', action: 'got', card: '2' })).toBe(400);
  });

  it('trims an answer to something a person could have typed', () => {
    const test = harness();
    const ann = test.join('Ann');

    test.post(
      { kind: 'answer', round: 0, value: { type: 'text', text: 'x'.repeat(5_000) } },
      ann.sessionToken
    );

    const received = test.state().received;
    const last = received[received.length - 1]?.intent as Extract<Intent, { kind: 'answer' }>;
    const value = last.value as { type: 'text'; text: string };
    expect(value.text.length).toBeLessThanOrEqual(240);
  });

  it('accepts newGame as an ordinary, argument-free host command', () => {
    const test = harness();
    expect(test.post({ kind: 'host', command: { cmd: 'newGame' } }, test.hostToken).statusCode).toBe(
      200
    );
    const received = test.state().received;
    expect(received[received.length - 1]?.intent).toEqual({
      kind: 'host',
      command: { cmd: 'newGame' },
    });
  });

  it('takes a theme only as valid 6-digit hex colours, one per token', () => {
    const test = harness();
    const setTheme = (theme: unknown): number | null =>
      test.post({ kind: 'host', command: { cmd: 'setSettings', settings: { theme } } }, test.hostToken)
        .statusCode;

    expect(
      setTheme({
        bg: '#101010',
        bgRaised: '#202020',
        bgSunken: '#000000',
        fg: '#ffffff',
        fgMuted: '#cccccc',
        border: '#333333',
        accent: '#4477ff',
        accentFg: '#ffffff',
        correct: '#00ff00',
        wrong: '#ff0000',
        warn: '#ffff00',
      })
    ).toBe(200);
    const lastSetSettings = (): Extract<HostCommand, { cmd: 'setSettings' }> =>
      (test.state().received[test.state().received.length - 1]?.intent as Extract<
        Intent,
        { kind: 'host' }
      >).command as Extract<HostCommand, { cmd: 'setSettings' }>;

    expect(lastSetSettings().settings.theme?.bg).toBe('#101010');

    // A malformed patch still parses to a whole, valid theme — every bad or
    // missing token falls back rather than sending a half-formed object on.
    setTheme({ bg: 'not-a-colour', accent: '#4477ff' });
    expect(lastSetSettings().settings.theme?.accent).toBe('#4477ff');
    expect(lastSetSettings().settings.theme?.bg).not.toBe('not-a-colour');

    // Omitting theme entirely leaves it out of the patch rather than resetting it.
    expect(
      test.post({ kind: 'host', command: { cmd: 'setSettings', settings: {} } }, test.hostToken)
        .statusCode
    ).toBe(200);
    expect(lastSetSettings().settings.theme).toBeUndefined();
  });
});

describe('a buzz', () => {
  /**
   * Correcting a buzz belongs to the room, because the room holds the bounds
   * that make a correction honest. This layer's job is to leave the timestamp
   * alone — correcting in both places would correct twice, and would leave the
   * room unable to tell a clamped buzz from one that needed no clamping.
   */
  it('reaches the reducer exactly as the phone reported it', () => {
    const test = harness();
    const ann = test.join('Ann');
    // The question was revealed a moment ago and the buzz has just arrived.
    test.state().revealAt = 1_000;
    test.setClock(1_500);

    test.post(
      {
        kind: 'buzz',
        round: 0,
        charsSeen: 12,
        tClient: 1_100,
        clock: { offsetMs: 200, rttMs: 40, spreadMs: 5 },
      },
      ann.sessionToken
    );

    const received = test.state().received;
    const last = received[received.length - 1]?.intent as Extract<Intent, { kind: 'buzz' }>;
    expect(last.kind).toBe('buzz');
    expect(last.tClient).toBe(1_100);
    expect(last.charsSeen).toBe(12);
  });

  /**
   * The smoothing is this layer's, the correction is the room's. What crosses
   * between them is one number per player, kept current in room state so that
   * the reducer stays a pure function of what it holds.
   */
  /** The shape the shell actually posts: the intent wrapped, the measurement beside it. */
  it('reads the measurement beside an intent that arrives wrapped', () => {
    const test = harness();
    const ann = test.join('Ann');
    test.setClock(1_500);

    test.post(
      {
        intent: { kind: 'buzz', round: 0, charsSeen: 0, tClient: 1_100 },
        clock: { offsetMs: 200, rttMs: 40, spreadMs: 5 },
      },
      ann.sessionToken
    );

    expect(test.room.clocks.clockFor(ann.playerId)?.offsetMs).toBe(200);
  });

  it('hands the room the offset it measured, alongside the buzz', () => {
    const test = harness();
    const ann = test.join('Ann');
    test.setClock(1_500);

    test.post(
      {
        kind: 'buzz',
        round: 0,
        charsSeen: 12,
        tClient: 1_100,
        clock: { offsetMs: 200, rttMs: 40, spreadMs: 5 },
      },
      ann.sessionToken
    );

    expect(test.state().clockOffsets[ann.playerId]).toBe(200);
  });

  it('hands over a measurement that arrives with a join', () => {
    const test = harness();
    const res = test.post({
      kind: 'join',
      name: 'Ann',
      clock: { offsetMs: -75, rttMs: 40, spreadMs: 5 },
    });
    const ann = res.body as JoinResponse;

    expect(test.state().clockOffsets[ann.playerId]).toBe(-75);
  });

  /**
   * A phone that reports once and then buzzes repeatedly is the normal case,
   * so the figure the room holds must survive a buzz that carries no
   * measurement of its own.
   */
  it('keeps the measurement for later buzzes', () => {
    const test = harness();
    const ann = test.join('Ann');
    test.setClock(1_500);

    test.post(
      {
        kind: 'buzz',
        round: 0,
        charsSeen: 1,
        tClient: 1_050,
        clock: { offsetMs: 200, rttMs: 40, spreadMs: 5 },
      },
      ann.sessionToken
    );
    test.post({ kind: 'buzz', round: 0, charsSeen: 9, tClient: 1_100 }, ann.sessionToken);

    expect(test.room.clocks.clockFor(ann.playerId)?.offsetMs).toBe(200);
    expect(test.state().clockOffsets[ann.playerId]).toBe(200);
  });

  /**
   * Successive reports from one phone differ mostly by measurement noise, so
   * most of the stored figure is kept and a fresh one nudges it. What the room
   * is given is the smoothed value, never the raw report.
   */
  it('smooths a second measurement rather than replacing it', () => {
    const test = harness();
    const ann = test.join('Ann');

    test.post(
      { kind: 'rejoin', clock: { offsetMs: 200, rttMs: 40, spreadMs: 5 } },
      ann.sessionToken
    );
    test.post(
      { kind: 'rejoin', clock: { offsetMs: 400, rttMs: 40, spreadMs: 5 } },
      ann.sessionToken
    );

    const handed = test.state().clockOffsets[ann.playerId];
    expect(handed).toBeGreaterThan(200);
    expect(handed).toBeLessThan(400);
    expect(handed).toBe(test.room.clocks.clockFor(ann.playerId)?.offsetMs);
  });

  it('cannot carry a measurement for somebody else', () => {
    const test = harness();
    const ann = test.join('Ann');
    const ben = test.join('Ben');
    test.state().revealAt = 1_000;
    test.setClock(1_500);

    test.post(
      {
        kind: 'buzz',
        round: 0,
        charsSeen: 0,
        tClient: 1_100,
        playerId: ben.playerId,
        clock: { offsetMs: 300, rttMs: 40, spreadMs: 5 },
      },
      ann.sessionToken
    );

    expect(test.room.clocks.clockFor(ann.playerId)?.offsetMs).toBe(300);
    expect(test.room.clocks.clockFor(ben.playerId)).toBeNull();
  });

  it('ignores a measurement that is not one', () => {
    const test = harness();
    const ann = test.join('Ann');

    test.post(
      { kind: 'rejoin', clock: { offsetMs: 200, rttMs: -1, spreadMs: 5 } },
      ann.sessionToken
    );
    test.post({ kind: 'rejoin', clock: { offsetMs: 'soon' } }, ann.sessionToken);

    expect(test.room.clocks.clockFor(ann.playerId)).toBeNull();
  });

  it('refuses a buzz that does not say when or how much was read', () => {
    const test = harness();
    const ann = test.join('Ann');
    expect(test.post({ kind: 'buzz', round: 0, charsSeen: 3 }, ann.sessionToken).statusCode).toBe(
      400
    );
    expect(
      test.post({ kind: 'buzz', round: 0, tClient: 1_000 }, ann.sessionToken).statusCode
    ).toBe(400);
  });
});

describe('a deadline the reducer asked for', () => {
  it('comes back as an intent carrying the system role', () => {
    let clock = 1_000;
    const port = createStubRoomPort({ now: () => clock });
    const timers: { run(): void } & Timers = (() => {
      const pending = new Map<number, () => void>();
      let nextHandle = 1;
      return {
        set(run: () => void) {
          const handle = nextHandle;
          nextHandle += 1;
          pending.set(handle, run);
          return handle;
        },
        clear(handle: unknown) {
          pending.delete(handle as number);
        },
        run() {
          for (const [handle, run] of [...pending]) {
            pending.delete(handle);
            run();
          }
        },
      };
    })();
    const transport = createTransport({ port, now: () => clock, heartbeatMs: 0, timers });
    const res = fakeResponse();
    transport.createRoom(fakeRequest({ body: {} }), res);
    const room = transport.registry.get((res.body as CreateRoomResponse).code);
    if (room === undefined) throw new Error('the room was not created');

    room.scheduler.schedule(2_000, 0, 'answerWindow');
    clock = 2_000;
    timers.run();

    const state = port.asStub(room.state);
    expect(state.received.at(-1)).toEqual({
      actor: { role: 'system' },
      intent: { kind: 'timer', round: 0, tag: 'answerWindow' },
      receivedAt: 2_000,
    });
    expect(state.phase).toBe('reveal');
  });
});

describe('mounting the transport', () => {
  it('claims the paths the protocol names', () => {
    const routes: string[] = [];
    const app = {
      get: (path: string) => routes.push(`GET ${path}`),
      post: (path: string) => routes.push(`POST ${path}`),
    };
    const transport = createTransport({ port: createStubRoomPort(), timers: manualTimers() });

    transport.register(app as never);
    transport.registry.stopSweeping();

    expect(routes).toEqual([
      'POST /api/games/rooms',
      'GET /api/games/rooms/:code/stream',
      'POST /api/games/rooms/:code/intent',
    ]);
  });

  it('strips the mount point when registered on a router mounted there', () => {
    const routes: string[] = [];
    const router = {
      get: (path: string) => routes.push(`GET ${path}`),
      post: (path: string) => routes.push(`POST ${path}`),
    };
    const transport = createTransport({ port: createStubRoomPort(), timers: manualTimers() });

    transport.register(router as never, '/api/games');
    transport.registry.stopSweeping();

    expect(routes).toEqual(['POST /rooms', 'GET /rooms/:code/stream', 'POST /rooms/:code/intent']);
  });
});
