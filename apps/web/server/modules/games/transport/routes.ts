/**
 * The HTTP surface: create a room, open a stream, post an intent.
 *
 * One rule governs the whole file. The `Actor` handed to the reducer is
 * derived from a token this layer verified, never from anything in the request
 * body. A body that says `{"actor":{"role":"host"}}` is data, not a claim, and
 * nothing here reads it. That is the only thing standing between a curious
 * teenager with the browser console open and the ability to end everyone
 * else's game.
 */

import type { Express, Router } from 'express';
import { API, FAMILIARITIES, TEAM_IDS } from '../../../../src/modules/games/shared/protocol.js';
import type {
  Actor,
  AnswerValue,
  ApiError,
  CreateRoomResponse,
  Familiarity,
  HostCommand,
  Intent,
  JoinResponse,
  PlayerId,
  RoomSettings,
  ServerTime,
  TeamId,
} from '../../../../src/modules/games/shared/protocol.js';
import { DEFAULT_THEME, sanitizeTheme } from '../../../../src/modules/games/shared/theme.js';
import { config } from '../config.js';
import type { ClockReport, Timers } from '../clock/index.js';
import { EventStream, refuseStream } from './EventStream.js';
import type { JsonResponse, StreamRequest, StreamResponse, SubscriberRole } from './EventStream.js';
import { RoomRegistry } from './RoomRegistry.js';
import type { Room } from './RoomRegistry.js';
import { broadcast, dispatch } from './broadcast.js';
import type { TransportContext } from './broadcast.js';
import type { EffectHandlers, RoomPort } from './roomPort.js';

/** Long enough for "Grandma Ellen", short enough not to break a roster line. */
const MAX_NAME_LENGTH = 24;
/** A typed answer is a phrase, not an essay. */
const MAX_ANSWER_LENGTH = 240;
/** An ordering game with more items than this would be unplayable on a phone. */
const MAX_ORDER_ITEMS = 32;
/** A host's choice names one thing on a screen, such as a tile; it is never prose. */
const MAX_CHOICE_LENGTH = 64;
/** Sweeping this often is enough for an idle window measured in hours. */
const SWEEP_INTERVAL_MS = 60_000;

export interface TransportRequest extends StreamRequest {
  params: Record<string, string | undefined>;
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, unknown>;
}

export interface TransportResponse extends StreamResponse, JsonResponse {}

export interface TransportOptions {
  port: RoomPort;
  registry?: RoomRegistry;
  handlers?: EffectHandlers;
  now?: () => ServerTime;
  heartbeatMs?: number;
  idleTimeoutMs?: number;
  /** Injected so a test can drive every room deadline without waiting on one. */
  timers?: Timers;
}

export interface Transport {
  registry: RoomRegistry;
  context: TransportContext;
  createRoom(req: TransportRequest, res: TransportResponse): void;
  stream(req: TransportRequest, res: TransportResponse): void;
  intent(req: TransportRequest, res: TransportResponse): void;
  /** `mountedAt`: the path the router is mounted at, stripped from the absolute API paths. */
  register(app: Express | Router, mountedAt?: string): void;
}

// ---------------------------------------------------------------------------
// Failure
// ---------------------------------------------------------------------------

/** Most rooms one server keeps at once (the Presenter caps its sessions the same way). */
export const MAX_ROOMS = 500;

function fail(res: JsonResponse, status: number, error: string, message: string): void {
  const body: ApiError = { error, message };
  res.status(status).json(body);
}

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isRound(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTeamId(value: unknown): value is TeamId {
  return typeof value === 'string' && (TEAM_IDS as readonly string[]).includes(value);
}

/**
 * Names are shown on a screen at the front of a room, so control characters
 * and runs of whitespace are removed rather than rejected: someone whose
 * keyboard added a stray newline should get to play, not get an error.
 */
function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let cleaned = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    cleaned += code < 0x20 || code === 0x7f ? ' ' : character;
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, MAX_NAME_LENGTH);
}

/**
 * A clock measurement rides alongside an intent rather than inside one.
 *
 * The protocol's buzz carries only what the player did — how much they had
 * read and when their own clock says they pressed. How far that clock sits
 * from the server's is not part of the press: it is measured separately, it
 * changes on its own schedule, and it is the server's business to decide how
 * much of it to believe. Keeping it out of the intent is what lets the reducer
 * stay a pure function of what people did.
 */
