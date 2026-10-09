/**
 * The big screen.
 *
 * During play it shows what the whole room may see: the public clue, large
 * enough to read from the back, and four lettered names. Every other clue is on
 * a phone, and the screen says so, because the game only works once people
 * start reading theirs aloud.
 *
 * At the reveal it shows the answer, how the room split — a bar and a count per
 * name, never a voter — and every clue with its reference, marked with where
 * it was, so the room can see which piece of evidence should have settled it.
 * A room voting as one group has its verdict here, in this layout; with teams
 * to compare, each team's is drawn below by the shell, which owns the vote.
 */

import type { GroupResult } from '../../../shared/protocol.js';
import type { HostViewProps } from '../../shell/gameViews.js';
import { WHERE_CAPTIONS, letterFor, readHostCase, readReveal } from './payload.js';

function Nothing({ line }: { line: string }) {
  return (
    <section class="det det-host">
      <p class="det-nothing">{line}</p>
    </section>
  );
}

function howToPlay(teamsEnabled: boolean): string {
  return teamsEnabled
    ? 'Every phone holds a different clue. Talk it over with your team, then vote on your phone — each team’s majority is its answer.'
    : 'Every phone holds a different clue. Talk it over, then vote on your phone — the room’s majority is the answer.';
}

function CaseBoard({ snapshot, view }: HostViewProps) {
  const board = readHostCase(view);
  if (!board) return <Nothing line="Nothing to show for this round." />;

  return (
    <section class="det det-host">
      <p class="det-ask">{board.question}</p>
      <p class="det-opening">“{board.opening}”</p>
      <p class="det-muted det-how">{howToPlay(snapshot.settings.teamsEnabled)}</p>
      <ol class="det-options" aria-label="The suspects">
        {board.options.map((option) => (
          <li key={option.index} class="det-option">
            <span class="det-letter">{letterFor(option.index)}</span>
            <span class="det-name">{option.label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export const HostQuestion = CaseBoard;
export const HostAnswering = CaseBoard;

/** The room's verdict, in words, for a room playing as one group. */
function roomVerdict(group: GroupResult): { line: string; tone: 'correct' | 'wrong' | 'none' } {
  if (group.correct === true) return { line: 'Case solved — every detective scores', tone: 'correct' };
  if (group.decided !== null) return { line: `The room chose ${group.decided} — not this time`, tone: 'wrong' };
  if (group.split.length === 0) return { line: 'Nobody voted', tone: 'none' };
  return { line: 'The room was split — nobody scores', tone: 'none' };
}

export function HostReveal({ reveal }: HostViewProps) {
  const detail = readReveal(reveal?.detail);
  if (!reveal || !detail) return <Nothing line="Waiting for the answer." />;

  const groups = reveal.groups ?? [];
  // One group is the whole room, teams on or off, and the shell leaves its
  // verdict to this view; with several, each team's is drawn below.
  const only = groups.length === 1 ? groups[0] : undefined;
  const verdict = only !== undefined ? roomVerdict(only) : null;

  const rows = reveal.aggregates;
  const most = rows.reduce((high, row) => Math.max(high, row.count), 0);
  const votes = rows.reduce((total, row) => total + row.count, 0);

  return (
    <section class="det det-host det-reveal">
      <div class="det-column">
        <p class="det-label">The answer</p>
        <h2 class="det-answer">{detail.person}</h2>
        {verdict !== null && (
          <p class="det-verdict" data-tone={verdict.tone}>
            {verdict.tone === 'correct' && <span aria-hidden="true">✓ </span>}
            {verdict.line}
          </p>
        )}
        {groups.length > 1 && <p class="det-muted">Each team’s verdict is below.</p>}

        <ul class="det-split" aria-label="How the room voted">
          {rows.map((row) => (
            <li key={row.label} class="det-split-row" data-correct={row.label === detail.person}>
              <span class="det-split-label">{row.label}</span>
              <span class="det-bar">
                <span
                  class="det-bar-fill"
                  style={{ width: `${most === 0 ? 0 : Math.round((row.count / most) * 100)}%` }}
                />
              </span>
              <span class="det-split-count">{row.count}</span>
            </li>
          ))}
        </ul>
        <p class="det-muted">{votes === 1 ? '1 vote' : `${votes} votes`} — nobody is named.</p>
      </div>

      <div class="det-column">
        <p class="det-label">The evidence</p>
        <ul class="det-evidence" aria-label="Every clue">
          {detail.clues.map((clue) => (
            <li key={clue.text} class="det-clue" data-where={clue.where}>
              <span>{clue.text}</span>
              <span class="det-muted det-small">
                {clue.reference === null ? '' : `${clue.reference} · `}
                {WHERE_CAPTIONS[clue.where]}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
