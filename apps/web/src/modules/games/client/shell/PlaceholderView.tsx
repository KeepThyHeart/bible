/**
 * What the shell renders when the room's game has no views registered here.
 *
 * This is not only a development convenience. A host on a stale tab and a
 * phone that loaded a newer bundle can disagree about which games exist, and
 * "this game is not installed" on the screen is a fixable situation, whereas a
 * blank projector in front of a room is not.
 */

import type { HostViewProps, PlayerViewProps } from './gameViews.js';

export function HostPlaceholder({ snapshot }: HostViewProps) {
  return (
    <section class="placeholder">
      <h2>No view for this game</h2>
      <p class="muted">
        The room is playing <strong>{snapshot.settings.gameId}</strong>, which this screen does not
        know how to draw.
      </p>
      <p class="muted">Phase: {snapshot.phase}</p>
    </section>
  );
}

export function PlayerPlaceholder({ snapshot }: PlayerViewProps) {
  return (
    <section class="placeholder">
      <h2>Nothing to do here yet</h2>
      <p class="muted">
        This phone has no screen for <strong>{snapshot.settings.gameId}</strong>. Reload the page,
        and tell the host if it stays this way.
      </p>
    </section>
  );
}
