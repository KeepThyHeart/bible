/**
 * The handoff link: how control of a session moves from one device to another.
 *
 * This is what makes "prepare on a desktop, present from a phone" work, which
 * is the reason a session can be driven at all without user accounts. The
 * running order already lives on the session server-side; this carries the one
 * thing that does not, the control token.
 *
 * The token goes in the URL **fragment**, never the path or the query. Browsers
 * do not send a fragment to the server, so it stays out of access logs, out of
 * `Referer` headers on anything the page later links to, and out of any proxy
 * in between. It is read once on load and then removed from the address bar --
 * partly so the app's own `#/KJV/43/3` navigation hash is not fighting it, and
 * partly so the token is not sitting in a visible address bar on a laptop that
 * may itself be plugged into a projector.
 *
 * `/present/c/<sessionId>` is served by the SPA catch-all, so no server route is
 * needed: it is the reading app, which is the whole point of session mode.
 */

import type { ControllerSession } from '../stores/presentStore';

/** `/present/c/<sessionId>`, with the session id as the first capture. */
const CONTROL_PATH = /^\/present\/c\/([0-9A-HJKMNP-TV-Z]{16})\/?$/;

/** Crockford base32, which excludes I, L, O and U. */
const JOIN_CODE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/**
 * A session picked up from a handoff link.
 *
 * The fragment is `#t=<token>&j=<joinCode>&x=<expiry>`: the join code and
 * expiry ride along so the receiving device can open its stream and know when
 * the session dies without a round trip -- and, more to the point, without an
 * endpoint that turns a control token into a join code, which would be a way to
 * escalate one capability into the other.
 */
export type AdoptedSession = ControllerSession;

function fragmentParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
}

/**
 * Read a session out of a handoff URL, if this is one.
 *
 * Returns null for every ordinary page load, which is the overwhelming majority
 * of them.
 */
export function parseControlLink(url: {
  pathname: string;
  hash: string;
}): AdoptedSession | null {
  const path = CONTROL_PATH.exec(url.pathname);
  if (!path) return null;

  const params = fragmentParams(url.hash);
  const controlToken = params.get('t');
  const joinCode = params.get('j');
  if (!controlToken || !joinCode) return null;
  if (!JOIN_CODE.test(joinCode)) return null;
  // Base64url, and long enough to be the 256-bit value the server mints.
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(controlToken)) return null;

  const expiry = params.get('x');
  return {
    sessionId: path[1],
    joinCode,
    controlToken,
    expiresAt: expiry && !Number.isNaN(Date.parse(expiry)) ? expiry : '',
  };
}

/**
 * Take the session out of the current URL and scrub the address bar.
 *
 * Called before anything else reads `location.hash` -- the reader's own
 * navigation hash and this one occupy the same slot, and leaving a token there
 * for `navigateFromHash` to trip over is the kind of ordering bug that only
 * shows up on the one machine that matters.
 */
export function takeControlLinkFromUrl(): AdoptedSession | null {
  if (typeof window === 'undefined') return null;

  const adopted = parseControlLink(window.location);
  if (!adopted) return null;

  try {
    // Back to the app's own root, with no token in the bar and no history entry
    // holding one either.
    window.history.replaceState(null, '', '/');
  } catch {
    // A browser that refuses this leaves the token visible; the session still
    // works, which is the part the presenter is depending on.
  }
  return adopted;
}

/**
 * Build the link that hands this session to another device.
 *
 * Whoever holds this drives the screen, so it belongs behind a deliberate
 * action and a plain warning, never on the wall and never in the lobby.
 */
export function buildControlLink(session: ControllerSession, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const params = new URLSearchParams({ t: session.controlToken, j: session.joinCode });
  if (session.expiresAt) params.set('x', session.expiresAt);
  return `${base}/present/c/${session.sessionId}#${params.toString()}`;
}

/** The URL a viewer opens: the join code, and nothing privileged. */
export function buildViewerLink(joinCode: string, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/present/v/${joinCode}`;
}
