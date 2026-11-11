/**
 * What the shell renders when the room's game has no views registered here.
 *
 * This is not only a development convenience. A host on a stale tab and a
 * phone that loaded a newer bundle can disagree about which games exist, and
 * "this game is not installed" on the screen is a fixable situation, whereas a
 * blank projector in front of a room is not.
 */

import type { HostViewProps, PlayerViewProps } from './gameViews.js';
import { gt } from './t.js';

export function HostPlaceholder({ snapshot }: HostViewProps) {
  return (
    <section class="placeholder">
      <h2>{gt('games.placeholder.noView', 'No view for this game')}</h2>
      <p class="muted">
        {gt('games.placeholder.playingBefore', 'The game being played is')} <strong>{snapshot.settings.gameId}</strong>
        {gt('games.placeholder.playingAfter', ', which this screen does not know how to draw.')}
      </p>
      <p class="muted">{gt('games.placeholder.phase', 'Phase:')} {snapshot.phase}</p>
    </section>
  );
}

export function PlayerPlaceholder({ snapshot }: PlayerViewProps) {
  return (
    <section class="placeholder">
      <h2>{gt('games.placeholder.nothingYet', 'Nothing to do here yet')}</h2>
      <p class="muted">
        {gt('games.placeholder.noScreenBefore', 'This phone has no screen for')} <strong>{snapshot.settings.gameId}</strong>
        {gt('games.placeholder.noScreenAfter', '. Reload the page, and tell the organizer if it stays this way.')}
      </p>
    </section>
  );
}
