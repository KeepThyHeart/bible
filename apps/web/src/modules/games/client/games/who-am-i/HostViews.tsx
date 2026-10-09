/**
 * The big screen.
 *
 * Sized for the back of a hall: the newest clue is the largest thing on the
 * screen, an option is a letter and a name and nothing else, and the right
 * answer at the reveal is marked with a word as well as a hue.
 *
 * What the screen shows of the room is how many got it at each clue, which is
 * the praise worth making public — the room that knew it at clue one — and
 * nothing about who guessed wrong. A wrong guess sits a player out of the whole
 * question, and that is exactly the thing that must not be visible from the
 * sofa; only the player's own phone says so.
 */

import type { HostViewProps } from '../../shell/gameViews.js';
import type { ScreenSnapshot } from '../../../shared/protocol.js';
import type { ClockPort } from '../../shell/clockPort.js';
import { LiveClues, RevealClues } from './ClueList.js';
import { useCluesShown } from './clues.js';
import { letterFor, readReveal, readRound, worthAt } from './payload.js';
import type { WhoAmIRound } from './payload.js';

function Nothing({ line }: { line: string }) {
  return (
    <section class="wai wai-host">
      <p class="wai-nothing">{line}</p>
    </section>
  );
}

function Options({ round }: { round: WhoAmIRound }) {
  return (
    <ol class="wai-options" aria-label="The options">
      {round.options.map((option) => (
        <li key={option.index} class="wai-option">
          <span class="wai-letter">{letterFor(option.index)}</span>
          <span class="wai-name">{option.label}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The room never enters a reading phase for this game — answers open with the
 * first clue — so this is drawn only if a room somehow does. It shows the first
 * clue and says answers are coming, which is the truth in that case.
 */
export function HostQuestion({ view }: HostViewProps) {
  const round = readRound(view);
  if (!round) return <Nothing line="Nothing to show for this round." />;

  return (
    <section class="wai wai-host">
      <h2 class="wai-ask">Who am I?</h2>
      <LiveClues clues={round.clues} shown={1} size="large" />
      <p class="wai-muted">Answers open in a moment.</p>
    </section>
  );
}

function LiveQuestion({ round, snapshot, clock }: { round: WhoAmIRound; snapshot: ScreenSnapshot; clock: ClockPort }) {
  const shown = useCluesShown(round, snapshot, clock);

  return (
    <section class="wai wai-host">
      <h2 class="wai-ask">Who am I?</h2>
      <LiveClues clues={round.clues} shown={shown} size="large" />
      <p class="wai-worth">
        Clue {shown} of {round.clues.length} · worth {worthAt(shown)}
      </p>
      <Options round={round} />
      <p class="wai-muted">
        {round.groupVote
          ? 'Each team votes on its phones, and can change its mind until time runs out. The sooner a team agrees, the more it is worth.'
          : round.pacing === 'player'
            ? 'One guess each. Turn the clues over on your phone.'
            : 'One guess each, on your phone. The sooner you are sure, the more it is worth.'}
      </p>
    </section>
  );
}

export function HostAnswering({ view, snapshot, clock }: HostViewProps) {
  const round = readRound(view);
  if (!round) return <Nothing line="Nothing to show for this round." />;
  return <LiveQuestion round={round} snapshot={snapshot} clock={clock} />;
}

/**
 * Under a team vote the counts per clue are still everyone's own votes, which
 * the teams' splits below this view do not show: those say who each team
 * chose, not when. So the ladder stays, and only its summary line changes, to
 * count votes rather than people who got it.
 */
export function HostReveal({ reveal }: HostViewProps) {
  const detail = readReveal(reveal?.detail);
  if (!reveal || !detail) return <Nothing line="Waiting for the answer." />;
  const teamVote = reveal.groups !== undefined;

  return (
    <section class="wai wai-host">
      <p class="wai-answer-label">I am</p>
      <h2 class="wai-answer">{detail.person}</h2>
      <RevealClues clues={detail.clues} counts={true} size="large" />
      <p class="wai-muted">
        {detail.gotIt === 0
          ? 'A hard one — nobody had it this time.'
          : teamVote
            ? `${detail.gotIt === 1 ? '1 vote' : `${detail.gotIt} votes`} named ${detail.person}. Nobody is named.`
            : `${detail.gotIt === 1 ? '1 person' : `${detail.gotIt} people`} got it. Nobody is named.`}
      </p>
    </section>
  );
}
