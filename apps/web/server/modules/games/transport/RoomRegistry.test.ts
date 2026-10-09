import { describe, expect, it } from 'vitest';
import { RoomRegistry } from './RoomRegistry.js';
import type { Room } from './RoomRegistry.js';
import { createStubRoomPort } from './stubRoomPort.js';
import { ROOM_CODE_ALPHABET, hashToken } from './codes.js';
import type { Subscriber, SubscriberRole } from './EventStream.js';
import type { ServerEvent, ServerTime } from '../../../../src/modules/games/shared/protocol.js';
import type { TimerIntent, Timers } from '../clock/index.js';

/** A subscriber that records instead of writing to a socket. */
function recordingSubscriber(role: SubscriberRole = { kind: 'screen', owner: true }): Subscriber & {
  events: ServerEvent[];
} {
  const events: ServerEvent[] = [];
  let closed = false;
  return {
    role,
    events,
    get closed() {
      return closed;
    },
    send(event: ServerEvent) {
      events.push(event);
    },
    close() {
      closed = true;
    },
  };
}

/**
 * Timers a test drives by hand. Nothing here waits on real time: a deadline
 * fires because the test moved the clock and ran what was armed.
 */
function manualTimers(): Timers & { run(): void; armed(): number } {
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
    armed() {
      return pending.size;
    },
  };
}

interface Harness {
  registry: RoomRegistry;
  room: Room;
  hostToken: string;
  setClock(at: ServerTime): void;
  timers: ReturnType<typeof manualTimers>;
}

function harness(idleTimeoutMs = 1_000): Harness {
  let clock = 1_000;
  const timers = manualTimers();
  const registry = new RoomRegistry({
    port: createStubRoomPort({ now: () => clock }),
    idleTimeoutMs,
    now: () => clock,
    timers,
  });
  const created = registry.create({});
  return {
    registry,
    room: created.room,
    hostToken: created.ownerToken,
    setClock: (at) => {
      clock = at;
    },
    timers,
  };
}

describe('creating a room', () => {
  it('issues a readable code and a host token it does not keep', () => {
    const { room, hostToken } = harness();

    for (const character of room.code) expect(ROOM_CODE_ALPHABET).toContain(character);
    expect(room.ownerTokenHash).toBe(hashToken(hostToken));
    expect(room.ownerTokenHash).not.toContain(hostToken);
  });

  it('allocates a code no live room is using', () => {
    let clock = 0;
    const registry = new RoomRegistry({ port: createStubRoomPort(), now: () => clock });
    const codes = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      clock += 1;
      codes.add(registry.create({}).room.code);
    }
    expect(codes.size).toBe(50);
    expect(registry.size).toBe(50);
  });
});

describe('finding a room', () => {
  it('takes the code the way a phone keyboard produced it', () => {
    const { registry, room } = harness();
    expect(registry.get(room.code)).toBe(room);
    expect(registry.get(room.code.toLowerCase())).toBe(room);
    expect(registry.get(` ${room.code.slice(0, 2)}-${room.code.slice(2)} `)).toBe(room);
    expect(registry.has(room.code)).toBe(true);
  });

  it('misses on anything that is not a live code', () => {
    const { registry } = harness();
    expect(registry.get('C0DE2')).toBeUndefined();
    expect(registry.get(undefined)).toBeUndefined();
    expect(registry.get(12345)).toBeUndefined();
  });
});

describe('host authority', () => {
  it('recognises the issued token and nothing else', () => {
    const { registry, room, hostToken } = harness();
    expect(registry.isOwner(room, hostToken)).toBe(true);
    expect(registry.isOwner(room, `${hostToken}x`)).toBe(false);
    expect(registry.isOwner(room, '')).toBe(false);
    expect(registry.isOwner(room, undefined)).toBe(false);
  });
});

