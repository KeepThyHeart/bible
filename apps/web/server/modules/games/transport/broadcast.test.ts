import { describe, expect, it } from 'vitest';
import { RoomRegistry } from './RoomRegistry.js';
import type { Room } from './RoomRegistry.js';
import { broadcast, dispatch, sendFullStandings, sendSnapshot } from './broadcast.js';
import type { TransportContext } from './broadcast.js';
import { createStubRoomPort } from './stubRoomPort.js';
import type { Subscriber, SubscriberRole } from './EventStream.js';
import type { RoomState } from './roomPort.js';
import type {
  ClientSnapshot,
  Effect,
  PlayerSnapshot,
  RoomCode,
  ServerEvent,
} from '../../../../src/modules/games/shared/protocol.js';
import type { Timers } from '../clock/index.js';

interface Recorder extends Subscriber {
  events: ServerEvent[];
}

function recordingSubscriber(role: SubscriberRole): Recorder {
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

function snapshotsOf(recorder: Recorder): ClientSnapshot[] {
  return recorder.events
    .filter((event): event is Extract<ServerEvent, { type: 'snapshot' }> => {
      return event.type === 'snapshot';
    })
    .map((event) => event.snapshot);
}

function lastPlayerSnapshot(recorder: Recorder): PlayerSnapshot {
  const snapshots = snapshotsOf(recorder);
  const last = snapshots[snapshots.length - 1];
  if (last === undefined || last.viewer !== 'player') throw new Error('no player snapshot');
  return last;
}

interface Harness {
  context: TransportContext;
  room: Room;
  registry: RoomRegistry;
  persisted: { code: RoomCode; state: RoomState }[];
  judged: { round: number; playerId: string }[];
  join(playerId: string, name: string): void;
}

function harness(effectsFor?: (addressed: { intent: { kind: string } }) => Effect[]): Harness {
  const now = (): number => 1_000;
  const port = createStubRoomPort({
    now,
    ...(effectsFor === undefined ? {} : { effectsFor }),
  });
  const registry = new RoomRegistry({ port, now, timers: manualTimers() });
  const persisted: { code: RoomCode; state: RoomState }[] = [];
  const judged: { round: number; playerId: string }[] = [];
  const context: TransportContext = {
    port,
    registry,
    handlers: {
      persist: (code, state) => persisted.push({ code, state }),
      requestJudge: (_code, round, playerId) => judged.push({ round, playerId }),
    },
    now,
  };
  registry.onTimer = (room, intent) => {
    dispatch(context, room, { actor: { role: 'system' }, intent, receivedAt: now() });
  };
  const room = registry.create({}).room;
  return {
    context,
    room,
    registry,
    persisted,
    judged,
    join: (playerId, name) => {
      dispatch(context, room, {
        actor: { role: 'player', playerId },
        intent: { kind: 'join', name },
        receivedAt: now(),
      });
    },
  };
}

describe('projecting to subscribers', () => {
  /**
   * The governing rule of the design: a player's own score reaches only that
   * player's socket, and the big screen is trimmed on the server. A single
   * rendered payload written to everyone is exactly how that guarantee is lost,
   * so each subscriber is projected separately.
   */
  it('gives every subscriber its own payload rather than one shared one', () => {
    const { context, room, join } = harness();
    join('p1', 'Ann');
    join('p2', 'Ben');
    dispatch(context, room, {
      actor: { role: 'owner' },
      intent: { kind: 'host', command: { cmd: 'adjust', playerId: 'p1', delta: 7 } },
      receivedAt: 1_000,
    });

    const ann = recordingSubscriber({ kind: 'player', playerId: 'p1' });
    const ben = recordingSubscriber({ kind: 'player', playerId: 'p2' });
    const host = recordingSubscriber({ kind: 'screen', owner: true });
    for (const subscriber of [ann, ben, host]) room.subscribers.add(subscriber);

    broadcast(context, room);

    const annSnapshot = lastPlayerSnapshot(ann);
    const benSnapshot = lastPlayerSnapshot(ben);
    expect(annSnapshot.you.id).toBe('p1');
    expect(annSnapshot.yourScore).toBe(7);
    expect(benSnapshot.you.id).toBe('p2');
    expect(benSnapshot.yourScore).toBe(0);
    expect(annSnapshot).not.toBe(benSnapshot);
  });

  it("never sends a player anybody else's score", () => {
    const { context, room, join } = harness();
    join('p1', 'Ann');
    join('p2', 'Ben');
    dispatch(context, room, {
      actor: { role: 'owner' },
      intent: { kind: 'host', command: { cmd: 'adjust', playerId: 'p2', delta: 31 } },
      receivedAt: 1_000,
    });

    const ann = recordingSubscriber({ kind: 'player', playerId: 'p1' });
    room.subscribers.add(ann);
    broadcast(context, room);

    const payload = JSON.stringify(lastPlayerSnapshot(ann));
    expect(payload).not.toContain('31');
    expect(payload).not.toContain('standings');
  });

  it('sends the host the trimmed standings, not the ordering', () => {
    const { context, room, join } = harness();
    for (const [id, name] of [
      ['p1', 'Ann'],
      ['p2', 'Ben'],
      ['p3', 'Cai'],
      ['p4', 'Dot'],
    ] as const) {
      join(id, name);
    }

    const host = recordingSubscriber({ kind: 'screen', owner: true });
    room.subscribers.add(host);
    broadcast(context, room);

    const snapshot = snapshotsOf(host)[0];
    if (snapshot === undefined || snapshot.viewer !== 'screen') throw new Error('no host snapshot');
    expect(snapshot.players).toHaveLength(4);
    // The big screen physically cannot render a last place: the data for it was
    // never assembled.
    expect(snapshot.standings).toHaveLength(3);
  });

  it('tells a player who is no longer in the room, then closes and drops them', () => {
    const { context, room, join } = harness();
    join('p1', 'Ann');
    const ann = recordingSubscriber({ kind: 'player', playerId: 'p1' });
    room.subscribers.add(ann);

    dispatch(context, room, {
      actor: { role: 'owner' },
      intent: { kind: 'host', command: { cmd: 'kick', playerId: 'p1' } },
      receivedAt: 1_000,
    });

    expect(ann.events.at(-1)).toEqual({
      type: 'kicked',
      reason: 'You are no longer in this room.',
    });
    expect(ann.closed).toBe(true);
    expect(room.subscribers.has(ann)).toBe(false);
  });

  it('drops a subscriber whose stream has already gone', () => {
    const { context, room, join } = harness();
    join('p1', 'Ann');
    const ann = recordingSubscriber({ kind: 'player', playerId: 'p1' });
    ann.close();
    room.subscribers.add(ann);

    broadcast(context, room);

    expect(room.subscribers.size).toBe(0);
    expect(ann.events).toHaveLength(0);
  });

  it('sends nothing once the room is closed', () => {
    const { context, room, registry } = harness();
    const host = recordingSubscriber({ kind: 'screen', owner: true });
    room.subscribers.add(host);
    registry.close(room, 'done');
    const before = host.events.length;

    broadcast(context, room);

    expect(host.events).toHaveLength(before);
  });
});

describe('the full leaderboard', () => {
  it('reaches the host who asked and nobody else', () => {
    const { context, room, join } = harness();
    join('p1', 'Ann');
    const host = recordingSubscriber({ kind: 'screen', owner: true });
    const ann = recordingSubscriber({ kind: 'player', playerId: 'p1' });
    room.subscribers.add(host);
    room.subscribers.add(ann);

    dispatch(context, room, {
      actor: { role: 'owner' },
      intent: { kind: 'host', command: { cmd: 'requestFullStandings' } },
      receivedAt: 1_000,
    });

    expect(host.events.some((event) => event.type === 'standingsFull')).toBe(true);
    expect(ann.events.some((event) => event.type === 'standingsFull')).toBe(false);
  });

  it('is a one-off rather than part of steady state', () => {
    const { context, room, join } = harness();
    join('p1', 'Ann');
    const host = recordingSubscriber({ kind: 'screen', owner: true });
    room.subscribers.add(host);

    broadcast(context, room);
    sendSnapshot(context, room, host);

    expect(host.events.every((event) => event.type === 'snapshot')).toBe(true);
  });

  it('says nothing when the room offers no full ordering', () => {
    const { context, room } = harness();
    const port = { ...context.port };
    delete port.standingsFull;
    const host = recordingSubscriber({ kind: 'screen', owner: true });
    room.subscribers.add(host);

    sendFullStandings({ ...context, port }, room);

    expect(host.events).toHaveLength(0);
  });
});

describe('revealing a round', () => {
  /** Poses an outcome so that the reveal path has something to project. */
  function scoreRound(room: Room, port: ReturnType<typeof createStubRoomPort>): void {
    const state = port.asStub(room.state);
    state.reveal = {
      round: 0,
      correctLabel: 'Naomi',
      aggregates: [{ label: 'Naomi', count: 1 }],
      detail: null,
    };
    state.results['p1'] = { correct: true, pointsAwarded: 10, submitted: null, note: null };
    state.results['p2'] = { correct: false, pointsAwarded: 0, submitted: null, note: null };
  }

  function revealsOf(recorder: Recorder): Extract<ServerEvent, { type: 'reveal' }>[] {
    return recorder.events.filter(
      (event): event is Extract<ServerEvent, { type: 'reveal' }> => event.type === 'reveal'
    );
  }

  function revealHarness(): {
    ann: Recorder;
    ben: Recorder;
    host: Recorder;
    fire(): void;
  } {
    const { context, room, join } = harness((addressed) => {
      return addressed.intent.kind === 'host' ? [{ type: 'reveal', round: 0 }] : [];
    });
    const port = context.port as ReturnType<typeof createStubRoomPort>;
    join('p1', 'Ann');
    join('p2', 'Ben');
    scoreRound(room, port);

    const ann = recordingSubscriber({ kind: 'player', playerId: 'p1' });
    const ben = recordingSubscriber({ kind: 'player', playerId: 'p2' });
    const host = recordingSubscriber({ kind: 'screen', owner: true });
    for (const subscriber of [ann, ben, host]) room.subscribers.add(subscriber);

    return {
      ann,
      ben,
      host,
      fire: () => {
        dispatch(context, room, {
          actor: { role: 'owner' },
          intent: { kind: 'host', command: { cmd: 'revealNow' } },
          receivedAt: 1_000,
        });
      },
    };
  }

  it('sends the public payload to everyone', () => {
    const { ann, ben, host, fire } = revealHarness();
    fire();

    for (const recorder of [ann, ben, host]) {
      const reveals = revealsOf(recorder);
      expect(reveals).toHaveLength(1);
      expect(reveals[0]?.reveal.correctLabel).toBe('Naomi');
    }
  });

  /**
   * The half that has to be addressed. A result names whether one person got it
   * wrong, so it reaches that person's socket and no other — the same rule the
   * snapshots follow, enforced the same way.
   */
  it("sends each player their own result and nobody else's", () => {
    const { ann, ben, host, fire } = revealHarness();
    fire();

    expect(revealsOf(ann)[0]?.yourResult?.correct).toBe(true);
    expect(revealsOf(ben)[0]?.yourResult?.correct).toBe(false);
    // The big screen is told what the answer was, never who missed it.
    expect(revealsOf(host)[0]?.yourResult).toBeNull();
  });

  /**
   * A phone must never be handed a result for a phase it does not know it is
   * in, or it renders a score over a question that is still on screen.
   */
  it('follows the snapshot that announces the phase', () => {
    const { ann, fire } = revealHarness();
    fire();

    const types = ann.events.map((event) => event.type);
    expect(types.indexOf('reveal')).toBeGreaterThan(types.lastIndexOf('snapshot'));
  });

  it('says nothing when the round produced no outcome', () => {
    const { context, room, join } = harness((addressed) => {
      return addressed.intent.kind === 'host' ? [{ type: 'reveal', round: 0 }] : [];
    });
    join('p1', 'Ann');
    const ann = recordingSubscriber({ kind: 'player', playerId: 'p1' });
    room.subscribers.add(ann);

    dispatch(context, room, {
      actor: { role: 'owner' },
      intent: { kind: 'host', command: { cmd: 'revealNow' } },
      receivedAt: 1_000,
    });

    expect(ann.events.every((event) => event.type === 'snapshot')).toBe(true);
  });
});

describe('performing the effects a reduction asked for', () => {
  it('arms a deadline the reducer asked for, and fires it back as an intent', () => {
    const { context, room, registry } = harness((addressed) => {
      return addressed.intent.kind === 'join'
        ? [{ type: 'timer', at: 5_000, round: 0, tag: 'answerWindow' }]
        : [];
    });

    dispatch(context, room, {
      actor: { role: 'player', playerId: 'p1' },
      intent: { kind: 'join', name: 'Ann' },
      receivedAt: 1_000,
    });

    expect(room.scheduler.pending()).toEqual([{ round: 0, tag: 'answerWindow', at: 5_000 }]);
    expect(registry.onTimer).not.toBeNull();
  });

  it("cancels a round's deadlines", () => {
    const { context, room } = harness((addressed) => {
      return addressed.intent.kind === 'leave' ? [{ type: 'cancelTimers', round: 3 }] : [];
    });
    room.scheduler.schedule(9_000, 3, 'answerWindow');

    dispatch(context, room, {
      actor: { role: 'player', playerId: 'p1' },
      intent: { kind: 'leave' },
      receivedAt: 1_000,
    });

    expect(room.scheduler.pending()).toHaveLength(0);
  });

  it('hands persistence and judging to the handlers that own them', () => {
    const { context, room, persisted, judged } = harness((addressed) => {
      return addressed.intent.kind === 'join'
        ? [{ type: 'persist' }, { type: 'requestJudge', round: 2, playerId: 'p1' }]
        : [];
    });

    dispatch(context, room, {
      actor: { role: 'player', playerId: 'p1' },
      intent: { kind: 'join', name: 'Ann' },
      receivedAt: 1_000,
    });

    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.code).toBe(room.code);
    expect(judged).toEqual([{ round: 2, playerId: 'p1' }]);
  });

  it('closes the room when the reducer says the game ended', () => {
    const { context, room, registry } = harness((addressed) => {
      return addressed.intent.kind === 'host' ? [{ type: 'closeRoom' }] : [];
    });
    const host = recordingSubscriber({ kind: 'screen', owner: true });
    room.subscribers.add(host);

    dispatch(context, room, {
      actor: { role: 'owner' },
      intent: { kind: 'host', command: { cmd: 'end' } },
      receivedAt: 1_000,
    });

    expect(room.closed).toBe(true);
    expect(registry.get(room.code)).toBeUndefined();
    expect(host.events.at(-1)).toEqual({
      type: 'roomClosed',
      reason: 'the host ended the game',
    });
  });

  it('arms the deadline before the snapshot that advertises it goes out', () => {
    const armedWhenSent: number[] = [];
    const { context, room } = harness((addressed) => {
      return addressed.intent.kind === 'join'
        ? [{ type: 'timer', at: 5_000, round: 0, tag: 'answerWindow' }]
        : [];
    });
    const host = recordingSubscriber({ kind: 'screen', owner: true });
    const watching: Subscriber = {
      role: host.role,
      get closed() {
        return host.closed;
      },
      send(event) {
        armedWhenSent.push(room.scheduler.pending().length);
        host.send(event);
      },
      close() {
        host.close();
      },
    };
    room.subscribers.add(watching);

    dispatch(context, room, {
      actor: { role: 'player', playerId: 'p1' },
      intent: { kind: 'join', name: 'Ann' },
      receivedAt: 1_000,
    });

    expect(armedWhenSent).toEqual([1]);
  });
});
