import { describe, expect, it } from 'vitest';
import { createRoomPort } from '../room/port.js';
import { createTransport } from './routes.js';
import type { Transport, TransportRequest, TransportResponse } from './routes.js';
import { CodeOpenLimiter } from './CodeOpenLimiter.js';
import type { Room } from './RoomRegistry.js';
import type { GameModule, Round, RoundOutcome } from '../../../../src/modules/games/shared/games.js';
import type {
  ClientSnapshot,
  CreateRoomResponse,
  Intent,
  JoinResponse,
  ServerEvent,
  ServerTime,
} from '../../../../src/modules/games/shared/protocol.js';
import type { Timers } from '../clock/index.js';

// ---------------------------------------------------------------------------
// A game and a transport over the real room
// ---------------------------------------------------------------------------

const ANSWER = 'naomi';

const game: GameModule = {
  id: 'echo',
  name: 'Echo',
  supportsSolo: true,
  usesBuzz: false,
  buildRound(_context, index): Round<string> {
    return { index, secret: ANSWER, hostView: { prompt: 'who?', answer: ANSWER }, playerView: { prompt: 'who?' } };
  },
  scoreRound(): RoundOutcome {
    return { perPlayer: new Map(), aggregates: [], correctLabel: ANSWER, detail: null };
  },
  answerPreview(): string | null {
    return `preview:${ANSWER}`;
  },
};

interface FakeResponse extends TransportResponse {
  statusCode: number | null;
  body: unknown;
  chunks: string[];
  headers: Map<string, string>;
  events(): ServerEvent[];
  streaming(): boolean;
}

