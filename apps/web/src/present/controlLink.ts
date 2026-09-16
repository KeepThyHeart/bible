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

/** `/present/f/<joinCode>`, with the join code as the first capture. */
const FOLLOW_PATH = /^\/present\/f\/([0-9A-HJKMNP-TV-Z]{8})\/?$/;

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

/**
 * The URL a phone follows along on: the join code, and nothing privileged --
 * same as `buildViewerLink`, just the other destination.
 */
export function buildFollowLink(joinCode: string, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/present/f/${joinCode}`;
}

/**
 * Read a join code out of a `/present/f/<code>` URL, if this is one.
 *
 * Unlike `parseControlLink`, there is no secret to take out of the address
 * bar and scrub: the join code is exactly what the QR code and the viewer
 * link already hand out (see `buildViewerLink`), so it is fine to sit in the
 * path and in history. `takeFollowLinkFromUrl` still exists for the same
 * "read once at boot" shape `main.tsx` already uses for the control link.
 */
export function parseFollowLink(pathname: string): string | null {
  const match = FOLLOW_PATH.exec(pathname);
  return match ? match[1] : null;
}

/** `parseFollowLink`, read from `window.location`. Returns null on every ordinary page load. */
export function takeFollowLinkFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return parseFollowLink(window.location.pathname);
}

/**
 * `/watch`, the short address someone can type by hand rather than scan or
 * paste -- see `watch.html`. No join code in the path: the code-entry form is
 * the whole point of typing this instead of following a link.
 */
export function buildWatchLink(origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/watch`;
}

/**
 * `host/watch`, without the scheme -- what actually gets typed. A presenter
 * reading this off a slide is not going to type "https://"; every browser's
 * address bar fills it in.
 */
export function typedWatchAddress(origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base.replace(/^[a-z]+:\/\//i, '')}/watch`;
}
