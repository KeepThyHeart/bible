/**
 * A minimal, in-memory implementation of the room seam.
 *
 * It exists so the delivery layer can be built and tested without the real
 * state machine, and it doubles as executable documentation of what the
 * transport actually requires: a roster, a per-viewer projection, and a
 * reducer that returns new state rather than mutating it. It is not a game —
 * it knows nothing about rounds, scoring or content — and it is never wired
 * into a running server.
 */

import type {
  AddressedIntent,
  Effect,
  ScreenSnapshot,
  PersonalResult,
  PhaseName,
  PlayerId,
  PlayerSnapshot,
  PublicPlayer,
  RevealPayload,
  RoomCode,
  RoomSettings,
  ServerTime,
  Standing,
  TeamId,
} from '../../../../src/modules/games/shared/protocol.js';
import { DEFAULT_THEME } from '../../../../src/modules/games/shared/theme.js';
import type { ReduceResult, RoomCreation, RoomPort, RoomState } from './roomPort.js';

export interface StubPlayer {
  id: PlayerId;
  name: string;
  teamId: TeamId | null;
  connected: boolean;
  score: number;
}

export interface StubState {
  code: RoomCode;
  settings: RoomSettings;
  phase: PhaseName;
  paused: boolean;
  round: number;
  players: StubPlayer[];
  revealAt: ServerTime | null;
  /** Every intent the reducer was handed, so a test can assert on the actor. */
  received: AddressedIntent[];
  /** What the transport has pushed in from its clock measurements. */
  clockOffsets: Record<PlayerId, number>;
  /** Posed by a test, so that a reveal effect has something to project. */
  reveal: RevealPayload | null;
  /** Posed by a test: one result per player, addressed to that player alone. */
  results: Record<PlayerId, PersonalResult>;
  serverTime: ServerTime;
}

const DEFAULT_SETTINGS: RoomSettings = {
  gameId: 'fill-in-the-blank',
  setId: null,
  translation: 'KJV',
  teamsEnabled: false,
  rounds: 10,
  answerWindowMs: 20_000,
  showIndividualScores: false,
  solo: false,
  groupVote: false,
  familiarity: 'broad',
  gameOptions: {},
  theme: DEFAULT_THEME,
};

/** How many names the big screen may show. Everything below is aggregate only. */
const VISIBLE_STANDINGS = 3;

export interface StubOptions {
  /** Lets a test drive the effect path without inventing a whole game. */
  effectsFor?: (addressed: AddressedIntent) => Effect[];
  now?: () => ServerTime;
}

function clone(state: StubState): StubState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    clockOffsets: { ...state.clockOffsets },
    results: { ...state.results },
  };
}

function publicView(player: StubPlayer): PublicPlayer {
  return { id: player.id, name: player.name, teamId: player.teamId, connected: player.connected };
}

