/**
 * The rule that lets a receiver mix two sources of the same session's state --
 * the network (SSE) and, on the same machine, a `BroadcastChannel` -- without
 * ever going backwards or disagreeing with itself.
 *
 * The network is authoritative: everything a session's state can become is
 * decided by the server (see `reducer.ts` and `presentRoutes.ts`). The local
 * channel exists only so a screen sharing a browser with the controller does
 * not have to wait on a round trip to the server -- venue wifi, not this
 * machine's own bus, is the thing that can be slow or absent. So the version
 * rule below has one job: let a local frame win a tie only until the network's
 * own answer to the same change arrives, at which point the network wins.
 *
 * Kept in its own file, importing nothing runtime-specific, so it can be unit
 * tested as a pure function and shared by every receiver (the projection
 * viewer, a follow-along tab, and the controller's own preview).
 */

import type { PresentState } from '../protocol';

export type FrameOrigin = 'network' | 'local';

export interface PresentFrame {
  origin: FrameOrigin;
  state: PresentState;
}

/**
 * Whether `incoming` should replace `current`.
 *
 *  - A strictly newer version always wins: this is what makes a dropped or
 *    reordered frame harmless, exactly as it already is for the SSE-only path.
 *  - On an *equal* version, a network frame replaces a local one, but never
 *    the other way around. That is the one asymmetry in this file, and it is
 *    what keeps a locally predicted frame from displacing the server's actual
 *    answer if both happen to describe the same version number.
 *  - Nothing else is a reason to update: an older version is a duplicate or a
 *    reordered delivery, and an equal version from the same kind of source a
 *    second time is a no-op.
 */
export function isNewer(current: PresentState | null, incoming: PresentFrame): boolean {
  if (!current) return true;
  if (incoming.state.version > current.version) return true;
  if (incoming.state.version < current.version) return false;
  return incoming.origin === 'network';
}

/**
 * Whether two states would look identical to a viewer: same item, position
 * and display, ignoring `session.viewerCount` (no viewer displays it, and a
 * locally predicted frame never carries a real one anyway).
 *
 * This is what a receiver uses to decide whether a frame that *wins* `isNewer`
 * is actually worth telling its subscribers about. The common case it exists
 * for: a controller predicts a `show` locally and publishes it over
 * `BroadcastChannel`, and the network's own answer to that same POST arrives
 * moments later at the same version, confirming exactly what was predicted.
 * Both frames are legitimately "newer" by `isNewer`'s own rule (the tie goes
 * to the network), but replaying an identical render is not a second change
 * -- it is the same change told twice, and for an item whose content is still
 * loading (a hymn's slides, fetched separately by every viewer), that second,
 * uncurtained re-render is what showed up as a visible double flash.
 */
export function renderEquivalent(a: PresentState, b: PresentState): boolean {
  return a.version === b.version
    && JSON.stringify(a.live) === JSON.stringify(b.live)
    && JSON.stringify(a.position) === JSON.stringify(b.position)
    && JSON.stringify(a.display) === JSON.stringify(b.display);
}
