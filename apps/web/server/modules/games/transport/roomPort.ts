/**
 * The seam between the delivery layer and the room state machine.
 *
 * The transport owns sockets, sessions and authentication; the room layer owns
 * state, phases and projection. Neither imports the other's implementation —
 * they meet here. That is what lets the two be written and tested at the same
 * time, and it is why every method below is expressed in terms of the wire
 * protocol rather than in terms of either side's internals.
 *
 * State is deliberately opaque to the transport. The transport stores it,
 * hands it back to `reduce`, and asks for projections of it; it never reads a
 * field. If the transport could read state it would eventually be tempted to
 * filter for privacy itself, and the whole guarantee is that filtering happens
 * in exactly one place.
 */

import type {
  AddressedIntent,
  Effect,
  ScreenSnapshot,
  JudgeRequest,
  PersonalResult,
  PlayerId,
  PlayerSnapshot,
  RevealPayload,
  RoomCode,
  RoomSettings,
  ServerTime,
  Standing,
} from '../../../../src/modules/games/shared/protocol.js';

/** Opaque to this layer. Only the room implementation knows its shape. */
export type RoomState = unknown;

export interface RoomCreation {
  code: RoomCode;
  /** Whatever the host asked for; the room layer fills in the rest. */
  settings: Partial<RoomSettings>;
  createdAt: ServerTime;
}

export interface ReduceResult {
  state: RoomState;
  effects: Effect[];
}

export interface RoomPort {
  createState(creation: RoomCreation): RoomState;

  /**
   * Pure: no clock, no sockets, no database. Anything the outside world must
   * do comes back as an effect for the transport to perform.
   *
   * Every field arrives exactly as the client sent it, a buzz's `tClient`
   * included: it is still on the phone's own clock. Correcting it belongs to
   * the room, because the room is what holds the bounds a buzz cannot honestly
   * leave — the reveal instant below and the arrival above. The transport's
   * part is to keep each player's measured offset current through
   * `setClockOffset`, and then to leave the timestamp alone. Correcting in both
   * places would correct twice, and would leave the room unable to tell a
   * clamped buzz from an honest one.
   */
  reduce(state: RoomState, addressed: AddressedIntent): ReduceResult;

  /**
   * Null means this player is no longer part of the room — kicked, or left.
   * The transport reads that as "close this stream", which is why removal
   * needs no separate signal.
   */
  projectForPlayer(state: RoomState, playerId: PlayerId): PlayerSnapshot | null;

  /**
   * `owner` is proved by the transport from which credential opened the
   * stream — the owner token, or the display token — and handed over the
   * same way a player's own id already is. A display-credentialled screen
   * never receives `control`, whatever else is happening in the room.
   */
  projectForScreen(state: RoomState, owner: boolean): ScreenSnapshot;

  /**
   * Connection status is not an intent. A phone that locks has not left the
   * room and has not asked for anything; the roster simply needs to show it as
   * away until it comes back. Keeping it out of the intent stream also keeps a
   * flaky connection from filling a replayable log with noise.
   */
  setConnected(state: RoomState, playerId: PlayerId, connected: boolean): RoomState;

  /**
   * Screen presence, following `setConnected`'s own precedent exactly: not an
   * intent, nobody asked for it, and it must not enter the intent stream. The
   * transport calls this on a screen stream's subscribe and close, with what
   * is connected right now.
   */
  setScreenPresence(
    state: RoomState,
    presence: { anyScreen: boolean; ownerScreen: boolean }
  ): RoomState;

  /**
   * How far this player's clock sits from the server's, as measured out of
   * band and smoothed by the transport. It is not an intent for the same reason
   * connection status is not: nobody asked for it, it changes on its own
   * schedule, and a fresh measurement must not look like something the player
   * did. The room reads it when it corrects a buzz.
   */
  setClockOffset(state: RoomState, playerId: PlayerId, offsetMs: number): RoomState;

  /**
   * The public half of a reveal, or null when the round produced no outcome —
   * a skipped round, or a room that never started. Nothing in this payload can
   * name who answered what.
   */
  projectReveal(state: RoomState): RevealPayload | null;

  /** The private half, for one phone. Null when that player has no result. */
  projectPersonalResult(state: RoomState, playerId: PlayerId): PersonalResult | null;

  /**
   * The full ordering, for a host who explicitly asked. Optional because a
   * room that never offers it is a legitimate room: the default is a top
   * three, and a bottom of the leaderboard is never steady-state data.
   */
  standingsFull?(state: RoomState): Standing[];

  /**
   * What a judge provider would need to form an opinion, or null when nobody is
   * awaiting adjudication. It is a projection like the others rather than
   * something the runtime assembles for itself, because assembling it would mean
   * reading state — and the moment this layer can read state, the promise that
   * filtering happens in exactly one place is gone.
   *
   * The player id travels with it so the caller can prove the answer it gets
   * back still belongs to the person it asked about. A model is slow enough
   * that the queue can move on while it thinks.
   */
  judgeRequest?(state: RoomState): (JudgeRequest & { playerId: PlayerId }) | null;
}

/**
 * The two effects the transport cannot perform on its own. Both are optional:
 * with neither supplied the game is still fully playable, it just does not
 * survive a restart and the host does all the adjudicating.
 */
export interface EffectHandlers {
  persist?(code: RoomCode, state: RoomState): void;
  requestJudge?(code: RoomCode, round: number, playerId: PlayerId): void;
}