export function createStubRoomPort(options: StubOptions = {}): RoomPort & {
  asStub(state: RoomState): StubState;
} {
  const now = options.now ?? Date.now;

  function asStub(state: RoomState): StubState {
    return state as StubState;
  }

  function ranked(state: StubState): StubPlayer[] {
    return [...state.players].sort((a, b) => b.score - a.score);
  }

  return {
    asStub,

    createState(creation: RoomCreation): RoomState {
      const state: StubState = {
        code: creation.code,
        settings: { ...DEFAULT_SETTINGS, ...creation.settings },
        phase: 'lobby',
        paused: false,
        round: 0,
        players: [],
        revealAt: null,
        received: [],
        clockOffsets: {},
        reveal: null,
        results: {},
        serverTime: creation.createdAt,
      };
      return state;
    },

    reduce(state: RoomState, addressed: AddressedIntent): ReduceResult {
      const next = clone(asStub(state));
      next.received = [...next.received, addressed];
      next.serverTime = addressed.receivedAt;

      const intent = addressed.intent;
      const actor = addressed.actor;
      // Mirrors the real reducer's own `removeSession` effect (see
      // `server/room/reducer.ts`): emitted exactly when a player is actually
      // removed, so the transport tests exercising this stub see the same
      // "a refused kick removes nobody's session" behaviour as production.
      const removed: Effect[] = [];

      if (actor.role === 'player') {
        const existing = next.players.find((player) => player.id === actor.playerId);
        if (intent.kind === 'join') {
          if (existing === undefined) {
            next.players.push({
              id: actor.playerId,
              name: intent.name,
              teamId: intent.teamId ?? null,
              connected: true,
              score: 0,
            });
          } else {
            existing.name = intent.name;
            existing.connected = true;
          }
        }
        if (intent.kind === 'rejoin' && existing !== undefined) existing.connected = true;
        if (intent.kind === 'setTeam' && existing !== undefined) existing.teamId = intent.teamId;
        if (intent.kind === 'leave') {
          next.players = next.players.filter((player) => player.id !== actor.playerId);
          removed.push({ type: 'removeSession', playerId: actor.playerId });
        }
      }

      if (actor.role === 'owner' && intent.kind === 'host') {
        const command = intent.command;
        if (command.cmd === 'start') next.phase = 'answering';
        if (command.cmd === 'pause') next.paused = true;
        if (command.cmd === 'resume') next.paused = false;
        if (command.cmd === 'nextRound') next.round += 1;
        if (command.cmd === 'kick') {
          if (next.players.some((player) => player.id === command.playerId)) {
            next.players = next.players.filter((player) => player.id !== command.playerId);
            removed.push({ type: 'removeSession', playerId: command.playerId });
          }
        }
        if (command.cmd === 'adjust') {
          const target = next.players.find((player) => player.id === command.playerId);
          if (target !== undefined) target.score += command.delta;
        }
        if (command.cmd === 'setSettings') {
          next.settings = { ...next.settings, ...command.settings };
        }
      }

      if (actor.role === 'system' && intent.kind === 'timer') next.phase = 'reveal';

      return { state: next, effects: [...removed, ...(options.effectsFor?.(addressed) ?? [])] };
    },

    setConnected(state: RoomState, playerId: PlayerId, connected: boolean): RoomState {
      const next = clone(asStub(state));
      const player = next.players.find((candidate) => candidate.id === playerId);
      // An unknown id is a no-op: a stream can outlive the player it belonged
      // to by a few milliseconds when someone is kicked.
      if (player !== undefined) player.connected = connected;
      return next;
    },

    // The stub's own snapshots don't model `questionOnScreen` dynamically
    // (see `projectForScreen` below), so there is nothing for this to write.
    setScreenPresence(state: RoomState): RoomState {
      return state;
    },

    setClockOffset(state: RoomState, playerId: PlayerId, offsetMs: number): RoomState {
      const next = clone(asStub(state));
      next.clockOffsets[playerId] = offsetMs;
      return next;
    },

    projectForPlayer(state: RoomState, playerId: PlayerId): PlayerSnapshot | null {
      const stub = asStub(state);
      const player = stub.players.find((candidate) => candidate.id === playerId);
      if (player === undefined) return null;
      const order = ranked(stub);
      const position = order.findIndex((candidate) => candidate.id === playerId);
      return {
        viewer: 'player',
        code: stub.code,
        phase: stub.phase,
        paused: stub.paused,
        round: stub.round,
        totalRounds: stub.settings.rounds,
        settings: stub.settings,
        players: stub.players.map(publicView),
        controller: { kind: 'owner' },
        questionOnScreen: false,
        phaseEndsAt: null,
        phaseDurationMs: null,
        revealAt: stub.revealAt,
        serverTime: now(),
        you: publicView(player),
        yourScore: player.score,
        youAnswered: false,
        yourRank: position < VISIBLE_STANDINGS ? position + 1 : null,
        view: null,
        yourAnswer: null,
        canChangeAnswer: false,
        buzz: null,
        youAreSpent: false,
        yourControlRequest: null,
      };
    },

    projectForScreen(state: RoomState, _owner: boolean): ScreenSnapshot {
      const stub = asStub(state);
      const order = ranked(stub);
      const visible = stub.settings.showIndividualScores
        ? order
        : order.slice(0, VISIBLE_STANDINGS);
      const standings: Standing[] = visible.map((player) => ({
        playerId: player.id,
        name: player.name,
        teamId: player.teamId,
        score: player.score,
      }));
      return {
        viewer: 'screen',
        code: stub.code,
        phase: stub.phase,
        paused: stub.paused,
        round: stub.round,
        totalRounds: stub.settings.rounds,
        settings: stub.settings,
        players: stub.players.map(publicView),
        controller: { kind: 'owner' },
        questionOnScreen: false,
        phaseEndsAt: null,
        phaseDurationMs: null,
        revealAt: stub.revealAt,
        serverTime: now(),
        standings,
        teamStandings: [],
        // The stub knows nothing about a previous game to have folded a
        // score in from (see `PlayerState.allTimeScore` in the real room),
        // so the only honest stand-in is this game's own standings.
        overallStandings: standings,
        answeredCount: 0,
        view: null,
        buzz: null,
      };
    },

    projectReveal(state: RoomState): RevealPayload | null {
      return asStub(state).reveal;
    },

    projectPersonalResult(state: RoomState, playerId: PlayerId): PersonalResult | null {
      return asStub(state).results[playerId] ?? null;
    },

    standingsFull(state: RoomState): Standing[] {
      return ranked(asStub(state)).map((player) => ({
        playerId: player.id,
        name: player.name,
        teamId: player.teamId,
        score: player.score,
      }));
    },
  };
}
