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
import { gt } from '../../shell/t.js';
import { awaitingReveal } from '../../shell/waitingCopy.js';
import { letterFor, readHostCase, readReveal, whereCaption } from './payload.js';

function Nothing({ line }: { line: string }) {
  return (
    <section class="det det-host">
      <p class="det-nothing">{line}</p>
    </section>
  );
}

function howToPlay(teamsEnabled: boolean): string {
  return teamsEnabled
    ? gt('games.detective.view.howTeams', 'Every phone holds a different clue. Talk it over with your team, then vote on your phone — each team’s majority is its answer.')
    : gt('games.detective.view.howGroup', 'Every phone holds a different clue. Talk it over, then vote on your phone — the group’s majority is the answer.');
}

function CaseBoard({ snapshot, view }: HostViewProps) {
  const board = readHostCase(view);
  if (!board) return <Nothing line={gt('games.detective.view.nothingToShow', 'Nothing to show for this round.')} />;

  return (
    <section class="det det-host">
      <p class="det-ask">{board.question}</p>
      <p class="det-opening">“{board.opening}”</p>
      <p class="det-muted det-how">{howToPlay(snapshot.settings.teamsEnabled)}</p>
      <ol class="det-options" aria-label={gt('games.detective.view.suspects', 'The suspects')}>
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

/** The group's verdict, in words, for everyone playing as one group. */
function roomVerdict(group: GroupResult): { line: string; tone: 'correct' | 'wrong' | 'none' } {
  if (group.correct === true) return { line: gt('games.detective.view.solved', 'Case solved — every detective scores'), tone: 'correct' };
  if (group.decided !== null) return { line: gt('games.detective.view.groupChose', 'The group chose {answer} — not this time', { answer: group.decided }), tone: 'wrong' };
  if (group.split.length === 0) return { line: gt('games.detective.view.nobodyVoted', 'Nobody voted'), tone: 'none' };
  return { line: gt('games.detective.view.groupSplit', 'The group was split — nobody scores'), tone: 'none' };
}

export function HostReveal({ reveal }: HostViewProps) {
  const detail = readReveal(reveal?.detail);
  if (!reveal || !detail) return <Nothing line={awaitingReveal()} />;

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
        <p class="det-label">{gt('games.detective.view.answer', 'The answer')}</p>
        <h2 class="det-answer">{detail.person}</h2>
        {verdict !== null && (
          <p class="det-verdict" data-tone={verdict.tone}>
            {verdict.tone === 'correct' && <span aria-hidden="true">✓ </span>}
            {verdict.line}
          </p>
        )}
        {groups.length > 1 && <p class="det-muted">{gt('games.detective.view.teamVerdicts', 'Each team’s verdict is below.')}</p>}

        <ul class="det-split" aria-label={gt('games.detective.view.howVoted', 'How the group voted')}>
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
        <p class="det-muted">{votes === 1
            ? gt('games.detective.view.oneVote', '1 vote — nobody is named.')
            : gt('games.detective.view.manyVotes', '{count} votes — nobody is named.', { count: votes })}</p>
      </div>

      <div class="det-column">
        <p class="det-label">{gt('games.detective.view.evidence', 'The evidence')}</p>
        <ul class="det-evidence" aria-label={gt('games.detective.view.everyClue', 'Every clue')}>
          {detail.clues.map((clue) => (
            <li key={clue.text} class="det-clue" data-where={clue.where}>
              <span>{clue.text}</span>
              <span class="det-muted det-small">
                {clue.reference === null ? '' : gt('games.detective.view.referencePrefix', '{reference} · ', { reference: clue.reference })}
                {whereCaption(clue.where)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
