/**
 * The big screen.
 *
 * The board is the game's face, so it is on the screen whenever there is not a
 * question to read: while the tile is being announced, and again at the
 * reveal, with the tile just played now marked as played. Played tiles carry a
 * word as well as a dimmer colour, because a projector in a lit hall washes
 * colour out long before it washes out text.
 *
 * The screen never shows who answered what. What it shows of the room is a bar
 * chart of counts, which is the same information a room can hear in the noise
 * it makes, and none of the information that makes someone not want to guess.
 */

import type { HostViewProps } from '../../shell/gameViews.js';
import { letterFor, readDetail, readHostView, tileCaption } from './payload.js';
import type { BoardColumn, TileState } from './payload.js';

function Nothing({ line }: { line: string }) {
  return (
    <section class="cb cb-host">
      <p class="cb-nothing">{line}</p>
    </section>
  );
}

const STATE_WORDS: Record<TileState, string> = {
  open: '',
  played: 'played',
  current: 'now',
};

/**
 * The grid. At the reveal the tile in play is shown as played, because by then
 * it is: the next thing the room sees is the board without it.
 *
 * Given `onChoose`, every open tile becomes a button that picks it. Played
 * tiles never do, so the host cannot ask for a question the room has seen; the
 * server refuses one anyway, since a stale screen could still send it.
 */
function Board({
  columns,
  size,
  settled = false,
  onChoose,
}: {
  columns: BoardColumn[];
  size: 'large' | 'small';
  settled?: boolean;
  onChoose?: (choice: string) => void;
}) {
  return (
    <ol
      class={`cb-board cb-board-${size}`}
      style={`--cb-columns: ${columns.length}`}
      aria-label="The board"
    >
      {columns.map((column) => (
        <li key={column.name} class="cb-column">
          <h3 class="cb-category">{column.name}</h3>
          <ol class="cb-tiles">
            {column.tiles.map((tile) => {
              const state: TileState = settled && tile.state === 'current' ? 'played' : tile.state;
              const word = STATE_WORDS[state];
              const face = (
                <>
                  <span class="cb-tile-value">{tile.value}</span>
                  {word.length > 0 && <span class="cb-tile-word">{word}</span>}
                </>
              );
              const choice = tile.choice;
              return (
                <li
                  key={tile.value}
                  class="cb-tile"
                  data-state={state}
                  aria-current={state === 'current' ? 'true' : undefined}
                >
                  {onChoose && state === 'open' && choice !== null ? (
                    <button
                      type="button"
                      class="cb-tile-pick"
                      aria-label={`${column.name} for ${tile.value}`}
                      onClick={() => onChoose(choice)}
                    >
                      {face}
                    </button>
                  ) : (
                    face
                  )}
                </li>
              );
            })}
          </ol>
        </li>
      ))}
    </ol>
  );
}

function Cleared({ columns }: { columns: BoardColumn[] }) {
  return (
    <section class="cb cb-host">
      <h2 class="cb-ask">The board is cleared.</h2>
      <Board columns={columns} size="large" />
    </section>
  );
}

export function HostQuestion({ view }: HostViewProps) {
  const board = readHostView(view);
  if (!board) return <Nothing line="Nothing to show for this round." />;
  if (!board.tile) return <Cleared columns={board.columns} />;

  return (
    <section class="cb cb-host">
      <Board columns={board.columns} size="large" />
      <p class="cb-caption">{tileCaption(board.tile.category, board.tile.value)}</p>
      <h2 class="cb-prompt cb-prompt-large">{board.tile.prompt}</h2>
      <p class="cb-hint">Read it. Answers open in a moment.</p>
    </section>
  );
}

export function HostAnswering({ view }: HostViewProps) {
  const board = readHostView(view);
  if (!board) return <Nothing line="Nothing to show for this round." />;
  if (!board.tile) return <Cleared columns={board.columns} />;

  return (
    <section class="cb cb-host">
      <p class="cb-caption">{tileCaption(board.tile.category, board.tile.value)}</p>
      <h2 class="cb-prompt">{board.tile.prompt}</h2>
      <ol class="cb-options" aria-label="The options">
        {board.tile.options.map((option) => (
          <li key={option.index} class="cb-option">
            <span class="cb-letter">{letterFor(option.index)}</span>
            <span class="cb-label">{option.label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The answer, the split, and the board — which is where the host picks the next
 * tile. Picking is offered only while there is a next question to pick; Next
 * question in the control bar still plays the next tile along without anyone
 * choosing.
 */
export function HostReveal({ snapshot, view, reveal, send }: HostViewProps) {
  const board = readHostView(view);
  if (!board) return <Nothing line="Nothing to show for this round." />;
  if (!board.tile) return <Cleared columns={board.columns} />;

  const detail = readDetail(reveal?.detail);
  if (!reveal || !detail) return <Nothing line="Waiting for the answer." />;

  const moreToPlay = snapshot.round + 1 < snapshot.totalRounds;
  const choose = moreToPlay ? (choice: string) => send({ cmd: 'choose', choice }) : undefined;

  const aggregates = reveal.aggregates;
  const most = aggregates.reduce((high, row) => Math.max(high, row.count), 0);
  const answered = aggregates.reduce((total, row) => total + row.count, 0);
  // Played as a team vote, the shell draws each team's split under this view,
  // so the room's own split here would say the same thing twice.
  const teamVote = reveal.groups !== undefined;

  return (
    <section class="cb cb-host">
      <p class="cb-caption">{tileCaption(detail.category, detail.value)}</p>
      <p class="cb-answer-label">The answer</p>
      <h2 class="cb-answer">{reveal.correctLabel}</h2>
      {detail.reference !== null && <p class="cb-reference">{detail.reference}</p>}

      {!teamVote && (
        <>
          <ul class="cb-split" aria-label="How the room answered">
            {aggregates.map((row) => (
              <li key={row.label} class="cb-split-row" data-correct={row.label === reveal.correctLabel}>
                <span class="cb-split-label">{row.label}</span>
                <span class="cb-bar">
                  <span
                    class="cb-bar-fill"
                    style={{ width: `${most === 0 ? 0 : Math.round((row.count / most) * 100)}%` }}
                  />
                </span>
                <span class="cb-split-count">{row.count}</span>
              </li>
            ))}
          </ul>
          <p class="cb-muted">
            {answered === 1 ? '1 answer' : `${answered} answers`} — nobody is named.
          </p>
        </>
      )}

      {choose && <p class="cb-hint">Tap a tile to choose the next question.</p>}
      <Board columns={board.columns} size="small" settled {...(choose ? { onChoose: choose } : {})} />
    </section>
  );
}