function fakeResponse(): FakeResponse {
  const response: FakeResponse = {
    statusCode: null,
    body: undefined,
    chunks: [],
    headers: new Map(),
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
      /* nothing to close */
    },
    flushHeaders() {
      /* nothing to flush */
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
  drop(): void;
}

function fakeRequest(options: {
  code?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, unknown>;
  ip?: string;
}): FakeRequest {
  const closeListeners: (() => void)[] = [];
  return {
    ip: options.ip,
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

const manualTimers = (): Timers => ({ set: () => 0, clear: () => undefined });

interface Harness {
  transport: Transport;
  room: Room;
  code: string;
  ownerToken: string;
  displayToken: string;
  setClock(at: ServerTime): void;
  post(intent: Intent, token: string): FakeResponse;
  join(name: string): JoinResponse;
  open(query: Record<string, unknown>, ip?: string): { req: FakeRequest; res: FakeResponse };
  fireControlRequestExpiry(playerId: string): void;
}

function harness(limit?: number): Harness {
  let clock = 1_000;
  const now = (): ServerTime => clock;
  const transport = createTransport({
    port: createRoomPort(() => game),
    now,
    heartbeatMs: 0,
    timers: manualTimers(),
    codeOpenLimiter: new CodeOpenLimiter({ now, ...(limit === undefined ? {} : { limit }) }),
  });
  const created = fakeResponse();
  transport.createRoom(fakeRequest({ body: { settings: { rounds: 3 } } }), created);
  const { code, ownerToken, displayToken } = created.body as CreateRoomResponse;
  const room = transport.registry.get(code);
  if (room === undefined) throw new Error('the room was not created');

  function post(intent: Intent, token: string): FakeResponse {
    const res = fakeResponse();
    transport.intent(fakeRequest({ code, body: intent, headers: { authorization: `Bearer ${token}` } }), res);
    return res;
  }

  return {
    transport,
    room,
    code,
    ownerToken,
    displayToken,
    setClock: (at) => {
      clock = at;
    },
    post,
    join: (name) => {
      const res = fakeResponse();
      transport.intent(fakeRequest({ code, body: { kind: 'join', name } }), res);
      return res.body as JoinResponse;
    },
    open(query, ip) {
      const req = fakeRequest({ code, query, ...(ip === undefined ? {} : { ip }) });
      const res = fakeResponse();
      transport.stream(req, res);
      return { req, res };
    },
    // The scheduler would deliver this when the 45 seconds ran out.
    fireControlRequestExpiry(playerId) {
      transport.registry.onTimer?.(room, { kind: 'timer', round: -2, tag: playerId });
    },
  };
}

function lastSnapshot(res: FakeResponse): ClientSnapshot {
  const event = res.events().filter((candidate) => candidate.type === 'snapshot').at(-1);
  if (event === undefined || event.type !== 'snapshot') throw new Error('no snapshot was sent');
  return event.snapshot;
}

function startRound(test: Harness): void {
  test.post({ kind: 'host', command: { cmd: 'start' } }, test.ownerToken);
  test.post({ kind: 'host', command: { cmd: 'nextRound' } }, test.ownerToken);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('the remote stream', () => {
  it('is opened by the owner token with as=remote, and receives a remote snapshot with the answer', () => {
    const test = harness();
    test.join('Ann');
    const remote = test.open({ token: test.ownerToken, as: 'remote' });
    startRound(test);

    expect(remote.res.streaming()).toBe(true);
    const snapshot = lastSnapshot(remote.res);
    expect(snapshot.viewer).toBe('remote');
    if (snapshot.viewer !== 'remote') return;
    expect(snapshot.phase).toBe('answering');
    expect(snapshot.control?.answer).toBe(`preview:${ANSWER}`);
  });

  it('is sent a snapshot on every change, as a screen is', () => {
    const test = harness();
    const remote = test.open({ token: test.ownerToken, as: 'remote' });
    const before = remote.res.events().length;
    test.join('Ann');
    test.join('Bea');
    expect(remote.res.events().length).toBeGreaterThanOrEqual(before + 2);
    expect(lastSnapshot(remote.res).players).toHaveLength(2);
  });

  it('refuses as=remote for any token that is not the owner token', () => {
    const test = harness();
    const ann = test.join('Ann');
    for (const token of [test.displayToken, ann.sessionToken, 'not-a-token']) {
      const { res } = test.open({ token, as: 'remote' });
      expect(res.statusCode).toBe(401);
      expect(res.streaming()).toBe(false);
    }
    const noToken = test.open({ as: 'remote' });
    expect(noToken.res.statusCode).toBe(401);
    expect(noToken.res.streaming()).toBe(false);
  });

  it('leaves the owner token without as=remote as the owner screen', () => {
    const test = harness();
    const { res } = test.open({ token: test.ownerToken });
    expect(lastSnapshot(res).viewer).toBe('screen');
  });

  it('never sends the answer to the owner screen, a display screen or a code-only screen', () => {
    const test = harness();
    test.join('Ann');
    const ownerScreen = test.open({ token: test.ownerToken });
    const displayScreen = test.open({ token: test.displayToken });
    const codeOnly = test.open({});
    const remote = test.open({ token: test.ownerToken, as: 'remote' });
    startRound(test);

    expect(JSON.stringify(lastSnapshot(remote.res))).toContain('preview:');
    for (const stream of [ownerScreen, displayScreen, codeOnly]) {
      expect(JSON.stringify(lastSnapshot(stream.res))).not.toContain('preview:');
    }
  });
});

describe('who counts as a screen', () => {
  it('does not treat a remote as a screen: phones keep the question', () => {
    const test = harness();
    const ann = test.join('Ann');
    const player = test.open({ token: ann.sessionToken });
    const remote = test.open({ token: test.ownerToken, as: 'remote' });

    const snapshot = lastSnapshot(player.res);
    expect(snapshot.questionOnScreen).toBe(false);
    expect(lastSnapshot(remote.res).questionOnScreen).toBe(false);
  });

  it('puts the question on the screen when an owner screen, a display screen or a code-only screen is open', () => {
    for (const query of [(t: Harness) => ({ token: t.ownerToken }), (t: Harness) => ({ token: t.displayToken }), () => ({})]) {
      const test = harness();
      const ann = test.join('Ann');
      const player = test.open({ token: ann.sessionToken });
      test.open(query(test));
      expect(lastSnapshot(player.res).questionOnScreen).toBe(true);
    }
  });

  it('goes back to phones-only when the last screen closes, with a remote still open', () => {
    const test = harness();
    const ann = test.join('Ann');
    const player = test.open({ token: ann.sessionToken });
    test.open({ token: test.ownerToken, as: 'remote' });
    const screen = test.open({});
    expect(lastSnapshot(player.res).questionOnScreen).toBe(true);
    screen.req.drop();
    expect(lastSnapshot(player.res).questionOnScreen).toBe(false);
  });
});

describe('the owner credential being attended', () => {
  function askForControl(test: Harness): string {
    const ann = test.join('Ann');
    test.post({ kind: 'requestControl' }, ann.sessionToken);
    return ann.playerId;
  }

  function controllerOf(test: Harness): ClientSnapshot['controller'] {
    return lastSnapshot(test.open({}).res).controller;
  }

  it('keeps control with the owner while a remote is open, even if only display screens are otherwise there', () => {
    const test = harness();
    test.open({ token: test.displayToken });
    test.open({ token: test.ownerToken, as: 'remote' });
    const playerId = askForControl(test);

    test.fireControlRequestExpiry(playerId);

    expect(controllerOf(test)).toEqual({ kind: 'owner' });
  });

  it('keeps control with the owner while an owner screen is open and no remote is', () => {
    const test = harness();
    test.open({ token: test.ownerToken });
    const playerId = askForControl(test);

    test.fireControlRequestExpiry(playerId);

    expect(controllerOf(test)).toEqual({ kind: 'owner' });
  });

  it('hands control to a waiting request when only display screens are open', () => {
    const test = harness();
    test.open({ token: test.displayToken });
    test.open({});
    const playerId = askForControl(test);

    test.fireControlRequestExpiry(playerId);

    expect(controllerOf(test)).toEqual({ kind: 'player', playerId });
  });

  it('hands control over once the remote goes to sleep and drops', () => {
    const test = harness();
    test.open({});
    const remote = test.open({ token: test.ownerToken, as: 'remote' });
    const playerId = askForControl(test);
    remote.req.drop();

    test.fireControlRequestExpiry(playerId);

    expect(controllerOf(test)).toEqual({ kind: 'player', playerId });
  });

  it('counts the owner as attended again when the remote reconnects', () => {
    const test = harness();
    const first = test.open({ token: test.ownerToken, as: 'remote' });
    const playerId = askForControl(test);
    first.req.drop();
    test.open({ token: test.ownerToken, as: 'remote' });

    test.fireControlRequestExpiry(playerId);

    expect(controllerOf(test)).toEqual({ kind: 'owner' });
  });
});

describe('a screen opened by the room code alone', () => {
  it('is a display-only screen: no control block, no pending judgement, no answer', () => {
    const test = harness();
    test.join('Ann');
    const codeOnly = test.open({});
    startRound(test);

    expect(codeOnly.res.streaming()).toBe(true);
    const snapshot = lastSnapshot(codeOnly.res);
    expect(snapshot.viewer).toBe('screen');
    const wire = JSON.stringify(snapshot);
    expect(wire).not.toContain('"control"');
    expect(wire).not.toContain('pendingJudge');
    expect(wire).not.toContain('preview:');
  });

  it('sees exactly what a display-token screen sees', () => {
    const test = harness();
    test.join('Ann');
    const codeOnly = test.open({});
    const displayToken = test.open({ token: test.displayToken });
    expect(lastSnapshot(codeOnly.res)).toEqual(lastSnapshot(displayToken.res));
  });

  it('answers an unknown room the way a wrong token is answered', () => {
    const test = harness();
    const wrong = test.open({ token: 'not-a-token' });
    const res = fakeResponse();
    test.transport.stream({ ...fakeRequest({ code: 'ZZZZZ' }) }, res);

    expect(res.statusCode).toBe(wrong.res.statusCode);
    expect(res.body).toEqual(wrong.res.body);
    expect(res.streaming()).toBe(false);
  });

  it('answers a closed room the same way', () => {
    const test = harness();
    test.transport.registry.close(test.room, 'finished');
    const { res } = test.open({});
    expect(res.statusCode).toBe(401);
    expect(res.streaming()).toBe(false);
  });

  it('is limited per client address, and another address is unaffected', () => {
    const test = harness(3);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(test.open({}, '203.0.113.9').res.streaming()).toBe(true);
    }
    const refused = test.open({}, '203.0.113.9');
    expect(refused.res.statusCode).toBe(429);
    expect(refused.res.streaming()).toBe(false);
    expect(Number(refused.res.headers.get('Retry-After'))).toBeGreaterThan(0);

    expect(test.open({}, '203.0.113.10').res.streaming()).toBe(true);
  });

  it('lets the same address in again once the window has passed', () => {
    const test = harness(1);
    expect(test.open({}, '203.0.113.9').res.streaming()).toBe(true);
    expect(test.open({}, '203.0.113.9').res.statusCode).toBe(429);
    test.setClock(1_000 + 60_000);
    expect(test.open({}, '203.0.113.9').res.streaming()).toBe(true);
  });

  it('does not charge a client for opening with a credential', () => {
    const test = harness(1);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(test.open({ token: test.displayToken }, '203.0.113.9').res.streaming()).toBe(true);
    }
    expect(test.open({}, '203.0.113.9').res.streaming()).toBe(true);
  });
});
