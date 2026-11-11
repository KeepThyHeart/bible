/**
 * The organizer's tile pick.
 *
 * Shown on whichever device holds control, at the reveal and only while there
 * is a next question to pick. It reads the same board the big screen draws and
 * offers the tiles still open as a compact grid. Played tiles are left out
 * rather than disabled, so the organizer is never asked to read past what the
 * room has already seen; the server refuses a played tile anyway, since a stale
 * device could still send one.
 *
 * Leaving it alone is fine: Next question plays the next tile along the
 * board's own walk.
 */

import type { ControlViewProps } from '../../shell/gameViews.js';
import { gt } from '../../shell/t.js';
import { readHostView } from './payload.js';

export function ControlTilePick({ snapshot, send }: ControlViewProps) {
  if (snapshot.phase !== 'reveal') return null;
  if (snapshot.round + 1 >= snapshot.totalRounds) return null;

  const board = readHostView(snapshot.view);
  if (!board) return null;

  const columns = board.columns
    .map((column) => ({
      name: column.name,
      tiles: column.tiles.flatMap((tile) =>
        tile.state === 'open' && tile.choice !== null ? [{ value: tile.value, choice: tile.choice }] : []
      ),
    }))
    .filter((column) => column.tiles.length > 0);
  if (columns.length === 0) return null;

  const heading = gt('games.categoryBoard.control.heading', 'Choose the next tile');
  return (
    <section class="cb cb-control" aria-label={heading}>
      <p class="cb-control-heading">{heading}</p>
      <ul class="cb-control-columns">
        {columns.map((column) => (
          <li key={column.name} class="cb-control-column">
            <p class="cb-control-category">{column.name}</p>
            <ul class="cb-control-tiles">
              {column.tiles.map((tile) => (
                <li key={tile.value}>
                  <button
                    type="button"
                    class="cb-tile-pick"
                    aria-label={`${column.name} for ${tile.value}`}
                    onClick={() => send({ cmd: 'choose', choice: tile.choice })}
                  >
                    {tile.value}
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
