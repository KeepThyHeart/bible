/**
 * Session tokens, kept per room in localStorage.
 *
 * The point of storing them is that a reload, an accidental back gesture or a
 * phone waking from lock rejoins as the *same* player. Creating a second
 * player instead is visible to the whole group — a duplicate name in the
 * roster and a score that starts again at zero — so this is worth the storage.
 *
 * Every access is allowed to fail. Private windows, blocked cookies and some
 * embedded webviews either omit `localStorage` or throw when it is touched, and
 * a phone that cannot remember a token still plays fine by joining again. The
 * catches below are there because that exception is expected and its handling
 * is deliberate, not to paper over a bug.
 */

import type { PlayerId, RoomCode, SessionToken } from '../../shared/protocol.js';

const PREFIX = 'bible-games';

const sessionKey = (code: RoomCode) => `${PREFIX}:session:${code}`;
const ownerKey = (code: RoomCode) => `${PREFIX}:owner:${code}`;
const NAME_KEY = `${PREFIX}:name`;
const LAST_ROOM_KEY = `${PREFIX}:last-room`;

export interface RoomSession {
  code: RoomCode;
  playerId: PlayerId;
  token: SessionToken;
  name: string;
}

/**
 * What the device that created a room keeps. `displayToken` never travels
 * over the wire again after creation and is never displayed to the room
 * itself — only shown, as a QR, to whoever is adding a second screen (see
 * `HostToken`'s own doc comment in the protocol). Kept here rather than
 * requested again because there is no way to ask the server for it a second
 * time: it is handed out once, at creation, like the owner token.
 */
export interface OwnerSession {
  code: RoomCode;
  ownerToken: string;
  displayToken: string;
}

/**
 * How long an owner session may sit untouched before `/screen` (and its
 * `/host` alias) stops offering to resume it and starts a fresh room instead.
 * Visiting `/host` used to silently reconnect to whatever room this device
 * last hosted, however long ago that was — a week-old, long-closed room
 * greeting a host who meant to start a new one. Long enough that a single
 * event's natural pauses (a meal break, moving rooms, a laptop sleeping
 * between rounds) never trip it; short enough that coming back another day
 * gets a clean room.
 */
export const OWNER_SESSION_CUTOFF_MS = 8 * 60 * 60 * 1000;

interface StoredOwnerSession extends OwnerSession {
  /** Last time this device touched the session — see `OWNER_SESSION_CUTOFF_MS`. */
  touchedAt: number;
}

/** Reading the property itself throws when storage is disabled, not just get/set. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readItem(key: string): string | null {
  const store = storage();
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch {
    // Out of quota, or a window that only pretends to have storage. The token
    // is a convenience; losing it costs one rejoin.
    return;
  }
}

function removeItem(key: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    return;
  }
}

function parseObject(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // Someone else's key, or a half-written value from a killed tab.
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function loadSession(code: RoomCode): RoomSession | null {
  const raw = parseObject(readItem(sessionKey(code)));
  if (!raw) return null;
  const playerId = str(raw['playerId']);
  const token = str(raw['token']);
  if (!playerId || !token) return null;
  return { code, playerId, token, name: str(raw['name']) ?? '' };
}

export function saveSession(session: RoomSession): void {
  writeItem(sessionKey(session.code), JSON.stringify(session));
  writeItem(LAST_ROOM_KEY, session.code);
  if (session.name) writeItem(NAME_KEY, session.name);
}

export function clearSession(code: RoomCode): void {
  removeItem(sessionKey(code));
  if (readItem(LAST_ROOM_KEY) === code) removeItem(LAST_ROOM_KEY);
}

function readStoredOwnerSession(code: RoomCode): StoredOwnerSession | null {
  const raw = parseObject(readItem(ownerKey(code)));
  if (!raw) return null;
  const ownerToken = str(raw['ownerToken']);
  const displayToken = str(raw['displayToken']);
  if (!ownerToken || !displayToken) return null;
  const touchedAt = typeof raw['touchedAt'] === 'number' ? raw['touchedAt'] : null;
  // A session saved before this field existed is treated as freshly touched
  // rather than instantly stale.
  return { code, ownerToken, displayToken, touchedAt: touchedAt ?? Date.now() };
}

/**
 * A session untouched for longer than `OWNER_SESSION_CUTOFF_MS` is treated as
 * if it were never stored at all. Age is measured from the last touch, not
 * from when the room was first created, so a room open for a whole long
 * event is never mistaken for an abandoned one — see `touchOwnerSession`.
 */
export function loadOwnerSession(code: RoomCode): OwnerSession | null {
  const stored = readStoredOwnerSession(code);
  if (!stored) return null;
  if (Date.now() - stored.touchedAt > OWNER_SESSION_CUTOFF_MS) return null;
  return { code: stored.code, ownerToken: stored.ownerToken, displayToken: stored.displayToken };
}

export function saveOwnerSession(session: OwnerSession): void {
  const stored: StoredOwnerSession = { ...session, touchedAt: Date.now() };
  writeItem(ownerKey(session.code), JSON.stringify(stored));
  writeItem(`${PREFIX}:last-owner`, session.code);
}

/**
 * Refreshes an already-open session's touch time without changing anything
 * else. Called while a screen is actually up, so an owner who never leaves
 * the tab never sees their own room go stale underneath them.
 */
export function touchOwnerSession(code: RoomCode): void {
  const stored = readStoredOwnerSession(code);
  if (!stored) return;
  writeItem(ownerKey(code), JSON.stringify({ ...stored, touchedAt: Date.now() }));
}

export function clearOwnerSession(code: RoomCode): void {
  removeItem(ownerKey(code));
  if (readItem(`${PREFIX}:last-owner`) === code) removeItem(`${PREFIX}:last-owner`);
}

/** The room this device was last in, so a bare reload knows where to go. */
export function lastRoom(): RoomCode | null {
  return str(readItem(LAST_ROOM_KEY));
}

export function lastOwnedRoom(): RoomCode | null {
  return str(readItem(`${PREFIX}:last-owner`));
}

/** Typing a name once per device rather than once per game is the whole point. */
export function rememberedName(): string {
  return readItem(NAME_KEY) ?? '';
}

export function rememberName(name: string): void {
  if (name) writeItem(NAME_KEY, name);
}

/**
 * Solo is a room with one player who is also the host, so both halves of the
 * identity have to survive a reload together — a host token with no session
 * token is a room you can run but not play.
 *
 * It keeps its own key rather than reusing the two above, so that the room
 * someone played alone last night is not the room offered back to them when
 * they open the host screen in front of a group.
 */
export interface SoloSession {
  code: RoomCode;
  hostToken: string;
  playerId: PlayerId;
  token: SessionToken;
  name: string;
}

const SOLO_KEY = `${PREFIX}:solo`;

export function loadSoloSession(): SoloSession | null {
  const raw = parseObject(readItem(SOLO_KEY));
  if (!raw) return null;
  const code = str(raw['code']);
  const hostToken = str(raw['hostToken']);
  const playerId = str(raw['playerId']);
  const token = str(raw['token']);
  if (!code || !hostToken || !playerId || !token) return null;
  return { code, hostToken, playerId, token, name: str(raw['name']) ?? '' };
}

export function saveSoloSession(session: SoloSession): void {
  writeItem(SOLO_KEY, JSON.stringify(session));
  if (session.name) writeItem(NAME_KEY, session.name);
}

export function clearSoloSession(): void {
  removeItem(SOLO_KEY);
}
