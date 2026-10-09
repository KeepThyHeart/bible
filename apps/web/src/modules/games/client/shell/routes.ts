/**
 * Routing, hand-rolled over the History API.
 *
 * There are three destinations and they never nest, so a router library would
 * be more configuration than the thing it configures. What matters here is
 * that a link a QR code produced (`/play?room=QK7P`) lands on the join screen
 * with the code already filled in — a code typed by hand at a distance from
 * the screen is the most error-prone moment in the whole evening.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { ROOM_CODE_ALPHABET } from '../../shared/protocol.js';
import type { RoomCode } from '../../shared/protocol.js';

/**
 * `screen` is the name; `host` still routes here as an alias, so a leader
 * who types the old path still lands in the right place. `home` is the bare
 * root with no code: the landing page with its two doors.
 */
/** The pages the server serves for the standalone client (`server/modules/games/gamesPages.ts`). */
export const PATHS = {
  base: '/games',
  play: '/games/play',
  screen: '/games/screen',
  solo: '/games/solo',
} as const;

export type RouteName = 'home' | 'screen' | 'play' | 'solo';

export interface Route {
  name: RouteName;
  /** Room code carried by the link, already normalised. */
  code: RoomCode | null;
  /**
   * A display token carried by the link (`t=`), for `screen` only — the QR
   * a room's owner shows to add a second screen. Never present otherwise.
   */
  displayToken: string | null;
}

export interface RouteState {
  route: Route;
  navigate(to: string, replace?: boolean): void;
}

/** Codes travel through URLs, hands and camera lenses, so accept them loosely. */
export function normaliseCode(raw: string): RoomCode {
  return raw.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

const NOT_CODE_ALPHABET = new RegExp(`[^${ROOM_CODE_ALPHABET}]`, 'g');

/**
 * A stricter pass for a code someone is actually typing (`JoinScreen`), on
 * top of `normaliseCode`'s general tidy-up: a code never contains `0`/`O`,
 * `1`/`I`/`L`, `U`, or the low-contrast look-alike pairs the alphabet was
 * chosen to exclude (see `server/transport/codes.ts`), so a character
 * outside it is always a typo, worth dropping before the round trip that
 * would otherwise be the only thing to say so.
 */
export function filterToCodeAlphabet(raw: string): RoomCode {
  return normaliseCode(raw).replace(NOT_CODE_ALPHABET, '');
}

export function readRoute(pathname: string, search: string): Route {
  const params = new URLSearchParams(search);
  const raw = params.get('room') ?? params.get('code') ?? '';
  const code = normaliseCode(raw);
  // `/games/play` -> `/play`. The bare paths stay understood (they were the standalone app's own).
  const path = pathname.replace(/\/+$/, '').toLowerCase().replace(/^\/games(?=\/|$)/, '');
  // The bare root with nothing else going on is the one case worth a
  // landing screen: `/` with a code (a link someone made by hand, pointed at
  // the root rather than `/play`) still means "join this room", not "start
  // over at the front door", and every other path keeps meaning what it
  // always has.
  const name: RouteName =
    path === '/screen' || path === '/host'
      ? 'screen'
      : path === '/solo'
        ? 'solo'
        : path === '' && code.length === 0
          ? 'home'
          : 'play';
  const t = name === 'screen' ? params.get('t') : null;
  return {
    name,
    code: code.length > 0 ? code : null,
    displayToken: t && t.length > 0 ? t : null,
  };
}

export function joinUrl(origin: string, code: RoomCode): string {
  return `${origin}${PATHS.play}?room=${encodeURIComponent(code)}`;
}

/** The QR a room's owner shows to add a second screen — never shown to the room itself. */
export function screenUrl(origin: string, code: RoomCode, displayToken: string): string {
  return `${origin}${PATHS.screen}?room=${encodeURIComponent(code)}&t=${encodeURIComponent(displayToken)}`;
}

function current(): Route {
  return readRoute(location.pathname, location.search);
}

export function useRoute(): RouteState {
  const [route, setRoute] = useState<Route>(current);

  useEffect(() => {
    const onPop = () => setRoute(current());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  // pushState deliberately does not fire popstate, so our own navigations have
  // to update state here; the listener above is only for the back button.
  const navigate = useCallback((to: string, replace = false) => {
    if (replace) history.replaceState(null, '', to);
    else history.pushState(null, '', to);
    setRoute(current());
  }, []);

  return { route, navigate };
}

/**
 * The same interface over memory, for the host screen embedded in the reader:
 * its address bar belongs to the reader (`#/@games`), so game navigation must
 * not touch it. `to` is parsed exactly as a URL would be.
 */
export function useMemoryRoute(initial: string = PATHS.base): RouteState {
  const parse = (to: string): Route => {
    const url = new URL(to, 'http://games.invalid');
    return readRoute(url.pathname, url.search);
  };
  const [route, setRoute] = useState<Route>(() => parse(initial));
  const navigate = useCallback((to: string) => setRoute(parse(to)), []);
  return { route, navigate };
}
