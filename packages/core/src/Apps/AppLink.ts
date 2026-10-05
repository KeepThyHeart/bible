/**
 * App deep links (task 0080).
 *
 * - Web: the location hash `#/@<segment>[/<route>]`, e.g. `#/@present` or
 *   `#/@memorize/review/today`. Study's own hash (`#/KJV/43/3`, no `@`) is not
 *   an app link and stays the reader's, unchanged.
 * - Desktop: the internal URI `app:<segment>[/<route>]` (commands, session
 *   restore). No OS protocol is registered.
 *
 * `segment` is the app's deep-link segment (its id unless the descriptor sets
 * `deepLink.segment`); the shell maps it back to an app id. `route` is opaque
 * to the host: the app owns its format. Each route segment is
 * percent-encoded on format and decoded on parse, so any string without a
 * leading or trailing `/` survives a round trip.
 */

export interface AppLink {
  /** The deep-link segment (usually the app id). Lowercase. */
  readonly segment: string;
  /** The app's own route, '' when none. Never starts or ends with `/`. */
  readonly route: string;
}

export type AppLinkScheme = 'hash' | 'uri';

/** Segment grammar: lowercase ids, dots and dashes inside (extension ids are dotted). */
const SEGMENT_RE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

const HASH_PREFIX = '#/@';
const URI_PREFIX = 'app:';

export function isValidAppLinkSegment(segment: string): boolean {
  return SEGMENT_RE.test(segment) && !segment.includes('..');
}

/**
 * Parse `#/@id[/route]` (with or without the leading `#`) or `app:id[/route]`.
 * Returns null for anything else, including Study's hashes, an empty or
 * malformed segment, and a route with broken percent-encoding.
 */
export function parseAppLink(input: string | null | undefined): AppLink | null {
  if (typeof input !== 'string') return null;
  let rest: string;
  if (input.startsWith(HASH_PREFIX)) rest = input.slice(HASH_PREFIX.length);
  else if (input.startsWith(HASH_PREFIX.slice(1))) rest = input.slice(HASH_PREFIX.length - 1);
  else if (input.startsWith(URI_PREFIX)) rest = input.slice(URI_PREFIX.length);
  else return null;

  const slash = rest.indexOf('/');
  const segment = slash === -1 ? rest : rest.slice(0, slash);
  if (!isValidAppLinkSegment(segment)) return null;
  const rawRoute = slash === -1 ? '' : rest.slice(slash + 1);
  const parts = rawRoute.split('/').filter((p) => p !== '');
  try {
    return { segment, route: parts.map((p) => decodeURIComponent(p)).join('/') };
  } catch {
    return null;
  }
}

/**
 * Format a link. Throws for an invalid segment (a programming error: ids are
 * validated at registration). Empty route segments are dropped.
 */
export function formatAppLink(segment: string, route = '', scheme: AppLinkScheme = 'hash'): string {
  if (!isValidAppLinkSegment(segment)) throw new Error(`Invalid app link segment "${segment}"`);
  const parts = route.split('/').filter((p) => p !== '');
  const tail = parts.length ? `/${parts.map((p) => encodeURIComponent(p)).join('/')}` : '';
  return `${scheme === 'hash' ? HASH_PREFIX : URI_PREFIX}${segment}${tail}`;
}

/** True when a location hash belongs to the app host (`#/@…`), whether or not it parses. */
export function isAppHash(hash: string): boolean {
  return hash.startsWith(HASH_PREFIX) || hash.startsWith(HASH_PREFIX.slice(1));
}