describe('sessions', () => {
  it('rejoins as the same player rather than making a second one', () => {
    const { registry, room } = harness();
    const created = registry.createSession(room);

    const found = registry.findSession(room, created.sessionToken);

    expect(found?.playerId).toBe(created.playerId);
    expect(room.sessions).toHaveLength(1);
  });

  it('keeps only the digest of a session token', () => {
    const { registry, room } = harness();
    const created = registry.createSession(room);
    expect(room.sessions[0]?.tokenHash).toBe(hashToken(created.sessionToken));
    expect(JSON.stringify(room.sessions)).not.toContain(created.sessionToken);
  });

  it('does not recognise a token from another room', () => {
    const { registry, room } = harness();
    const other = registry.create({}).room;
    const elsewhere = registry.createSession(other);

    expect(registry.findSession(room, elsewhere.sessionToken)).toBeUndefined();
    expect(registry.findSession(room, 'not-a-token')).toBeUndefined();
    expect(registry.findSession(room, undefined)).toBeUndefined();
  });

  it('records when a session was last seen', () => {
    const { registry, room, setClock } = harness();
    const created = registry.createSession(room);
    setClock(9_000);

    registry.findSession(room, created.sessionToken);

    expect(room.sessions[0]?.lastSeenAt).toBe(9_000);
  });

  it('stops a removed session working and forgets its clock', () => {
    const { registry, room } = harness();
    const created = registry.createSession(room);
    room.clocks.report(created.playerId, { offsetMs: 250, rttMs: 40, spreadMs: 5 }, 1_000);

    registry.removeSession(room, created.playerId);

    expect(registry.findSession(room, created.sessionToken)).toBeUndefined();
    expect(room.clocks.clockFor(created.playerId)).toBeNull();
  });
});

describe('room deadlines', () => {
  it('delivers a due deadline as an intent', () => {
    const { registry, room, timers, setClock } = harness();
    const fired: TimerIntent[] = [];
    registry.onTimer = (target, intent) => {
      expect(target).toBe(room);
      fired.push(intent);
    };

    room.scheduler.schedule(4_000, 2, 'answerWindow');
    timers.run();
    expect(fired).toHaveLength(0);

    setClock(4_000);
    timers.run();

    expect(fired).toEqual([{ kind: 'timer', round: 2, tag: 'answerWindow' }]);
  });

  it('cancels exactly the round that was cancelled', () => {
    const { registry, room } = harness();
    room.scheduler.schedule(9_000, 1, 'answerWindow');
    room.scheduler.schedule(9_000, 2, 'answerWindow');

    registry.cancelTimers(room, 1);

    expect(room.scheduler.pending()).toEqual([{ round: 2, tag: 'answerWindow', at: 9_000 }]);
  });

  it('leaves nothing armed when the room closes', () => {
    const { registry, room, timers } = harness();
    room.scheduler.schedule(9_000, 1, 'answerWindow');

    registry.close(room, 'done');

    expect(room.scheduler.pending()).toHaveLength(0);
    expect(timers.armed()).toBe(0);
  });
});

describe('closing a room', () => {
  it('says why before the socket goes away', () => {
    const { registry, room } = harness();
    const subscriber = recordingSubscriber();
    registry.subscribe(room, subscriber);

    registry.close(room, 'the host ended the game');

    // A stream that merely ends looks like a network drop, and the phone would
    // reconnect to a code that no longer exists.
    expect(subscriber.events).toEqual([
      { type: 'roomClosed', reason: 'the host ended the game' },
    ]);
    expect(subscriber.closed).toBe(true);
    expect(registry.get(room.code)).toBeUndefined();
    expect(room.sessions).toHaveLength(0);
  });

  it('closes once', () => {
    const { registry, room } = harness();
    const subscriber = recordingSubscriber();
    registry.subscribe(room, subscriber);

    registry.close(room, 'first');
    registry.close(room, 'second');

    expect(subscriber.events).toHaveLength(1);
  });
});

describe('sweeping idle rooms', () => {
  it('keeps a room with somebody connected however quiet it is', () => {
    const { registry, room, setClock } = harness(1_000);
    registry.subscribe(room, recordingSubscriber());
    setClock(1_000_000);

    expect(registry.sweep()).toHaveLength(0);
    expect(registry.get(room.code)).toBe(room);
  });

  it('closes a room nobody is connected to and nothing has happened in', () => {
    const { registry, room, setClock } = harness(1_000);
    setClock(1_500);
    expect(registry.sweep()).toHaveLength(0);

    setClock(3_000);

    expect(registry.sweep()).toEqual([room.code]);
    expect(registry.get(room.code)).toBeUndefined();
  });

  it('treats a subscriber arriving as activity', () => {
    const { registry, room, setClock } = harness(1_000);
    setClock(1_500);
    const subscriber = recordingSubscriber();
    registry.subscribe(room, subscriber);
    registry.unsubscribe(room, subscriber);
    setClock(2_400);

    expect(registry.sweep()).toHaveLength(0);
  });
});
