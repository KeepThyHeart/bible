/**
 * The live rooms of one server process.
 *
 * A room lives in exactly one process and is never sharded: its state, its
 * subscribers and its pending timers are all one object in one map. That is a
 * deliberate ceiling — a room is a dozen people in a building for an hour —
 * and it buys the thing the whole design rests on, which is that a round's
 * ordering is decided by one machine with one clock.
 */

import { config } from '../config.js';
import { OffsetTracker, Scheduler } from '../clock/index.js';
import type { TimerIntent, Timers } from '../clock/index.js';
import {
  allocateRoomCode,
  generatePlayerId,
  generateSessionToken,
  generateHostToken,
  generateDisplayToken,
  hashToken,
  hashesEqual,
  normaliseRoomCode,
  verifyToken,
} from './codes.js';
import type { Subscriber } from './EventStream.js';
import type { RoomPort, RoomState } from './roomPort.js';
import type {
  HostToken,
  PlayerId,
  RoomCode,
  RoomSettings,
  ServerTime,
  SessionToken,
} from '../../../../src/modules/games/shared/protocol.js';

/**
 * A player's claim on an identity. Only the hash is held: a copy of this
 * structure, in a log or a persisted file, must not let anyone answer as
 * somebody else.
 */
export interface SessionRecord {
  playerId: PlayerId;
  tokenHash: string;
  createdAt: ServerTime;
  lastSeenAt: ServerTime;
}

export interface Room {
  code: RoomCode;
  state: RoomState;
  ownerTokenHash: string;
  /**
   * Opens a screen stream and nothing else. Minted alongside the owner token
   * at creation, and never displayed to the room — see `HostToken`'s own doc
   * comment in the protocol.
   */
  displayTokenHash: string;
  sessions: SessionRecord[];
  subscribers: Set<Subscriber>;
  /** The room's deadlines. Timer effects are handed here and come back as intents. */
  scheduler: Scheduler;
  /**
   * How far each of this room's phones sits from the server's clock. It is
   * held per room rather than globally because it dies with the room, and
   * because a player id only means anything inside one.
   */
  clocks: OffsetTracker;
  createdAt: ServerTime;
  lastActivityAt: ServerTime;
  closed: boolean;
}

export interface RoomRegistryOptions {
  port: RoomPort;
  idleTimeoutMs?: number;
  now?: () => ServerTime;
  /** Injected so a test can drive every room deadline without waiting on one. */
  timers?: Timers;
}

export interface CreatedRoom {
  room: Room;
  /** Returned once, at creation, and never stored in the clear. */
  ownerToken: HostToken;
  /** Returned once, at creation, and never stored in the clear. */
  displayToken: string;
}

export interface CreatedSession {
  playerId: PlayerId;
  sessionToken: SessionToken;
}

export class RoomRegistry {
  /**
   * Where a fired deadline goes. It is assigned after construction because the
   * thing that runs an intent needs the registry to exist first, and a timer
   * cannot fire before a room has been created anyway.
   */
  onTimer: ((room: Room, intent: TimerIntent) => void) | null = null;

  private readonly rooms = new Map<RoomCode, Room>();
  private readonly port: RoomPort;
  private readonly idleTimeoutMs: number;
  private readonly now: () => ServerTime;
  private readonly timers: Timers | null;
  private sweeper: NodeJS.Timeout | null = null;

  constructor(options: RoomRegistryOptions) {
    this.port = options.port;
    this.idleTimeoutMs = options.idleTimeoutMs ?? config.roomIdleTimeoutMs;
    this.now = options.now ?? Date.now;
    this.timers = options.timers ?? null;
  }

  create(settings: Partial<RoomSettings>): CreatedRoom {
    const createdAt = this.now();
    const code = allocateRoomCode((candidate) => this.rooms.has(candidate));
    const ownerToken = generateHostToken();
    const displayToken = generateDisplayToken();
    // A fired deadline finds its room by code rather than closing over the
    // object, which also settles what a timer that outlived its room should do:
    // the lookup misses and nothing is delivered.
    const scheduler = new Scheduler(
      (intent) => {
        const target = this.rooms.get(code);
        if (target !== undefined) this.onTimer?.(target, intent);
      },
      {
        now: this.now,
        ...(this.timers === null ? {} : { timers: this.timers }),
      }
    );
    const room: Room = {
      code,
      state: this.port.createState({ code, settings, createdAt }),
      ownerTokenHash: hashToken(ownerToken),
      displayTokenHash: hashToken(displayToken),
      sessions: [],
      subscribers: new Set(),
      scheduler,
      clocks: new OffsetTracker(),
      createdAt,
      lastActivityAt: createdAt,
      closed: false,
    };
    this.rooms.set(code, room);
    return { room, ownerToken, displayToken };
  }

