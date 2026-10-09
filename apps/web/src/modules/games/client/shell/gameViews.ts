/**
 * The client half of the game seam.
 *
 * A game contributes six components — three phases for the host screen, three
 * for the phone — and registers them under its id. The shell owns everything
 * around them: the room code, the roster, teams, the timer bar, reconnection,
 * scores and the lobby and summary screens. Nothing in the shell names a game.
 *
 * Registration is a side effect of importing the game's module, which keeps the
 * shell free of a hard-coded list and lets each game live in its own directory.
 */

import type { ComponentType } from 'preact';
import type {
  GameId,
  HostCommand,
  Intent,
  PersonalResult,
  PhaseName,
  PlayerSnapshot,
  RevealPayload,
  ScreenSnapshot,
} from '../../shared/protocol.js';
import type { ClockPort } from './clockPort.js';
import { HostPlaceholder, PlayerPlaceholder } from './PlaceholderView.js';

/** The phases a game renders. Lobby and summary belong to the shell. */
export type GamePhase = Extract<PhaseName, 'question' | 'answering' | 'reveal'>;

export interface HostViewProps {
  snapshot: ScreenSnapshot;
  /** The game's own host payload, already typed by the game that sent it. */
  view: unknown;
  reveal: RevealPayload | null;
  clock: ClockPort;
  send(command: HostCommand): void;
}

export interface PlayerViewProps {
  snapshot: PlayerSnapshot;
  view: unknown;
  reveal: RevealPayload | null;
  /** This player's own outcome. Never leaves this phone. */
  yourResult: PersonalResult | null;
  clock: ClockPort;
  send(intent: Intent): void;
}

export type PhaseViews<P> = Record<GamePhase, ComponentType<P>>;

/** What a game's own slot in the control area is given to work with. */
export interface ControlViewProps {
  snapshot: ScreenSnapshot | PlayerSnapshot;
  send(command: HostCommand): void;
}

export interface GameViews {
  id: GameId;
  host: PhaseViews<HostViewProps>;
  player: PhaseViews<PlayerViewProps>;
  /**
   * True when the host's reveal draws how the room voted — the split and what
   * the room decided — in its own layout. A vote's split is drawn once, so the
   * shell then leaves a room of one group to the game and draws its team cards
   * only when there are teams to compare. Left out, the shell draws every vote
   * and a game's reveal leaves its own split out whenever a round was voted on.
   */
  revealDrawsRoomVote?: boolean;
  /**
   * Control UI beyond a verdict — sword drill's "tap a connected player's
   * name to call them on" is the one example today. Registered client-side
   * only, never in `src/shared/`, so nothing about the protocol freezes for
   * it and a game that has nothing beyond the ordinary judge card (the other
   * eight, today) registers nothing. Rendered, when present, beside
   * `ControlPanel`'s judge card on whichever device currently holds control —
   * a screen or a phone, exactly like the rest of the control area.
   */
  control?: ComponentType<ControlViewProps>;
}

const registry = new Map<GameId, GameViews>();

export function registerGameViews(views: GameViews): void {
  registry.set(views.id, views);
}

export function getGameViews(id: GameId): GameViews | undefined {
  return registry.get(id);
}

export function listGameViews(): GameViews[] {
  return [...registry.values()];
}

/** Test seam: a registry that leaks between test files is a puzzle, not a test. */
export function clearGameViews(): void {
  registry.clear();
}

/**
 * The shell must render something for every phase, including for a room whose
 * game has not been installed on this client. A placeholder that says so is
 * better than a blank projector.
 */
export function hostViewFor(id: GameId, phase: GamePhase): ComponentType<HostViewProps> {
  return registry.get(id)?.host[phase] ?? HostPlaceholder;
}

export function playerViewFor(id: GameId, phase: GamePhase): ComponentType<PlayerViewProps> {
  return registry.get(id)?.player[phase] ?? PlayerPlaceholder;
}

export function isGamePhase(phase: PhaseName): phase is GamePhase {
  return phase === 'question' || phase === 'answering' || phase === 'reveal';
}