function parseClockReport(raw: unknown): ClockReport | null {
  const source = asRecord(raw);
  if (source === null) return null;
  if (!isFiniteNumber(source.offsetMs)) return null;
  // A negative round trip or spread is not a slow link, it is a broken
  // measurement, and folding one in would move an offset that was fine.
  if (!isFiniteNumber(source.rttMs) || source.rttMs < 0) return null;
  if (!isFiniteNumber(source.spreadMs) || source.spreadMs < 0) return null;
  return { offsetMs: source.offsetMs, rttMs: source.rttMs, spreadMs: source.spreadMs };
}

function parseAnswerValue(raw: unknown): AnswerValue | null {
  const value = asRecord(raw);
  if (value === null) return null;
  switch (value.type) {
    case 'text':
      if (typeof value.text !== 'string') return null;
      return { type: 'text', text: value.text.slice(0, MAX_ANSWER_LENGTH) };
    case 'choice':
      if (!isCount(value.index)) return null;
      return { type: 'choice', index: value.index };
    case 'order': {
      const order = value.order;
      if (!Array.isArray(order) || order.length > MAX_ORDER_ITEMS) return null;
      if (!order.every((item): item is string => typeof item === 'string')) return null;
      return { type: 'order', order };
    }
    case 'reference':
      if (!isCount(value.book) || !isCount(value.chapter) || !isCount(value.verse)) return null;
      return { type: 'reference', book: value.book, chapter: value.chapter, verse: value.verse };
    case 'found':
      return { type: 'found' };
    case 'card':
      // The shape only. Whether this is the card in play, and whether this
      // player may tap it, is the game's question, asked against the room.
      if (value.action !== 'got' && value.action !== 'pass' && value.action !== 'slip') return null;
      if (!isCount(value.card)) return null;
      return { type: 'card', action: value.action, card: value.card };
    default:
      return null;
  }
}

/**
 * Settings arrive as a partial and are filtered to known keys with known
 * types. Anything else is dropped rather than merged, so a stray field in a
 * request cannot become a field in room state.
 */
export function parseSettings(raw: unknown): Partial<RoomSettings> {
  const source = asRecord(raw);
  const settings: Partial<RoomSettings> = {};
  if (source === null) return settings;

  if (typeof source.gameId === 'string') settings.gameId = source.gameId;
  if (typeof source.setId === 'string') settings.setId = source.setId;
  if (source.setId === null) settings.setId = null;
  if (typeof source.translation === 'string') settings.translation = source.translation;
  if (typeof source.teamsEnabled === 'boolean') settings.teamsEnabled = source.teamsEnabled;
  if (isCount(source.rounds)) settings.rounds = source.rounds;
  if (isCount(source.answerWindowMs)) settings.answerWindowMs = source.answerWindowMs;
  if (typeof source.showIndividualScores === 'boolean') {
    settings.showIndividualScores = source.showIndividualScores;
  }
  if (typeof source.solo === 'boolean') settings.solo = source.solo;
  if (typeof source.groupVote === 'boolean') settings.groupVote = source.groupVote;
  if (isFamiliarity(source.familiarity)) settings.familiarity = source.familiarity;
  if (source.theme !== undefined) settings.theme = sanitizeTheme(source.theme, DEFAULT_THEME);

  const options = parseGameOptions(source.gameOptions);
  if (options !== null) settings.gameOptions = options;
  return settings;
}

function isFamiliarity(value: unknown): value is Familiarity {
  return typeof value === 'string' && (FAMILIARITIES as readonly string[]).includes(value);
}

/**
 * Per-game options, which the shell does not interpret. It still refuses
 * anything that is not a string, because a game reading these is entitled to
 * assume the type even though it cannot assume the keys.
 */
function parseGameOptions(raw: unknown): Record<string, string> | null {
  const source = asRecord(raw);
  if (source === null) return null;
  const options: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') options[key] = value;
  }
  return options;
}

