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
import { gt } from '../../shell/t.js';
import { awaitingReveal } from '../../shell/waitingCopy.js';
import { letterFor, readDetail, readHostView, tileCaption } from './payload.js';
import type { BoardColumn, TileState } from './payload.js';

function Nothing({ line }: { line: string }) {
  return (
    <section class="cb cb-host">
      <p class="cb-nothing">{line}</p>
    </section>
  );
}

function stateWord(state: TileState): string {
  if (state === 'played') return gt('games.categoryBoard.view.tilePlayed', 'played');
  if (state === 'current') return gt('games.categoryBoard.view.tileNow', 'now');
  return '';
}

/**
 * The grid, read-only. At the reveal the tile in play is shown as played,
 * because by then it is: the next thing the room sees is the board without it.
 * Picking the next tile happens on the organizer's own device.
 */
function Board({
  columns,
  size,
  settled = false,
}: {
  columns: BoardColumn[];
  size: 'large' | 'small';
  settled?: boolean;
}) {
  return (
    <ol
      class={`cb-board cb-board-${size}`}
      style={`--cb-columns: ${columns.length}`}
      aria-label={gt('games.categoryBoard.view.board', 'The board')}
    >
      {columns.map((column) => (
        <li key={column.name} class="cb-column">
          <h3 class="cb-category">{column.name}</h3>
          <ol class="cb-tiles">
            {column.tiles.map((tile) => {
              const state: TileState = settled && tile.state === 'current' ? 'played' : tile.state;
              const word = stateWord(state);
              const face = (
                <>
                  <span class="cb-tile-value">{tile.value}</span>
                  {word.length > 0 && <span class="cb-tile-word">{word}</span>}
                </>
              );
              return (
                <li
                  key={tile.value}
                  class="cb-tile"
                  data-state={state}
                  aria-current={state === 'current' ? 'true' : undefined}
                >
                  {face}
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
      <h2 class="cb-ask">{gt('games.categoryBoard.view.cleared', 'The board is cleared.')}</h2>
      <Board columns={columns} size="large" />
    </section>
  );
}

export function HostQuestion({ view }: HostViewProps) {
  const board = readHostView(view);
  if (!board) return <Nothing line={gt('games.categoryBoard.view.nothingToShow', 'Nothing to show for this round.')} />;
  if (!board.tile) return <Cleared columns={board.columns} />;

  return (
    <section class="cb cb-host">
      <Board columns={board.columns} size="large" />
      <p class="cb-caption">{tileCaption(board.tile.category, board.tile.value)}</p>
      <h2 class="cb-prompt cb-prompt-large">{board.tile.prompt}</h2>
      <p class="cb-hint">{gt('games.categoryBoard.view.readIt', 'Read it. Answers open in a moment.')}</p>
    </section>
  );
}

export function HostAnswering({ view }: HostViewProps) {
  const board = readHostView(view);
  if (!board) return <Nothing line={gt('games.categoryBoard.view.nothingToShow', 'Nothing to show for this round.')} />;
  if (!board.tile) return <Cleared columns={board.columns} />;

  return (
    <section class="cb cb-host">
      <p class="cb-caption">{tileCaption(board.tile.category, board.tile.value)}</p>
      <h2 class="cb-prompt">{board.tile.prompt}</h2>
      <ol class="cb-options" aria-label={gt('games.categoryBoard.view.options', 'The options')}>
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
 * The answer, the split, and the board with the tile just played marked.
 * Picking the next tile is the organizer's, on their own device; Next question
 * still plays the next tile along without anyone choosing.
 */
export function HostReveal({ view, reveal }: HostViewProps) {
  const board = readHostView(view);
  if (!board) return <Nothing line={gt('games.categoryBoard.view.nothingToShow', 'Nothing to show for this round.')} />;
  if (!board.tile) return <Cleared columns={board.columns} />;

  const detail = readDetail(reveal?.detail);
  if (!reveal || !detail) return <Nothing line={awaitingReveal()} />;

  const aggregates = reveal.aggregates;
  const most = aggregates.reduce((high, row) => Math.max(high, row.count), 0);
  const answered = aggregates.reduce((total, row) => total + row.count, 0);
  // Played as a team vote, the shell draws each team's split under this view,
  // so the room's own split here would say the same thing twice.
  const teamVote = reveal.groups !== undefined;

  return (
    <section class="cb cb-host">
      <p class="cb-caption">{tileCaption(detail.category, detail.value)}</p>
      <p class="cb-answer-label">{gt('games.categoryBoard.view.answer', 'The answer')}</p>
      <h2 class="cb-answer">{reveal.correctLabel}</h2>
      {detail.reference !== null && <p class="cb-reference">{detail.reference}</p>}

      {!teamVote && (
        <>
          <ul class="cb-split" aria-label={gt('games.categoryBoard.view.howAnswered', 'How the group answered')}>
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
            {answered === 1
              ? gt('games.categoryBoard.view.oneAnswer', '1 answer — nobody is named.')
              : gt('games.categoryBoard.view.manyAnswers', '{count} answers — nobody is named.', { count: answered })}
          </p>
        </>
      )}

      <Board columns={board.columns} size="small" settled />
    </section>
  );
}
