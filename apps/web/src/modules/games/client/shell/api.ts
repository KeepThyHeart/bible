/**
 * The upstream half of the transport: plain JSON POSTs.
 *
 * Failures come back as values rather than exceptions. A phone on guest wifi
 * fails requests as a matter of routine, and every call site here has
 * something better to render than a stack trace.
 */

import type {
  Catalog,
  CreateRoomResponse,
  Intent,
  JoinResponse,
  RoomCode,
  RoomSettings,
  Standing,
  TeamId,
} from '../../shared/protocol.js';
import { API } from '../../shared/protocol.js';
import type { ClockReport } from '../clock/index.js';

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string };

const OFFLINE = 'Could not reach the server. Check the wifi and try again.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function request<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
  const response = await fetch(url, init).catch(() => null);
  if (!response) return { ok: false, error: OFFLINE };

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(body) && typeof body['message'] === 'string' ? body['message'] : null;
    return { ok: false, error: message ?? `Server said ${response.status}.` };
  }
  return { ok: true, value: body as T };
}

function post<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function createRoom(settings: Partial<RoomSettings>): Promise<ApiResult<CreateRoomResponse>> {
  return post<CreateRoomResponse>(API.createRoom, { settings });
}

/**
 * Joining is an intent like any other, but it is the one sent without a token —
 * it is what issues one.
 */
export function joinRoom(
  code: RoomCode,
  name: string,
  teamId: TeamId | null
): Promise<ApiResult<JoinResponse>> {
  const intent: Intent =
    teamId === null ? { kind: 'join', name } : { kind: 'join', name, teamId };
  return post<JoinResponse>(API.intent(code), { intent });
}

/**
 * A clock measurement rides beside the intent rather than inside it: it is not
 * something the player did, and the server decides how far to believe it.
 */
export function sendIntent(
  code: RoomCode,
  token: string,
  intent: Intent,
  clock: ClockReport | null = null
): Promise<ApiResult<unknown>> {
  return post<unknown>(API.intent(code), clock === null ? { token, intent } : { token, intent, clock });
}

export const EMPTY_CATALOG: Catalog = { games: [], sets: [], translations: [] };

export async function fetchCatalog(): Promise<Catalog> {
  const result = await request<Partial<Catalog>>(API.catalog, { method: 'GET' });
  if (!result.ok) return EMPTY_CATALOG;
  const value = result.value;
  return {
    games: Array.isArray(value.games) ? value.games : [],
    sets: Array.isArray(value.sets) ? value.sets : [],
    translations: Array.isArray(value.translations) ? value.translations : [],
  };
}

export type FullStandings = { standings: Standing[] };
