/**
 * Reading what the server sent, rather than trusting it.
 *
 * A view payload arrives as `unknown`, and it genuinely can be: a phone that
 * loaded yesterday's bundle, a room whose game changed under a screen that was
 * asleep, a round the server had no Bible module to build from. Each is read
 * into a shape or into null, and a null draws a line of plain text rather than
 * an exception across a projector.
 *
 * The shapes are declared here as well as on the server on purpose: what
 * passes between the two is the wire, not a type.
 */

import type {
  ClientTime,
  PlayerId,
  PublicBuzzState,
  PublicPlayer,
  RoomSettings,
} from '../../../shared/protocol.js';

/** Stable identifier for this game, matching the server module's. */
export const GAME_ID = 'sword-drill';

/**
 * How a room finds out who found the reference: `hostCalls` — nobody's phone
 * has a button at all; the host announces the reference, listens for a
 * reader, and taps that player's own name to call on them (`{cmd: 'callOn'}`)
 * — or `buttons`, the original "everyone races to tap Found it" mechanic.
 *
 * `gameOptions` is a plain string map the room carries opaquely (see
 * `RoomSettings.gameOptions`), so this key means nothing to the shell or to
 * any other game — only this file reads it, on both the host's and the
 * player's screens, and it is a room setting rather than a fixed choice
 * because a printed-Bible group and a room of confident typers want
 * different things here.
 *
 * `hostCalls` is the default: read aloud, a tap race is a poor proxy for who
 * actually found it first, and the button mechanic is offered as a fallback
 * for a room that would rather have it (an internet-connected room, players
 * spread across a large space, ...) — not the assumed default experience.
 */
export type BuzzMode = 'hostCalls' | 'buttons';

export function buzzModeOf(gameOptions: RoomSettings['gameOptions']): BuzzMode {
  return gameOptions['buzzMode'] === 'buttons' ? 'buttons' : 'hostCalls';
}

/**
 * What a screen is given while the round is live. A player's phone gets only
 * the reference; the host alone also gets `text`, so they can confirm a
 * reader's citation the moment they hear it (see the server module's doc
 * comment). `text` is simply absent from a player's payload — this is
 * projection doing the work, not the client hiding a field it was sent.
 */
export interface Drill {
  reference: string;
  translation: string;
  text?: string;
}

/** What the reveal draws, once the round is scored. */
export interface DrillReveal {
  reference: string;
  text: string;
  translation: string;
  /** Who was heard and confirmed, in order. Nobody else is ever listed. */
  confirmed: PlayerId[];
}

/**
 * Where one phone stands in the round. Every screen of this game is decided by
 * this, and most of what it decides is what *not* to say.
 */
export type Place =
  /** Has not tapped, so the button is still there. */
  | { kind: 'free' }
  /** At the head of the queue: the room is listening to them. */
  | { kind: 'reading' }
  | { kind: 'waiting'; ahead: number }
  /** The host heard them read and confirmed it. */
  | { kind: 'confirmed' }
  /** The host moved on from their reading. Only their own phone is told. */
  | { kind: 'passed' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringAt(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' ? value : null;
}

/** Null for anything unreadable, and for a round with no reference in it. */
export function readDrill(view: unknown): Drill | null {
  if (!isRecord(view)) return null;
  const reference = stringAt(view, 'reference');
  if (reference === null || reference.length === 0) return null;
  const text = stringAt(view, 'text');
  return {
    reference,
    translation: stringAt(view, 'translation') ?? '',
    ...(text !== null && text.length > 0 ? { text } : {}),
  };
}

export function readReveal(detail: unknown): DrillReveal | null {
  if (!isRecord(detail)) return null;
  const reference = stringAt(detail, 'reference');
  if (reference === null || reference.length === 0) return null;
  const listed = Array.isArray(detail['confirmed']) ? detail['confirmed'] : [];
  return {
    reference,
    text: stringAt(detail, 'text') ?? '',
    translation: stringAt(detail, 'translation') ?? '',
    confirmed: listed.filter((id): id is string => typeof id === 'string'),
  };
}

/**
 * Players the host has confirmed while the round is still live. The room keeps
 * a sword-drill round open past each confirmation and lists who it confirmed;
 * the list is still checked, because it arrives over the wire.
 */
export function confirmedIn(buzz: PublicBuzzState | null): PlayerId[] {
  const listed: unknown = buzz?.confirmed;
  return Array.isArray(listed) ? listed.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * `spent` no longer travels on `buzz` itself — a screen the whole room is
 * watching must not be able to name who already answered wrong (see
 * `PublicBuzzState`'s own doc comment) — so it arrives separately: this
 * player's own `youAreSpent` for their own phone, or the controller's
 * `ControlPanel.spent` for calling on someone else's.
 */
export function placeOf(buzz: PublicBuzzState | null, playerId: PlayerId, spent: readonly PlayerId[]): Place {
  if (buzz === null) return { kind: 'free' };
  // Confirmed is checked first: a confirmed reader may also be recorded as
  // having had their turn, and praise is the thing to tell them.
  if (confirmedIn(buzz).includes(playerId)) return { kind: 'confirmed' };
  const position = buzz.queue.findIndex((entry) => entry.playerId === playerId);
  if (position === 0) return { kind: 'reading' };
  if (position > 0) return { kind: 'waiting', ahead: position };
  if (spent.includes(playerId)) return { kind: 'passed' };
  return { kind: 'free' };
}

/**
 * How many phones have tapped "Found it" this round, however it went for
 * them. A count names nobody, so the big screen may show it — accurate
 * while this device holds control and knows who is spent; undercounted by
 * however many are spent otherwise, which is the honest number this device
 * can vouch for rather than a guess.
 */
export function tappedCount(buzz: PublicBuzzState | null, spent: readonly PlayerId[]): number {
  if (buzz === null) return 0;
  const ids = new Set<PlayerId>([
    ...buzz.queue.map((entry) => entry.playerId),
    ...spent,
    ...confirmedIn(buzz),
  ]);
  return ids.size;
}

export function nameOf(players: readonly PublicPlayer[], id: PlayerId): string | null {
  return players.find((player) => player.id === id)?.name ?? null;
}

/** Names for a list of ids, skipping anyone who has since left the room. */
export function namesOf(players: readonly PublicPlayer[], ids: readonly PlayerId[]): string[] {
  const names: string[] = [];
  for (const id of ids) {
    const name = nameOf(players, id);
    if (name !== null) names.push(name);
  }
  return names;
}

/**
 * The timestamp a "Found it" tap carries: this phone's own clock, uncorrected.
 *
 * The shell posts the phone's measured clock offset beside every buzz, and the
 * room applies it. Stamping the tap with an estimate of server time instead
 * would apply the same offset a second time.
 */
export function pressedAt(): ClientTime {
  return Date.now();
}