function parseHostCommand(raw: unknown): HostCommand | null {
  const source = asRecord(raw);
  if (source === null) return null;
  switch (source.cmd) {
    case 'start':
    case 'pause':
    case 'resume':
    case 'skip':
    case 'revealNow':
    case 'nextRound':
    case 'end':
    case 'newGame':
    case 'requestFullStandings':
      return { cmd: source.cmd };
    case 'kick':
      if (typeof source.playerId !== 'string' || source.playerId.length === 0) return null;
      return { cmd: 'kick', playerId: source.playerId };
    case 'adjust':
      if (typeof source.delta !== 'number' || !Number.isFinite(source.delta)) return null;
      if (typeof source.playerId !== 'string' || source.playerId.length === 0) return null;
      return { cmd: 'adjust', playerId: source.playerId, delta: source.delta };
    case 'setSettings':
      return { cmd: 'setSettings', settings: parseSettings(source.settings) };
    case 'judge':
      if (
        source.verdict !== 'correct' &&
        source.verdict !== 'incorrect' &&
        source.verdict !== 'askToBeSpecific'
      ) {
        return null;
      }
      return { cmd: 'judge', verdict: source.verdict };
    case 'choose':
      // Only the shape is checked here. Whether the choice is one the game is
      // offering is the room's question, asked against the room's own state.
      if (typeof source.choice !== 'string' || source.choice.length === 0) return null;
      if (source.choice.length > MAX_CHOICE_LENGTH) return null;
      return { cmd: 'choose', choice: source.choice };
    case 'grantControl':
      if (typeof source.playerId !== 'string' || source.playerId.length === 0) return null;
      return { cmd: 'grantControl', playerId: source.playerId };
    case 'denyControl':
      if (typeof source.playerId !== 'string' || source.playerId.length === 0) return null;
      return { cmd: 'denyControl', playerId: source.playerId };
    case 'reclaimControl':
      return { cmd: 'reclaimControl' };
    default:
      return null;
  }
}

type IntentParse =
  | { ok: true; intent: Intent }
  | { ok: false; status: number; error: string; message: string };

function badIntent(message: string): IntentParse {
  return { ok: false, status: 400, error: 'badIntent', message };
}

export function parseIntent(raw: unknown): IntentParse {
  const source = asRecord(raw);
  if (source === null) return badIntent('an intent must be an object');

  switch (source.kind) {
    case 'join': {
      const name = cleanName(source.name);
      if (name === null) return badIntent('a name is required to join');
      if (source.teamId === undefined) return { ok: true, intent: { kind: 'join', name } };
      if (!isTeamId(source.teamId)) return badIntent('unknown team');
      return { ok: true, intent: { kind: 'join', name, teamId: source.teamId } };
    }
    case 'rejoin':
      return { ok: true, intent: { kind: 'rejoin' } };
    case 'leave':
      return { ok: true, intent: { kind: 'leave' } };
    case 'setTeam':
      if (!isTeamId(source.teamId)) return badIntent('unknown team');
      return { ok: true, intent: { kind: 'setTeam', teamId: source.teamId } };
    case 'answer': {
      if (!isRound(source.round)) return badIntent('an answer must name its round');
      const value = parseAnswerValue(source.value);
      if (value === null) return badIntent('unrecognised answer value');
      return { ok: true, intent: { kind: 'answer', round: source.round, value } };
    }
    case 'buzz':
      if (!isRound(source.round)) return badIntent('a buzz must name its round');
      if (!isCount(source.charsSeen)) return badIntent('a buzz must report what was read');
      if (typeof source.tClient !== 'number' || !Number.isFinite(source.tClient)) {
        return badIntent('a buzz must carry a client timestamp');
      }
      return {
        ok: true,
        intent: {
          kind: 'buzz',
          round: source.round,
          charsSeen: source.charsSeen,
          tClient: source.tClient,
        },
      };
    case 'withdraw':
      if (!isRound(source.round)) return badIntent('a withdrawal must name its round');
      return { ok: true, intent: { kind: 'withdraw', round: source.round } };
    case 'host': {
      const command = parseHostCommand(source.command);
      if (command === null) return badIntent('unrecognised host command');
      return { ok: true, intent: { kind: 'host', command } };
    }
    case 'requestControl':
      return { ok: true, intent: { kind: 'requestControl' } };
    case 'withdrawControlRequest':
      return { ok: true, intent: { kind: 'withdrawControlRequest' } };
    // Both of these carry the system role. They are produced inside this
    // process — by the scheduler and by the judge provider — and accepting
    // either over HTTP would let anyone fire a reveal early or hand the host a
    // verdict that no provider ever suggested.
    case 'timer':
    case 'judgeSuggestion':
      return {
        ok: false,
        status: 403,
        error: 'forbiddenIntent',
        message: 'that intent is raised by the server, not by a client',
      };
    default:
      return badIntent('unknown intent kind');
  }
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/**
 * A token may arrive as a bearer header, as a body field or, for the stream,
 * as a query parameter. The query parameter is not a preference — `EventSource`
 * cannot set a header, so a stream has no other way to authenticate itself.
 */
function presentedToken(req: TransportRequest, body: Record<string, unknown> | null): string | null {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string') {
    const match = /^bearer\s+(\S+)$/i.exec(authorization);
    const bearer = match?.[1];
    if (bearer !== undefined) return bearer;
  }
  if (body !== null && typeof body.token === 'string' && body.token.length > 0) return body.token;
  const query = req.query.token;
  if (typeof query === 'string' && query.length > 0) return query;
  return null;
}