  /**
   * Lookup normalises first, so a code typed in lowercase with a stray hyphen
   * finds its room and a code containing a glyph the alphabet excludes is a
   * miss rather than a scan of every room.
   */
  get(rawCode: unknown): Room | undefined {
    const code = normaliseRoomCode(rawCode);
    if (code === null) return undefined;
    return this.rooms.get(code);
  }

  has(rawCode: unknown): boolean {
    return this.get(rawCode) !== undefined;
  }

  get size(): number {
    return this.rooms.size;
  }

  touch(room: Room): void {
    room.lastActivityAt = this.now();
  }

  isOwner(room: Room, token: unknown): boolean {
    return verifyToken(token, room.ownerTokenHash);
  }

  isDisplay(room: Room, token: unknown): boolean {
    return verifyToken(token, room.displayTokenHash);
  }

  /**
   * Whether at least one screen is connected, and whether one of them is the
   * owner-credentialled one — read from the subscribers actually connected
   * right now, so it is always current rather than tracked separately and
   * liable to drift from it.
   */
  screenPresence(room: Room): { anyScreen: boolean; ownerScreen: boolean } {
    let anyScreen = false;
    let ownerScreen = false;
    for (const subscriber of room.subscribers) {
      if (subscriber.role.kind !== 'screen') continue;
      anyScreen = true;
      if (subscriber.role.owner) ownerScreen = true;
    }
    return { anyScreen, ownerScreen };
  }

  /**
   * Presenting a session token rejoins as the same player instead of creating
   * a second one, which is what makes a reload invisible to the rest of the
   * room: no duplicate name in the roster, no lost score.
   *
   * The search compares every session rather than looking the digest up in a
   * map, and does not stop at the first match. A room holds a handful of
   * people, so the cost is nothing, and it keeps every token check on the one
   * constant-time path.
   */
  findSession(room: Room, token: unknown): SessionRecord | undefined {
    if (typeof token !== 'string' || token.length === 0) return undefined;
    const presented = hashToken(token);
    let found: SessionRecord | undefined;
    for (const session of room.sessions) {
      if (hashesEqual(presented, session.tokenHash)) found = session;
    }
    if (found) found.lastSeenAt = this.now();
    return found;
  }

  createSession(room: Room): CreatedSession {
    const sessionToken = generateSessionToken();
    const at = this.now();
    const record: SessionRecord = {
      playerId: generatePlayerId(),
      tokenHash: hashToken(sessionToken),
      createdAt: at,
      lastSeenAt: at,
    };
    room.sessions.push(record);
    return { playerId: record.playerId, sessionToken };
  }

  /**
   * Used when a player leaves or is kicked: the token must stop working, and
   * the clock measured for that player is no longer about anybody, so it goes
   * with it rather than waiting to be inherited by a reused id.
   */
  removeSession(room: Room, playerId: PlayerId): void {
    room.sessions = room.sessions.filter((session) => session.playerId !== playerId);
    room.clocks.forget(playerId);
  }

  subscribe(room: Room, subscriber: Subscriber): void {
    room.subscribers.add(subscriber);
    this.touch(room);
  }

  unsubscribe(room: Room, subscriber: Subscriber): void {
    room.subscribers.delete(subscriber);
    this.touch(room);
  }

  cancelTimers(room: Room, round: number): void {
    room.scheduler.cancelRound(round);
  }

  clearAllTimers(room: Room): void {
    room.scheduler.cancelAll();
  }

  /**
   * Closing tells everyone why before the socket goes away. A stream that
   * simply ends looks like a network drop, and the phone would reconnect to a
   * code that no longer exists.
   */
  close(room: Room, reason: string): void {
    if (room.closed) return;
    room.closed = true;
    this.clearAllTimers(room);
    for (const subscriber of room.subscribers) {
      subscriber.send({ type: 'roomClosed', reason });
      subscriber.close();
    }
    room.subscribers.clear();
    room.sessions = [];
    room.clocks.clear();
    this.rooms.delete(room.code);
  }

  /**
   * Idle means nobody is connected and nothing has happened for the configured
   * window. A room with a live subscriber is never idle however quiet it is —
   * a group reading a passage together is not an abandoned room.
   */
  sweep(): RoomCode[] {
    const now = this.now();
    const expired: RoomCode[] = [];
    for (const room of [...this.rooms.values()]) {
      if (room.subscribers.size > 0) continue;
      if (now - room.lastActivityAt <= this.idleTimeoutMs) continue;
      expired.push(room.code);
      this.close(room, 'the room was idle and has been closed');
    }
    return expired;
  }

  startSweeping(intervalMs: number): void {
    if (this.sweeper !== null) return;
    this.sweeper = setInterval(() => this.sweep(), intervalMs);
    this.sweeper.unref();
  }

  stopSweeping(): void {
    if (this.sweeper === null) return;
    clearInterval(this.sweeper);
    this.sweeper = null;
  }

  /** Shuts the whole registry down; used when the process is going away. */
  closeAll(reason: string): void {
    this.stopSweeping();
    for (const room of [...this.rooms.values()]) this.close(room, reason);
  }
}
