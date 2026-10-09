/**
 * The room layer, dressed as the object the delivery layer expects.
 *
 * The two sides were written against the same seam but not against each other:
 * the room's functions take a game module and a concrete state type, and the
 * transport wants a single object over an opaque one. Reconciling them here,
 * rather than by bending either side, keeps the room's own surface honest —
 * `reduce` still takes its game explicitly, and every projection is still a
 * plain function of state that a test can call directly.
 *
 * Two differences are deliberate rather than mechanical:
 *
 * - `projectForPlayer` returns null for a player the room no longer has. The
 *   room's own version synthesises an empty viewer instead, which is the right
 *   answer for a projection but the wrong one for a socket: the transport reads
 *   null as "this stream belongs to nobody, close it", and without that a
 *   kicked phone would sit rendering a roster it is not in.
 * - The seed is drawn here. It is the room's own business — nothing outside
 *   reproduces a room from it — so making the caller supply one would only
 *   invite two callers to supply the same one.
 */

import { randomBytes } from 'node:crypto';
import type { GameModule } from '../../../../src/modules/games/shared/games.js';
import type {
  AddressedIntent,
  ScreenSnapshot,
  JudgeRequest,
  PersonalResult,
  PlayerId,
  PlayerSnapshot,
  RevealPayload,
  RoomSettings,
  Standing,
} from '../../../../src/modules/games/shared/protocol.js';
import type {
  ReduceResult,
  RoomCreation,
  RoomPort,
  RoomState as OpaqueState,
} from '../transport/roomPort.js';
import { reduce } from './reducer.js';
import {
  projectForPlayer,
  projectForScreen,
  projectFullStandings,
  projectPersonalResult,
  projectReveal,
} from './projection.js';
import {
  createRoom,
  findPlayer,
  judgeRequestOf,
  withClockOffset,
  withConnected,
  withScreenPresence,
  type RoomState,
} from './state.js';

/** A full 32-bit draw, which is the width the room's generator works in. */
function freshSeed(): number {
  return randomBytes(4).readUInt32BE(0);
}

/**
 * How a room finds the game it is playing.
 *
 * A function rather than a registry because the registry has no answer for a
 * host who picks a game this server does not carry, and inventing one here
 * would put that policy in the wrong layer. The composition root knows what to
 * fall back to; this layer only needs a module.
 */
export type GameResolver = (settings: RoomSettings) => GameModule;

export function createRoomPort(resolveGame: GameResolver): RoomPort {
  const room = (state: OpaqueState): RoomState => state as RoomState;

  return {
    createState(creation: RoomCreation): OpaqueState {
      return createRoom({
        code: creation.code,
        settings: creation.settings,
        now: creation.createdAt,
        seed: freshSeed(),
      });
    },

    /**
     * The game is resolved per call, from the settings currently in state, so
     * one process serves rooms playing different games and a host who changes
     * the game in the lobby is playing the new one from the next intent on.
     * Resolving before reducing is the deliberate half of that: an intent is
     * handled by the game that was in effect when it arrived, so a settings
     * change never retroactively re-scores what is already in flight.
     */
    reduce(state: OpaqueState, addressed: AddressedIntent): ReduceResult {
      const current = room(state);
      return reduce(current, addressed, resolveGame(current.settings));
    },

    projectForPlayer(state: OpaqueState, playerId: PlayerId): PlayerSnapshot | null {
      const current = room(state);
      if (findPlayer(current, playerId) === null) return null;
      return projectForPlayer(current, playerId, resolveGame(current.settings));
    },

    projectForScreen(state: OpaqueState, owner: boolean): ScreenSnapshot {
      const current = room(state);
      return projectForScreen(current, resolveGame(current.settings), owner);
    },

    setConnected(state: OpaqueState, playerId: PlayerId, connected: boolean): OpaqueState {
      return withConnected(room(state), playerId, connected);
    },

    setScreenPresence(
      state: OpaqueState,
      presence: { anyScreen: boolean; ownerScreen: boolean }
    ): OpaqueState {
      return withScreenPresence(room(state), presence);
    },

    setClockOffset(state: OpaqueState, playerId: PlayerId, offsetMs: number): OpaqueState {
      return withClockOffset(room(state), playerId, offsetMs);
    },

    projectReveal(state: OpaqueState): RevealPayload | null {
      return projectReveal(room(state));
    },

    projectPersonalResult(state: OpaqueState, playerId: PlayerId): PersonalResult | null {
      return projectPersonalResult(room(state), playerId);
    },

    standingsFull(state: OpaqueState): Standing[] {
      return projectFullStandings(room(state));
    },

    judgeRequest(state: OpaqueState): (JudgeRequest & { playerId: PlayerId }) | null {
      return judgeRequestOf(room(state));
    },
  };
}