// ---------------------------------------------------------------------------
// The transport
// ---------------------------------------------------------------------------

export function createTransport(options: TransportOptions): Transport {
  const now = options.now ?? Date.now;
  const registry =
    options.registry ??
    new RoomRegistry({
      port: options.port,
      idleTimeoutMs: options.idleTimeoutMs ?? config.roomIdleTimeoutMs,
      now,
      ...(options.timers === undefined ? {} : { timers: options.timers }),
    });
  const context: TransportContext = {
    port: options.port,
    registry,
    handlers: options.handlers ?? {},
    now,
  };

  // A deadline the reducer asked for comes back as an ordinary intent carrying
  // the system role. It is the one intent no client may raise, which is why the
  // path in is here and not through the HTTP surface.
  registry.onTimer = (room, intent) => {
    dispatch(context, room, { actor: { role: 'system' }, intent, receivedAt: now() });
  };

  function findRoom(req: TransportRequest, res: TransportResponse): Room | null {
    const room = registry.get(req.params.code);
    if (room === undefined) {
      fail(res, 404, 'roomNotFound', 'No room is using that code. Check the code on the big screen.');
      return null;
    }
    return room;
  }

  /**
   * A measurement the client sent alongside its intent, if it sent one.
   *
   * The tracker is the smoother: successive reports from one phone differ
   * mostly by noise, and it also knows a suspend from a drift. What comes out
   * of it goes straight into room state, because the room is what corrects a
   * buzz — this layer never touches the timestamp itself. Handing over the
   * smoothed figure rather than the raw report is the whole of the division:
   * one layer decides what a phone's clock is, the other decides what that
   * means for a queue.
   */
  function noteClock(
    room: Room,
    playerId: PlayerId,
    body: Record<string, unknown>,
    at: ServerTime
  ): void {
    const report = parseClockReport(body.clock);
    if (report === null) return;
    const clock = room.clocks.report(playerId, report, at);
    room.state = context.port.setClockOffset(room.state, playerId, clock.offsetMs);
  }

  function createRoom(req: TransportRequest, res: TransportResponse): void {
    const body = asRecord(req.body);
    const settings = parseSettings(body?.settings);
    // Rooms live in memory until they idle out; an unauthenticated endpoint needs a ceiling.
    if (registry.size >= MAX_ROOMS) {
      fail(res, 503, 'roomsFull', 'This server is hosting as many rooms as it can. Try again in a little while.');
      return;
    }
    const created = registry.create(settings);
    const response: CreateRoomResponse = {
      code: created.room.code,
      ownerToken: created.ownerToken,
      displayToken: created.displayToken,
    };
    res.status(201).json(response);
  }

  function stream(req: TransportRequest, res: TransportResponse): void {
    const room = registry.get(req.params.code);
    if (room === undefined) {
      refuseStream(res, 404, 'roomNotFound', 'No room is using that code. Check the code on the big screen.');
      return;
    }

    const token = presentedToken(req, null);
    let role: SubscriberRole;
    let playerId: PlayerId | null = null;

    if (registry.isOwner(room, token)) {
      role = { kind: 'screen', owner: true };
    } else if (registry.isDisplay(room, token)) {
      role = { kind: 'screen', owner: false };
    } else {
      const session = registry.findSession(room, token);
      if (session === undefined) {
        refuseStream(res, 401, 'unauthorized', 'that token does not belong to this room');
        return;
      }
      playerId = session.playerId;
      role = { kind: 'player', playerId: session.playerId };
    }

    const subscriber = new EventStream(res, role, {
      ...(options.heartbeatMs === undefined ? {} : { heartbeatMs: options.heartbeatMs }),
      now,
      onClose: () => {
        registry.unsubscribe(room, subscriber);
        if (room.closed) return;
        // Recomputed from who is actually still connected, following a
        // screen's close exactly as a player's already does.
        room.state = context.port.setScreenPresence(room.state, registry.screenPresence(room));
        if (playerId !== null) {
          room.state = context.port.setConnected(room.state, playerId, false);
        }
        broadcast(context, room);
      },
    });

    registry.subscribe(room, subscriber);
    room.state = context.port.setScreenPresence(room.state, registry.screenPresence(room));
    if (playerId !== null) {
      room.state = context.port.setConnected(room.state, playerId, true);
    }
    req.on('close', () => subscriber.close());

    // Everyone is re-projected, which incidentally makes the new stream's very
    // first event a full snapshot — the only thing a reconnecting phone needs.
    broadcast(context, room);
  }

  function intent(req: TransportRequest, res: TransportResponse): void {
    const room = findRoom(req, res);
    if (room === null) return;

    const body = asRecord(req.body);
    if (body === null) {
      fail(res, 400, 'badRequest', 'expected a JSON object');
      return;
    }
    // A client may post `{ intent: … }` with a token beside it, or post the
    // intent itself and authenticate with a header. Both are unambiguous
    // because an intent always carries a `kind`.
    const raw = typeof body.kind === 'string' ? body : body.intent;
    const parsed = parseIntent(raw);
    if (!parsed.ok) {
      fail(res, parsed.status, parsed.error, parsed.message);
      return;
    }

    const intentValue = parsed.intent;
    const token = presentedToken(req, body);
    const receivedAt = now();

    if (intentValue.kind === 'host') {
      // The owner token or a session in this room — the reducer decides
      // whether that actor actually controls the room (§5.1 of the design);
      // this layer's job is only to prove which one presented the token,
      // never to read the body for a claim of either.
      let actor: Actor;
      if (registry.isOwner(room, token)) {
        actor = { role: 'owner' };
      } else {
        const asPlayer = registry.findSession(room, token);
        if (asPlayer === undefined) {
          fail(res, 401, 'unauthorized', 'that command requires the host token or a session in this room');
          return;
        }
        actor = { role: 'player', playerId: asPlayer.playerId };
      }
      // A kick that the reducer actually applies comes back as its own
      // `removeSession` effect (see `broadcast.ts`), rather than being
      // inferred here from the command dispatched: once a `HostCommand` can
      // be refused for failing the controller check, a dispatched kick is
      // not necessarily an applied one.
      dispatch(context, room, { actor, intent: intentValue, receivedAt });
      res.status(200).json({ ok: true });
      return;
    }

    const session = registry.findSession(room, token);

    // Joining is the one intent that may arrive without a credential, because
    // it is where a credential comes from. Presenting an existing one instead
    // rejoins as the same player: a reload must not put a second copy of
    // somebody in the roster or lose the score attached to the first.
    if (intentValue.kind === 'join' && session === undefined) {
      const created = registry.createSession(room);
      dispatch(context, room, {
        actor: { role: 'player', playerId: created.playerId },
        intent: intentValue,
        receivedAt,
      });
      // After the join rather than before it: there is nobody to hang a
      // measurement on until the roster has this player in it.
      noteClock(room, created.playerId, body, receivedAt);
      const response: JoinResponse = {
        playerId: created.playerId,
        sessionToken: created.sessionToken,
      };
      res.status(200).json(response);
      return;
    }

    if (session === undefined) {
      fail(res, 401, 'unauthorized', 'that intent requires a session token');
      return;
    }

    // Before the dispatch, so a measurement riding along with a buzz is the one
    // that buzz is corrected by.
    noteClock(room, session.playerId, body, receivedAt);

    dispatch(context, room, {
      actor: { role: 'player', playerId: session.playerId },
      intent: intentValue,
      receivedAt,
    });

    if (intentValue.kind === 'leave') {
      // As with a kick, the reducer's own `removeSession` effect is what
      // invalidates the session now (see `broadcast.ts`), not this branch.
      res.status(200).json({ ok: true });
      return;
    }

    if (intentValue.kind === 'join' || intentValue.kind === 'rejoin') {
      // The token the client already holds is still the right one; it is
      // echoed so one code path on the phone handles both first join and
      // rejoin.
      const response: JoinResponse = {
        playerId: session.playerId,
        sessionToken: typeof token === 'string' ? token : '',
      };
      res.status(200).json(response);
      return;
    }

    res.status(200).json({ ok: true });
  }

  function register(app: Express | Router, mountedAt = ''): void {
    const rel = (path: string): string => (mountedAt !== '' && path.startsWith(mountedAt) ? path.slice(mountedAt.length) : path);
    const target = app as Router;
    target.post(rel(API.createRoom), (req, res) => createRoom(req, res));
    target.get(rel(API.stream(':code')), (req, res) => stream(req, res));
    target.post(rel(API.intent(':code')), (req, res) => intent(req, res));
    registry.startSweeping(SWEEP_INTERVAL_MS);
  }

  return { registry, context, createRoom, stream, intent, register };
}
